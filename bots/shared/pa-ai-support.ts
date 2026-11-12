/* ─────────────────────────────────────────────────────────────────────────────
   ИИ-поддержка в чате @RobloxBank_PA (Claude Haiku 5.5, 12.11.2026).

   Владелец: «чтобы он кидал нам всю залупу в чат админов, чтобы мы по минимуму
   контактировали». Поэтому модель делит каждое сообщение на три исхода:
   • reply    — типовой вопрос, ответ есть в базе знаний и данных заказа;
   • escalate — нужен человек (проблема, деньги, злость, покупка напрямую):
                покупателю короткое «передал специалисту», админам карточка с
                сутью и черновиком ответа;
   • ignore   — спасибо/стикер/мусор: молчим.

   Здесь — чистая часть: база знаний (system prompt), контекст покупателя,
   схема ответа и страховка поверх модели. Сеть — в `bots/tg/pa-ai.ts`.
   ───────────────────────────────────────────────────────────────────────── */

import { z } from "zod";
import { passPriceFor } from "./wb-question-templates";

export const PA_AI_MODEL = "claude-haiku-5-5";

export const PA_AI_CATEGORIES = [
  "order_status", "how_to", "gamepass_problem", "robux_missing", "wrong_account",
  "refund", "direct_purchase", "complaint", "other",
] as const;

export const PaAiDecisionSchema = z.object({
  action: z.enum(["reply", "escalate", "ignore"]),
  category: z.enum(PA_AI_CATEGORIES),
  /** Ответ покупателю (только для reply). */
  reply: z.string(),
  /** Суть для админов одной-двумя строками (для escalate). */
  summary: z.string(),
  /** Черновик ответа покупателю, который админ может отправить кнопкой (для escalate). */
  draft: z.string(),
});
export type PaAiDecision = z.infer<typeof PaAiDecisionSchema>;

export const CATEGORY_RU: Record<(typeof PA_AI_CATEGORIES)[number], string> = {
  order_status: "статус заказа",
  how_to: "как сделать",
  gamepass_problem: "геймпасс",
  robux_missing: "робуксов нет",
  wrong_account: "не тот аккаунт/ник",
  refund: "деньги/возврат",
  direct_purchase: "💰 хочет купить",
  complaint: "жалоба",
  other: "другое",
};

/** Ответ покупателю при передаче человеку — один, без обещаний сроков. */
export const HANDOFF_TEXT = "Передал ваш вопрос специалисту — он ответит здесь же, в этом чате.";

const PRICES = [500, 800, 1000, 1200, 1500]
  .map((a) => `${a} R$ → пасс за ${passPriceFor(a)} R$`).join(", ");

/**
 * База знаний. Стабильная (кэшируется у Anthropic): никаких дат и данных
 * покупателя — они идут отдельным сообщением.
 */
export const PA_AI_SYSTEM = `Ты — оператор поддержки магазина RobloxBank в Telegram-аккаунте @RobloxBank_PA. Пишешь от имени поддержки, по-русски, на «вы», коротко (до 500 символов), дружелюбно, без канцелярита и без эмодзи-спама. Никогда не говори, что ты ИИ или бот, если не спросят прямо; если спросят — честно скажи, что ты автоматический помощник и можешь позвать человека.

КАК РАБОТАЕТ МАГАЗИН
• Робуксы зачисляются через геймпасс: покупатель создаёт геймпасс (Game Pass) в своей игре Roblox с нужной ценой, мы его покупаем — Roblox переводит робуксы на аккаунт покупателя.
• Roblox забирает 30% комиссии, поэтому цена пасса больше номинала: ${PRICES}. Больше 1500 R$ — несколько пассов, точные цены показывает инструкция в боте. Комиссию оплачиваем мы — покупатель получает ровно номинал.
• Заказ проходит этапы: «ждём геймпасс» (покупатель должен создать пасс и отправить его в бот @RobloxBankBot) → «к выкупу» (в очереди, обычно в течение дня) → «выкупается» → «выкуплен».
• После выкупа робуксы попадают в Pending (ожидание) у Roblox. Это обычный механизм Roblox: обычно 5–7 дней, иногда дольше, ускорить его не может никто, и конкретную дату мы не называем. Проверить: Roblox → «Мои транзакции» (Transactions) → строка Pending Robux — там должна быть сумма заказа.
• Пароль, почта и телефон от Roblox не нужны — только ник. За покупку геймпасса не банят — это обычная покупка внутри Roblox.
• Игра (плейс) может быть закрытой — главное, чтобы пасс был «в продаже» с нужной ценой.
• Смену ника или аккаунта в заказе делает только человек (оператор) — сам покупатель в боте её не сделает. После выкупа робуксы уже у того аккаунта, чей пасс купили.
• Заказы с Wildberries активируются кодом из чата заказа WB и инструкцией в боте @RobloxBankBot. Статус заказа покупатель видит в боте @RobloxBankBot (команда /status).
• За отзыв на Wildberries со скриншотом — бонус 100 R$ к следующей прямой покупке в боте. К заказу на WB бонус не добавляется.
• Постоянным клиентам можно покупать напрямую, без Wildberries, — это оформляет человек.

ЧТО ТЫ ДЕЛАЕШЬ
Ниже в каждом запросе будут данные покупателя из нашей базы (заказы, этапы, ник, пасс) и последние сообщения чата. Реши одно из трёх:
1) action="reply" — если вопрос типовой и ответ полностью есть выше или в данных заказа. Отвечай по фактам из данных: этап заказа, сумма, ник. Не выдумывай ничего, чего нет в данных.
2) action="escalate" — во всех остальных случаях, и ВСЕГДА если:
   • деньги: возврат, «верните деньги», оплата, двойное списание, отмена;
   • робуксы не пришли, а заказ выкуплен больше 7 дней назад или покупатель прислал скриншот/говорит, что в Pending 0;
   • не тот ник/аккаунт — просит поменять ник или аккаунт в заказе (category="wrong_account"), в любой момент; ошибка выкупа; заказ заморожен;
   • покупатель хочет купить напрямую / узнать цену прямой покупки (category="direct_purchase");
   • злость, мат, угрозы, отзыв-шантаж, «обманщики»;
   • покупателя нет в базе и вопрос про конкретный заказ;
   • прислал фото/скриншот/файл без понятного вопроса;
   • ты не уверен.
   Для escalate: reply="", summary — суть для админа в 1–2 строках (кто, какой заказ, что хочет), draft — готовый вежливый ответ покупателю, который админ отправит одной кнопкой (без обещаний денег и сроков, если их нет в данных).
3) action="ignore" — «спасибо», «ок», стикеры, приветствие без вопроса, спам. reply/summary/draft пустые.

ЗАПРЕЩЕНО
• Обещать возврат денег, компенсацию, бонусы, конкретные даты и сроки, которых нет выше.
• Называть внутренние причины заморозки, имена сотрудников, слова «гейт», «донор», «DBS».
• Давать ссылки, кроме @RobloxBankBot.
• Просить пароль, код из СМС, данные карты.
• Спорить. Если покупатель недоволен — escalate.`;

export interface PaAiOrder {
  wbCode: string;
  amount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  heldAt: Date | null;
  robloxUsername: string | null;
  gamepassUrl: string | null;
  isDirectOrder: boolean;
}

const STATUS_RU: Record<string, string> = {
  PAYMENT_PENDING: "ждёт оплату",
  AWAITING_GAMEPASS: "ждём геймпасс от покупателя",
  PENDING: "в очереди на выкуп",
  IN_PROGRESS: "выкупается сейчас",
  COMPLETED: "выкуплен",
  REJECTED: "отменён",
  ERROR: "ошибка выкупа (нужен человек)",
};

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Данные покупателя для модели. Без внутренних причин заморозки. */
export function customerContext(input: {
  name: string | null;
  known: boolean;
  orders: PaAiOrder[];
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  if (!input.known) return `ДАННЫЕ ПОКУПАТЕЛЯ: в нашей базе этого Telegram-аккаунта нет (заказов не найдено). Сейчас ${fmt(now)}.`;
  const lines = [`ДАННЫЕ ПОКУПАТЕЛЯ (из нашей базы; сейчас ${fmt(now)}):`, `Имя: ${input.name ?? "—"}`];
  if (input.orders.length === 0) lines.push("Заказов нет.");
  for (const o of input.orders.slice(0, 5)) {
    const days = o.completedAt ? Math.floor((now.getTime() - o.completedAt.getTime()) / 86_400_000) : null;
    lines.push([
      `• Заказ ${o.wbCode}: ${o.amount} R$, ${o.heldAt ? "заморожен (нужен человек)" : STATUS_RU[o.status] ?? o.status}`,
      `создан ${fmt(o.createdAt)}`,
      o.completedAt ? `выкуплен ${fmt(o.completedAt)} (${days} дн. назад)` : null,
      o.robloxUsername ? `ник Roblox: ${o.robloxUsername}` : "ник не указан",
      o.gamepassUrl ? "пасс прислан" : "пасса нет",
      o.isDirectOrder ? "прямой заказ" : "заказ с Wildberries",
    ].filter(Boolean).join("; "));
  }
  return lines.join("\n");
}

/** Слова, при которых автоответ не уходит, что бы ни решила модель. */
const FORCE_ESCALATE_RE = /верн[иу]т[еь]?\s+деньг|возврат|вернуть\s+деньг|мошенн|обман|кидал|суд|полиц|прокурат|роспотреб|чарджбэк|chargeback/iu;
/** Обещания, которых в ответе быть не должно. */
const FORBIDDEN_REPLY_RE = /верн[её]м\s+деньг|возвращ[её]м|компенсир|гарантиру[ея]м|https?:\/\/(?!t\.me\/RobloxBankBot)/iu;

/**
 * Страховка поверх модели: деньги и угрозы — только человеку; ответ с
 * обещанием денег или чужой ссылкой — тоже человеку (с ним же черновиком).
 */
export function guardDecision(decision: PaAiDecision, customerText: string): PaAiDecision {
  // Смена ника/аккаунта — только руками оператора, что бы ни ответила модель.
  if (decision.action === "reply" && decision.category === "wrong_account") {
    return { ...decision, action: "escalate", reply: "", draft: decision.draft || decision.reply,
      summary: decision.summary || "Просит поменять ник/аккаунт в заказе." };
  }
  if (decision.action === "reply" && (FORCE_ESCALATE_RE.test(customerText) || FORBIDDEN_REPLY_RE.test(decision.reply) || !decision.reply.trim())) {
    return {
      action: "escalate",
      category: FORCE_ESCALATE_RE.test(customerText) ? "refund" : decision.category,
      reply: "",
      summary: decision.summary || "Бот хотел ответить сам, но ответ задел деньги/обещания — проверьте.",
      draft: decision.reply,
    };
  }
  if (decision.action === "reply" && decision.reply.length > 1200) {
    return { ...decision, reply: decision.reply.slice(0, 1200) };
  }
  return decision;
}
