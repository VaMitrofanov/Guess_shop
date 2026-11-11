/**
 * 🟣 Wildberries Hub — admin analytics dashboard.
 *
 * Screens:
 *  - Main hub: today/yesterday, top products, stock alerts, FBS badge
 *  - Stocks & Runway: per-article stock with days-remaining forecast
 *  - Dynamics: this week vs last week with per-day bar chart
 *  - Unit Economics: profit calculator per product
 *  - Reviews: unanswered reviews & questions with inline reply
 *  - FBS: marketplace orders list
 *  - Products: price editing (unchanged from v1)
 *  - Codes: add / download (unchanged from v1)
 *  - Analytics: activation bar chart (unchanged from v1)
 */

import { type Telegraf } from "telegraf";

import { ADMIN_IDS } from "../../shared/admin";

import {
  getStocksWithRunway,
  getUnansweredReviews,
  captureNotifyState,
  flushFbsDigest,
  getFbsOrders,
} from "./wb-client";

// ── Formatting helpers ───────────────────────────────────────────────────────


function stars(n?: number): string {
  if (!n) return "";
  return "★".repeat(n) + "☆".repeat(5 - n);
}

/** Escape user-supplied text (review bodies, author names) for HTML parse_mode. */
function escapeHtmlWb(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


// ── Main Hub ─────────────────────────────────────────────────────────────────

/**
 * Call once at bot startup to begin background WB monitoring (every 15 min).
 *
 * Notification policy:
 *  - FBS orders:   hourly digest — accumulates delta across cycles, sends one
 *                  message per hour. Avoids spam at 100+ orders/day.
 *  - Low stock:    immediate — each newly-critical article fires once.
 *  - Reviews:      immediate — fires once per cycle if count increased.
 */
export function startWbMonitor(bot: Telegraf, intervalMs = 15 * 60 * 1000): void {
  setInterval(async () => {
    try {
      const [fbs, stocks, reviews] = await Promise.all([
        getFbsOrders(),
        getStocksWithRunway(),
        getUnansweredReviews(),
      ]);
      const fbsCount         = fbs?.length ?? 0;
      const reviewCount      = reviews.length;
      const lowStockArticles = (stocks ?? [])
        .filter(s => s.runwayDays < 7 && s.runwayDays > 0)
        .map(s => s.article);

      const prev = captureNotifyState(fbsCount, reviewCount, lowStockArticles);
      if (!prev) return;

      // ── FBS: hourly digest ───────────────────────────────────────────────
      const newFbs    = fbsCount - prev.fbsCount;
      const digestBatch = flushFbsDigest(newFbs);
      if (digestBatch > 0) {
        const orderWord = digestBatch === 1 ? "заказ" : digestBatch < 5 ? "заказа" : "заказов";
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `🛒 <b>FBS: +${digestBatch} ${orderWord} за час</b>\nВсего в работе: <b>${fbsCount}</b>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }

      // ── Low stock: immediate, one message per newly-critical article ─────
      const newLowStock = lowStockArticles.filter(a => !prev.lowStockArticles.includes(a));
      if (newLowStock.length > 0) {
        const detail = newLowStock.map(a => {
          const s = stocks?.find(st => st.article === a);
          return `  • <code>${a}</code> — ${s?.quantity ?? "?"} шт (${s?.runwayDays ?? "?"}д)`;
        }).join("\n");
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `⚠️ <b>Low Stock Alert (${newLowStock.length} арт.)</b>\n${detail}\nПора заказывать поставку.`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }

      // ── Reviews: immediate, with the content inlined ─────────────────────
      // The admin UI lives in the TWA and the old in-bot «Отзывы» hub is dead,
      // so a "open the Отзывы section" pointer leads nowhere. Instead we render
      // the new review(s) — rating + full text + which product — right in the
      // notification, so the admin sees what was written and the score at a glance.
      // NB: WB feedback API exposes no order/code, so a review can't be tied to a
      // specific order — only to the product (article/nmId = a denomination).
      const newReviews = reviewCount - prev.reviewCount;
      if (newReviews > 0) {
        const reviewWord = newReviews === 1 ? "отзыв/вопрос" : newReviews < 5 ? "отзыва/вопроса" : "отзывов/вопросов";
        // reviews is sorted newest-first → the freshest unanswered are the new ones.
        const shown = reviews.slice(0, Math.min(newReviews, 3));
        const body = shown.map(r => {
          const icon   = r.kind === "review" ? "⭐" : "❓";
          const rating = r.kind === "review" && r.stars
            ? `\n⭐ Оценка: <b>${r.stars}/5</b>  ${stars(r.stars)}`
            : "";
          const prod = r.article ? `\n🏷 Товар: <code>${r.article}</code>` : "";
          const txt  = (r.text ?? "").trim();
          const quote = txt
            ? `\n💬 «${escapeHtmlWb(txt).slice(0, 700)}${txt.length > 700 ? "…" : ""}»`
            : `\n<i>(без текста — только оценка)</i>`;
          return `${icon} <b>${escapeHtmlWb(r.author)}</b>${rating}${prod}${quote}`;
        }).join("\n\n");
        const more = newReviews > shown.length ? `\n\n<i>…ещё ${newReviews - shown.length} — ответь на WB</i>` : "";
        const msg =
          `⭐ <b>${newReviews} новых ${reviewWord} на Wildberries</b>\n` +
          `━━━━━━━━━━━━━━━━\n\n${body}${more}`;
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId, msg, {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("WB monitor error:", err);
    }
  }, intervalMs);
}

// ── Stocks & Runway ──────────────────────────────────────────────────────────

// ── Dynamics ─────────────────────────────────────────────────────────────────

// ── Realization Report ────────────────────────────────────────────────────────

// ── Advert Hub ────────────────────────────────────────────────────────────────

// ── Unit Economics ────────────────────────────────────────────────────────────

// ── What-if calculator (wbcon-style forecast for any price/denomination) ────────

// ── Reviews & Questions ───────────────────────────────────────────────────────

// ── FBS Orders ───────────────────────────────────────────────────────────────

// ── Products ─────────────────────────────────────────────────────────────────

// ── Price editing ────────────────────────────────────────────────────────────

// ── Add codes — denomination picker ──────────────────────────────────────────

// ── Analytics (activation bar chart) ─────────────────────────────────────────

// ── Recent Orders (legacy) ───────────────────────────────────────────────────

// ── Download unused codes ────────────────────────────────────────────────────

