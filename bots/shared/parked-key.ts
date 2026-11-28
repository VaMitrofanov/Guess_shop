/* ─────────────────────────────────────────────────────────────────────────────
   🔑 Отложенный ключ (27.11.2026, владелец).

   «Если нам на любом этапе скинули ключ и он рабочий — сохраняем и применяем,
   как только есть возможность». Кейс 8L3JCD5: ключ годный, но у аккаунта нет
   ни одной игры. Раньше ключ жил 15 минут в памяти бота, и после создания
   плейса человека просили прислать его ещё раз — а он к тому моменту уже
   ушёл (4 часа на планшете ребёнка, ★1, «верните деньги»).

   Теперь годный ключ, который упёрся НЕ в себя (нет игры, игра скрыта, сбой
   Roblox), ложится в `RobloxApiKey` зашифрованным с `lastResult = parked:<код>`.
   Воркер TG-бота (`runParkedKeySweep`, раз в час) пробует его снова на заказе
   этого покупателя, который ждёт пасс. Получилось — пасс привязан, покупателю
   и админам сообщение. Ключ перестал работать (перевыпущен, отозван) —
   владельцу один алерт «ключ устарел». Ждёт дольше 30 дней — тоже алерт.

   Ключ не логируется и не попадает ни в одно сообщение.
   ───────────────────────────────────────────────────────────────────────── */

import { createPassesByKey, recordAutocreateTrace } from "./gamepass-autocreate";
import { createTargetsFor } from "./gamepass-plan";
import { rememberRobloxApiKey } from "./roblox-api-key-store";
import { decryptWbSecret } from "./wb-delivery-crypto";
import { heldOrderBuyerText, isOrderHeld } from "./held-order-notice";
import { PROBLEM_HOLD_ACTOR } from "./order-hold";

/** Строка в заметку заказа (как `appendOrderAudit` веба: свежие строки внизу). */
function appendNote(note: string | null | undefined, line: string): string {
  const current = note?.trim() ?? "";
  const combined = current ? `${current}\n${line}` : line;
  return combined.length <= 2000 ? combined : combined.slice(combined.length - 2000);
}

export const PARKED_PREFIX = "parked:";
export const STALE_PREFIX = "stale:";
export const PARKED_GAVE_UP = "parked_expired";
export const PARKED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Отказы, которые говорят о самом ключе: такой ключ ждать бессмысленно. */
const KEY_FAULTS = new Set(["bad_key", "bad_scope", "bad_scope_write", "key_other_account", "not_authorized"]);

/** Ключ годный, а мешает что-то другое — его стоит сохранить и повторить. */
export function keyWorthParking(error: string | null | undefined): boolean {
  if (!error) return false;
  if (KEY_FAULTS.has(error)) return false;
  // Ник не найден — неизвестно, чей это ключ; без ника применять некуда.
  return error !== "nick_not_found";
}

export function isKeyFault(error: string | null | undefined): boolean {
  return Boolean(error && KEY_FAULTS.has(error));
}

/** Строка для покупателя: ключ сохранён и сработает сам. */
export const PARKED_KEY_LINE =
  "🔑 Ключ мы сохранили. Как только игра появится, геймпасс создадим сами и напишем сюда — присылать ключ ещё раз не нужно.";

type Db = any;

/**
 * Отложить годный ключ. Покупатель — по Telegram/VK id или по `userId`, заказ —
 * по коду. Никогда не бросает: это удобство, а не часть заказа.
 */
export async function parkRobloxKey(
  db: Db,
  input: {
    key: string;
    nick: string;
    error: string | null | undefined;
    tgId?: string | number | null;
    vkId?: string | number | null;
    userId?: string | null;
    wbCode?: string | null;
  },
): Promise<boolean> {
  try {
    if (!keyWorthParking(input.error) || !input.nick?.trim()) return false;
    let userId = input.userId ?? null;
    if (!userId && (input.tgId || input.vkId)) {
      const user = await db.user.findFirst({
        where: input.tgId ? { tgId: String(input.tgId) } : { vkId: String(input.vkId) },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }
    const order = input.wbCode
      ? await db.wbOrder.findFirst({
          where: { wbCode: { equals: input.wbCode, mode: "insensitive" } },
          select: { id: true, userId: true },
        })
      : null;
    userId = userId ?? order?.userId ?? null;
    if (!userId) return false;
    const saved = await rememberRobloxApiKey(db, {
      key: input.key,
      robloxUsername: input.nick,
      userId,
      orderId: order?.id ?? null,
      result: `${PARKED_PREFIX}${input.error}`,
      createdPasses: 0,
    });
    return saved !== "skipped";
  } catch (err) {
    console.warn("[parked-key] не отложен:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Заказ, которому можно отдать отложенный ключ. */
export function orderTakesParkedKey(order: {
  status: string;
  gamepassUrl?: string | null;
  isDirectOrder?: boolean | null;
  paidAt?: Date | string | null;
  heldBy?: string | null;
}): boolean {
  if (!["AWAITING_GAMEPASS", "REJECTED"].includes(order.status)) return false;
  if (order.gamepassUrl) return false;
  if (order.isDirectOrder && !order.paidAt) return false;
  // «Автозащита» = деньги ушли покупателю: выкупа не будет, пасс не нужен.
  if (order.heldBy === PROBLEM_HOLD_ACTOR) return false;
  return true;
}

export interface ParkedSweepDeps {
  /** Сообщение покупателю (без HTML). */
  sendBuyer: (user: { tgId: string | null; vkId: string | null }, text: string) => Promise<void>;
  /** Алерт владельцу/админам (HTML Telegram). */
  alertAdmins: (html: string) => Promise<void>;
  /** Карточка выкупа (как у бота после привязки). */
  orderCard?: (order: any, opts: { heldReason: string | null; parts: number }) => Promise<void>;
  now?: () => Date;
}

export interface ParkedSweepResult {
  checked: number;
  applied: number;
  stale: number;
  expired: number;
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));

/** Один проход: все отложенные ключи, по одному Roblox-вызову на ключ. */
export async function runParkedKeySweep(db: Db, deps: ParkedSweepDeps): Promise<ParkedSweepResult> {
  const now = deps.now?.() ?? new Date();
  const result: ParkedSweepResult = { checked: 0, applied: 0, stale: 0, expired: 0 };
  const rows = await db.robloxApiKey.findMany({
    where: { lastResult: { startsWith: PARKED_PREFIX }, userId: { not: null } },
    select: { id: true, robloxUsername: true, encryptedValue: true, userId: true, lastUsedAt: true, lastResult: true, user: { select: { tgId: true, vkId: true } } },
    take: 50,
  });

  for (const row of rows) {
    result.checked += 1;
    const parkedAt = row.lastUsedAt ? new Date(row.lastUsedAt) : now;
    if (now.getTime() - parkedAt.getTime() > PARKED_MAX_AGE_MS) {
      await db.robloxApiKey.update({ where: { id: row.id }, data: { lastResult: PARKED_GAVE_UP } });
      await deps.alertAdmins(`⏳ <b>Отложенный ключ ждёт больше 30 дней</b>\nНик <code>${esc(row.robloxUsername)}</code> — пасс так и не удалось создать (${esc(String(row.lastResult).slice(PARKED_PREFIX.length))}). Больше не пробуем.`).catch(() => {});
      result.expired += 1;
      continue;
    }

    const orders = await db.wbOrder.findMany({
      where: { userId: row.userId, status: { in: ["AWAITING_GAMEPASS", "REJECTED"] }, gamepassUrl: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, wbCode: true, amount: true, status: true, gamepassUrl: true, isDirectOrder: true, paidAt: true, heldAt: true, heldReason: true, heldBy: true, orderSource: true, robloxUsername: true, adminNote: true, platform: true, createdAt: true },
    });
    const order = orders.find(orderTakesParkedKey);
    // Заказа, ждущего пасс, нет — ключ подождёт следующего (или пригодится
    // в `createPassesWithStoredKey` при новом заказе).
    if (!order) continue;

    let key: string;
    try {
      key = decryptWbSecret(row.encryptedValue, "roblox-api-key");
    } catch {
      continue;
    }
    const targets = createTargetsFor(order.amount, order.orderSource !== "SITE");
    const outcome = await createPassesByKey({ apiKey: key, nick: row.robloxUsername, targets: targets.map((t) => t.price), quiet: true });

    if (outcome.created.length === 0) {
      if (isKeyFault(outcome.error)) {
        await db.robloxApiKey.update({ where: { id: row.id }, data: { lastResult: `${STALE_PREFIX}${outcome.error}` } });
        await deps.alertAdmins(
          `🔑 <b>Ключ покупателя устарел</b> — ${esc(order.wbCode)}\nОтложенный ключ ника <code>${esc(row.robloxUsername)}</code> больше не работает (${esc(String(outcome.error))}): его перевыпустили или удалили. Нужен новый ключ или пасс от покупателя.`,
        ).catch(() => {});
        result.stale += 1;
      }
      continue;
    }

    // Пассы созданы: след, ключ → ok, привязка к заказу.
    await recordAutocreateTrace(db, { wbCode: order.wbCode, nick: row.robloxUsername, apiKey: key, created: outcome.created, partial: Boolean(outcome.error) }).catch(() => {});
    const complete = outcome.created.length === targets.length;
    const headUrl = `https://www.roblox.com/game-pass/${outcome.created[0].gamePassId}`;
    const fresh = await db.wbOrder.findUnique({ where: { id: order.id }, select: { adminNote: true } });
    const stamp = now.toISOString().slice(0, 10);
    const note = `[КЛЮЧ-ОТЛОЖЕН ${stamp}] создано ${outcome.created.map((c) => `${c.gamePassId} (${c.priceInRobux} R$)`).join(", ")}${complete ? "" : ` — набор НЕ полный (${outcome.created.length} из ${targets.length})`}`;
    const data: Record<string, unknown> = {
      gamepassUrl: headUrl,
      adminNote: appendNote(fresh?.adminNote ?? order.adminNote, note),
      ...(order.robloxUsername ? {} : { robloxUsername: row.robloxUsername }),
      ...(complete ? { status: "PENDING", pendingAt: now, rejectionReason: null, buyoutErrorCode: null, adminId: null } : {}),
    };
    if (complete && outcome.created.length > 1) {
      await db.$transaction([
        db.wbOrderGamepass.deleteMany({ where: { orderId: order.id } }),
        db.wbOrderGamepass.createMany({
          data: outcome.created.map((pass, index) => ({
            orderId: order.id,
            gamepassId: String(pass.gamePassId),
            gamepassUrl: `https://www.roblox.com/game-pass/${pass.gamePassId}`,
            amount: targets[index].amount,
            position: index,
          })),
        }),
        db.wbOrder.update({ where: { id: order.id }, data }),
      ]);
    } else {
      await db.wbOrder.update({ where: { id: order.id }, data });
    }
    result.applied += 1;

    const heldReason = isOrderHeld(order) ? (order.heldReason ?? "заморожен") : null;
    if (complete) {
      const user = row.user ?? { tgId: null, vkId: null };
      const prices = outcome.created.map((c) => `${c.priceInRobux} R$`).join(" + ");
      const text = heldReason
        ? heldOrderBuyerText(heldReason, order.wbCode)
        : `🔑 Игра появилась — геймпасс создали сами по вашему ключу: ${prices} на аккаунте ${row.robloxUsername}.\n\n` +
          `👍 От вас больше ничего не нужно: заказ в очереди на выкуп, как только выкупим — напишем сюда.\n\nКод ВБ: ${order.wbCode}`;
      await deps.sendBuyer(user, text).catch(() => {});
      await deps.orderCard?.({ ...order, gamepassUrl: headUrl, robloxUsername: order.robloxUsername ?? row.robloxUsername }, { heldReason, parts: outcome.created.length }).catch(() => {});
    } else {
      await deps.alertAdmins(
        `🔑 <b>Отложенный ключ сработал не полностью</b> — ${esc(order.wbCode)}\nСоздано ${outcome.created.length} из ${targets.length}; головной пасс привязан, дособерите заказ.`,
      ).catch(() => {});
    }
  }
  return result;
}
