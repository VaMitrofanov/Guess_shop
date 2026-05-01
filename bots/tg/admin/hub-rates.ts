/**
 * 💱 Rates Hub — live market rates dashboard.
 *
 * Shows current rates from all providers (MarketRate table),
 * conversion to ₽, diff vs previous snapshot, and sub-$4 analytics.
 */

import { Markup, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}ч ${m}мин` : `${h}ч`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}д ${rh}ч` : `${d}д`;
}

// ── Main widget ──────────────────────────────────────────────────────────────

export async function showRatesHub(ctx: Context): Promise<void> {
  const text = await buildRatesText();

  await sendOrEditWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("📊 Аналитика <$4", CB.ratesAnalytics)],
    [Markup.button.callback("🔄 Обновить", CB.ratesRefresh)],
  ]));
}

export async function refreshRates(ctx: Context): Promise<void> {
  const text = await buildRatesText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("📊 Аналитика <$4", CB.ratesAnalytics)],
    [Markup.button.callback("🔄 Обновить", CB.ratesRefresh)],
  ]));
}

async function buildRatesText(): Promise<string> {
  const [rates, settings] = await Promise.all([
    (db as any).marketRate.findMany({ orderBy: { updatedAt: "desc" } }),
    (db as any).globalSettings.findUnique({ where: { id: "global" } }),
  ]);

  const usdToRub = settings?.usdToRub ?? 90;

  if (!rates || rates.length === 0) {
    return (
      `💱 <b>КУРС РОБУКСОВ</b>\n` +
      `━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ Нет данных. Парсер ещё не запускался.`
    );
  }

  // Build per-provider lines + find best rate
  let bestRate = Infinity;
  let bestProvider = "";
  const lines: string[] = [];

  for (const r of rates) {
    const rateRub = Math.round(r.rateUSD * usdToRub * 10) / 10;

    // Get previous snapshot for diff
    let diffLine = "";
    try {
      const prevSnap = await (db as any).rateSnapshot.findFirst({
        where: { provider: r.provider },
        orderBy: { createdAt: "desc" },
        skip: 1, // skip the latest (current)
      });
      if (prevSnap) {
        const diff = r.rateUSD - prevSnap.rateUSD;
        const pct = ((diff / prevSnap.rateUSD) * 100).toFixed(1);
        const arrow = diff < 0 ? "↘️" : diff > 0 ? "↗️" : "➡️";
        diffLine = ` ${arrow} ${diff > 0 ? "+" : ""}${pct}%`;
      }
    } catch { }

    const updatedAt = new Date(r.updatedAt).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit", minute: "2-digit",
    });

    const providerLinks: Record<string, string> = {
      "rbx120h": "https://rbx120h.com/",
      "bossrobux": "https://bossrobux.com/"
    };
    const providerLink = providerLinks[r.provider] || `https://${r.provider}.com/`;
    const providerDisplay = `<a href="${providerLink}">${r.provider}</a>`;

    let extraLines = "";
    if (r.purchaseRate != null && r.purchaseRate > 0) {
      extraLines += `\n   Закуп: $${r.purchaseRate}`;
    }
    if (r.accountsCount != null && r.accountsCount > 0) {
      extraLines += `\n   Аккаунтов: ${r.accountsCount}`;
    }

    lines.push(
      `🏪 <b>${providerDisplay}</b>\n` +
      `   💵 $${r.rateUSD}/1K R$${diffLine}\n` +
      `   💰 ${rateRub} ₽/1K R$\n` +
      `   📦 ${fmtNum(r.inventory)} R$ в наличии\n` +
      `   🕐 ${updatedAt}${extraLines}`
    );

    if (r.rateUSD < bestRate) {
      bestRate = r.rateUSD;
      bestProvider = r.provider;
    }
  }

  const bestRub = Math.round(bestRate * usdToRub * 10) / 10;
  const bestLine = bestRate < Infinity
    ? `\n💎 Лучший: <b>$${bestRate}</b> (${bestProvider}) = <b>${bestRub} ₽/1K R$</b>`
    : "";
  const fxLine = `\n💹 USD/RUB: <b>${usdToRub}</b>`;

  return (
    `💱 <b>КУРС РОБУКСОВ</b>\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    lines.join("\n\n") +
    `\n` +
    bestLine +
    fxLine
  );
}

// ── Analytics: sub-$4 episodes ───────────────────────────────────────────────

export async function showRatesAnalytics(ctx: Context): Promise<void> {
  const text = await buildAnalyticsText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Назад", CB.hubRates)],
    [Markup.button.callback("🔄 Обновить", CB.ratesAnalytics)],
  ]));
}

async function buildAnalyticsText(): Promise<string> {
  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // All snapshots below $4 in the last 7 days
  const sub4_7d: Array<{ provider: string; rateUSD: number; createdAt: Date }> =
    await (db as any).rateSnapshot.findMany({
      where: { rateUSD: { lte: 4.0 }, createdAt: { gte: day7 } },
      orderBy: { createdAt: "asc" },
      select: { provider: true, rateUSD: true, createdAt: true },
    });

  // All snapshots below $4 in the last 30 days
  const sub4_30d: Array<{ provider: string; rateUSD: number; createdAt: Date }> =
    await (db as any).rateSnapshot.findMany({
      where: { rateUSD: { lte: 4.0 }, createdAt: { gte: day30 } },
      orderBy: { createdAt: "asc" },
      select: { provider: true, rateUSD: true, createdAt: true },
    });

  // All-time minimum
  const allTimeMin: { rateUSD: number; provider: string; createdAt: Date } | null =
    await (db as any).rateSnapshot.findFirst({
      orderBy: { rateUSD: "asc" },
      select: { rateUSD: true, provider: true, createdAt: true },
    });

  // General stats for 7 days
  const stats7d = await (db as any).rateSnapshot.aggregate({
    _min: { rateUSD: true },
    _max: { rateUSD: true },
    _avg: { rateUSD: true },
    _count: true,
    where: { createdAt: { gte: day7 } },
  });

  // ── Compute sub-$4 episodes ──────────────────────────────────────────────
  // An "episode" is a consecutive sequence of snapshots where rate ≤ $4
  // We estimate duration between first and last snapshot in each episode,
  // plus typical interval padding.

  const episodes7d = computeEpisodes(sub4_7d);
  const episodes30d = computeEpisodes(sub4_30d);

  const total7dMs = episodes7d.reduce((s, e) => s + e.durationMs, 0);
  const total30dMs = episodes30d.reduce((s, e) => s + e.durationMs, 0);
  const minRate7d = sub4_7d.length > 0 ? Math.min(...sub4_7d.map(s => s.rateUSD)) : null;

  const fmtDate = (d: Date) => new Date(d).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });

  let text = `📊 <b>АНАЛИТИКА КУРСА &lt;$4</b>\n━━━━━━━━━━━━━━━━\n\n`;

  // 7-day block
  text += `📅 <b>ЗА 7 ДНЕЙ:</b>\n`;
  if (sub4_7d.length === 0) {
    text += `   Курс не опускался ниже $4\n`;
  } else {
    text +=
      `   📉 Минимум: <b>$${minRate7d}</b>\n` +
      `   🔢 Эпизодов ≤$4: <b>${episodes7d.length}</b>\n` +
      `   ⏱ Суммарно ниже $4: <b>${fmtDuration(total7dMs)}</b>\n`;

    // Show last 3 episodes
    const last3 = episodes7d.slice(-3).reverse();
    for (const ep of last3) {
      text += `   • ${fmtDate(ep.start)} — $${ep.minRate} (${fmtDuration(ep.durationMs)})\n`;
    }
  }

  // 30-day block
  text += `\n📅 <b>ЗА 30 ДНЕЙ:</b>\n`;
  if (sub4_30d.length === 0) {
    text += `   Курс не опускался ниже $4\n`;
  } else {
    const minRate30d = Math.min(...sub4_30d.map(s => s.rateUSD));
    text +=
      `   📉 Минимум: <b>$${minRate30d}</b>\n` +
      `   🔢 Эпизодов ≤$4: <b>${episodes30d.length}</b>\n` +
      `   ⏱ Суммарно ниже $4: <b>${fmtDuration(total30dMs)}</b>\n`;
  }

  // General stats
  text += `\n📈 <b>ОБЩАЯ СТАТИСТИКА (7д):</b>\n`;
  if (stats7d._count > 0) {
    text +=
      `   Средний курс: <b>$${parseFloat(stats7d._avg.rateUSD).toFixed(2)}</b>\n` +
      `   Диапазон: $${parseFloat(stats7d._min.rateUSD).toFixed(2)} — $${parseFloat(stats7d._max.rateUSD).toFixed(2)}\n` +
      `   Замеров: ${stats7d._count}\n`;
  } else {
    text += `   Нет данных\n`;
  }

  // All-time record
  if (allTimeMin) {
    text += `\n🏆 <b>Рекорд:</b> $${allTimeMin.rateUSD} (${allTimeMin.provider}, ${fmtDate(allTimeMin.createdAt)})`;
  }

  return text;
}

interface Episode {
  start: Date;
  end: Date;
  minRate: number;
  durationMs: number;
  snapCount: number;
}

/**
 * Group snapshots into episodes of consecutive sub-$4 readings.
 * Two snapshots are in the same episode if they're within 2h of each other.
 */
function computeEpisodes(snapshots: Array<{ rateUSD: number; createdAt: Date }>): Episode[] {
  if (snapshots.length === 0) return [];

  const GAP_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours
  const INTERVAL_PADDING = 15 * 60 * 1000;  // assume ~15 min parser cycle

  const episodes: Episode[] = [];
  let epStart = new Date(snapshots[0].createdAt);
  let epEnd = epStart;
  let epMin = snapshots[0].rateUSD;
  let epCount = 1;

  for (let i = 1; i < snapshots.length; i++) {
    const ts = new Date(snapshots[i].createdAt);
    const gap = ts.getTime() - epEnd.getTime();

    if (gap <= GAP_THRESHOLD) {
      epEnd = ts;
      epMin = Math.min(epMin, snapshots[i].rateUSD);
      epCount++;
    } else {
      // Close current episode
      episodes.push({
        start: epStart,
        end: epEnd,
        minRate: Math.round(epMin * 100) / 100,
        durationMs: Math.max(epEnd.getTime() - epStart.getTime(), INTERVAL_PADDING),
        snapCount: epCount,
      });
      // Start new episode
      epStart = ts;
      epEnd = ts;
      epMin = snapshots[i].rateUSD;
      epCount = 1;
    }
  }

  // Close last episode
  episodes.push({
    start: epStart,
    end: epEnd,
    minRate: Math.round(epMin * 100) / 100,
    durationMs: Math.max(epEnd.getTime() - epStart.getTime(), INTERVAL_PADDING),
    snapCount: epCount,
  });

  return episodes;
}
