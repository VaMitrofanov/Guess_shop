/* ─────────────────────────────────────────────────────────────────────────────
   💬 Сообщения покупателя из чата WB — ОДИН увед на заказ (15–16.11.2026).

   Замер владельца: 272 сообщения покупателей за неделю, каждое — отдельный
   громкий увед. Первая версия (15.11) склеивала их, но в беседе всё равно
   копились «покупатель пишет · 2», «· 4» по одному заказу. Две причины (логи
   16.11, WB #6283455252):

   1. ГОНКА. Два сообщения пришли за один проход синка, оба уведа ушли
      параллельно: разговор запоминался только ПОСЛЕ ответа Telegram, и второй
      не видел первого. Теперь всё по одному заказу идёт строго по очереди.
   2. ОКНО. Через 10 минут тишины открывался НОВЫЙ увед, старый оставался.
      Теперь после паузы старый увед удаляется, а новый (со звуком — правка
      звука не даёт) несёт всю историю: на заказ в беседе всегда одно сообщение.

   Правила:
   - до `WINDOW_MS` с прошлого сообщения — дописываем правкой, без звука;
   - позже (до `KEEP_MS`) или после ответа админа — «поднимаем»: новый увед
     с историей, старый удаляем;
   - пустяковые («спасибо», «ок», «?») не открывают и не поднимают — только
     дописываются;
   - ответ админа кнопкой или текстом дописывается строкой «↩️ …» в тот же
     увед (`noteAdminReply`) — вместо отдельного сообщения «✅ В чат WB».

   Состояние в памяти процесса: после рестарта разговор начнётся новым уведом.
   ───────────────────────────────────────────────────────────────────────── */

import { formatAdminNotice, mskTime } from "./notify-format";
import { escapeHtml } from "./notify";
import { countConversation } from "./notice-stats";

/** Сколько тишины считается «тем же заходом» — дописываем без звука. */
export const CONVERSATION_WINDOW_MS = 10 * 60_000;
/** Сколько помним разговор: позже — новый увед с чистого листа. */
export const CONVERSATION_KEEP_MS = 6 * 60 * 60_000;
const MAX_LINES = 10;
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
  /** Убрать прежний увед, когда разговор поднят новым. Без него старый остаётся. */
  remove?(target: ConversationTarget, messageId: number): Promise<void>;
}

/** Что видит рендер: строки разговора и счётчики. */
export interface ConversationView {
  head: string;
  who: string | null;
  lines: string[];
  total: number;
  answered: boolean;
  /** 📤 Статус переписки: что уже ушло покупателю (16.11.2026). Готовый HTML. */
  status?: string[] | null;
}
export type ConversationRender = (view: ConversationView) => string;

interface Conversation {
  render: ConversationRender;
  status: string[] | null;
  head: string;
  who: string | null;
  lines: string[];
  total: number;
  /** Последнее сообщение ПОКУПАТЕЛЯ (ответ админа окно не продлевает). */
  lastAt: number;
  /** Последняя строка — ответ админа: следующее сообщение покупателя поднимает увед. */
  answered: boolean;
  targets: ConversationTarget[];
  io: ConversationIo;
  messages: Map<string, { target: ConversationTarget; messageId: number }>;
}

const open = new Map<string, Conversation>();
/** Очередь по заказу: параллельные сообщения не должны открыть два уведа. */
const queues = new Map<string, Promise<unknown>>();

function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  const tail = next.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

/** Сколько сообщений не влезло в увед — для строки «…ещё N раньше». */
export function hiddenCount(c: Pick<ConversationView, "lines" | "total">): number {
  const shown = c.lines.filter((l) => !l.startsWith("↩️")).length;
  return Math.max(0, c.total - shown);
}

export function renderConversation(c: Pick<ConversationView, "head" | "who" | "lines" | "total"> & { answered?: boolean; status?: string[] | null }): string {
  const hidden = hiddenCount(c);
  const count = c.total > 1 ? ` · ${c.total}` : "";
  return formatAdminNotice({
    marker: c.answered ? "done" : "action",
    zone: "DBS",
    title: `покупатель пишет${count}${c.answered ? " · ответили" : ""}`,
    lines: [
      c.who ? `${c.head} · ${c.who}` : c.head,
      ...(c.status ?? []),
      hidden > 0 ? `<i>…ещё ${hidden} раньше</i>` : null,
      ...c.lines,
    ],
  });
}

function prune(now: number): void {
  for (const [key, c] of open) if (now - c.lastAt > CONVERSATION_KEEP_MS) open.delete(key);
}

async function editAll(c: Conversation): Promise<number> {
  const text = c.render(c);
  let edited = 0;
  await Promise.allSettled([...c.messages.values()].map(async ({ target, messageId }) => {
    if (await c.io.edit(target, messageId, text)) edited += 1;
  }));
  return edited;
}

/** Новый увед по всем целям; прежние копии (если были) удаляются ПОСЛЕ отправки. */
async function sendFresh(c: Conversation): Promise<boolean> {
  const previous = [...c.messages.values()];
  const text = c.render(c);
  const fresh = new Map<string, { target: ConversationTarget; messageId: number }>();
  await Promise.allSettled(c.targets.map(async (target) => {
    const messageId = await c.io.send(target, text);
    if (messageId !== null) fresh.set(target.key, { target, messageId });
  }));
  if (fresh.size === 0) return false;
  c.messages = fresh;
  if (c.io.remove) {
    await Promise.allSettled(previous.map(({ target, messageId }) => c.io.remove!(target, messageId)));
  }
  return true;
}

/**
 * Принять сообщение покупателя. `head` — строка заказа (уже HTML), `who` —
 * одна строка «кто это» (обычный текст). Возвращает, что сделано.
 */
export function noteBuyerMessage(input: {
  conversationKey: string;
  head: string;
  who?: string | null;
  text: string;
  targets: ConversationTarget[];
  io: ConversationIo;
  now?: number;
  /** Свой вид уведа (поддержка); по умолчанию — «DBS · покупатель пишет». */
  render?: ConversationRender;
  /** Открывать увед и на пустяковом тексте (обращение в поддержку — всегда дело). */
  openOnTrivial?: boolean;
  /** 📤 Что уже ушло покупателю — строки между шапкой и сообщениями. */
  status?: string[] | null;
}): Promise<"opened" | "appended" | "resurfaced" | "skipped"> {
  return serial(input.conversationKey, () => noteBuyerMessageNow(input)).then((result) => {
    countConversation(result);
    return result;
  });
}

async function noteBuyerMessageNow(input: Parameters<typeof noteBuyerMessage>[0]): Promise<"opened" | "appended" | "resurfaced" | "skipped"> {
  const now = input.now ?? Date.now();
  prune(now);

  const clipped = input.text.length > PREVIEW ? `${input.text.slice(0, PREVIEW - 1)}…` : input.text;
  const line = `<i>${mskTime(new Date(now))}</i> ${escapeHtml(clipped)}`;
  const trivial = isTrivialBuyerText(input.text);
  const current = open.get(input.conversationKey);

  if (current) {
    const quiet = now - current.lastAt <= CONVERSATION_WINDOW_MS && !current.answered;
    current.lines = [...current.lines, line].slice(-MAX_LINES);
    current.total += 1;
    current.lastAt = now;
    current.head = input.head;
    if (input.status !== undefined) current.status = input.status;
    current.targets = input.targets;
    current.io = input.io;
    if (input.render) current.render = input.render;
    if (quiet || trivial) {
      if (await editAll(current) > 0) return "appended";
      // Правку не приняли (увед удалили) — пусть уйдёт новым.
    }
    current.answered = false;
    if (await sendFresh(current)) return "resurfaced";
    open.delete(input.conversationKey);
    return "skipped";
  }

  if (trivial && !input.openOnTrivial) return "skipped";

  const conversation: Conversation = {
    render: input.render ?? renderConversation,
    status: input.status ?? null,
    head: input.head,
    who: input.who ? escapeHtml(input.who) : null,
    lines: [line],
    total: 1,
    lastAt: now,
    answered: false,
    targets: input.targets,
    io: input.io,
    messages: new Map(),
  };
  if (await sendFresh(conversation)) open.set(input.conversationKey, conversation);
  return "opened";
}

/**
 * Админ ответил покупателю из Telegram — дописать «↩️ кто: что» в тот же увед.
 * `false` — разговора в памяти нет (рестарт, старый увед): пусть вызывающий
 * подтвердит отправку по-старому, отдельным сообщением.
 */
export function noteAdminReply(conversationKey: string, actor: string, what: string, now = Date.now()): Promise<boolean> {
  return serial(conversationKey, async () => {
    const c = open.get(conversationKey);
    if (!c) return false;
    const clipped = what.length > PREVIEW ? `${what.slice(0, PREVIEW - 1)}…` : what;
    c.lines = [...c.lines, `↩️ <i>${mskTime(new Date(now))}</i> ${escapeHtml(actor)}: ${escapeHtml(clipped)}`].slice(-MAX_LINES);
    c.answered = true;
    return (await editAll(c)) > 0;
  });
}

/** Для тестов. */
export function resetConversations(): void {
  open.clear();
  queues.clear();
}
