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

export type DeskFolder = "NEW" | "QUEUE" | "PROBLEM" | "DONE";

/** Папки аккаунта: id фиксированы, чтобы обновлять свои, а не плодить новые.
 *  Название папки у Telegram — не длиннее 12 символов. */
export const DESK_FOLDERS: Record<DeskFolder, { id: number; title: string; emoticon: string }> = {
  NEW: { id: 201, title: "Новые", emoticon: "🆕" },
  QUEUE: { id: 202, title: "К выкупу", emoticon: "⏳" },
  PROBLEM: { id: 203, title: "Проблемы", emoticon: "⚠️" },
  DONE: { id: 204, title: "Готово", emoticon: "✅" },
};

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

const ACTIVE = new Set(["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"]);

const STAGE: Record<string, string> = {
  AWAITING_GAMEPASS: "ждём пасс",
  PENDING: "к выкупу",
  IN_PROGRESS: "выкупается",
  ERROR: "ошибка выкупа",
  COMPLETED: "выкуплен",
  REJECTED: "отменён",
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
