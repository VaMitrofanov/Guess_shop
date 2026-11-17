/* ─────────────────────────────────────────────────────────────────────────────
   📤 Что уже ушло покупателю в чат WB — для уведа «покупатель пишет»
   (16.11.2026, владелец: «вместо одинаковых кнопок — статус, что уже было
   отправлено ботом или человеком, чтобы понимать, не заходя на WB; кнопки — по
   логике, исходя из этого»).

   Этап заказа решает, какие ответы вообще имеют смысл:
   • `before_code` — ждём код получения: «Пришлите код», «Курьера нет»;
   • `gate_sent`   — код гейта ушёл, покупатель его ещё не открыл: «Инструкция»;
   • `activated`   — покупатель уже у нас в боте: отвечать лучше ТАМ (ссылка на
     диалог TG/VK), а в WB — только своим текстом;
   • `closed`      — отменён/возвращён: только «Свой ответ».
   «✍️ Свой ответ» и «📱 Открыть в TWA» есть всегда.

   17.11.2026 (владелец: «слишком громоздко… если заказ выкуплен — нахуй нам
   знать, ушёл ли гейт»): статус сжат до ОДНОЙ фразы о заказе, а кружок
   заголовка красится по состоянию заказа (`tone`). История чата WB («что
   уже ушло») показывается только пока покупатель не дошёл до бота.
   ───────────────────────────────────────────────────────────────────────── */

import { WB_REPLY_CB, type WbReplyKind } from "./wb-reply-buttons";
import { vkCommunityDialogUrl } from "./vk-links";
import { twaStartappUrl } from "./admin-route";
import { heldLabel } from "./notify-format";

export type DbsChatStage = "before_code" | "gate_sent" | "activated" | "closed";

/** Цвет кружка в уведе = состояние ЗАКАЗА (17.11.2026, владелец), а не срочность:
 *  ⚪ мяч у покупателя · 🟡 в работе у нас · 🟢 выкуплено · 🔴 стоп · ⚫ мёртв. */
export type DbsChatTone = "idle" | "work" | "done" | "stop" | "closed";

export interface DbsChatStatus {
  stage: DbsChatStage;
  tone: DbsChatTone;
  /** Одной фразой, где заказ сейчас: «ждёт выкупа 23 ч», «выкуплено 15.11». HTML. */
  state: string;
  /** Доп. строки — только пока заказ не дошёл до бота (что ушло в чат WB). HTML. */
  lines: string[];
  code: string | null;
  contact: { tgUsername?: string | null; vkId?: string | null } | null;
}

type InlineButton = { text: string; callback_data?: string; url?: string };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function moscowTime(at: Date, now: Date): string {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Europe/Moscow" };
  const day = (d: Date) => d.toLocaleDateString("ru-RU", { ...opts, day: "2-digit", month: "2-digit" });
  const time = at.toLocaleTimeString("ru-RU", { ...opts, hour: "2-digit", minute: "2-digit" });
  return day(at) === day(now) ? time : `${day(at)} ${time}`;
}

function moscowDay(at: Date): string {
  return at.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
}

/** «40 мин», «23 ч», «3 сут». */
export function ageText(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} ч` : `${Math.round(h / 24)} сут`;
}

const GATE_SENT = new Set(["GATE_LINK_SENT", "AUTO_GATE_ISSUED_AND_SENT", "GATE_MANUALLY_MARKED_SENT", "GATE_SERVED_EXTERNALLY"]);

type Internal = {
  status: string;
  robloxUsername: string | null;
  gamepassUrl: string | null;
  pendingAt?: Date | null;
  completedAt?: Date | null;
  heldAt?: Date | null;
  heldReason?: string | null;
  /** Код ошибки выкупа (`ERROR`) и причина отказа (`REJECTED`) — тоже не голым словом. */
  buyoutErrorCode?: string | null;
  rejectionReason?: string | null;
};

/** «ошибка выкупа: REGIONAL_PRICE» — причина рядом со словом, если она есть. */
function withWhy(word: string, why: string | null | undefined): string {
  const t = (why ?? "").replace(/\s+/g, " ").trim();
  if (!t || t === "не указана") return word;
  return `${word}: ${escapeHtml(t.length > 90 ? `${t.slice(0, 89).trimEnd()}…` : t)}`;
}

/** Заказ уже у нас в боте: где он. История чата WB здесь больше не нужна. */
function internalState(i: Internal, now: Date): { tone: DbsChatTone; state: string } {
  if (i.heldAt) return { tone: "stop", state: heldLabel(i.heldReason) };
  switch (i.status) {
    case "COMPLETED": return { tone: "done", state: i.completedAt ? `выкуплено ${moscowDay(i.completedAt)}` : "выкуплено" };
    case "IN_PROGRESS": return { tone: "work", state: "выкупается" };
    case "PENDING": return { tone: "work", state: i.pendingAt ? `ждёт выкупа <b>${ageText(i.pendingAt, now)}</b>` : "ждёт выкупа" };
    case "ERROR": return { tone: "stop", state: withWhy("ошибка выкупа", i.buyoutErrorCode) };
    case "REJECTED": return { tone: "closed", state: withWhy("отклонён", i.rejectionReason) };
  }
  const missing = [!i.robloxUsername && "ника", !i.gamepassUrl && "пасса"].filter(Boolean);
  return {
    tone: "work",
    state: missing.length > 0 ? `в боте, нет ${missing.join(" и ")}` : `в боте · ${escapeHtml(i.status)}`,
  };
}

/** Чистая сборка статуса — без базы, ради тестов. */
export function buildDbsChatStatus(input: {
  now: Date;
  cancelled: boolean;
  gateState: string | null;
  chatState: string | null;
  code: string | null;
  internal: Internal | null;
  contact: DbsChatStatus["contact"];
  events: { type: string; createdAt: Date; actor?: string | null }[];
  lastSeller: { text: string | null; at: Date } | null;
}): DbsChatStatus {
  const { now, events } = input;
  const pick = (types: Set<string> | string) => {
    const match = events
      .filter((e) => (typeof types === "string" ? e.type === types : types.has(e.type)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { first: match[0] ?? null, last: match[match.length - 1] ?? null, count: match.length };
  };
  const gate = pick(GATE_SENT);

  let stage: DbsChatStage;
  if (input.cancelled) stage = "closed";
  else if (input.internal) stage = "activated";
  else if (input.gateState === "SENT" || input.gateState === "SEND_UNKNOWN" || gate.count > 0) stage = "gate_sent";
  else stage = "before_code";

  const base = { stage, code: input.code, contact: input.contact };
  if (stage === "closed") return { ...base, tone: "closed", state: "отменён на WB", lines: [] };
  if (stage === "activated" && input.internal) return { ...base, ...internalState(input.internal, now), lines: [] };

  // До бота: что уже ушло в чат WB — чтобы не повторять покупателю то же самое.
  let state: string;
  if (stage === "gate_sent") {
    const reminders = pick("GATE_REMINDER_SENT");
    state = `гейт ушёл${gate.first ? ` ${moscowTime(gate.first.createdAt, now)}` : ""}, не открыт`
      + (reminders.count > 0 ? ` · напомнили${reminders.count > 1 ? ` ×${reminders.count}` : ""}` : "");
  } else if (input.chatState === "CODE_RECEIVED") {
    state = "код получения есть, гейт не ушёл";
  } else {
    const asked = pick("DELIVERY_CODE_REQUESTED");
    state = `ждём код получения${asked.first ? ` · попросили ${moscowTime(asked.first.createdAt, now)}` : ""}`;
  }
  const lines: string[] = [];
  if (input.lastSeller?.text) {
    const preview = input.lastSeller.text.replace(/\s+/g, " ").trim();
    lines.push(`↪️ от нас ${moscowTime(input.lastSeller.at, now)}: <i>${escapeHtml(preview.length > 70 ? `${preview.slice(0, 69)}…` : preview)}</i>`);
  }
  return { ...base, tone: "idle", state, lines };
}

/** Кнопки под уведом «покупатель пишет» — по этапу. */
export function dbsChatMarkup(wbOrderId: string, status: Pick<DbsChatStatus, "stage" | "code" | "contact"> | null): { inline_keyboard: InlineButton[][] } {
  const cb = (k: WbReplyKind) => `${WB_REPLY_CB}:${k}:${wbOrderId}`;
  const own: InlineButton = { text: "✍️ Ответ в WB", callback_data: cb("w") };
  const twaUrl = twaStartappUrl(status?.code);
  const twa: InlineButton | null = twaUrl ? { text: "📱 Открыть в TWA", url: twaUrl } : null;
  const rows: InlineButton[][] = [];
  switch (status?.stage ?? "before_code") {
    case "before_code":
      rows.push([{ text: "🔑 Пришлите код", callback_data: cb("c") }, { text: "🚚 Курьера нет", callback_data: cb("r") }]);
      break;
    case "gate_sent":
      rows.push([{ text: "📖 Инструкция", callback_data: cb("g") }]);
      break;
    case "activated": {
      const tg = status?.contact?.tgUsername;
      const vk = status?.contact?.vkId;
      if (tg && /^[A-Za-z0-9_]{4,32}$/.test(tg)) rows.push([{ text: `💬 Написать в TG @${tg}`, url: `https://t.me/${tg}` }]);
      else if (vk && /^\d+$/.test(vk)) rows.push([{ text: "💬 Написать в ВК", url: vkCommunityDialogUrl(vk) }]);
      break;
    }
    case "closed":
      break;
  }
  rows.push(twa ? [own, twa] : [own]);
  return { inline_keyboard: rows };
}

type Db = {
  wbMarketplaceOrder: { findUnique: (args: unknown) => Promise<unknown> };
  wbOrder: { findUnique: (args: unknown) => Promise<unknown> };
  wbBuyerChatEvent: { findFirst: (args: unknown) => Promise<unknown> };
};

/** Статус по номеру заказа WB. Ошибка чтения — `null`: увед уйдёт с базовыми кнопками. */
export async function loadDbsChatStatus(db: Db, wbOrderId: string, now = new Date()): Promise<DbsChatStatus | null> {
  try {
    const order = await db.wbMarketplaceOrder.findUnique({
      where: { wbOrderId },
      select: {
        id: true, chatState: true, gateState: true, cancelledAt: true,
        wbCode: { select: { code: true } },
        events: { orderBy: { createdAt: "desc" }, take: 60, select: { type: true, createdAt: true, actor: true } },
      },
    }) as {
      id: string; chatState: string | null; gateState: string | null; cancelledAt: Date | null;
      wbCode: { code: string } | null; events: { type: string; createdAt: Date; actor: string | null }[];
    } | null;
    if (!order) return null;
    const code = order.wbCode?.code ?? null;
    const [internal, lastSeller] = await Promise.all([
      code
        ? db.wbOrder.findUnique({
            where: { wbCode: code },
            select: {
              status: true, robloxUsername: true, gamepassUrl: true, pendingAt: true, completedAt: true, heldAt: true, heldReason: true,
              buyoutErrorCode: true, rejectionReason: true,
              user: { select: { username: true, tgId: true, vkId: true } },
            },
          }) as Promise<(Internal & { user: { username: string | null; tgId: string | null; vkId: string | null } | null }) | null>
        : Promise.resolve(null),
      db.wbBuyerChatEvent.findFirst({
        where: { marketplaceOrderId: order.id, sender: "seller" },
        orderBy: { sentAt: "desc" },
        select: { textRedacted: true, sentAt: true },
      }) as Promise<{ textRedacted: string | null; sentAt: Date } | null>,
    ]);
    return buildDbsChatStatus({
      now,
      cancelled: Boolean(order.cancelledAt),
      gateState: order.gateState,
      chatState: order.chatState,
      code,
      internal: internal
        ? {
            status: internal.status, robloxUsername: internal.robloxUsername, gamepassUrl: internal.gamepassUrl,
            pendingAt: internal.pendingAt, completedAt: internal.completedAt, heldAt: internal.heldAt, heldReason: internal.heldReason,
            buyoutErrorCode: internal.buyoutErrorCode, rejectionReason: internal.rejectionReason,
          }
        : null,
      contact: internal?.user ? { tgUsername: internal.user.tgId ? internal.user.username : null, vkId: internal.user.vkId } : null,
      events: order.events,
      lastSeller: lastSeller ? { text: lastSeller.textRedacted, at: lastSeller.sentAt } : null,
    });
  } catch {
    return null;
  }
}
