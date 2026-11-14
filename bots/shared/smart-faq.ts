/* ─────────────────────────────────────────────────────────────────────────────
   🧭 Умный FAQ (15.11.2026, владелец: «бот понимает статус заказа и от этого
   строит ссылки… ушёл читать — а в конце кнопка вернуться к геймпассу»).

   Чистый модуль, общий для TG и ВК: этап заказа → шапка FAQ, порядок
   вопросов, ответы с цифрами заказа и строка «что дальше». Кнопки строят
   адаптеры (`bots/tg/handlers.ts`, `bots/vk/handlers.ts`).
   ───────────────────────────────────────────────────────────────────────── */

import { singlePassFits } from "./gamepass-plan";
import { fmtDateRu } from "./robux-eta";

export type FaqStage = "gp" | "queue" | "done" | "none";
type Fmt = "html" | "plain";

export interface FaqOrder {
  wbCode: string | null;
  amount: number;
  status: string;
  completedAt: Date | null;
  robloxUsername: string | null;
  isDirectOrder?: boolean | null;
  heldAt?: Date | null;
}

const DONE_DAYS = 30;

export function faqStage(order: FaqOrder | null | undefined, now = Date.now()): FaqStage {
  if (!order) return "none";
  if (order.status === "AWAITING_GAMEPASS") return "gp";
  if (["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status)) return "queue";
  if (order.status === "COMPLETED" && order.completedAt && now - order.completedAt.getTime() < DONE_DAYS * 86_400_000) return "done";
  return "none";
}

/** Вопросы про этот этап — сверху FAQ, в этом порядке. Остальное — «Другие вопросы». */
export const STAGE_KEYS: Record<FaqStage, string[]> = {
  gp: ["how_gp", "price", "managed", "gp_hidden"],
  queue: ["when_buy", "wrong_gp", "what_now"],
  done: ["when_rbx", "bonus"],
  none: [],
};

/** Новый пункт: пасс создан, а поиск по нику его не находит. */
export const GP_HIDDEN_ITEM = {
  key: "gp_hidden",
  label: "🙈 Создал пасс, а бот его не видит",
};

export function gpPassPrice(amount: number): number {
  return Math.ceil(amount / 0.7);
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b = (fmt: Fmt, s: string) => (fmt === "html" ? `<b>${s}</b>` : s);
const code = (fmt: Fmt, s: string) => (fmt === "html" ? `<code>${esc(s)}</code>` : s);
const isWbCode = (c: string | null) => Boolean(c && !c.startsWith("DIR-"));

function stageWord(order: FaqOrder, stage: FaqStage): string {
  if (order.heldAt && stage === "queue") return "🔎 на проверке у поддержки";
  if (stage === "gp") return "⏳ ждём твой геймпасс";
  if (stage === "queue") return order.status === "IN_PROGRESS" ? "⚙️ выкупаем геймпасс" : "🕐 в очереди на выкуп";
  if (stage === "done") return `✅ выкуплен ${order.completedAt ? fmtDateRu(order.completedAt) : ""} — Robux в Pending у Roblox`.replace("  ", " ");
  return "";
}

/** Шапка над вопросами: заказ и этап. Пусто — заказа, о котором стоит говорить, нет. */
export function faqContextLines(order: FaqOrder | null | undefined, stage: FaqStage, fmt: Fmt): string[] {
  if (!order || stage === "none") return [];
  const who = isWbCode(order.wbCode) && stage !== "done"
    ? `🎟 Твой заказ: ${code(fmt, order.wbCode!)} · ${order.amount} R$`
    : `🎟 Заказ на ${order.amount} R$${order.robloxUsername ? ` · ник ${code(fmt, order.robloxUsername)}` : ""}`;
  return [who, `📊 Сейчас: ${b(fmt, stageWord(order, stage))}`];
}

/** Последняя строка объяснения «Геймпасс и Pending»: куда вернуться. */
export function stageNextLine(stage: FaqStage, fmt: Fmt): string | null {
  if (stage === "gp") return "⏳ Твой заказ ждёт геймпасс — создай его и пришли сюда, кнопки ниже.";
  if (stage === "queue") return "🕐 Твой заказ в очереди на выкуп — статус в «Мой заказ».";
  if (stage === "done") return `✅ Твой заказ выкуплен — проверь строку ${b(fmt, "Pending Robux")} в Transactions.`;
  return null;
}

/**
 * Ответ под заказ или `null` — тогда общий текст пункта. Только там, где
 * этап меняет смысл ответа: цена (своя цифра), «что делать», «не тот ник»,
 * «бот не видит пасс».
 */
export function personalFaqAnswer(key: string, order: FaqOrder | null | undefined, stage: FaqStage, fmt: Fmt, platform: "tg" | "vk"): string | null {
  if (key === "price" && order && stage === "gp") {
    if (!singlePassFits(order.amount)) {
      return `Твой заказ на ${b(fmt, `${order.amount} R$`)} делится на несколько геймпассов — у каждого своя цена. Точные цены — в твоей инструкции, по шагам.\n\n` +
        "⚠️ Managed pricing (региональные цены) — выключен, иначе Roblox сам поменяет цену.";
    }
    return `Для твоего заказа на ${b(fmt, `${order.amount} R$`)} поставь цену геймпасса ${b(fmt, `${gpPassPrice(order.amount)} R$`)}.\n\n` +
      `Roblox забирает 30% комиссии с продажи, поэтому после выкупа на твой аккаунт придёт ровно ${order.amount}.\n\n` +
      "⚠️ Managed pricing (региональные цены) — выключен, иначе Roblox сам поменяет цену и выкупить не получится.";
  }
  if (key === "what_now") {
    if (stage === "gp") return `Твой заказ ждёт геймпасс. Открой ${b(fmt, "📖 Мою инструкцию")} — там все шаги. Создал пасс — пришли ссылку на него или свой ник Roblox сюда.`;
    if (stage === "queue") return order?.heldAt
      ? "Заказ на проверке у поддержки — ничего делать не нужно, менеджер напишет сюда."
      : "Ничего делать не нужно: заказ в очереди на выкуп. Как только выкупим — бот пришлёт уведомление сюда.";
    if (stage === "done") return "Заказ выкуплен — робуксы уже на твоём аккаунте, в статусе Pending. Проверь строку Pending Robux в Transactions (кнопка ниже).";
  }
  if (key === "wrong_gp") {
    if (stage === "gp") return `Пока пасс не отправлен, просто введи нужный ник: кнопка ${b(fmt, "🔎 Ввести ник Roblox")} ниже — и выбери свой геймпасс.`;
    if (stage === "queue") return order?.isDirectOrder
      ? "Напиши менеджеру — поменяем ник до выкупа."
      : `Нажми ${b(fmt, "⚠️ Ошибся с ником? Изменить заказ")} ниже — можно перевыбрать ник и геймпасс, пока заказ не выкуплен.`;
    if (stage === "done") return "Заказ уже выкуплен — робуксы ушли на ник из заказа. Поменять его после выкупа нельзя.";
  }
  if (key === "gp_hidden") {
    const send = "🔗 Прислать ссылку на геймпасс";
    return "Так бывает, если игра (плейс) закрыта или пасс создан только что — поиск по нику его ещё не видит. Это не ошибка.\n\n" +
      `Нажми ${b(fmt, send)} и пришли ссылку на пасс: открой его на create.roblox.com или в Roblox и скопируй адрес страницы. ` +
      "Главное — пасс в продаже и с нужной ценой.";
  }
  return null;
}

/** «— 715 R$» к пункту про цену, когда пасс один. */
export function priceLabelSuffix(order: FaqOrder | null | undefined, stage: FaqStage): string {
  return order && stage === "gp" && singlePassFits(order.amount) ? ` — ${gpPassPrice(order.amount)} R$` : "";
}
