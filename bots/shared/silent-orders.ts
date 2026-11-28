/* ─────────────────────────────────────────────────────────────────────────────
   «Молчат» под контролем (13.11.2026). Заказы, по которым бот отправил все три
   напоминания о геймпассе и не дождался ответа. Владелец: такие клиенты нас
   устраивают («бесплатные деньги»), но держать их на виду нужно — поэтому
   ни отмен, ни заморозок, только еженедельная сводка и `/silent` по запросу.

   Определение то же, что у вкладки «🫥 Молчат» (`src/lib/order-queue.ts`,
   STALE_LINK): ждёт пасс, remindersSent ≥ 3, не заморожен, не в избранном.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const SILENT_REMINDERS = 3;
const DAY = 86_400_000;

export interface SilentOrder { wbCode: string; amount: number; createdAt: Date }
export interface SilentSummary {
  count: number;
  robux: number;
  buckets: { under14: number; d14to30: number; over30: number };
  robuxOver30: number;
  oldest: Array<{ wbCode: string; amount: number; days: number }>;
}

export function summarizeSilent(orders: SilentOrder[], now = Date.now()): SilentSummary {
  const days = (o: SilentOrder) => Math.floor((now - new Date(o.createdAt).getTime()) / DAY);
  const over30 = orders.filter((o) => days(o) > 30);
  return {
    count: orders.length,
    robux: orders.reduce((s, o) => s + o.amount, 0),
    buckets: {
      under14: orders.filter((o) => days(o) < 14).length,
      d14to30: orders.filter((o) => days(o) >= 14 && days(o) <= 30).length,
      over30: over30.length,
    },
    robuxOver30: over30.reduce((s, o) => s + o.amount, 0),
    oldest: [...orders]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 5)
      .map((o) => ({ wbCode: o.wbCode, amount: o.amount, days: days(o) })),
  };
}

export async function loadSilentSummary(db: Db, now = Date.now()): Promise<SilentSummary> {
  const orders: SilentOrder[] = await db.wbOrder.findMany({
    where: {
      status: "AWAITING_GAMEPASS",
      remindersSent: { gte: SILENT_REMINDERS },
      heldAt: null,
      isFavorite: false,
      isTest: false,
    },
    select: { wbCode: true, amount: true, createdAt: true },
  });
  return summarizeSilent(orders, now);
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function formatSilentSummary(s: SilentSummary): string {
  if (s.count === 0) return "🫥 <b>Молчат</b>: никого — все, кому бот напоминал, ответили.";
  const lines = [
    `🫥 <b>Молчат: ${s.count} заказов · ${fmt(s.robux)} R$</b>`,
    "Бот отправил все 3 напоминания о геймпассе — ответа нет. Деньги у нас, робуксы не выданы.",
    "",
    `• до 2 недель — ${s.buckets.under14}`,
    `• 2–4 недели — ${s.buckets.d14to30}`,
    `• больше месяца — ${s.buckets.over30}${s.buckets.over30 ? ` (${fmt(s.robuxOver30)} R$)` : ""}`,
  ];
  if (s.oldest.length) {
    lines.push("", "Самые старые:");
    for (const o of s.oldest) lines.push(`• <code>${o.wbCode}</code> · ${o.amount} R$ · ${o.days} дн.`);
  }
  lines.push("", "Дальше: ничего не делать обязательно — вкладка «🫥 Молчат» в «Заказах», если захотите дожать.");
  return lines.join("\n");
}

/** Неделя по МСК, «2026-11-09» — понедельник. Ключ, чтобы слать раз в неделю. */
export function mskWeekKey(now = Date.now()): string {
  const msk = new Date(now + 3 * 3600_000);
  const dow = (msk.getUTCDay() + 6) % 7;
  return new Date(msk.getTime() - dow * DAY).toISOString().slice(0, 10);
}

/** Пора ли слать: понедельник после 10:00 МСК и на этой неделе ещё не слали. */
export function silentWeeklyDue(lastWeek: string | null | undefined, now = Date.now()): boolean {
  const msk = new Date(now + 3 * 3600_000);
  if (msk.getUTCDay() !== 1 || msk.getUTCHours() < 10) return false;
  return lastWeek !== mskWeekKey(now);
}
