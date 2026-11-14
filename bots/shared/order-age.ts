const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(value: number, forms: [string, string, string]): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Keep in sync with src/lib/order-age.ts (the web and bots have separate builds). */
export function formatOrderAge(createdAt: Date | string, now: Date | number = Date.now()): string {
  const createdMs = new Date(createdAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diff = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
  const minutes = Math.floor(diff / MINUTE_MS);

  if (minutes < 60) return `🟢 ${minutes} мин`;

  const hours = Math.floor(diff / HOUR_MS);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return `🟢 ${hours} ч${remainingMinutes ? ` ${remainingMinutes} мин` : ""}`;

  const days = Math.floor(diff / DAY_MS);
  const remainingHours = hours % 24;
  const age = `${days} ${plural(days, ["день", "дня", "дней"])}${remainingHours ? ` ${remainingHours} ч` : ""}`;
  if (days >= 14) return `🔴 ${age} · старше 2 недель`;
  if (days >= 7) return `🔴 ${age} · недельный`;
  if (days >= 3) return `🟠 ${age}`;
  return `🟡 ${age}`;
}
