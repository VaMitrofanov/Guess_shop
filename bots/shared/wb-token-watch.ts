/**
 * Сторож срока токена API Wildberries.
 *
 * 01.11.2026 в 03:39 МСК истёк `WB_API_TOKEN` (WB выдаёт его на 180 дней), и
 * бот молча перестал забирать заказы DBS, двигать статусы и читать чаты: в
 * базе это выглядело только как `MARKETPLACE_401_UNKNOWN` у курсоров синка.
 * Срок зашит в сам токен (JWT, поле `exp`), поэтому о нём можно знать заранее.
 *
 * Раз в час проверяем `exp` и пишем админам на порогах 14 / 7 / 3 / 1 день, а
 * после истечения — каждые 12 часов, пока токен не заменят. Какой порог уже
 * объявлен, хранится в `WbSyncCursor` (stream `wb-token-expiry`): иначе каждый
 * перезапуск бота повторял бы предупреждение.
 *
 * Сам токен никуда не пишется и не логируется — только его срок.
 */

import { db } from "./db";
import { formatAdminNotice } from "./notify-format";

const STREAM = "wb-token-expiry";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Пороги предупреждения, в днях до истечения. */
const WB_TOKEN_WARN_DAYS = [14, 7, 3, 1] as const;
/** Как часто напоминать, когда токен уже истёк. */
const EXPIRED_REPEAT_MS = 12 * 60 * 60 * 1000;

/** Срок из JWT без проверки подписи (подпись проверяет WB, нам нужна только дата). */
export function wbTokenExpiry(token: string | null | undefined): Date | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof payload?.exp === "number" ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Какой порог сейчас действует: `0` — истёк, `1`/`3`/`7`/`14` — осталось не
 * больше стольких дней, `null` — до срока больше двух недель.
 */
export function wbTokenLevel(exp: Date, now = new Date()): number | null {
  const left = exp.getTime() - now.getTime();
  if (left <= 0) return 0;
  const days = left / DAY_MS;
  const hit = [...WB_TOKEN_WARN_DAYS].reverse().find((d) => days <= d);
  return hit ?? null;
}

/** Надо ли слать: новый порог (ниже прошлого), смена токена или повтор по истёкшему. */
export function wbTokenShouldWarn(
  level: number | null,
  state: { level?: number | null; exp?: string | null; sentAt?: string | null } | null,
  exp: Date,
  now = new Date(),
): boolean {
  if (level === null) return false;
  // Токен заменили — прошлые отметки не про него.
  if (!state || state.exp !== exp.toISOString()) return true;
  if (state.level === null || state.level === undefined || level < state.level) return true;
  if (level === 0 && state.sentAt) return now.getTime() - new Date(state.sentAt).getTime() >= EXPIRED_REPEAT_MS;
  return false;
}

const fmtMsk = (d: Date) =>
  d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export function wbTokenNotice(name: string, exp: Date, level: number): string {
  const expired = level === 0;
  return formatAdminNotice({
    marker: expired ? "urgent" : level <= 3 ? "action" : "waiting",
    zone: "WB",
    title: expired ? `токен ${name} истёк` : `токен ${name} истекает через ${level === 1 ? "сутки" : `${level} дн.`}`,
    lines: [
      `Срок: <b>${fmtMsk(exp)} МСК</b>`,
      expired
        ? "Бот не видит новые заказы DBS, не двигает статусы и не читает чаты WB."
        : "После этого бот перестанет видеть заказы DBS, статусы и чаты WB.",
    ],
    next: "Кабинет WB → Настройки → Доступ к API → новый токен с теми же категориями → в Coolify (Web и TG-бот), затем перезапуск.",
  });
}

export async function runWbTokenWatch(send: (html: string) => Promise<void>, now = new Date()): Promise<void> {
  const tokens: [string, string | undefined][] = [
    ["WB_API_TOKEN", process.env.WB_API_TOKEN],
    ["WB_CHAT_TOKEN", process.env.WB_CHAT_TOKEN],
  ];
  const cursor = await (db as any).wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const meta: Record<string, { level?: number | null; exp?: string | null; sentAt?: string | null }> =
    (cursor?.metadata as any) ?? {};
  let changed = false;

  for (const [name, token] of tokens) {
    const exp = wbTokenExpiry(token);
    if (!exp) continue;
    const level = wbTokenLevel(exp, now);
    const state = meta[name] ?? null;
    if (!wbTokenShouldWarn(level, state, exp, now)) {
      // Новый токен без предупреждений — запоминаем срок, чтобы следующий порог считался от него.
      if (level === null && state?.exp !== exp.toISOString()) {
        meta[name] = { level: null, exp: exp.toISOString(), sentAt: null };
        changed = true;
      }
      continue;
    }
    await send(wbTokenNotice(name, exp, level!));
    meta[name] = { level, exp: exp.toISOString(), sentAt: now.toISOString() };
    changed = true;
  }

  if (!changed) return;
  await (db as any).wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, metadata: meta, lastAttemptAt: now, lastSuccessAt: now },
    update: { metadata: meta, lastAttemptAt: now, lastSuccessAt: now },
  });
}
