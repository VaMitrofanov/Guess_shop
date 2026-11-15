import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_TOPIC_KEYS, adminTargets, adminTopicName, loadAdminRoute } from "../shared/admin-route";
import { formatAdminNotice } from "../shared/notify-format";
import { tgSend } from "../shared/notify";
import { NOTICE_STATS_STREAM, flushNoticeStats, mskDay, type NoticeDay } from "../shared/notice-stats";

/* ─────────────────────────────────────────────────────────────────────────────
   📊 Сводка «сколько уведов ушло вчера» — в 09:00 МСК в тему «Система»
   (16.11.2026). Считает `bots/shared/notice-stats.ts`. Курсор дня — поле
   `reportedDay` в той же строке `WbSyncCursor` `admin-notice-stats`.
   Выключатель — `NOTICE_STATS_REPORT=off`.
   ───────────────────────────────────────────────────────────────────────── */

const HOUR_MSK = 9;

export function noticeStatsText(
  day: string,
  d: NoticeDay,
  names: Array<{ key: string; name: string }>,
  dmKeys: string[],
): string {
  const rows = names
    .map(({ key, name }) => ({ name, n: d.sent[key] ?? 0 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const dm = dmKeys.reduce((sum, key) => sum + (d.sent[key] ?? 0), 0);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return formatAdminNotice({
    marker: "progress",
    zone: "СИСТЕМА",
    title: `уведы за ${day} · ${total}`,
    lines: [
      rows.length ? rows.map((r) => `${r.name} — <b>${r.n}</b>`).join(" · ") : "В беседу ничего не ушло.",
      dm ? `Копии в личку — ${dm}` : null,
      d.merged || d.resurfaced
        ? `💬 Склейка: ${d.merged} сообщ. покупателей легли правкой в открытый увед${d.resurfaced ? `, ${d.resurfaced} уведов поднято заново` : ""}`
        : null,
    ],
  });
}

async function tick(): Promise<void> {
  if ((process.env.NOTICE_STATS_REPORT ?? "").trim().toLowerCase() === "off") return;
  const now = new Date();
  if (new Date(now.getTime() + 3 * 3600_000).getUTCHours() !== HOUR_MSK) return;
  await flushNoticeStats(db as never).catch(() => undefined);
  const yesterday = mskDay(new Date(now.getTime() - 86_400_000));
  const row = await db.wbSyncCursor.findUnique({ where: { stream: NOTICE_STATS_STREAM } });
  const meta = (row?.metadata ?? {}) as { days?: Record<string, NoticeDay>; reportedDay?: string };
  if (meta.reportedDay === yesterday) return;
  // Сначала курсор — второй процесс/рестарт в тот же час не пришлёт дубль.
  await db.wbSyncCursor.upsert({
    where: { stream: NOTICE_STATS_STREAM },
    create: { stream: NOTICE_STATS_STREAM, metadata: { ...meta, reportedDay: yesterday } as never },
    update: { metadata: { ...meta, reportedDay: yesterday } as never },
  });
  const d = meta.days?.[yesterday];
  if (!d) return;

  const cfg = await loadAdminRoute();
  const names = await Promise.all(ADMIN_TOPIC_KEYS.map(async (topic) => ({
    key: `${cfg.chatId}#${cfg.topics[topic]}`,
    name: await adminTopicName(topic),
  })));
  const label = new Date(`${yesterday}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  const text = noticeStatsText(label, d, names, cfg.dmIds);
  for (const t of await adminTargets("system", { loud: false })) {
    await tgSend(t.chatId, text, { parse_mode: "HTML", ...t.extra }).catch(() => undefined);
  }
}

export function registerNoticeStatsReport(_bot: Telegraf): void {
  if (process.env.NODE_ENV === "test") return;
  setInterval(() => { void tick().catch((e) => console.warn("[notice-stats]", (e as Error)?.message ?? e)); }, 10 * 60_000);
}
