/* ─────────────────────────────────────────────────────────────────────────────
   ⭐ Тихая оценка поддержки @RobloxBank_PA (17.11.2026).

   Владелец: «кнопки оценки поддержки норм, только тихая, чтобы нам голову
   лишний раз не ебала».

   Когда разговор, похоже, закончен — последним написали мы, покупатель молчит
   больше часа, а до этого он сам писал в течение суток, — бот присылает в чат
   поддержки одно сообщение без звука: «Как вам ответ поддержки?» с 👍 / 👎.
   Одному человеку — не чаще раза в 14 дней. Голос ничего не запускает: ни
   уведомлений админам, ни ИИ. Итог за вчера — одной строкой в утренней сводке
   «Системы» (`notice-stats-report.ts`).

   Всё состояние — в `WbSyncCursor` `pa-rating`: кого спрашивали и счётчики по
   дням (МСК). Миграции не нужно.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const RATING_STREAM = "pa-rating";
/** Пауза после нашего последнего ответа: раньше — разговор, может, ещё идёт. */
export const RATING_AFTER_S = 3600;
/** Позже суток — уже не про этот разговор. */
export const RATING_BEFORE_S = 24 * 3600;
/** Одного человека спрашиваем не чаще. */
export const RATING_REPEAT_MS = 14 * 24 * 3600_000;
/** Вопросов за один проход воркера. */
export const RATING_CAP = 5;

export const RATING_TEXT = "Как вам ответ поддержки? Оцените одним нажатием — так мы поймём, что улучшить.";
export const RATING_CB = { up: "pr:up", down: "pr:dn" } as const;
export const RATING_KEYBOARD = [[
  { text: "👍 Помогли", callback_data: RATING_CB.up },
  { text: "👎 Не помогли", callback_data: RATING_CB.down },
]];
export function ratingThanks(vote: "up" | "down"): string {
  return vote === "up"
    ? "Спасибо за оценку! 💙"
    : "Спасибо, что сказали. Если вопрос ещё не решён — напишите здесь, ответим.";
}

export interface RatingMeta {
  asked?: Record<string, string>;
  days?: Record<string, { asked: number; up: number; down: number }>;
}

export const mskDay = (at: number = Date.now()) => new Date(at + 3 * 3600_000).toISOString().slice(0, 10);

export interface ChatTail {
  /** Последнее сообщение в чате. */
  last: { out: boolean; date: number; text: string; viaBot: boolean } | null;
  /** Когда покупатель писал последний раз (unix-секунды) или `null`. */
  lastIncoming: number | null;
}

/** Пора ли спрашивать. Чистая функция — покрыта тестом. */
export function ratingDue(tail: ChatTail, askedAt: string | undefined, nowS: number): boolean {
  const last = tail.last;
  if (!last || !last.out) return false;
  // Наш же вопрос об оценке или закреп заказа — не ответ поддержки.
  if (last.text.startsWith("📌") || last.text.startsWith(RATING_TEXT.slice(0, 20))) return false;
  const age = nowS - last.date;
  if (age < RATING_AFTER_S || age > RATING_BEFORE_S) return false;
  // Разговор был: покупатель сам писал в течение суток до нашего ответа.
  if (!tail.lastIncoming || last.date - tail.lastIncoming > RATING_BEFORE_S || tail.lastIncoming > last.date) return false;
  if (askedAt && nowS * 1000 - Date.parse(askedAt) < RATING_REPEAT_MS) return false;
  return true;
}

async function load(db: Db): Promise<RatingMeta> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: RATING_STREAM } }).catch(() => null);
  return (row?.metadata ?? {}) as RatingMeta;
}

async function save(db: Db, meta: RatingMeta): Promise<void> {
  // Старше 60 дней — не храним.
  const cutoff = Date.now() - 60 * 24 * 3600_000;
  for (const [k, v] of Object.entries(meta.asked ?? {})) if (Date.parse(v) < cutoff) delete meta.asked![k];
  for (const k of Object.keys(meta.days ?? {})) if (Date.parse(`${k}T00:00:00Z`) < cutoff) delete meta.days![k];
  await db.wbSyncCursor.upsert({
    where: { stream: RATING_STREAM },
    create: { stream: RATING_STREAM, metadata: meta as never },
    update: { metadata: meta as never },
  });
}

export async function loadAskedMap(db: Db): Promise<Record<string, string>> {
  return (await load(db)).asked ?? {};
}

export async function recordRatingAsked(db: Db, tgIds: string[]): Promise<void> {
  if (!tgIds.length) return;
  const meta = await load(db);
  meta.asked ??= {};
  meta.days ??= {};
  const day = mskDay();
  const d = (meta.days[day] ??= { asked: 0, up: 0, down: 0 });
  for (const id of tgIds) { meta.asked[id] = new Date().toISOString(); d.asked++; }
  await save(db, meta);
}

export async function recordRatingVote(db: Db, vote: "up" | "down"): Promise<void> {
  const meta = await load(db);
  meta.days ??= {};
  const d = (meta.days[mskDay()] ??= { asked: 0, up: 0, down: 0 });
  d[vote]++;
  await save(db, meta);
}

/** Строка для утренней сводки или `null`, если вчера никого не спрашивали. */
export async function ratingDayLine(db: Db, day: string): Promise<string | null> {
  const d = (await load(db)).days?.[day];
  if (!d || (!d.asked && !d.up && !d.down)) return null;
  const voted = d.up + d.down;
  return `⭐ Оценки поддержки: 👍 ${d.up} · 👎 ${d.down}${d.asked ? ` (спросили ${d.asked}, ответили ${voted})` : ""}`;
}
