/* ─────────────────────────────────────────────────────────────────────────────
   Разметка чатов поддержки @RobloxBank_PA (12.11.2026) — то же, что метки
   диалогов в ВК (`vk-dialog-labels.ts`), но для Telegram-аккаунта.

   Чат связан с покупателем точно: собеседник = `User.tgId`. По его заказам
   решаем:
   • метку — имя контакта «Анна · ZT8BW8D · 500 · ждём пасс» (видят все, кто
     сидит в аккаунте);
   • папку — 🆕 Новые / ⏳ К выкупу / ⚠️ Проблемы / ✅ Готово.

   Модуль чистый: заказы → решение. Сеть (Telegram) и база — в воркере
   `bots/tg/pa-desk-worker.ts`. Бот никому не пишет: только переименовывает
   контакты и раскладывает чаты по папкам.
   ───────────────────────────────────────────────────────────────────────── */

export type DeskFolder = "NEW" | "QUEUE" | "PROBLEM" | "DONE" | "REVIEW";

/** Папки аккаунта: id фиксированы, чтобы обновлять свои, а не плодить новые.
 *  Название папки у Telegram — не длиннее 12 символов. */
export const DESK_FOLDERS: Record<DeskFolder, { id: number; title: string; emoticon: string }> = {
  NEW: { id: 201, title: "Новые", emoticon: "🆕" },
  QUEUE: { id: 202, title: "К выкупу", emoticon: "⏳" },
  PROBLEM: { id: 203, title: "Проблемы", emoticon: "⚠️" },
  DONE: { id: 204, title: "Готово", emoticon: "✅" },
  // 13.11.2026: оставил на WB отзыв ★1–3 (последняя версия) — дополнительная папка,
  // чат при этом остаётся и в своей папке по заказу.
  REVIEW: { id: 205, title: "Отзыв ★1–3", emoticon: "😡" },
};

/** Хвост метки для покупателя с плохим отзывом на WB. */
export function badReviewMark(stars: number | null | undefined): string {
  return stars != null ? ` · ★${stars} отзыв` : "";
}

export interface DeskOrder {
  wbCode: string;
  amount: number;
  status: string;
  createdAt: Date;
  heldAt: Date | null;
  /** Есть непогашенные пометки (возврат, висяк, отзыв удалён…). */
  openFlags: boolean;
}

export interface DeskDecision {
  folder: DeskFolder;
  /** Хвост метки после имени: «ZT8BW8D · 500 · ждём пасс». Пусто — заказов нет. */
  tag: string | null;
}

// Заказы кодов Robux (17.11.2026) — те же статусы, что в закрепе (`pa-pin.ts`):
// оплаченный и ещё не выданный код ждёт нас, как заказ «к выкупу».
const ACTIVE = new Set(["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "CODE_PAID"]);

const STAGE: Record<string, string> = {
  AWAITING_GAMEPASS: "ждём пасс",
  PENDING: "к выкупу",
  IN_PROGRESS: "выкупается",
  ERROR: "ошибка выкупа",
  COMPLETED: "выкуплен",
  REJECTED: "отменён",
  CODE_PAID: "код: выдать",
  CODE_ISSUED: "код выдан",
};

const isProblem = (o: DeskOrder) => Boolean(o.heldAt) || o.status === "ERROR" || (o.openFlags && ACTIVE.has(o.status));

/**
 * Решение по одному чату. Главный заказ — проблемный, иначе активный, иначе
 * самый свежий; остальные — счётчиком «+2».
 */
export function deskDecision(orders: DeskOrder[]): DeskDecision {
  if (orders.length === 0) return { folder: "NEW", tag: null };
  const byNew = [...orders].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const main = byNew.find(isProblem) ?? byNew.find((o) => ACTIVE.has(o.status)) ?? byNew[0];
  const folder: DeskFolder = byNew.some(isProblem) ? "PROBLEM"
    : byNew.some((o) => ACTIVE.has(o.status)) ? "QUEUE"
      : "DONE";
  const stage = main.heldAt ? "заморожен" : STAGE[main.status] ?? main.status.toLowerCase();
  const more = orders.length > 1 ? ` · +${orders.length - 1}` : "";
  return { folder, tag: `${main.wbCode} · ${main.amount} · ${stage}${more}` };
}

/** Разделитель метки — по нему узнаём свои имена контактов. */
const SEP = " · ";
/** Telegram режет имя контакта на 64 символах. */
const NAME_MAX = 64;

/** Метка — наша (её можно переписывать), а не имя, которое дал оператор. */
export function isDeskLabel(name: string | null | undefined): boolean {
  return Boolean(name && /^[^·]* · [A-Z0-9-]{6,14} · /.test(name));
}

/** Имя собеседника без нашего хвоста: «Анна · ZT8… · …» → «Анна». */
export function baseNameOf(current: string | null | undefined, fallback: string): string {
  const name = (current ?? "").trim();
  if (isDeskLabel(name)) return name.split(SEP)[0].trim() || fallback;
  return name || fallback;
}

/**
 * Новое имя контакта или `null`, если трогать не надо:
 * • оператор сам переименовал контакт (имя не наше) — не трогаем;
 * • заказов нет — метку не ставим (у незнакомца просто его имя);
 * • метка уже такая же — ничего не делаем.
 */
export function nextContactName(input: {
  isContact: boolean;
  currentName: string | null;
  fallbackName: string;
  tag: string | null;
}): string | null {
  if (input.isContact && !isDeskLabel(input.currentName)) return null;
  const base = baseNameOf(input.currentName, input.fallbackName).slice(0, 24);
  if (!input.tag) return null;
  const next = `${base}${SEP}${input.tag}`.slice(0, NAME_MAX);
  return next === (input.currentName ?? "").trim() ? null : next;
}

/**
 * Наша реакция на сообщение клиента = ответ (17.11.2026, владелец: «реакция —
 * это зачастую ответ»). ❤️ на «спасибо, всё вошла» закрывает разговор, и чат не
 * должен висеть в «⏰ Без ответа».
 *
 * «Наша» — поставленная из аккаунта поддержки (человеком или его бизнес-ботом):
 * Telegram метит такую `chosenOrder` у реакции и `my` у недавних. Реакция самого
 * клиента на своё сообщение ответом не считается. Форма — подмножество
 * `Api.MessageReactions` из gramjs, чтобы правило проверялось без сети.
 */
export function answeredByReaction(reactions: {
  results?: Array<{ chosenOrder?: number | null }>;
  recentReactions?: Array<{ my?: boolean | null }>;
} | null | undefined): boolean {
  if (!reactions) return false;
  return (reactions.results ?? []).some((r) => r.chosenOrder != null)
    || (reactions.recentReactions ?? []).some((r) => Boolean(r.my));
}

/* ── ❤️ Авто-реакция на «спасибо» (17.11.2026, владелец: «да, делай авто-❤️») ──
   Короткое финальное «спасибо, всё пришло» — не вопрос, а конец разговора.
   Аккаунт ставит ❤️ сам, и по правилу `answeredByReaction` чат уходит из
   «⏰ Без ответа». Ловушка — «спасибо, а когда придут?»: там вопрос, и ❤️
   выглядела бы как «прочитали и забили». Поэтому правило узкое:
   • последним в разговоре отвечали МЫ (иначе «спасибо» может быть вежливым
     началом нового обращения);
   • после нашего ответа клиент написал не больше трёх сообщений, и КАЖДОЕ —
     короткая благодарность/согласие без вопроса и без «но/а когда»;
   • на них ещё нет нашей реакции. */

const MAX_THANKS_LEN = 200;
/** Слово-благодарность (по началу слова): спасибо, спс, пасиб, благодарю, thanks… */
const THANKS_PREFIX = ["спасиб", "спс", "пасиб", "сяб", "благодар", "thank", "thx", "мерси"];
/** Чистое согласие: ❤️ само по себе не заслуживает, но рядом со «спасибо» — конец. */
const ACK_WORDS = new Set(["ок", "окей", "ok", "хорошо", "понял", "поняла", "поняли", "ясно", "супер", "отлично", "класс",
  "круто", "всё", "все", "пришли", "пришло", "пришёл", "пришел", "получил", "получила", "вошла", "вошел", "вошёл", "зашла",
  "зашел", "зашёл", "работает", "ура", "да", "получилось", "разобрался", "разобралась"]);
/**
 * Признаки, что разговор НЕ окончен: вопрос, жалоба, ожидание. Список чёрный, а
 * не белый: благодарят развёрнуто («А поняла, спасибо, всё вошла, извините…
 * не догоняю, как и что здесь надо делать, спасибо за помощь» — живой пример
 * владельца), и белый список такое не пропустил бы.
 */
const NOT_FINAL = new Set(["но", "когда", "почему", "зачем", "сколько", "где", "долго", "ждать", "жду", "ждём", "ждем",
  "возврат", "верните", "вернуть", "вернете", "вернёте", "ошибка", "ошибку", "проблема", "можно", "подскажите", "скажите",
  "помогите", "нет", "пока", "ещё", "еще", "скоро", "уже", "обман", "обманули", "развод", "мошенники", "отзыв"]);
/** «не» + это начало слова = жалоба: «не пришло», «не вижу», «не работает». */
const NOT_PROBLEM = ["пришл", "приш", "вид", "работ", "могу", "получ", "зачисл", "вош", "заход", "отоб", "показ", "начисл"];

/** Одно сообщение клиента — благодарность («thanks»), согласие («ack») или ни то ни другое. */
export function isThanksLike(text: string | null | undefined): "thanks" | "ack" | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_THANKS_LEN || /[?¿]/.test(t)) return null;
  const words = t.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return null;
  const stop = new Set([...NOT_FINAL].map((w) => w.replace(/ё/g, "е")));
  if (words.some((w) => stop.has(w))) return null;
  if (words.some((w, i) => w === "не" && NOT_PROBLEM.some((p) => (words[i + 1] ?? "").startsWith(p)))) return null;
  if (words.some((w) => THANKS_PREFIX.some((p) => w.startsWith(p)))) return "thanks";
  const ack = new Set([...ACK_WORDS].map((w) => w.replace(/ё/g, "е")));
  return words.every((w) => ack.has(w)) ? "ack" : null;
}

export interface HeartMsg {
  out: boolean;
  text: string | null;
  /** На сообщении уже стоит наша реакция. */
  ourReaction: boolean;
  /** Нетекстовое (фото, стикер, голос) — по нему не судим. */
  media?: boolean;
}

/**
 * Какому сообщению поставить ❤️ — индекс в `newestFirst` или `null`.
 * Сообщения от свежего к старому, как отдаёт `getMessages`.
 */
export function heartTarget(newestFirst: HeartMsg[]): number | null {
  const tail: HeartMsg[] = [];
  let i = 0;
  for (; i < newestFirst.length && !newestFirst[i].out; i++) tail.push(newestFirst[i]);
  if (!tail.length || tail.length > 3 || i >= newestFirst.length) return null; // нет нашего ответа до хвоста
  // Тихий закреп «📌 Ваш заказ» шлёт автоматика, это не ответ человека: «спасибо»
  // после него ещё не значит, что вопрос клиента закрыт.
  if (/^📌/.test(newestFirst[i].text ?? "")) return null;
  if (tail.some((m) => m.ourReaction)) return null;
  // Стикер/эмодзи-картинка в хвосте — пусть решает человек; голос/фото — тем более.
  if (tail.some((m) => m.media)) return null;
  const kinds = tail.map((m) => isThanksLike(m.text));
  if (kinds.some((k) => k === null)) return null;
  if (!kinds.includes("thanks")) return null; // одно «ок» — не повод для ❤️
  return 0;
}
