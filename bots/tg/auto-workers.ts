/**
 * Фоновые задачи TG-бота (единственный всегда работающий процесс с доступом к
 * базе и алертам админам):
 *
 *  • GP-watcher (+3): для AWAITING_GAMEPASS с вероятным ником ищет в Roblox
 *    выставленный пасс по нужной цене и просит покупателя подтвердить —
 *    подтверждение (handlers.ts) переводит заказ в PENDING, дальше менеджер.
 *  • Срок токена WB и обращения покупателей — см. расписание внизу.
 *
 * Автовыкуп и автослив донора удалены 11.11.2026: донора как модели нет,
 * браузерный сервис не работает, выкуп идёт вручную.
 */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { tgSend, tgDeliveryOutcome, vkSend, vkCanReceive, escapeHtml } from "../shared/notify";

import { searchGamepassesByNick } from "../shared/gamepass-search";



import { runWbTokenWatch } from "../shared/wb-token-watch";
import { runBuyerContactSweep } from "../shared/buyer-contact-sweep";
import { syncOrderPins } from "../shared/order-pin";
import { reconcileNoticeLine, runWbSalesReconcile } from "../shared/wb-sales-reconcile";
import { notifyWbReconcile } from "../shared/wb-delivery-admin-notify";
import { questionsAutoreplyEnabled, runWbQuestionsSweep } from "../shared/wb-questions-sweep";
import { paDeskMode, runPaDeskSweep } from "./pa-desk-worker";


const expectedPrice = (amount: number) => Math.ceil(amount / 0.7);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));

async function alertAdmins(html: string): Promise<void> {
  await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, html, { parse_mode: "HTML" })));
}


// ── One-shot adminNote annotation (best-effort, dedup by marker) ─────────────

// ─────────────────────────────────────────────────────────────────────────────
// +1 Auto-buyout
// ─────────────────────────────────────────────────────────────────────────────



// ─────────────────────────────────────────────────────────────────────────────
// +5.G.3 Auto-drain — слив остатка донора в приёмник, когда баланс упал ниже
// минимальной цены выкупа (143 R$ грязными = 100 R$ чистыми). Kill-switch OFF.
// ─────────────────────────────────────────────────────────────────────────────




// ─────────────────────────────────────────────────────────────────────────────
// +3 GP-watcher
// ─────────────────────────────────────────────────────────────────────────────

const gpWatchTickRunning = { v: false };

export async function runGpWatchTick(bot: Telegraf): Promise<void> {
  if (gpWatchTickRunning.v) return;
  gpWatchTickRunning.v = true;
  try {
    const settings = await db.globalSettings.findUnique({ where: { id: "global" }, select: { gpWatchEnabled: true, gpWatchNotify: true } });
    if (!settings?.gpWatchEnabled) return;
    const mode: string = settings.gpWatchNotify ?? "both";
    const pingCustomer = mode !== "admin";
    const alertAdmin   = mode !== "customer";

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await db.wbOrder.findMany({
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

      await db.wbOrder.update({ where: { id: order.id }, data: { gpWatchLastCheckAt: new Date() } });

      const want = expectedPrice(order.amount);
      let outcome;
      try { outcome = await searchGamepassesByNick(order.probableNick!, want); }
      catch { continue; }
      if (outcome.status !== "ok" || outcome.matches.length === 0) continue;

      const pass = outcome.matches[0];
      if (String(pass.gamepassId) === order.gpWatchNotifiedPassId) continue; // already pinged for this pass

      // Claim the dedup slot before sending (no double-ping if we crash mid-send),
      // but ROLL BACK on a confirmed delivery failure so the next tick retries.
      await db.wbOrder.update({ where: { id: order.id }, data: { gpWatchNotifiedPassId: String(pass.gamepassId) } });

      // Исход пинга: доставлен / клиенту писать нельзя вообще / временный сбой.
      // Временный сбой — единственный повод повторить на следующем тике, и
      // только он молчит перед админами: алерт уходит один раз, когда исход
      // известен. Раньше любой отказ сбрасывал дедуп, и тот же пасс каждый час
      // рождал тот же алерт (FLBDVYK: покупатель заблокировал бота, 11.10.2026).
      let delivered: "tg" | "vk" | "skip" | "unreachable" | null = pingCustomer ? null : "skip";
      if (pingCustomer) {
        const tgMsg =
          `🎉 <b>Похоже, твой геймпасс готов!</b>\n\n` +
          `Ник: <b>${escapeHtml(order.probableNick!)}</b>\n` +
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
          const outcome = tgDeliveryOutcome(res);
          delivered = outcome === "delivered" ? "tg" : outcome === "permanent" ? "unreachable" : null;
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
          // VK 901 («нет разрешения на сообщения») не лечится повтором —
          // спрашиваем VK прямо, а не гадаем по коду ошибки.
          if (ok) delivered = "vk";
          else if ((await vkCanReceive(order.user.vkId)) === false) delivered = "unreachable";
        } else {
          delivered = "unreachable";
        }

        if (delivered === null) {
          // Временный сбой — освобождаем дедуп, следующий тик попробует снова.
          // Админов не будим: они узнают исход, когда он станет известен.
          await db.wbOrder.update({ where: { id: order.id }, data: { gpWatchNotifiedPassId: null } });
          continue;
        }
      }

      if (alertAdmin) {
        const pingLine =
          delivered === "skip"        ? "клиенту НЕ отправлял (режим admin) — оповести из карточки TWA" :
          delivered === "unreachable" ? "📵 клиенту написать нельзя (заблокировал бота / закрыл сообщения) — подтверди пасс сам или напиши в чат WB" :
                                        `клиент оповещён (${String(delivered).toUpperCase()}), ждём ✅/❌`;
        await alertAdmins(
          `👁 <b>GP-watch: нашёл геймпасс по вероятному нику</b>\n` +
          `Заказ <code>${order.wbCode}</code> · ник <b>${escapeHtml(order.probableNick!)}</b>\n` +
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
  // GP-watcher: hourly cadence (owner 2026-07-04: «каждые 15 мин — часто,
  // я бы сделал каждый час хотя бы»). Boot tick stays at +70s so a fresh
  // deploy proves the worker alive within минуты, не через час.
  setTimeout(() => runGpWatchTick(bot).catch((e) => console.error("[gp-watch] boot:", e)), 70_000);
  setInterval(() => runGpWatchTick(bot).catch((e) => console.error("[gp-watch] tick:", e)), 60 * 60 * 1000);

  // Срок токена WB: раз в час, первый прогон через 2 минуты после старта
  // (01.11.2026 токен истёк молча — бот 7 часов не видел заказы DBS).
  setTimeout(() => runWbTokenWatch(alertAdmins).catch((e) => console.error("[wb-token] boot:", e)), 120_000);
  setInterval(() => runWbTokenWatch(alertAdmins).catch((e) => console.error("[wb-token] tick:", e)), 60 * 60 * 1000);

  // Обращения покупателей: отметки BUYER_CANCEL/BUYER_HELP (с 03.11 без заморозки и пуша).
  const buyerSweep = () => runBuyerContactSweep(db)
    .then((r) => { if (r.cancel || r.help) console.log(`[buyer-contacts] отмена ${r.cancel}, нужен человек ${r.help}`); })
    .catch((e) => console.error("[buyer-contacts] tick:", e));
  setTimeout(buyerSweep, 150_000);
  setInterval(buyerSweep, 3 * 60 * 1000);

  // Сверка денег WB с выдачей (12.11.2026): продажи/возвраты статистики против
  // наших заказов. Сама ходит в WB раз в 3 часа; тик чаще — чтобы рестарт не
  // откладывал проход. Находки — в «Риски» и одним пушем.
  const reconcile = () => runWbSalesReconcile(db)
    .then((r) => {
      if (r.skipped) return;
      console.log(`[wb-reconcile] продаж ${r.sales}, новых расхождений ${r.fresh.length}, открыто ${JSON.stringify(r.open)}`);
      notifyWbReconcile(r.fresh.map((f) => reconcileNoticeLine(f, escapeHtml)), r.fresh.length);
    })
    .catch((e) => console.error("[wb-reconcile] tick:", e instanceof Error ? e.message : e));
  setTimeout(reconcile, 240_000);
  setInterval(reconcile, 15 * 60 * 1000);

  // Вопросы к карточкам WB (12.11.2026): типовые — ответ шаблоном, код в вопросе —
  // отклонить, жалоба — шаблон + «Риски» + пуш. Выключатель WB_QUESTIONS_AUTOREPLY=off.
  const questions = () => {
    if (!questionsAutoreplyEnabled()) return;
    runWbQuestionsSweep(db)
      .then((r) => {
        if (r.seen) console.log(`[wb-questions] вопросов ${r.seen}: ответ ${r.answered}, скрыто ${r.rejected}, жалоб ${r.complaints}, без шаблона ${r.unknown}, не ушло ${r.failed}`);
      })
      .catch((e) => console.error("[wb-questions] tick:", e instanceof Error ? e.message : e));
  };
  setTimeout(questions, 300_000);
  setInterval(questions, 10 * 60 * 1000);

  // Разметка чатов поддержки @RobloxBank_PA (12.11.2026): метки в именах контактов
  // и папки по заказам. Никому не пишет. Env: PA_API_ID/PA_API_HASH/PA_SESSION, PA_DESK=off|dry.
  const mode = paDeskMode();
  if (mode !== "off") {
    let running = false;
    const desk = () => {
      if (running) return;
      running = true;
      runPaDeskSweep(mode)
        .then((r) => {
          if (r && (r.renamed || r.foldersUpdated)) {
            console.log(`[pa-desk] чатов ${r.chats}, с заказами ${r.linked}, меток ${r.renamed}, папок обновлено ${r.foldersUpdated} ${JSON.stringify(r.folders)}`);
          }
        })
        .catch((e) => console.error("[pa-desk] tick:", e instanceof Error ? e.message : e))
        .finally(() => { running = false; });
    };
    setTimeout(desk, 120_000);
    setInterval(desk, 5 * 60 * 1000);
  }

  // Живой закреп заказа: «ждём пасс → в очереди → выкуплен» правится на месте.
  // Сообщение удалено / бот заблокирован — стадию двигаем, чтобы не биться вечно.
  const pinSweep = () => syncOrderPins(db, "TG", async (pin, text) => {
    try {
      await bot.telegram.editMessageText(pin.chatId, pin.messageId, undefined, text, { parse_mode: "HTML" });
      return {};
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (/message is not modified/i.test(msg)) return {};
      if (/message to edit not found|chat not found|bot was blocked|user is deactivated|MESSAGE_ID_INVALID/i.test(msg)) {
        console.warn(`[order-pin] TG ${pin.code}: закреп недоступен (${msg.slice(0, 80)})`);
        return {};
      }
      throw err;
    }
  })
    .then((n) => { if (n) console.log(`[order-pin] TG обновлено закрепов: ${n}`); })
    .catch((e) => console.error("[order-pin] TG tick:", e));
  setTimeout(pinSweep, 90_000);
  setInterval(pinSweep, 2 * 60 * 1000);

  console.log("[gp-watch] worker started ✅ (kill-switch in GlobalSettings.gpWatchEnabled)");
}
