/**
 * Background auto-workers for the Telegram bot process (the only always-on
 * daemon with DB + admin-alert access). Two independent, kill-switched loops:
 *
 *  • Auto-buyout (+1): buys new PENDING orders automatically with the donor
 *    cookie until the balance reaches the drain threshold, then alerts admins
 *    to drain manually. Guards: kill-switch OFF by default, per-tick cap,
 *    atomic PENDING→IN_PROGRESS claim (no race with the TWA manual buyout),
 *    expected-price validation, consecutive-failure backoff.
 *
 *  • GP-watcher (+3): for AWAITING_GAMEPASS orders that carry a probable nick
 *    (captured "in pencil") but no confirmed gamepass, polls Roblox for a
 *    for-sale gamepass at the expected price. When one appears, pings the
 *    customer to confirm — confirmation (handled in handlers.ts) promotes the
 *    order to PENDING, where the auto-buyout loop (or a manager) takes it.
 *
 * Both notify via raw tgSend/vkSend + admin alerts. Only auto-workers → handlers
 * imports notifyUserCompleted (one direction — no import cycle).
 */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { tgSend, vkSend, escapeHtml } from "../shared/notify";
import {
  getGamepassProductInfo,
  purchaseGamepassVerified,
  getRobuxBalance,
} from "../shared/roblox";
import { searchGamepassesByNick } from "../shared/gamepass-search";
import { runDrain, drainAuthedUser, drainUserGamepasses, ownsGamepass, drainCurrency } from "../shared/drain";
import { notifyUserCompleted } from "./handlers";
import { buildOrderProfitSnapshot } from "../shared/order-profit";

const expectedPrice = (amount: number) => Math.ceil(amount / 0.7);
const PRICE_TOL = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));

async function alertAdmins(html: string): Promise<void> {
  await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, html, { parse_mode: "HTML" })));
}

function gpMatch(url: string | null | undefined): string | null {
  const m = url?.match(/game-pass(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

// ── One-shot adminNote annotation (best-effort, dedup by marker) ─────────────
async function annotateOnce(orderId: string, marker: string, line: string): Promise<void> {
  try {
    const o = await (db as any).wbOrder.findUnique({ where: { id: orderId }, select: { adminNote: true } });
    if (o?.adminNote?.includes(marker)) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = o?.adminNote ? `${o.adminNote}\n` : "";
    await (db as any).wbOrder.update({
      where: { id: orderId },
      data: { adminNote: `${prefix}${marker} ${stamp} ${line}`.slice(0, 2000) },
    });
  } catch { /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// +1 Auto-buyout
// ─────────────────────────────────────────────────────────────────────────────

// In-memory guards (reset on process restart — by design).
let consecutiveFails = 0;
let backoffUntil = 0;
const autobuyTickRunning = { v: false };
// Orders that hard-failed this run (e.g. "already owned") — don't retry until restart.
const autobuySkip = new Set<string>();

async function maybeThresholdAlert(settings: any, balance: number): Promise<void> {
  const threshold = settings.autoBuyoutThreshold ?? 150;
  if (balance > threshold) {
    // Recovered above threshold (topped up) → reset the alert dedup.
    if (settings.autoBuyoutBelowSince) {
      await (db as any).globalSettings.update({ where: { id: "global" }, data: { autoBuyoutBelowSince: null } });
    }
    return;
  }
  // П7: баланс 0 — сливать уже нечего (аккаунт слит); молчим и дедуп не взводим,
  // чтобы после пополнения цикл начался чисто.
  if (balance <= 0) return;
  const since = settings.autoBuyoutBelowSince ? new Date(settings.autoBuyoutBelowSince).getTime() : 0;
  const sixHours = 6 * 60 * 60 * 1000;
  if (Date.now() - since < sixHours) return; // already alerted recently
  await (db as any).globalSettings.update({ where: { id: "global" }, data: { autoBuyoutBelowSince: new Date() } });
  await alertAdmins(
    `💧 <b>Пора сливать остаток</b>\n` +
    `Баланс донора <b>${balance.toLocaleString()} R$</b> ≤ порога <b>${threshold} R$</b>.\n` +
    `Автовыкуп не покупает ниже порога — остаток предназначен сливу (💧 в TWA).`
  );
}

export async function runAutoBuyoutTick(bot: Telegraf): Promise<void> {
  if (autobuyTickRunning.v || Date.now() < backoffUntil) return;
  autobuyTickRunning.v = true;
  try {
    const settings = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
    if (!settings?.autoBuyoutEnabled) return;

    const cookie = settings.robloxCookie;
    if (!cookie) { await alertAdmins("⚠️ Автовыкуп включён, но cookie донора не задан (/setcookie)."); return; }

    let balance = await getRobuxBalance(cookie);
    if (balance === null) {
      await alertAdmins("⚠️ Автовыкуп: не удалось прочитать баланс донора (cookie протух?). Тик пропущен.");
      return;
    }

    const threshold = settings.autoBuyoutThreshold ?? 150;
    if (balance <= threshold) { await maybeThresholdAlert(settings, balance); return; }

    const maxPerTick = settings.autoBuyoutMaxPerTick ?? 5;
    const orders = await (db as any).wbOrder.findMany({
      // Пояс+подтяжки (П5): неоплаченный DIR в PENDING оказаться не должен
      // (guard'ы в TWA), но даже если окажется — автовыкуп его не тронет.
      where: { status: "PENDING", isTest: false, NOT: { isDirectOrder: true, paidAt: null } },
      orderBy: { pendingAt: "asc" },
      take: maxPerTick + autobuySkip.size, // headroom so skipped ones don't starve the tick
      include: { user: { select: { id: true, tgId: true, vkId: true } } },
    });

    let bought = 0;
    for (const order of orders) {
      if (bought >= maxPerTick) break;
      if (autobuySkip.has(order.id)) continue;

      const gpId = gpMatch(order.gamepassUrl);
      if (!gpId) continue;

      const info = await getGamepassProductInfo(gpId, cookie);
      if (!info) { autobuySkip.add(order.id); await annotateOnce(order.id, "[AUTOBUY-SKIP", "product-info недоступен"); continue; }

      const want = expectedPrice(order.amount);
      if (!info.isForSale) { autobuySkip.add(order.id); await annotateOnce(order.id, "[AUTOBUY-SKIP", "не на продаже"); continue; }
      if (Math.abs(info.userBasePriceInRobux - want) > PRICE_TOL) {
        autobuySkip.add(order.id);
        await annotateOnce(order.id, "[AUTOBUY-SKIP", `базовая цена ${info.userBasePriceInRobux}≠ожид ${want} — ручной выкуп`);
        continue;
      }
      if (info.hasUnsafeBuyerPrice) {
        autobuySkip.add(order.id);
        await (db as any).wbOrder.update({
          where: { id: order.id },
          data: { status: "ERROR", buyoutErrorCode: "REGIONAL_PRICE" },
        });
        await annotateOnce(order.id, "[РЕГ-ЦЕНА", `донор ${info.priceInRobux} R$, база ${info.userBasePriceInRobux} R$ — нужен выкуп из TWA с автозаменой`);
        await alertAdmins(`⚠️ <b>Рег. цена</b> · ${order.wbCode}\n${info.priceInRobux}/${info.userBasePriceInRobux} R$ — заказ перенесён в ошибку; автозамена доступна в TWA.`);
        continue;
      }
      // Seller must match the confirmed nick when we have one (guards a swapped GP).
      if (order.robloxUsername && info.creatorName &&
          order.robloxUsername.toLowerCase() !== info.creatorName.toLowerCase()) {
        autobuySkip.add(order.id);
        await annotateOnce(order.id, "[AUTOBUY-SKIP", `продавец ${info.creatorName}≠ник ${order.robloxUsername}`);
        continue;
      }
      if (balance - info.priceInRobux < 0) continue; // wait for balance / drain

      // Atomic claim — count 0 means a manager grabbed it in the TWA meanwhile.
      const claim = await (db as any).wbOrder.updateMany({
        where: { id: order.id, status: "PENDING" },
        data: { status: "IN_PROGRESS" },
      });
      if (claim.count === 0) continue;

      // Ф1: покупка с контрольной проверкой владения — таймаут/5xx у Roblox
      // нередко значит «куплено»; recovered-успех спасает заказ от ложного отката.
      const result = await purchaseGamepassVerified(info.productId, info.priceInRobux, info.creatorId, cookie, gpId);

      const isAlreadyOwned = !result.success && /already.?own/i.test(result.msg);

      if (result.success || isAlreadyOwned) {
        consecutiveFails = 0;
        const money = buildOrderProfitSnapshot(order, settings, result.price ?? info.priceInRobux);
        await (db as any).wbOrder.updateMany({
          where: { id: order.id, status: "IN_PROGRESS" },
          data: { status: "COMPLETED", buyoutErrorCode: null, purchaseRate: settings.purchaseRate ?? null, purchaserUsername: settings.robloxAccountName ?? null, completedAt: new Date(), ...(money ?? {}) },
        });
        if (order.user) {
          try { await notifyUserCompleted(bot, order.user, order.id, order.amount, order.isDirectOrder ?? false); } catch { /* user may have blocked */ }
        }
        if (result.recovered) {
          // Робуксы реально списаны, но цены из ответа нет — перечитываем баланс.
          await annotateOnce(order.id, "[AUTOBUY-RECOVERED", "владение подтверждено после ошибки ответа Roblox");
          const fresh = await getRobuxBalance(cookie);
          balance = fresh ?? (balance - (result.price ?? info.priceInRobux));
        } else if (!isAlreadyOwned) {
          balance -= (result.price ?? info.priceInRobux);
        }
        bought++;
        const ownedTag = isAlreadyOwned ? " (AlreadyOwned)"
          : result.recovered ? " (✅ recovered — владение подтверждено после ошибки)" : "";
        await alertAdmins(
          `🤖 <b>Автовыкуп</b> · <code>${order.wbCode}</code> · ${result.price ?? info.priceInRobux} R$ · ` +
          `${escapeHtml(info.creatorName)} — ✅${ownedTag}\n💰 Баланс донора: ${balance.toLocaleString()} R$`
        );
        if (balance <= threshold) { await maybeThresholdAlert({ ...settings, autoBuyoutBelowSince: null }, balance); break; }
        await sleep(jitter(2000, 8000));
      } else {
        // Revert claim, record, and count the failure.
        await (db as any).wbOrder.updateMany({ where: { id: order.id, status: "IN_PROGRESS" }, data: { status: "PENDING" } });
        consecutiveFails++;
        const cookieDead = result.reason === "CookieExpired";
        await annotateOnce(order.id, "[AUTOBUY-FAIL", result.msg.slice(0, 120));
        await alertAdmins(
          `⚠️ <b>Автовыкуп не прошёл</b> · <code>${order.wbCode}</code> · ${info.priceInRobux} R$\n` +
          `Причина: <code>${escapeHtml(result.msg)}</code>`
        );
        if (cookieDead || consecutiveFails >= 3) {
          backoffUntil = Date.now() + 15 * 60 * 1000;
          await alertAdmins(
            `⛔ <b>Автовыкуп приостановлен на 15 мин</b> (${cookieDead ? "cookie протух" : "3 ошибки подряд"}).\n` +
            `Kill-switch НЕ снят — проверь донора и /autobuy status.`
          );
          break;
        }
        await sleep(jitter(2000, 5000));
      }
    }
  } catch (err: any) {
    console.error("[auto-buyout] tick error:", err?.message ?? err);
  } finally {
    autobuyTickRunning.v = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// +5.G.3 Auto-drain — слив остатка донора в приёмник, когда баланс упал ниже
// минимальной цены выкупа (143 R$ грязными = 100 R$ чистыми). Kill-switch OFF.
// ─────────────────────────────────────────────────────────────────────────────

/** Минимальная грязная цена выкупа: ceil(100 / 0.7). Ниже неё донор бесполезен. */
export const AUTO_DRAIN_BELOW = 143;

const autoDrainTickRunning = { v: false };
let autoDrainBackoffUntil = 0;
// Дедуп алертов «все пассы заняты / нет кандидата» — не чаще раза в 6 ч.
let noCandidateAlertAt = 0;

export async function runAutoDrainTick(): Promise<void> {
  if (autoDrainTickRunning.v || Date.now() < autoDrainBackoffUntil) return;
  autoDrainTickRunning.v = true;
  try {
    const s = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
    if (!s?.autoDrainEnabled) return;
    const donorCookie: string | undefined = s.robloxCookie;
    const drainCookie: string | undefined = s.drainCookie;
    if (!donorCookie || !drainCookie) return; // без пары cookie сливать нечем

    const balance = await drainCurrency(donorCookie);
    if (balance === null) {
      autoDrainBackoffUntil = Date.now() + 15 * 60 * 1000;
      await alertAdmins("⚠️ Автослив: не удалось прочитать баланс донора (cookie протух?). Пауза 15 мин.");
      return;
    }
    // Сливаем только «мёртвый» остаток: 0 < баланс < минимальной цены выкупа.
    // Выше порога остаток ещё нужен автовыкупу/менеджеру.
    if (balance < 1 || balance >= AUTO_DRAIN_BELOW) return;

    const [donor, receiver] = await Promise.all([
      drainAuthedUser(donorCookie),
      drainAuthedUser(drainCookie),
    ]);
    if (!donor || !receiver) {
      autoDrainBackoffUntil = Date.now() + 15 * 60 * 1000;
      await alertAdmins("⚠️ Автослив: cookie донора или приёмника невалиден. Пауза 15 мин.");
      return;
    }

    // Кандидат: пасс приёмника, которым донор ещё НЕ владеет (Roblox не даёт
    // владеть двумя копиями — «один пасс = один слив на донора»). Настроенный
    // drainGamepassId пробуем первым.
    const passes = await drainUserGamepasses(receiver.id, drainCookie);
    if (s.drainGamepassId) {
      const idx = passes.findIndex((p) => p.gamepassId === String(s.drainGamepassId));
      if (idx > 0) passes.unshift(passes.splice(idx, 1)[0]);
    }
    let candidate: { gamepassId: string; name: string } | null = null;
    for (const p of passes) {
      const owned = await ownsGamepass(donor.id, p.gamepassId);
      if (owned === false) { candidate = p; break; }
      // owned === null (проверка не удалась) — пасс пропускаем, не рискуем.
    }
    if (!candidate) {
      if (Date.now() - noCandidateAlertAt > 6 * 60 * 60 * 1000) {
        noCandidateAlertAt = Date.now();
        await alertAdmins(
          `💧 <b>Автослив: нет свободного геймпасса приёмника</b>\n` +
          `Баланс донора <b>${balance} R$</b> &lt; ${AUTO_DRAIN_BELOW} R$, но все пассы ` +
          `приёмника (${passes.length}) донор уже выкупал. Создай новый геймпасс у ` +
          `<b>${escapeHtml(receiver.name)}</b> — или слей вручную из TWA с другим донором.`
        );
      }
      return;
    }

    const res = await runDrain(donorCookie, drainCookie, candidate.gamepassId);
    if (res.success) {
      await (db as any).drainEvent.create({
        data: {
          donorName: donor.name,
          drainName: receiver.name,
          amount: res.drained ?? balance,
          gamepassId: candidate.gamepassId,
          source: "auto",
        },
      }).catch((e: any) => console.warn("[auto-drain] DrainEvent write failed:", e?.message ?? e));
      // П7: слив состоялся — сброс дедупа «пора сливать», следующий цикл чистый.
      await (db as any).globalSettings.update({
        where: { id: "global" }, data: { autoBuyoutBelowSince: null },
      }).catch(() => {});
      await alertAdmins(
        `💧 <b>Автослив: ${res.drained ?? balance} R$ → ${escapeHtml(receiver.name)}</b>\n` +
        `Пасс «${escapeHtml(candidate.name)}» · донор ${escapeHtml(donor.name)}\n` +
        `Баланс донора: ${res.donorBalanceAfter ?? "?"} R$ · приёмника: ${res.drainBalanceAfter ?? "?"} R$`
      );
    } else {
      autoDrainBackoffUntil = Date.now() + 15 * 60 * 1000;
      await alertAdmins(
        `⚠️ <b>Автослив не прошёл</b> (пауза 15 мин)\n` +
        `Пасс «${escapeHtml(candidate.name)}» · ${balance} R$\n` +
        `Причина: <code>${escapeHtml(res.msg)}</code>`
      );
    }
  } catch (err: any) {
    console.error("[auto-drain] tick error:", err?.message ?? err);
  } finally {
    autoDrainTickRunning.v = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// +3 GP-watcher
// ─────────────────────────────────────────────────────────────────────────────

const gpWatchTickRunning = { v: false };

export async function runGpWatchTick(bot: Telegraf): Promise<void> {
  if (gpWatchTickRunning.v) return;
  gpWatchTickRunning.v = true;
  try {
    const settings = await (db as any).globalSettings.findUnique({ where: { id: "global" }, select: { gpWatchEnabled: true, gpWatchNotify: true } });
    if (!settings?.gpWatchEnabled) return;
    const mode: string = settings.gpWatchNotify ?? "both";
    const pingCustomer = mode !== "admin";
    const alertAdmin   = mode !== "customer";

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await (db as any).wbOrder.findMany({
      where: {
        status: "AWAITING_GAMEPASS",
        isTest: false,
        robloxUsername: null,            // user hasn't confirmed a different nick
        probableNick: { not: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { probableNickAt: "desc" },
      take: 60, // fetched wide; per-order throttle trims to ~20 actual Roblox checks
      include: { user: { select: { tgId: true, vkId: true } } },
    });

    const now = Date.now();
    let checked = 0;
    for (const order of candidates) {
      if (checked >= 20) break;
      // Throttle: fresh orders (<3d) every tick; older ones every 2h.
      const ageMs = now - new Date(order.createdAt).getTime();
      const minGap = ageMs < 3 * 24 * 60 * 60 * 1000 ? 0 : 2 * 60 * 60 * 1000;
      const lastCheck = order.gpWatchLastCheckAt ? new Date(order.gpWatchLastCheckAt).getTime() : 0;
      if (now - lastCheck < minGap) continue;
      checked++;

      await (db as any).wbOrder.update({ where: { id: order.id }, data: { gpWatchLastCheckAt: new Date() } });

      const want = expectedPrice(order.amount);
      let outcome;
      try { outcome = await searchGamepassesByNick(order.probableNick, want); }
      catch { continue; }
      if (outcome.status !== "ok" || outcome.matches.length === 0) continue;

      const pass = outcome.matches[0];
      if (String(pass.gamepassId) === order.gpWatchNotifiedPassId) continue; // already pinged for this pass

      // Claim the dedup slot before sending (no double-ping if we crash mid-send),
      // but ROLL BACK on a confirmed delivery failure so the next tick retries.
      await (db as any).wbOrder.update({ where: { id: order.id }, data: { gpWatchNotifiedPassId: String(pass.gamepassId) } });

      let delivered: "tg" | "vk" | "skip" | null = pingCustomer ? null : "skip";
      if (pingCustomer) {
        const tgMsg =
          `🎉 <b>Похоже, твой геймпасс готов!</b>\n\n` +
          `Ник: <b>${escapeHtml(order.probableNick)}</b>\n` +
          `Геймпасс: <b>${escapeHtml(pass.name)}</b> · <b>${pass.robux} R$</b>\n\n` +
          `Это твой геймпасс? Подтверди — и мы сразу заберём его в выкуп 💛`;
        const kb = {
          inline_keyboard: [[
            { text: "✅ Да, это мой", callback_data: `gpw_ok:${order.id}` },
            { text: "❌ Не мой ник", callback_data: `gpw_no:${order.id}` },
          ]],
        };

        if (order.user?.tgId) {
          const res = await tgSend(order.user.tgId, tgMsg, { parse_mode: "HTML", reply_markup: kb });
          if ((res as any)?.ok !== false) delivered = "tg";
        } else if (order.user?.vkId) {
          const vkKb = JSON.stringify({
            inline: true,
            buttons: [[
              { action: { type: "text", label: "✅ Да, это мой", payload: JSON.stringify({ command: "gpw_ok", orderId: order.id }) }, color: "positive" },
              { action: { type: "text", label: "❌ Не мой ник", payload: JSON.stringify({ command: "gpw_no", orderId: order.id }) }, color: "negative" },
            ]],
          });
          const ok = await vkSend(order.user.vkId,
            `🎉 Похоже, твой геймпасс готов!\n\nНик: ${order.probableNick}\nГеймпасс: ${pass.name} · ${pass.robux} R$\n\n` +
            `Это твой геймпасс? Подтверди — заберём его в выкуп 💛`,
            { keyboard: vkKb });
          if (ok) delivered = "vk";
        }

        if (delivered === null) {
          // Confirmed failure (e.g. VK 901) — free the dedup slot for a retry.
          await (db as any).wbOrder.update({ where: { id: order.id }, data: { gpWatchNotifiedPassId: null } });
        }
      }

      if (alertAdmin) {
        const pingLine =
          delivered === "skip" ? "клиенту НЕ отправлял (режим admin) — оповести из карточки TWA" :
          delivered            ? `клиент оповещён (${delivered.toUpperCase()}), ждём ✅/❌` :
                                 "⚠️ пинг клиенту НЕ доставлен — повторим следующим тиком";
        await alertAdmins(
          `👁 <b>GP-watch: нашёл геймпасс по вероятному нику</b>\n` +
          `Заказ <code>${order.wbCode}</code> · ник <b>${escapeHtml(order.probableNick)}</b>\n` +
          `«${escapeHtml(pass.name)}» · <b>${pass.robux} R$</b> (ожидалось ${want})\n` +
          `${pingLine}\n` +
          `📊 TWA: поиск <code>${order.wbCode}</code>`
        );
      }
      await sleep(jitter(1500, 4000));
    }
  } catch (err: any) {
    console.error("[gp-watch] tick error:", err?.message ?? err);
  } finally {
    gpWatchTickRunning.v = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────────────────────

export function startAutoWorkers(bot: Telegraf): void {
  // Auto-buyout: 60 s cadence.
  setTimeout(() => runAutoBuyoutTick(bot).catch((e) => console.error("[auto-buyout] boot:", e)), 50_000);
  setInterval(() => runAutoBuyoutTick(bot).catch((e) => console.error("[auto-buyout] tick:", e)), 60_000);

  // GP-watcher: hourly cadence (owner 2026-07-04: «каждые 15 мин — часто,
  // я бы сделал каждый час хотя бы»). Boot tick stays at +70s so a fresh
  // deploy proves the worker alive within минуты, не через час.
  setTimeout(() => runGpWatchTick(bot).catch((e) => console.error("[gp-watch] boot:", e)), 70_000);
  setInterval(() => runGpWatchTick(bot).catch((e) => console.error("[gp-watch] tick:", e)), 60 * 60 * 1000);

  // Auto-drain: 15-минутный цикл (слив — редкое событие, чаще незачем).
  setTimeout(() => runAutoDrainTick().catch((e) => console.error("[auto-drain] boot:", e)), 90_000);
  setInterval(() => runAutoDrainTick().catch((e) => console.error("[auto-drain] tick:", e)), 15 * 60 * 1000);

  console.log("[auto-buyout] worker started ✅ (kill-switch in GlobalSettings.autoBuyoutEnabled)");
  console.log("[gp-watch] worker started ✅ (kill-switch in GlobalSettings.gpWatchEnabled)");
  console.log("[auto-drain] worker started ✅ (kill-switch in GlobalSettings.autoDrainEnabled)");
}
