import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

interface Bucket { label: string; count: number }

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(mon.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function fmtWeekday(d: Date): string {
  const wd = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${wd} ${dd}.${mm}`;
}

/** U11: строгая форма даты + реальная валидность (31 февраля не пройдёт). */
function isValidDateParam(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00+03:00`);
  if (!Number.isFinite(d.getTime())) return false;
  const [y, m, day] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, day));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === day;
}

function computeRange(range: string, dateStr: string): { from: Date; to: Date; type: string } {
  const d = new Date(dateStr + "T00:00:00+03:00");
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();

  if (range === "day") {
    const from = new Date(Date.UTC(y, m, day) - 3 * 3600_000);
    const to = new Date(from.getTime() + 86400_000);
    return { from, to, type: "day" };
  }
  if (range === "week") {
    const mon = startOfWeek(d);
    const from = new Date(Date.UTC(mon.getFullYear(), mon.getMonth(), mon.getDate()) - 3 * 3600_000);
    const to = new Date(from.getTime() + 7 * 86400_000);
    return { from, to, type: "week" };
  }
  if (range === "half-month") {
    const half = day <= 15 ? 1 : 16;
    const end = half === 1 ? 16 : daysInMonth(y, m) + 1;
    const from = new Date(Date.UTC(y, m, half) - 3 * 3600_000);
    const to = new Date(Date.UTC(y, m, end) - 3 * 3600_000);
    return { from, to, type: "half-month" };
  }
  // month
  const from = new Date(Date.UTC(y, m, 1) - 3 * 3600_000);
  const to = new Date(Date.UTC(y, m + 1, 1) - 3 * 3600_000);
  return { from, to, type: "month" };
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "week";
  const dateStr = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  if (!["day", "week", "half-month", "month"].includes(range))
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });

  // U11: мусорный `?date=` давал `Invalid Date`, и `from.toISOString()` ниже
  // бросал RangeError без обработчика — оператор видел 500 вместо «неверные
  // параметры». SQL-инъекции здесь не было (падало до интерполяции), но 400
  // подменялось 500.
  if (!isValidDateParam(dateStr))
    return NextResponse.json({ error: "Invalid date (ожидается YYYY-MM-DD)" }, { status: 400 });

  const { from, to, type } = computeRange(range, dateStr);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const isDay = type === "day";

  const nickQuery = isDay
    ? `SELECT EXTRACT(HOUR FROM "createdAt" AT TIME ZONE 'Europe/Moscow')::int AS bucket, COUNT(*)::int AS count
       FROM "WbOrder"
       WHERE "isTest" = false
         AND ("robloxUsername" IS NOT NULL OR "probableNick" IS NOT NULL)
         AND "createdAt" >= '${fromISO}'::timestamptz
         AND "createdAt" < '${toISO}'::timestamptz
       GROUP BY bucket ORDER BY bucket`
    : `SELECT DATE("createdAt" AT TIME ZONE 'Europe/Moscow') AS bucket, COUNT(*)::int AS count
       FROM "WbOrder"
       WHERE "isTest" = false
         AND ("robloxUsername" IS NOT NULL OR "probableNick" IS NOT NULL)
         AND "createdAt" >= '${fromISO}'::timestamptz
         AND "createdAt" < '${toISO}'::timestamptz
       GROUP BY bucket ORDER BY bucket`;

  const gpQuery = isDay
    ? `SELECT EXTRACT(HOUR FROM "pendingAt" AT TIME ZONE 'Europe/Moscow')::int AS bucket, COUNT(*)::int AS count
       FROM "WbOrder"
       WHERE "isTest" = false
         AND "gamepassUrl" IS NOT NULL
         AND "pendingAt" >= '${fromISO}'::timestamptz
         AND "pendingAt" < '${toISO}'::timestamptz
       GROUP BY bucket ORDER BY bucket`
    : `SELECT DATE("pendingAt" AT TIME ZONE 'Europe/Moscow') AS bucket, COUNT(*)::int AS count
       FROM "WbOrder"
       WHERE "isTest" = false
         AND "gamepassUrl" IS NOT NULL
         AND "pendingAt" >= '${fromISO}'::timestamptz
         AND "pendingAt" < '${toISO}'::timestamptz
       GROUP BY bucket ORDER BY bucket`;

  const [nickRows, gpRows] = await Promise.all([
    (prisma as any).$queryRawUnsafe(nickQuery) as Promise<any[]>,
    (prisma as any).$queryRawUnsafe(gpQuery) as Promise<any[]>,
  ]);

  const nickMap = new Map<string, number>();
  for (const r of nickRows) nickMap.set(String(isDay ? r.bucket : r.bucket.toISOString().split("T")[0]), Number(r.count));
  const gpMap = new Map<string, number>();
  for (const r of gpRows) gpMap.set(String(isDay ? r.bucket : r.bucket.toISOString().split("T")[0]), Number(r.count));

  const nicks: Bucket[] = [];
  const gamepasses: Bucket[] = [];

  if (isDay) {
    for (let h = 0; h < 24; h++) {
      const label = String(h).padStart(2, "0");
      nicks.push({ label, count: nickMap.get(String(h)) ?? 0 });
      gamepasses.push({ label, count: gpMap.get(String(h)) ?? 0 });
    }
  } else {
    const cur = new Date(from);
    while (cur < to) {
      const msk = new Date(cur.getTime() + 3 * 3600_000);
      const key = msk.toISOString().split("T")[0];
      const label = type === "week"
        ? fmtWeekday(msk)
        : String(msk.getDate());
      nicks.push({ label, count: nickMap.get(key) ?? 0 });
      gamepasses.push({ label, count: gpMap.get(key) ?? 0 });
      cur.setTime(cur.getTime() + 86400_000);
    }
  }

  const totalNicks = nicks.reduce((s, b) => s + b.count, 0);
  const totalGP = gamepasses.reduce((s, b) => s + b.count, 0);

  return NextResponse.json({
    nicks,
    gamepasses,
    range: { type, from: fromISO, to: toISO },
    totals: {
      nicks: totalNicks,
      gamepasses: totalGP,
      conversionPct: totalNicks > 0 ? Math.round((totalGP / totalNicks) * 100) : 0,
    },
  });
}
