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
   ───────────────────────────────────────────────────────────────────────── */

import { WB_REPLY_CB, type WbReplyKind } from "./wb-reply-buttons";
import { vkCommunityDialogUrl } from "./vk-links";
import { twaStartappUrl } from "./admin-route";

export type DbsChatStage = "before_code" | "gate_sent" | "activated" | "closed";

export interface DbsChatStatus {
  stage: DbsChatStage;
  /** Строки «что уже было», готовые для HTML-уведа (без кодов и адресов). */
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

const GATE_SENT = new Set(["GATE_LINK_SENT", "AUTO_GATE_ISSUED_AND_SENT", "GATE_MANUALLY_MARKED_SENT", "GATE_SERVED_EXTERNALLY"]);
const HUMAN_REPLY = new Set(["TG_REPLY_SENT", "CHAT_MESSAGE_SENT"]);

/** Чистая сборка статуса — без базы, ради тестов. */
export function buildDbsChatStatus(input: {
  now: Date;
  cancelled: boolean;
  gateState: string | null;
  chatState: string | null;
  code: string | null;
  internal: { status: string; robloxUsername: string | null; gamepassUrl: string | null } | null;
  contact: DbsChatStatus["contact"];
  events: { type: string; createdAt: Date; actor?: string | null }[];
  lastSeller: { text: string | null; at: Date } | null;
}): DbsChatStatus {
  const { now, events } = input;
  const first = (types: Set<string> | string) => {
    const match = events
      .filter((e) => (typeof types === "string" ? e.type === types : types.has(e.type)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return { first: match[0] ?? null, last: match[match.length - 1] ?? null, count: match.length };
  };
  const steps: string[] = [];
  const askedCode = first("DELIVERY_CODE_REQUESTED");
  if (askedCode.first) steps.push(`попросили код получения ${moscowTime(askedCode.first.createdAt, now)}`);
  const gate = first(GATE_SENT);
  if (gate.first) steps.push(`гейт с кодом ${moscowTime(gate.first.createdAt, now)}`);
  const reminders = first("GATE_REMINDER_SENT");
  if (reminders.count > 0) steps.push(`напоминание${reminders.count > 1 ? ` ×${reminders.count}` : ""} ${moscowTime(reminders.last!.createdAt, now)}`);
  const human = first(HUMAN_REPLY);
  if (human.count > 0) steps.push(`ответы людей ×${human.count}, последний ${moscowTime(human.last!.createdAt, now)}${human.last!.actor ? ` (${human.last!.actor})` : ""}`);

  const lines: string[] = [];
  if (steps.length > 0) lines.push(`📤 Уже было: ${steps.map(escapeHtml).join(" → ")}`);
  if (input.lastSeller?.text) {
    const preview = input.lastSeller.text.replace(/\s+/g, " ").trim();
    lines.push(`↪️ Последнее от нас ${moscowTime(input.lastSeller.at, now)}: <i>${escapeHtml(preview.length > 90 ? `${preview.slice(0, 89)}…` : preview)}</i>`);
  }

  let stage: DbsChatStage;
  if (input.cancelled) stage = "closed";
  else if (input.internal) stage = "activated";
  else if (input.gateState === "SENT" || input.gateState === "SEND_UNKNOWN" || gate.count > 0) stage = "gate_sent";
  else stage = "before_code";

  if (stage === "activated" && input.internal) {
    const has = [input.internal.robloxUsername ? "ник есть" : "ника нет", input.internal.gamepassUrl ? "пасс есть" : "пасса нет"].join(", ");
    lines.unshift(`🧭 Код открыт в боте · ${has} · статус ${escapeHtml(input.internal.status)}`);
  } else if (stage === "gate_sent") {
    lines.unshift("🧭 Гейт ушёл, код покупатель ещё не открыл");
  } else if (stage === "before_code") {
    lines.unshift(input.chatState === "CODE_RECEIVED" ? "🧭 Код получения есть, гейт ещё не ушёл" : "🧭 Ждём код получения");
  } else {
    lines.unshift("🧭 Заказ отменён на WB");
  }
  return { stage, lines, code: input.code, contact: input.contact };
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
            select: { status: true, robloxUsername: true, gamepassUrl: true, user: { select: { username: true, tgId: true, vkId: true } } },
          }) as Promise<{ status: string; robloxUsername: string | null; gamepassUrl: string | null; user: { username: string | null; tgId: string | null; vkId: string | null } | null } | null>
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
      internal: internal ? { status: internal.status, robloxUsername: internal.robloxUsername, gamepassUrl: internal.gamepassUrl } : null,
      contact: internal?.user ? { tgUsername: internal.user.tgId ? internal.user.username : null, vkId: internal.user.vkId } : null,
      events: order.events,
      lastSeller: lastSeller ? { text: lastSeller.textRedacted, at: lastSeller.sentAt } : null,
    });
  } catch {
    return null;
  }
}
