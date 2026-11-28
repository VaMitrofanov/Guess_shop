/* ─────────────────────────────────────────────────────────────────────────────
   📊 Сколько уведов ушло админам — по темам, за сутки (16.11.2026).

   До этого посчитать шум было не по чему: логи контейнера живут только с
   последнего рестарта. Теперь:
   - `tgSend` отмечает каждое НОВОЕ сообщение (правки не считаются) по ключу
     `<chat>#<тема>` или `<chat>` для лички;
   - склейка разговоров (`buyer-conversation-notice.ts`) отмечает, сколько
     сообщений покупателей легло правкой в уже открытый увед вместо нового;
   - раз в 10 минут счётчики дописываются в `WbSyncCursor` `admin-notice-stats`
     (по дню МСК, хранится 8 дней) — оба бота пишут в одну строку;
   - утром TG-бот шлёт сводку за вчера в тему «Система» (`notice-stats-report`).
   ───────────────────────────────────────────────────────────────────────── */

export const NOTICE_STATS_STREAM = "admin-notice-stats";
const FLUSH_MS = 10 * 60_000;
const KEEP_DAYS = 8;

export interface NoticeDay {
  /** `<chat>#<тема>` или `<chat>` → новых сообщений. */
  sent: Record<string, number>;
  /** Сообщений покупателя, дописанных правкой в открытый увед. */
  merged: number;
  /** Уведов, поднятых заново (старый удалён). */
  resurfaced: number;
}

type CursorDb = {
  wbSyncCursor: {
    findUnique(args: { where: { stream: string } }): Promise<{ metadata: unknown } | null>;
    upsert(args: { where: { stream: string }; create: { stream: string; metadata: never }; update: { metadata: never } }): Promise<unknown>;
  };
};

const pending = new Map<string, NoticeDay>();
let timer: ReturnType<typeof setInterval> | null = null;

export function mskDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

function today(now?: Date): NoticeDay {
  const day = mskDay(now);
  let d = pending.get(day);
  if (!d) { d = { sent: {}, merged: 0, resurfaced: 0 }; pending.set(day, d); }
  return d;
}

function ensureTimer(): void {
  if (timer || process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID) return;
  timer = setInterval(() => {
    void import("./db")
      .then(({ db }) => flushNoticeStats(db as unknown as CursorDb))
      .catch((err) => console.warn("[notice-stats] flush:", err instanceof Error ? err.message : err));
  }, FLUSH_MS);
  timer.unref?.();
}

/** Новое сообщение ушло в Telegram. */
export function countNoticeSent(chatId: string | number, threadId?: unknown, now?: Date): void {
  const key = typeof threadId === "number" ? `${chatId}#${threadId}` : String(chatId);
  const d = today(now);
  d.sent[key] = (d.sent[key] ?? 0) + 1;
  ensureTimer();
}

export function countConversation(result: "opened" | "appended" | "resurfaced" | "skipped", now?: Date): void {
  if (result === "appended") today(now).merged += 1;
  else if (result === "resurfaced") today(now).resurfaced += 1;
  else return;
  ensureTimer();
}

function addDay(into: NoticeDay, from: NoticeDay): NoticeDay {
  const sent = { ...into.sent };
  for (const [k, v] of Object.entries(from.sent)) sent[k] = (sent[k] ?? 0) + v;
  return { sent, merged: into.merged + from.merged, resurfaced: into.resurfaced + from.resurfaced };
}

/** Дописать накопленное в базу и обнулить. Ошибка — счётчики вернутся в память. */
export async function flushNoticeStats(db: CursorDb): Promise<void> {
  if (pending.size === 0) return;
  const batch = new Map(pending);
  pending.clear();
  try {
    const row = await db.wbSyncCursor.findUnique({ where: { stream: NOTICE_STATS_STREAM } });
    const days = { ...((row?.metadata as { days?: Record<string, NoticeDay> } | null)?.days ?? {}) };
    for (const [day, d] of batch) days[day] = addDay(days[day] ?? { sent: {}, merged: 0, resurfaced: 0 }, d);
    const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
    const metadata = { ...((row?.metadata as object | null) ?? {}), days: Object.fromEntries(keep.map((k) => [k, days[k]])) };
    await db.wbSyncCursor.upsert({
      where: { stream: NOTICE_STATS_STREAM },
      create: { stream: NOTICE_STATS_STREAM, metadata: metadata as never },
      update: { metadata: metadata as never },
    });
  } catch (err) {
    for (const [day, d] of batch) pending.set(day, addDay(pending.get(day) ?? { sent: {}, merged: 0, resurfaced: 0 }, d));
    throw err;
  }
}

/** Для тестов. */
export function resetNoticeStats(): void {
  pending.clear();
}

export function pendingNoticeStats(): Map<string, NoticeDay> {
  return pending;
}
