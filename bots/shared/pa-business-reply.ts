/* ─────────────────────────────────────────────────────────────────────────────
   Ответ «где мой заказ» в чате поддержки @RobloxBank_PA (12.11.2026).

   @RobloxBankBot подключён к аккаунту поддержки через Telegram Business и
   отвечает от его имени. Решение владельца: автоматом — только то, что бот
   знает точно из базы (этап заказа), всё остальное — человеку.

   Чистая функция: текст сообщения + заказы покупателя → ответ или `null`.
   ───────────────────────────────────────────────────────────────────────── */

import { buildRobuxEtaWbChat } from "./robux-eta";

export interface PaOrder {
  wbCode: string;
  amount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  heldAt: Date | null;
}

/* Ответ уходит от имени поддержки, поэтому распознавание строже, чем в
   основном боте (`isArrivalQuestion` из robux-eta ловит и «100 R$ в подарок
   придут?», и «как получить»): только явное «где / когда / не пришло», и ни
   слова о бонусе, комиссии, инструкции — там нужен другой ответ или человек.
   По 298 вопросам с WB старое правило срабатывало на 104, это — см. тест. */
const ASK_RE = new RegExp([
  "где\\s+(?:мо[йиеяю]\\s+)?(?:заказ|робук|робак|рб|роблокс|пасс|деньг)",
  "не\\s*(?:приш|приход|поступ|зачисл|начисл|дош|выкуп|купил)",
  "когда\\s+(?:уже\\s+)?(?:придут|прид[её]т|будут|выкуп|зачисл|поступ|купите)",
  "(?:сколько|долго)\\s+(?:ещ[её]\\s+)?(?:ждать|жд[её]м)",
  "до\\s+сих\\s+пор",
  "статус\\s+заказ|что\\s+с\\s+(?:моим\\s+)?заказ|выкупили\\s*\\?",
].join("|"), "iu");
const OFF_TOPIC_RE = /бонус|подар|\+\s?100|комисс|наличи|пвз|физическ|инструкц|как\s+(?:создать|получить|сделать|активир)|смс|qr|кью ?ар|сайт|отзыв|верн[иу]те|возврат/iu;

export function isOrderStatusQuestion(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/ё/g, "е");
  if (t.length < 4 || t.length > 300) return false;
  return ASK_RE.test(t) && !OFF_TOPIC_RE.test(t);
}

const STAGE_TEXT: Record<string, (o: PaOrder) => string> = {
  AWAITING_GAMEPASS: (o) =>
    `Заказ ${o.wbCode} на ${o.amount} R$ ждёт геймпасс: создайте пасс по инструкции из бота @RobloxBankBot и отправьте его туда — после этого выкупаем в течение дня. Если с пассом что-то не получается — напишите здесь, что именно, поможем.`,
  PENDING: (o) =>
    `Заказ ${o.wbCode} на ${o.amount} R$ в очереди на выкуп — обычно это в течение дня. Как только выкупим, бот @RobloxBankBot пришлёт уведомление.`,
  IN_PROGRESS: (o) =>
    `Заказ ${o.wbCode} на ${o.amount} R$ выкупаем прямо сейчас — бот @RobloxBankBot пришлёт уведомление, как только закончим.`,
};

const DAY = 86_400_000;

/**
 * Ответ на вопрос о заказе или `null` (тогда отвечает человек):
 * • вопрос не про заказ;
 * • заказа нет, он заморожен, с ошибкой или ждёт оплаты — тут нужен человек;
 * • свежий выкуп старше 30 дней — это уже не «в пути».
 */
export function paOrderReply(text: string, orders: PaOrder[], now: Date = new Date()): string | null {
  if (!isOrderStatusQuestion(text)) return null;
  const byNew = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const active = byNew.filter((o) => ["PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"].includes(o.status));
  if (active.length > 1) return null; // несколько живых заказов — пусть разберётся человек
  if (active.length === 1) {
    const o = active[0];
    if (o.heldAt) return null;
    const stage = STAGE_TEXT[o.status];
    return stage ? stage(o) : null;
  }
  const done = byNew
    .filter((o) => o.status === "COMPLETED" && o.completedAt && now.getTime() - o.completedAt.getTime() < 30 * DAY)
    .map((o) => ({ amount: o.amount, completedAt: o.completedAt as Date, wbCode: o.wbCode }));
  return buildRobuxEtaWbChat(done, now)?.text ?? null;
}

/** Карточка «Мой заказ» в боте одной ссылкой (`/start order`). */
export const BOT_ORDER_URL = "https://t.me/RobloxBankBot?start=order";

/**
 * 🤖 «Загляните в бота» (15.11.2026, владелец: «саппорту не надо голову
 * ебать "где мои робуксы"»). К ответу по этапу — ссылка на карточку заказа в
 * боте: там статус, инструкция, ник/пасс и проверка Robux. Поддержке остаётся
 * «в боте не нашёл ответа».
 */
export function paBotRedirectReply(text: string, orders: PaOrder[], now: Date = new Date()): string | null {
  const status = paOrderReply(text, orders, now);
  if (!status) return null;
  return [
    status,
    "",
    `📦 Всё по заказу — статус, инструкция, проверка Robux — в боте: ${BOT_ORDER_URL}`,
    "Если там не нашли ответа — напишите здесь, что именно не так, поможем.",
  ].join("\n");
}
