/* ─────────────────────────────────────────────────────────────────────────────
   💬 Сообщения покупателя из чата WB — один увед на разговор (15.11.2026).

   Замер владельца: 272 сообщения покупателей за неделю, каждое — отдельный
   громкий увед в 4–5 строк, «спасибо» и «здравствуйте» тоже. Теперь:

   - сообщения одного заказа в пределах `WINDOW_MS` дописываются в ТОТ ЖЕ
     увед (правка без звука, Telegram пишет «изменено»);
   - пустяковые («спасибо», «ок», «здравствуйте», «?») нового уведа не
     открывают — только дописываются в уже открытый;
   - формат — шапка, строка заказа, сообщения с временем; без «Дальше:»
     (что делать с сообщением покупателя — понятно и так).

   Состояние в памяти процесса: после рестарта разговор просто начнётся новым
   уведом — ничего не теряется.
   ───────────────────────────────────────────────────────────────────────── */

import { formatAdminNotice, mskTime } from "./notify-format";
import { escapeHtml } from "./notify";

export const CONVERSATION_WINDOW_MS = 10 * 60_000;
const MAX_LINES = 8;
const PREVIEW = 160;

const TRIVIAL_RE = /^(здравствуйте|здраствуйте|здрасте|привет|добрый (день|вечер)|доброе утро|спасибо( большое| огромное)?|спс|благодарю|ок|окей|ok|хорошо|понял[а]?|ясно|ладно|да|нет|ага|угу|жду|\?+|!+|\(+|\)+|👍+|🙏+|❤️+|ясно,? спасибо|хорошо,? спасибо)[\s!.,)(?❤👍🙏😊]*$/i;

export function isTrivialBuyerText(text: string): boolean {
  return TRIVIAL_RE.test(text.trim());
}

export interface ConversationTarget {
  key: string;
  chatId: string;
  extra: Record<string, unknown>;
}

export interface ConversationIo {
  send(target: ConversationTarget, text: string): Promise<number | null>;
  edit(target: ConversationTarget, messageId: number, text: string): Promise<boolean>;
}

interface Conversation {
  head: string;
  who: string | null;
  lines: string[];
  total: number;
  lastAt: number;
  messages: Map<string, { target: ConversationTarget; messageId: number }>;
}

const open = new Map<string, Conversation>();

export function renderConversation(c: Pick<Conversation, "head" | "who" | "lines" | "total">): string {
  const hidden = c.total - c.lines.length;
  return formatAdminNotice({
    marker: "action",
    zone: "DBS",
    title: c.total > 1 ? `покупатель пишет · ${c.total}` : "покупатель пишет",
    lines: [
      c.who ? `${c.head} · ${c.who}` : c.head,
      hidden > 0 ? `<i>…ещё ${hidden} раньше</i>` : null,
      ...c.lines,
    ],
  });
}

/**
 * Принять сообщение покупателя. `head` — строка заказа (уже HTML), `who` —
 * одна строка «кто это» (обычный текст). Возвращает, что сделано.
 */
export async function noteBuyerMessage(input: {
  conversationKey: string;
  head: string;
  who?: string | null;
  text: string;
  targets: ConversationTarget[];
  io: ConversationIo;
  now?: number;
}): Promise<"opened" | "appended" | "skipped"> {
  const now = input.now ?? Date.now();
  for (const [key, c] of open) if (now - c.lastAt > CONVERSATION_WINDOW_MS) open.delete(key);

  const clipped = input.text.length > PREVIEW ? `${input.text.slice(0, PREVIEW - 1)}…` : input.text;
  const line = `<i>${mskTime(new Date(now))}</i> ${escapeHtml(clipped)}`;
  const current = open.get(input.conversationKey);

  if (current) {
    current.lines = [...current.lines, line].slice(-MAX_LINES);
    current.total += 1;
    current.lastAt = now;
    const text = renderConversation(current);
    let edited = 0;
    await Promise.allSettled([...current.messages.values()].map(async ({ target, messageId }) => {
      if (await input.io.edit(target, messageId, text)) edited += 1;
    }));
    if (edited > 0) return "appended";
    // Правка не прошла (сообщение удалили/устарело) — открываем разговор заново.
    open.delete(input.conversationKey);
  }

  if (isTrivialBuyerText(input.text)) return "skipped";

  const conversation: Conversation = {
    head: input.head,
    who: input.who ? escapeHtml(input.who) : null,
    lines: [line],
    total: 1,
    lastAt: now,
    messages: new Map(),
  };
  const text = renderConversation(conversation);
  await Promise.allSettled(input.targets.map(async (target) => {
    const messageId = await input.io.send(target, text);
    if (messageId !== null) conversation.messages.set(target.key, { target, messageId });
  }));
  if (conversation.messages.size > 0) open.set(input.conversationKey, conversation);
  return "opened";
}

/** Для тестов. */
export function resetConversations(): void {
  open.clear();
}
