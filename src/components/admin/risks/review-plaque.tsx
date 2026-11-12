"use client";

import Link from "next/link";
import { starsText, type OrderRisk } from "@/lib/order-risk-types";
import { riskActionText } from "@/lib/risk-feed-types";
import { buyerHref, fmtRiskDate } from "./risk-item";
import css from "./risks.module.css";

/** Плашка отзыва + ссылка на досье в карточке заказа на сайте. */
export default function OrderRiskBlock({ risk }: { risk: OrderRisk | null | undefined }) {
  if (!risk || (!risk.review && !risk.buyerName)) return null;
  const review = risk.review;
  const fixed = review?.kind === "REVIEW_FIXED";
  const deleted = review?.kind === "REVIEW_DELETED";
  const action = riskActionText(review?.action, review?.kind);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {review && (
        <div className={`${css.plaque} ${fixed ? css.plaqueFixed : deleted ? css.plaqueDeleted : css.plaqueBad}`}>
          <div className={css.plaqueTitle}>
            <span>{fixed ? "ОТЗЫВ ИСПРАВЛЕН" : deleted ? "🗑 БЫЛ ПЛОХОЙ ОТЗЫВ, УДАЛЁН" : "ПЛОХОЙ ОТЗЫВ НА WB"}</span>
            <span className={css.when}>{fmtRiskDate(review.at)}</span>
          </div>
          <span className={css.stars} style={deleted ? { textDecoration: "line-through" } : undefined}>{fixed ? `${starsText(review.starsBefore)} → ${starsText(review.stars)}` : starsText(review.stars)}</span>
          {review.text && <div className={css.quote}>«{review.text}»</div>}
          {action && <span className={css.hint}>{action}</span>}
        </div>
      )}
      {risk.buyerName && (
        <Link href={buyerHref(risk.buyerName)} className={`${css.buyerChip} ${risk.flag ? css.buyerChipFlag : ""}`}>
          <span className={css.hint}>Покупатель WB</span>
          <b>{risk.buyerName}</b>
          {risk.flag && <span style={{ color: "#f4b545", fontWeight: 700 }}>⚠️ проблемный</span>}
          <span className={css.link}>Досье ›</span>
        </Link>
      )}
    </div>
  );
}
