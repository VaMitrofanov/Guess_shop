import "server-only";

import { prisma } from "@/lib/prisma";
import { assertOrderBuyable } from "@/lib/order-hold";
import { loadFirstInLine } from "@/lib/first-in-line";
import { bridgeConfigured, bridgeGamepassById } from "@/lib/roblox-bridge";
import { buildOrderProfitSnapshot } from "@/lib/order-profit";
import { recordOrderStatusChange } from "@/lib/order-status-event";
import { notifyOrderCompleted } from "@/lib/twa-notify";
import { recordCompletedNotice } from "@/lib/notice-delivery";
import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets, type AdminTopic } from "../../bots/shared/admin-route";
import { formatAdminNotice, orderRef } from "../../bots/shared/notify-format";
import { humanNoteLine, prependNote } from "../../bots/shared/order-hold";
import {
  RBXRUBY_OPEN,
  RbxrubyError,
  type RbxrubyOrder,
  rbxrubyBalance,
  rbxrubyCancel,
  rbxrubyCreateGamepassOrder,
  rbxrubyDetailedStock,
  rbxrubyKey,
  rbxrubyListPasses,
  rbxrubyOrderId,
  rbxrubyOrderInfo,
  rbxrubyReserveUsd,
} from "@/lib/rbxruby";

/**
 * Автовыкуп через RBXRUBY (28.11.2026).
 *
 * Режим — env `RBXRUBY_MODE`:
 *   off (по умолчанию) — ничего не делает;
 *   dry — только чтение: баланс, сток, проверка пасса у площадки; пишет в лог,
 *         что ОТПРАВИЛ БЫ. Ни одного заказа не создаёт;
 *   on  — создаёт заказы.
 *
 * Тик раз в минуту приходит от TG-бота (`/api/internal/rbxruby/tick`), плюс
 * вебхук площадки (`/api/webhooks/rbxruby`) ускоряет закрытие. Оба сходятся в
 * `applyRbxrubyState` — повторный вызов безопасен.
 *
 * Состояние — в `OrderEvent`: `RBXRUBY_SUBMIT` (отправили) и `RBXRUBY_RESULT`
 * (итог). Отправленный без итога = в полёте. Неудача НЕ повторяется
 * автоматически: заказ остаётся в «К выкупу» с заметкой, дальше человек.
 */

export const RBXRUBY_SUBMIT = "RBXRUBY_SUBMIT";
export const RBXRUBY_RESULT = "RBXRUBY_RESULT";
const ACTOR = "RBXRUBY";

export const RBXRUBY_EXCLUDE = "RBXRUBY_EXCLUDE";
const STREAM = "rbxruby";

export type RbxrubyMode = "off" | "dry" | "on";
const asMode = (v: unknown): RbxrubyMode | null => (v === "on" || v === "dry" || v === "off" ? v : null);

type CursorMeta = { mode?: RbxrubyMode; modeBy?: string; modeAt?: string; snapshot?: RbxrubySnapshot };
export type RbxrubySnapshot = {
  at: string;
  balance: number | null;
  stock: Array<{ rate: number; totalRobuxAmount: number; maxInstantOrder: number }>;
  report?: Omit<TickReport, "mode">;
};

async function readMeta(): Promise<CursorMeta> {
  const row = await prisma.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  return (row?.metadata ?? {}) as CursorMeta;
}
async function writeMeta(patch: Partial<CursorMeta>): Promise<void> {
  const meta = { ...(await readMeta()), ...patch };
  await prisma.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, metadata: JSON.parse(JSON.stringify(meta)) },
    update: { metadata: JSON.parse(JSON.stringify(meta)) },
  });
}

/**
 * Режим: env `RBXRUBY_MODE=off` — рубильник (сильнее кнопки). Иначе — кнопка в
 * админке (`WbSyncCursor` stream `rbxruby`), а без неё — env, по умолчанию dry.
 */
export async function rbxrubyMode(): Promise<RbxrubyMode> {
  const env = asMode(process.env.RBXRUBY_MODE?.trim().toLowerCase());
  if (env === "off") return "off";
  return asMode((await readMeta()).mode) ?? env ?? "dry";
}

export async function setRbxrubyMode(mode: RbxrubyMode, by: string): Promise<void> {
  await writeMeta({ mode, modeBy: by, modeAt: new Date().toISOString() });
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
/** Наш потолок курса, $ за 1000 R$. Дублирует коридор в кабинете — на случай, если там поднимут. */
const maxRate = () => num("RBXRUBY_MAX_RATE", 3.8);
const maxPerTick = () => num("RBXRUBY_MAX_PER_TICK", 2);
/** Потолок робуксов (цена пассов) за сутки — страховка от разгона. */
const dailyRobuxCap = () => num("RBXRUBY_DAILY_ROBUX", 30_000);

const expectedPassPrice = (amount: number) => Math.ceil(amount / 0.7);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function alert(topic: AdminTopic, html: string): Promise<void> {
  const token = process.env.TG_TOKEN;
  if (!token) return;
  const targets = await adminTargets(topic, { loud: topic === "action" });
  await Promise.allSettled(targets.map((t) => sendTelegramMessage(token, t.chatId, html, t.extra)));
}

async function addNote(orderId: string, text: string): Promise<void> {
  const o = await prisma.wbOrder.findUnique({ where: { id: orderId }, select: { adminNote: true } });
  await prisma.wbOrder.update({ where: { id: orderId }, data: { adminNote: prependNote(o?.adminNote, humanNoteLine(text, ACTOR)) } });
}

type Candidate = {
  id: string;
  wbCode: string;
  amount: number;
  gamepassId: string;
  status: string;
};

/**
 * Заказы, которые воркер вправе отправить: «К выкупу», один пасс, без пометок,
 * ни разу не отправленные.
 *
 * Порядок — тот же, что в блоке «Первым делом» (28.11.2026, владелец: «закрывать
 * на их сайте тех, кто ебёт мозг»): поднятые руками → не дошло → прямые →
 * «Ебут мозги» (по тону и числу сообщений) → «Спрашивают» → остальные по возрасту.
 */
async function loadCandidates(limit: number): Promise<Array<Candidate & { lane: string }>> {
  const [rows, first] = await Promise.all([
    prisma.wbOrder.findMany({
      where: {
        isTest: false,
        status: "PENDING",
        heldAt: null,
        flaggedAt: null,
        gamepassId: { not: null },
        NOT: { isDirectOrder: true, paidAt: null },
        splitGamepasses: { none: {} },
        events: { none: { type: { in: [RBXRUBY_SUBMIT, RBXRUBY_EXCLUDE] } } },
      },
      orderBy: [{ priorityAt: { sort: "desc", nulls: "last" } }, { isDirectOrder: "desc" }, { createdAt: "asc" }],
      take: 300,
      select: { id: true, wbCode: true, amount: true, gamepassId: true, status: true },
    }),
    loadFirstInLine().catch(() => null),
  ]);
  const rank = new Map<string, { i: number; lane: string }>();
  first?.rows.forEach((r, i) => rank.set(r.id, { i, lane: r.reason }));
  return rows
    .flatMap((r) => (r.gamepassId ? [{ ...r, gamepassId: r.gamepassId, status: String(r.status), lane: rank.get(r.id)?.lane ?? "queue", _i: rank.get(r.id)?.i ?? Number.MAX_SAFE_INTEGER }] : []))
    .map((r, idx) => ({ ...r, _idx: idx }))
    .sort((a, b) => a._i - b._i || a._idx - b._idx)
    .slice(0, limit)
    .map(({ _i, _idx, ...r }) => { void _i; void _idx; return r; });
}

type PassCheck =
  | { ok: true; placeId: number; owner: string; passPrice: number }
  | { ok: false; reason: string };

/** Пасс живой, на продаже, цена = номиналу, и площадка видит его у владельца. */
async function checkPass(c: Candidate): Promise<PassCheck> {
  if (!bridgeConfigured()) return { ok: false, reason: "мост Roblox не настроен" };
  const gp = await bridgeGamepassById(c.gamepassId);
  const details = gp?.details;
  const placeId = gp?.pass?.placeId;
  if (!details) return { ok: false, reason: "Roblox не отдал пасс" };
  if (details.isActive === false) return { ok: false, reason: "пасс не на продаже" };
  const need = expectedPassPrice(c.amount);
  if (Number(details.price) !== need) return { ok: false, reason: `цена пасса ${details.price} R$, нужна ${need}` };
  const owner = details.creatorName ?? gp?.pass?.sellerName;
  if (!owner) return { ok: false, reason: "не знаем ник владельца" };
  if (!placeId) return { ok: false, reason: "не знаем плейс пасса" };
  try {
    const list = await rbxrubyListPasses(owner, placeId);
    const hit = list.passes.find((p) => String(p.passId) === c.gamepassId);
    if (!hit) return { ok: false, reason: "RBXRUBY не видит пасс на плейсе" };
    if (hit.passPrice !== need) return { ok: false, reason: `RBXRUBY видит цену ${hit.passPrice} R$` };
    return { ok: true, placeId: list.placeId || placeId, owner: list.robloxUsername || owner, passPrice: hit.passPrice };
  } catch (e) {
    const msg = e instanceof RbxrubyError ? `${e.status} ${e.message}` : String(e);
    return { ok: false, reason: `RBXRUBY: ${msg}` };
  }
}

export type TickReport = {
  mode: RbxrubyMode;
  balance?: number;
  bestRate?: number | null;
  submitted: string[];
  wouldSubmit: string[];
  skipped: Array<{ code: string; reason: string }>;
  synced: number;
  completed: string[];
  failed: string[];
  error?: string;
};

export async function runRbxrubyTick(): Promise<TickReport> {
  const mode = await rbxrubyMode();
  const report: TickReport = { mode, submitted: [], wouldSubmit: [], skipped: [], synced: 0, completed: [], failed: [] };
  if (!rbxrubyKey()) return report;
  let lastStock: Stock = [];

  // 1. Отправленные доводим ВСЕГДА, даже на паузе: деньги уже зарезервированы.
  try {
    const s = await syncInFlight();
    report.synced = s.synced;
    report.completed = s.completed;
    report.failed = s.failed;
  } catch (e) {
    report.error = `sync: ${e instanceof Error ? e.message : e}`;
  }

  // 2. Новые.
  try {
    const [balance, stock] = await Promise.all([rbxrubyBalance(), rbxrubyDetailedStock()]);
    report.balance = balance;
    lastStock = stock.map((r) => ({ rate: r.rate, totalRobuxAmount: r.totalRobuxAmount, maxInstantOrder: r.maxInstantOrder }));
    const usable = usableStock(lastStock);
    report.bestRate = usable.length ? Math.min(...usable.map((r) => r.rate)) : null;
    if (mode !== "off" && usable.length) {
      const since = new Date(Date.now() - 24 * 3600_000);
      const todays = await prisma.orderEvent.findMany({ where: { type: RBXRUBY_SUBMIT, createdAt: { gte: since } }, select: { payload: true } });
      let spentRobux = todays.reduce((sum, e) => sum + (Number((e.payload as { passPrice?: number })?.passPrice) || 0), 0);
      let money = balance;

      for (const c of await loadCandidates(maxPerTick() * 5)) {
        if (report.submitted.length + report.wouldSubmit.length >= maxPerTick()) break;
        const prep = await prepare(c, usable, money);
        if (!prep.ok) {
          report.skipped.push({ code: c.wbCode, reason: prep.reason });
          if (prep.stop) break;
          continue;
        }
        if (spentRobux + prep.pass.passPrice > dailyRobuxCap()) { report.skipped.push({ code: c.wbCode, reason: "дневной потолок" }); break; }

        if (mode === "dry") {
          report.wouldSubmit.push(`[${c.lane}] ${c.wbCode} ${prep.pass.passPrice}R$ ~$${prep.reserve} @${prep.pass.owner}/${prep.pass.placeId}`);
        } else if (await submit(c, prep.pass, "worker")) {
          report.submitted.push(c.wbCode);
        } else {
          report.failed.push(c.wbCode);
          continue;
        }
        money -= prep.reserve;
        spentRobux += prep.pass.passPrice;
      }
    }
  } catch (e) {
    report.error = `${report.error ? report.error + "; " : ""}submit: ${e instanceof Error ? e.message : e}`;
  }
  const { mode: _m, ...rest } = report;
  void _m;
  await writeMeta({ snapshot: { at: new Date().toISOString(), balance: report.balance ?? null, stock: lastStock, report: rest } }).catch(() => {});
  return report;
}

type Stock = Array<{ rate: number; totalRobuxAmount: number; maxInstantOrder: number }>;
const usableStock = (stock: Stock) => stock.filter((r) => r.rate <= maxRate() && r.totalRobuxAmount > 0);

type Prepared =
  | { ok: true; pass: Extract<PassCheck, { ok: true }>; reserve: number }
  | { ok: false; reason: string; stop?: boolean };

/** Все проверки перед отправкой одного заказа (их же проходит кнопка «Отправить сейчас»). */
async function prepare(c: Candidate, usable: Stock, money: number): Promise<Prepared> {
  const guard = await assertOrderBuyable(prisma, c.id);
  if (guard.held) return { ok: false, reason: guard.reason };
  const pass = await checkPass(c);
  if (!pass.ok) return { ok: false, reason: pass.reason };
  // Пасс покупает ОДИН продавец: без такого заказ повиснет в Pending с резервом.
  const instant = Math.max(0, ...usable.map((r) => r.maxInstantOrder));
  if (instant < pass.passPrice) return { ok: false, reason: `нет продавца на ${pass.passPrice} R$ (макс. ${instant})` };
  const reserve = rbxrubyReserveUsd(pass.passPrice, maxRate());
  if (reserve > money) return { ok: false, reason: `баланс $${money} < $${reserve}`, stop: true };
  return { ok: true, pass, reserve };
}

async function submit(c: Candidate, pass: Extract<PassCheck, { ok: true }>, actor: string, attempt = 1): Promise<boolean> {
  const extId = rbxrubyOrderId(c.wbCode, attempt);
  // Сначала событие (уникальный ключ) — второй тик в гонке не отправит дубль.
  try {
    await prisma.orderEvent.create({
      data: {
        orderId: c.id, type: RBXRUBY_SUBMIT, idempotencyKey: `rbxruby:submit:${extId}`,
        payload: { extId, passPrice: pass.passPrice, placeId: pass.placeId, owner: pass.owner, gamepassId: c.gamepassId, actor, at: new Date().toISOString() },
      },
    });
  } catch {
    return false;
  }
  // Заказ выходит из «PENDING», чтобы человек не выкупил его параллельно руками.
  const moved = await prisma.wbOrder.updateMany({
    where: { id: c.id, status: "PENDING", heldAt: null },
    data: { status: "IN_PROGRESS", takenAt: new Date() },
  });
  if (moved.count === 0) {
    await recordResult(c.id, extId, { status: "Cancelled", error: { message: "заказ сменил статус до отправки" } });
    return false;
  }
  try {
    const created = await rbxrubyCreateGamepassOrder({
      orderId: extId, robloxUsername: pass.owner, robuxAmount: pass.passPrice,
      placeId: pass.placeId, gamepassId: Number(c.gamepassId),
    });
    await recordOrderStatusChange({ orderId: c.id, from: "PENDING", to: "IN_PROGRESS", actor: "worker:rbxruby", extra: { extId, status: created.status } });
    await addNote(c.id, `отправлен в RBXRUBY (${created.status}), ${pass.passPrice} R$`);
    return true;
  } catch (e) {
    const msg = e instanceof RbxrubyError ? `${e.status} ${e.message}` : String(e);
    // 409 ORDER_ALREADY_EXISTS — заказ у площадки есть, доведёт синк.
    if (e instanceof RbxrubyError && e.code === "ORDER_ALREADY_EXISTS") return true;
    await recordResult(c.id, extId, { status: "Error", error: { message: msg } });
    await prisma.wbOrder.updateMany({ where: { id: c.id, status: "IN_PROGRESS" }, data: { status: "PENDING" } });
    await addNote(c.id, `RBXRUBY не принял заказ: ${msg}`);
    await alert("buyout", formatAdminNotice({
      marker: "action", zone: "ВЫКУП", title: "RBXRUBY не принял заказ",
      lines: [orderRef({ code: c.wbCode, denomination: c.amount }, []), esc(msg), "Заказ вернулся в «К выкупу»."],
      next: null,
    }));
    return false;
  }
}

async function recordResult(orderId: string, extId: string, state: Partial<RbxrubyOrder>): Promise<boolean> {
  try {
    await prisma.orderEvent.create({
      data: {
        orderId, type: RBXRUBY_RESULT, idempotencyKey: `rbxruby:result:${extId}`,
        payload: JSON.parse(JSON.stringify({ extId, ...state, at: new Date().toISOString() })),
      },
    });
    return true;
  } catch {
    return false; // итог уже записан (вебхук и тик пришли вместе)
  }
}

async function syncInFlight(): Promise<{ synced: number; completed: string[]; failed: string[] }> {
  const subs = await prisma.orderEvent.findMany({
    where: { type: RBXRUBY_SUBMIT, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } },
    select: { orderId: true, payload: true },
  });
  if (!subs.length) return { synced: 0, completed: [], failed: [] };
  const done = await prisma.orderEvent.findMany({
    where: { type: RBXRUBY_RESULT, orderId: { in: subs.map((s) => s.orderId) } },
    select: { payload: true },
  });
  const closed = new Set(done.map((d) => String((d.payload as { extId?: string })?.extId)));
  const open = subs.filter((s) => !closed.has(String((s.payload as { extId?: string })?.extId)));
  const out = { synced: 0, completed: [] as string[], failed: [] as string[] };
  for (const s of open.slice(0, 20)) {
    const extId = String((s.payload as { extId?: string }).extId);
    try {
      const info = await rbxrubyOrderInfo(extId);
      out.synced++;
      const r = await applyRbxrubyState(s.orderId, info);
      if (r === "completed") out.completed.push(extId);
      if (r === "failed") out.failed.push(extId);
    } catch (e) {
      if (e instanceof RbxrubyError && e.status === 404) {
        // Площадка заказа не знает — значит, создание не прошло.
        await recordResult(s.orderId, extId, { status: "Error", error: { message: "RBXRUBY: заказ не найден" } });
        await prisma.wbOrder.updateMany({ where: { id: s.orderId, status: "IN_PROGRESS" }, data: { status: "PENDING" } });
      } else {
        console.warn("[rbxruby] info", extId, e instanceof Error ? e.message : e);
      }
    }
  }
  return out;
}

/** Применить состояние заказа площадки к нашему. Идемпотентно. */
export async function applyRbxrubyState(orderId: string, info: RbxrubyOrder): Promise<"open" | "completed" | "failed" | "noop"> {
  const order = await prisma.wbOrder.findUnique({
    where: { id: orderId },
    include: { user: true },
  });
  if (!order) return "noop";

  if (RBXRUBY_OPEN.includes(info.status)) {
    // Человек закрыл/отклонил/заморозил заказ, пока площадка ждёт продавца, — снимаем у неё.
    if (order.status !== "IN_PROGRESS" || order.heldAt) {
      if (info.status === "Queued") {
        await rbxrubyCancel(info.orderId).catch(() => {});
        await recordResult(orderId, info.orderId, { status: "Cancelled", error: { message: `у нас заказ ${order.status}${order.heldAt ? " (заморожен)" : ""}` } });
        return "failed";
      }
    }
    return "open";
  }

  if (!(await recordResult(orderId, info.orderId, info))) return "noop";

  if (info.status === "Completed") {
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status)) {
      await alert("action", formatAdminNotice({
        marker: "urgent", zone: "ВЫКУП", title: "RBXRUBY выкупил закрытый заказ",
        lines: [orderRef({ code: order.wbCode, denomination: order.amount }, []), `У нас статус ${order.status} — проверьте, не двойной ли выкуп.`],
        next: null,
      }));
      return "completed";
    }
    const settings = await prisma.globalSettings.findUnique({ where: { id: "global" } });
    const rate = Number(info.rate) > 0 ? Number(info.rate) : maxRate();
    const money = buildOrderProfitSnapshot(order, { purchaseRate: rate, usdToRub: settings?.usdToRub ?? null }, info.robuxAmount || expectedPassPrice(order.amount));
    await prisma.wbOrder.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED", buyoutErrorCode: null, completedAt: new Date(), priorityAt: null, priorityBy: null,
        purchaserUsername: info.buyerRobloxUsername ?? ACTOR,
        ...(money ?? {}),
      },
    });
    await recordOrderStatusChange({
      orderId, from: order.status, to: "COMPLETED", actor: "worker:rbxruby",
      extra: { wbCode: order.wbCode, amount: order.amount, extId: info.orderId, usd: info.price, rate: info.rate, seller: info.buyerRobloxUsername },
    });
    await addNote(orderId, `выкуплен через RBXRUBY: $${info.price ?? "?"} по ${info.rate ?? "?"}$/1k${info.buyerRobloxUsername ? `, аккаунт ${info.buyerRobloxUsername}` : ""}`);
    const userDisplay = order.user?.username ? `@${order.user.username}` : order.user?.tgId ?? order.user?.vkId ?? "—";
    try {
      const notice = await notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder);
      await recordCompletedNotice({ orderId, wbCode: order.wbCode, amount: order.amount, userDisplay, robloxUsername: order.robloxUsername, completedAt: order.completedAt, result: notice });
    } catch (e) {
      console.error("[rbxruby] уведомление о выкупе упало:", e);
      await recordCompletedNotice({
        orderId, wbCode: order.wbCode, amount: order.amount, userDisplay, robloxUsername: order.robloxUsername, completedAt: order.completedAt,
        result: { delivered: false, bonusDelivered: false, kind: "thanks", channel: order.user?.tgId ? "tg" : order.user?.vkId ? "vk" : "none" },
      }).catch(() => {});
    }
    return "completed";
  }

  // Error / Cancelled: резерв освобождаем, заказ — обратно людям.
  if (info.status === "Error") await rbxrubyCancel(info.orderId).catch(() => {});
  const why = info.error?.message || info.error?.reason || info.status;
  await prisma.wbOrder.updateMany({ where: { id: orderId, status: "IN_PROGRESS" }, data: { status: "PENDING" } });
  await addNote(orderId, `RBXRUBY: ${info.status} — ${why}`);
  await alert("buyout", formatAdminNotice({
    marker: "action", zone: "ВЫКУП", title: `RBXRUBY: ${info.status === "Error" ? "ошибка" : "отменён"}`,
    lines: [orderRef({ code: order.wbCode, denomination: order.amount }, []), esc(String(why)), "Заказ вернулся в «К выкупу», автоматом повторно не пойдёт."],
    next: null,
  }));
  return "failed";
}

/** Найти наш заказ по id площадки (для вебхука). */
export async function orderIdByRbxrubyId(extId: string): Promise<string | null> {
  const ev = await prisma.orderEvent.findUnique({ where: { idempotencyKey: `rbxruby:submit:${extId}` }, select: { orderId: true } });
  return ev?.orderId ?? null;
}

/* ── Админка: ручные действия, статусы, статистика (28.11.2026) ───────────── */

export type RbxrubyOrderState =
  | { state: "excluded"; label: string; by?: string }
  | { state: "open"; label: string; extId: string; at: string; reserve?: number }
  | { state: "done"; label: string; extId: string; at: string; usd?: number; rate?: number; seller?: string }
  | { state: "failed"; label: string; extId: string; at: string; why: string }
  | { state: "skipped"; label: string; why: string }
  | { state: "next"; label: string };

type Ev = { orderId: string; type: string; payload: unknown; createdAt: Date };

function stateFrom(events: Ev[], skipped: Map<string, string>, next: Set<string>, orderId: string): RbxrubyOrderState | null {
  const mine = events.filter((e) => e.orderId === orderId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const sub = mine.find((e) => e.type === RBXRUBY_SUBMIT);
  if (sub) {
    const p = sub.payload as { extId: string; passPrice?: number };
    const res = mine.find((e) => e.type === RBXRUBY_RESULT && (e.payload as { extId?: string }).extId === p.extId);
    if (!res) return { state: "open", label: "в RBXRUBY", extId: p.extId, at: sub.createdAt.toISOString(), reserve: p.passPrice ? rbxrubyReserveUsd(p.passPrice, maxRate()) : undefined };
    const r = res.payload as { status?: string; price?: number; rate?: number; buyerRobloxUsername?: string; error?: { message?: string; reason?: string } | null };
    if (r.status === "Completed") return { state: "done", label: "выкуплен RBXRUBY", extId: p.extId, at: res.createdAt.toISOString(), usd: r.price, rate: r.rate, seller: r.buyerRobloxUsername };
    return { state: "failed", label: `RBXRUBY: ${r.status === "Error" ? "ошибка" : "отменён"}`, extId: p.extId, at: res.createdAt.toISOString(), why: r.error?.message ?? r.error?.reason ?? String(r.status) };
  }
  const ex = mine.find((e) => e.type === RBXRUBY_EXCLUDE);
  if (ex) return { state: "excluded", label: "не отдавать", by: (ex.payload as { by?: string }).by };
  if (next.has(orderId)) return { state: "next", label: "следующий в RBXRUBY" };
  const why = skipped.get(orderId);
  if (why) return { state: "skipped", label: "руками", why };
  return null;
}

/** Состояние RBXRUBY для пачки заказов — метки в «Первым делом» и списках. */
export async function rbxrubyStates(orderIds: string[]): Promise<Record<string, RbxrubyOrderState>> {
  if (!orderIds.length) return {};
  const [events, meta, orders] = await Promise.all([
    prisma.orderEvent.findMany({
      where: { orderId: { in: orderIds }, type: { in: [RBXRUBY_SUBMIT, RBXRUBY_RESULT, RBXRUBY_EXCLUDE] } },
      select: { orderId: true, type: true, payload: true, createdAt: true },
    }),
    readMeta(),
    prisma.wbOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, wbCode: true } }),
  ]);
  const byCode = new Map(orders.map((o) => [o.wbCode, o.id]));
  const rep = meta.snapshot?.report;
  const skipped = new Map<string, string>();
  for (const s of rep?.skipped ?? []) { const id = byCode.get(s.code); if (id) skipped.set(id, s.reason); }
  const next = new Set<string>();
  for (const line of rep?.wouldSubmit ?? []) {
    const code = line.replace(/^\[[^\]]*\]\s*/, "").split(" ")[0];
    const id = byCode.get(code);
    if (id) next.add(id);
  }
  const out: Record<string, RbxrubyOrderState> = {};
  for (const id of orderIds) {
    const st = stateFrom(events, skipped, next, id);
    if (st) out[id] = st;
  }
  return out;
}

/** Хроника по одному заказу для карточки. */
export async function rbxrubyTimeline(orderId: string): Promise<Array<{ at: string; text: string; tone: "ok" | "bad" | "muted" }>> {
  const events = await prisma.orderEvent.findMany({
    where: { orderId, type: { in: [RBXRUBY_SUBMIT, RBXRUBY_RESULT, RBXRUBY_EXCLUDE] } },
    orderBy: { createdAt: "asc" },
    select: { type: true, payload: true, createdAt: true },
  });
  return events.map((e) => {
    const p = e.payload as Record<string, unknown>;
    const at = e.createdAt.toISOString();
    if (e.type === RBXRUBY_SUBMIT) {
      const price = Number(p.passPrice) || 0;
      return { at, tone: "muted" as const, text: `Отправлен · ${p.extId} · ${price} R$ · резерв $${rbxrubyReserveUsd(price, maxRate())}${p.actor && p.actor !== "worker" ? ` · ${p.actor}` : ""}` };
    }
    if (e.type === RBXRUBY_EXCLUDE) return { at, tone: "muted" as const, text: `Не отдавать в RBXRUBY${p.by ? ` · ${p.by}` : ""}` };
    if (p.status === "Completed") {
      return { at, tone: "ok" as const, text: `Выкуплен · $${p.price ?? "?"} по ${p.rate ?? "?"}/1k${p.buyerRobloxUsername ? ` · аккаунт ${p.buyerRobloxUsername}` : ""}` };
    }
    const err = p.error as { message?: string } | null | undefined;
    return { at, tone: "bad" as const, text: `${p.status === "Error" ? "Ошибка" : "Отменён"} · ${err?.message ?? ""}`.trim() };
  });
}

export type RbxrubyOverview = {
  configured: boolean;
  mode: RbxrubyMode;
  modeBy: string | null;
  envOff: boolean;
  maxRate: number;
  snapshotAt: string | null;
  balance: number | null;
  stockUsable: number;
  stockLines: Array<{ rate: number; robux: number }>;
  maxInstant: number;
  day: { completed: number; inFlight: number; failed: number; usd: number; robux: number };
  week: { completed: number; usd: number; robux: number; avgRate: number | null };
  next: string[];
  lastError: string | null;
};

export async function rbxrubyOverview(): Promise<RbxrubyOverview> {
  const [mode, meta] = await Promise.all([rbxrubyMode(), readMeta()]);
  const snap = meta.snapshot;
  const usable = usableStock(snap?.stock ?? []);
  const since7 = new Date(Date.now() - 7 * 86400_000);
  const since1 = Date.now() - 86400_000;
  const events = await prisma.orderEvent.findMany({
    where: { type: { in: [RBXRUBY_SUBMIT, RBXRUBY_RESULT] }, createdAt: { gte: since7 } },
    select: { type: true, payload: true, createdAt: true },
  });
  const results = events.filter((e) => e.type === RBXRUBY_RESULT);
  const closed = new Set(results.map((e) => String((e.payload as { extId?: string }).extId)));
  const subs = events.filter((e) => e.type === RBXRUBY_SUBMIT);
  const done = results.filter((e) => (e.payload as { status?: string }).status === "Completed");
  const sum = (list: typeof events, f: (p: Record<string, unknown>) => number) => list.reduce((s, e) => s + (f(e.payload as Record<string, unknown>) || 0), 0);
  const dayDone = done.filter((e) => e.createdAt.getTime() >= since1);
  const weekUsd = sum(done, (p) => Number(p.price));
  const weekRobux = sum(done, (p) => Number(p.robuxAmount));
  return {
    configured: Boolean(rbxrubyKey()),
    mode,
    modeBy: meta.modeBy ?? null,
    envOff: process.env.RBXRUBY_MODE?.trim().toLowerCase() === "off",
    maxRate: maxRate(),
    snapshotAt: snap?.at ?? null,
    balance: snap?.balance ?? null,
    stockUsable: usable.reduce((s, r) => s + r.totalRobuxAmount, 0),
    stockLines: usable.filter((r) => r.totalRobuxAmount >= 100).map((r) => ({ rate: r.rate, robux: r.totalRobuxAmount })),
    maxInstant: Math.max(0, ...usable.map((r) => r.maxInstantOrder)),
    day: {
      completed: dayDone.length,
      inFlight: subs.filter((e) => !closed.has(String((e.payload as { extId?: string }).extId))).length,
      failed: results.filter((e) => e.createdAt.getTime() >= since1 && (e.payload as { status?: string }).status !== "Completed").length,
      usd: Math.round(sum(dayDone, (p) => Number(p.price)) * 1000) / 1000,
      robux: sum(dayDone, (p) => Number(p.robuxAmount)),
    },
    week: {
      completed: done.length,
      usd: Math.round(weekUsd * 1000) / 1000,
      robux: weekRobux,
      avgRate: weekRobux > 0 ? Math.round((weekUsd / weekRobux) * 1000 * 100) / 100 : null,
    },
    next: (snap?.report?.wouldSubmit ?? []).slice(0, 3),
    lastError: snap?.report?.error ?? null,
  };
}

/** «Не отдавать в RBXRUBY» / «Снова можно». */
export async function setRbxrubyExcluded(orderId: string, excluded: boolean, by: string): Promise<void> {
  if (excluded) {
    await prisma.orderEvent.upsert({
      where: { idempotencyKey: `rbxruby:exclude:${orderId}` },
      create: { orderId, type: RBXRUBY_EXCLUDE, idempotencyKey: `rbxruby:exclude:${orderId}`, payload: { by, at: new Date().toISOString() } },
      update: {},
    });
  } else {
    await prisma.orderEvent.deleteMany({ where: { idempotencyKey: `rbxruby:exclude:${orderId}` } });
  }
}

/** Кнопка «Отправить в RBXRUBY сейчас»: те же проверки, вне очереди и режима (кроме рубильника env). */
export async function sendToRbxrubyNow(orderId: string, by: string): Promise<{ ok: boolean; message: string }> {
  if (!rbxrubyKey()) return { ok: false, message: "RBXRUBY не настроен" };
  if (process.env.RBXRUBY_MODE?.trim().toLowerCase() === "off") return { ok: false, message: "RBXRUBY выключен рубильником" };
  const o = await prisma.wbOrder.findUnique({
    where: { id: orderId },
    select: { id: true, wbCode: true, amount: true, gamepassId: true, status: true, isDirectOrder: true, paidAt: true, heldAt: true, _count: { select: { splitGamepasses: true } } },
  });
  if (!o) return { ok: false, message: "заказ не найден" };
  if (o.status !== "PENDING") return { ok: false, message: `заказ в статусе ${o.status}, нужен «К выкупу»` };
  if (!o.gamepassId) return { ok: false, message: "у заказа нет пасса" };
  if (o._count.splitGamepasses > 0) return { ok: false, message: "разбитый заказ — только руками" };
  if (o.isDirectOrder && !o.paidAt) return { ok: false, message: "прямой заказ не оплачен" };
  const prior = await prisma.orderEvent.findMany({ where: { orderId, type: RBXRUBY_SUBMIT }, select: { payload: true } });
  const attempt = prior.length + 1;
  if (prior.length) {
    const results = await prisma.orderEvent.count({ where: { orderId, type: RBXRUBY_RESULT } });
    if (results < prior.length) return { ok: false, message: "уже в RBXRUBY" };
  }
  const [balance, stock] = await Promise.all([rbxrubyBalance(), rbxrubyDetailedStock()]);
  const c: Candidate = { id: o.id, wbCode: o.wbCode, amount: o.amount, gamepassId: o.gamepassId, status: String(o.status) };
  const prep = await prepare(c, usableStock(stock), balance);
  if (!prep.ok) return { ok: false, message: prep.reason };
  await setRbxrubyExcluded(orderId, false, by);
  const ok = await submit(c, prep.pass, `admin:${by}`, attempt);
  return ok ? { ok: true, message: `отправлен, резерв ~$${prep.reserve}` } : { ok: false, message: "RBXRUBY не принял — см. заметку заказа" };
}

/** «Отменить у RBXRUBY»: площадка позволяет только Queued/Error. */
export async function cancelAtRbxruby(orderId: string, by: string): Promise<{ ok: boolean; message: string }> {
  const sub = await prisma.orderEvent.findFirst({ where: { orderId, type: RBXRUBY_SUBMIT }, orderBy: { createdAt: "desc" }, select: { payload: true } });
  const extId = (sub?.payload as { extId?: string } | undefined)?.extId;
  if (!extId) return { ok: false, message: "заказ не отправлялся в RBXRUBY" };
  try {
    const info = await rbxrubyCancel(extId);
    await recordResult(orderId, extId, { ...info, status: "Cancelled", error: { message: `отменил ${by}` } });
    await prisma.wbOrder.updateMany({ where: { id: orderId, status: "IN_PROGRESS" }, data: { status: "PENDING" } });
    await setRbxrubyExcluded(orderId, true, by);
    await addNote(orderId, `RBXRUBY: отменён вручную (${by}), автоматом больше не пойдёт`);
    return { ok: true, message: "отменён, резерв вернулся" };
  } catch (e) {
    const msg = e instanceof RbxrubyError ? e.message : String(e);
    return { ok: false, message: e instanceof RbxrubyError && e.status === 422 ? "RBXRUBY ищет продавца (Pending) — отменить пока нельзя" : msg };
  }
}
