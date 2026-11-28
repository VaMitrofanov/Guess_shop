/* ─────────────────────────────────────────────────────────────────────────────
   Память ассистента в беседе админов (26.11.2026).

   До этого каждый вопрос уходил в Claude сам по себе: «были проблемы с этим
   заказом?» после разговора про RVAMP3J получало «какой заказ имеется в виду?».
   Теперь две вещи:

   1. Короткая память. Последние реплики хранятся отдельно на каждого админа
      в каждой теме (`чат:тема:админ`) — два админа в одной теме не путают
      друг другу контекст. Через 30 минут тишины разговор забывается: новый
      вопрос через час — это новая тема, а не продолжение.
   2. Ответ на сообщение. Если админ ответил на карточку, увед или чужое
      сообщение, его текст (и подписи кнопок — там коды заказов) уходят в
      вопрос. Цитата Telegram (выделенный кусок) важнее всего сообщения.

   Память в процессе бота: после рестарта пусто, это нормально.
   ───────────────────────────────────────────────────────────────────────── */

export type AssistantTurn = { role: "user" | "assistant"; text: string };

const TTL_MS = 30 * 60_000;
const MAX_TURNS = 10; // 5 пар вопрос–ответ
const MAX_TURN_CHARS = 3000;
const MAX_REPLY_CHARS = 1500;

type Entry = { turns: AssistantTurn[]; at: number };
const store = new Map<string, Entry>();

export function memoryKey(chatId: number, threadId: number | undefined, userId: number): string {
  return `${chatId}:${threadId ?? 0}:${userId}`;
}

export function recallTurns(key: string, now = Date.now()): AssistantTurn[] {
  const e = store.get(key);
  if (!e) return [];
  if (now - e.at > TTL_MS) {
    store.delete(key);
    return [];
  }
  return e.turns.slice();
}

export function rememberExchange(key: string, question: string, answer: string, now = Date.now()): void {
  const turns = [
    ...recallTurns(key, now),
    { role: "user" as const, text: question.slice(0, MAX_TURN_CHARS) },
    { role: "assistant" as const, text: answer.slice(0, MAX_TURN_CHARS) },
  ].slice(-MAX_TURNS);
  store.delete(key); // вставка заново = свежий в порядке Map
  store.set(key, { turns, at: now });
  if (store.size > 500) store.delete(store.keys().next().value as string);
}

export function forgetTurns(key: string): void {
  store.delete(key);
}

type ReplyMsg = {
  text?: string;
  caption?: string;
  forum_topic_created?: unknown;
  from?: { first_name?: string; username?: string; is_bot?: boolean };
  reply_markup?: { inline_keyboard?: Array<Array<{ text?: string }>> };
};

/** Текст сообщения, на которое ответил админ, — или null, если ответа нет
 *  (в темах форума Telegram ставит «ответ» на корень темы у любого сообщения). */
export function replyContext(reply: ReplyMsg | undefined, quote?: { text?: string }, skipTexts: string[] = []): string | null {
  if (!reply || reply.forum_topic_created) return null;
  const body = (quote?.text ?? reply.text ?? reply.caption ?? "").trim();
  const buttons = (reply.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text?.trim()).filter(Boolean) as string[];
  if (!body && !buttons.length) return null;
  // Ответ на свой же ответ ассистента — он уже в памяти, второй раз не шлём.
  if (body && !quote?.text && skipTexts.some((t) => t.trim() === body)) return null;
  const who = reply.from?.is_bot ? "бот" : reply.from?.username ? `@${reply.from.username}` : reply.from?.first_name ?? "админ";
  const parts = [body.slice(0, MAX_REPLY_CHARS)];
  if (buttons.length) parts.push(`Кнопки: ${buttons.slice(0, 6).join(" · ")}`);
  return `[${quote?.text ? "Цитата из сообщения" : "Сообщение"} (${who}), на которое отвечаю]\n${parts.filter(Boolean).join("\n")}`;
}

/** Вопрос вместе с сообщением, на которое ответил админ. */
export function withReplyContext(question: string, context: string | null): string {
  return context ? `${context}\n\n[Вопрос]\n${question}` : question;
}
