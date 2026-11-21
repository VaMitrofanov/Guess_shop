import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { adminTargets } from "../shared/admin-route";
import { formatAdminNotice } from "../shared/notify-format";
import { tgSend } from "../shared/notify";

/* ─────────────────────────────────────────────────────────────────────────────
   ☀️ Утренняя сводка WB в 10:00 МСК (15.11.2026, владелец: «меньше мусорной
   информации, больше эргономики»). Одно сообщение в «Нужно действие»: сколько
   ждут код доставки (и сколько дольше суток), ждут пасс дольше суток, к выкупу,
   заморожено, плохие отзывы за сутки. Нули не показываем; всё по нулям —
   одна строка «всё спокойно». Курсор дня — `WbSyncCursor` `wb-morning-digest`.
   Выключатель — `WB_MORNING_DIGEST=off`.
   ───────────────────────────────────────────────────────────────────────── */

const STREAM = "wb-morning-digest";
const HOUR_MSK = 10;
const DAY = 86_400_000;
const mskNow = () => new Date(Date.now() + 3 * 3600_000);

export interface MorningCounts {
  waitCode: number;
  waitCodeOld: number;
  waitPassOld: number;
  toBuy: number;
  held: number;
  badReviews: number;
}

export function morningDigestText(c: MorningCounts, day: string): string {
  const lines = [
    c.waitCode ? `🔑 Ждут код доставки: <b>${c.waitCode}</b>${c.waitCodeOld ? ` · дольше суток — <b>${c.waitCodeOld}</b>` : ""}` : null,
    c.waitPassOld ? `🎮 Ждут геймпасс дольше суток: <b>${c.waitPassOld}</b>` : null,
    c.toBuy ? `🛒 К выкупу: <b>${c.toBuy}</b>` : null,
    c.held ? `❄️ Заморожено: <b>${c.held}</b>` : null,
    c.badReviews ? `⭐️ Отзывы ★1–3 за сутки: <b>${c.badReviews}</b>` : null,
  ].filter((l): l is string => Boolean(l));
  return formatAdminNotice({
    marker: lines.length ? "action" : "done",
    zone: "WB",
    title: `утро ${day}`,
    lines: lines.length ? lines : ["Всё спокойно: очередей нет."],
  });
}

async function counts(): Promise<MorningCounts> {
  const now = Date.now();
  const dayAgo = new Date(now - DAY);
  const recent = new Date(now - 14 * DAY);
  const openDbs = { isTest: false, cancelledAt: null, completedAt: null, firstSeenAt: { gte: recent } } as const;
  const [waitCode, waitCodeOld, waitPassOld, toBuy, held, badReviews] = await Promise.all([
    db.wbMarketplaceOrder.count({ where: openDbs }),
    db.wbMarketplaceOrder.count({ where: { ...openDbs, firstSeenAt: { gte: recent, lt: dayAgo } } }),
    db.wbOrder.count({ where: { isTest: false, status: "AWAITING_GAMEPASS", heldAt: null, createdAt: { gte: new Date(now - 30 * DAY), lt: dayAgo } } }),
    db.wbOrder.count({ where: { isTest: false, status: { in: ["PENDING", "IN_PROGRESS"] }, heldAt: null } }),
    db.wbOrder.count({ where: { isTest: false, heldAt: { not: null }, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"] } } }),
    db.wbReview.count({ where: { rating: { lte: 3 }, wbCreatedAt: { gte: dayAgo } } }).catch(() => 0),
  ]);
  return { waitCode, waitCodeOld, waitPassOld, toBuy, held, badReviews };
}

async function tick(): Promise<void> {
  if ((process.env.WB_MORNING_DIGEST ?? "").trim().toLowerCase() === "off") return;
  const msk = mskNow();
  if (msk.getUTCHours() !== HOUR_MSK) return;
  const day = msk.toISOString().slice(0, 10);
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } });
  if ((row?.metadata as { day?: string } | null)?.day === day) return;
  // Сначала курсор — второй процесс/рестарт в тот же час не пришлёт дубль.
  await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata: { day } }, update: { metadata: { day } } });
  const label = msk.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  const text = morningDigestText(await counts(), label);
  const markup = { reply_markup: { inline_keyboard: [[{ text: "📱 Открыть TWA", url: "https://t.me/RobloxBankBot?startapp" }]] } };
  for (const t of await adminTargets("action", { loud: true })) {
    await tgSend(t.chatId, text, { parse_mode: "HTML", ...markup, ...t.extra }).catch(() => undefined);
  }
}

export function registerWbMorningDigest(_bot: Telegraf): void {
  if (process.env.NODE_ENV === "test") return;
  setInterval(() => { void tick().catch((e) => console.warn("[wb-morning]", (e as Error)?.message ?? e)); }, 10 * 60_000);
}
