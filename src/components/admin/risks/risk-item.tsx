"use client";

import Link from "next/link";
import { starsText } from "@/lib/order-risk-types";
import { ORDER_STATUS_RU, RISK_KIND_META, riskActionText, type RiskFeedItem } from "@/lib/risk-feed-types";
import css from "./risks.module.css";

export function fmtRiskDate(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function buyerHref(name: string): string {
  return `/admin/buyers?name=${encodeURIComponent(name)}`;
}

/** Ссылка на заказ: карточка, если наш заказ есть, иначе поиск по коду. */
export function orderHref(item: { wbCode: string | null; order: { id: string } | null }): string | null {
  if (item.order) return `/admin/orders/${item.order.id}`;
  if (item.wbCode) return `/admin/orders?slice=ALL&q=${encodeURIComponent(item.wbCode)}`;
  return null;
}

/** Строка ленты «Риски» — и в разделе, и в досье. */
export function RiskItem({
  item, busy, onToggle, showActions = true,
}: {
  item: RiskFeedItem;
  busy?: boolean;
  onToggle?: (item: RiskFeedItem) => void;
  showActions?: boolean;
}) {
  const meta = RISK_KIND_META[item.kind];
  const resolved = Boolean(item.resolvedAt);
  const action = riskActionText(item.action);
  const href = orderHref(item);
  const stars = item.kind === "REVIEW_FIXED"
    ? `${starsText(item.starsBefore)} → ${starsText(item.stars)}`
    : item.kind === "BAD_REVIEW" ? starsText(item.stars) : null;
  return (
    <article className={`${css.item} ${resolved && showActions ? css.itemResolved : ""}`}>
      <span className={`${css.stripe} ${css[meta.tone]}`} aria-hidden="true" />
      <div className={css.body}>
        <div className={css.head}>
          <strong>{meta.label}</strong>
          {item.wbCode && <span className={css.code}>{item.wbCode}</span>}
          <span className={css.when}>{fmtRiskDate(item.occurredAt)}</span>
        </div>
        <div className={css.sub}>
          {item.buyerName ? <Link href={buyerHref(item.buyerName)}>{item.buyerName}</Link> : "без имени"}
          {item.amount ? ` · ${item.amount.toLocaleString("ru-RU")} R$` : ""}
          {item.wbOrderId ? ` · WB #${item.wbOrderId}` : ""}
          {` · ${item.order ? ORDER_STATUS_RU[item.order.status] ?? item.order.status : "код не вводили"}`}
        </div>
        {stars && <span className={css.stars}>{stars}</span>}
        {item.text && <div className={css.quote}>«{item.text}»</div>}
        <div className={css.pills}>
          {action && <span className={`${css.pill} ${item.action === "frozen" ? css.pillIce : css.pillGreen}`}>{action}</span>}
          {item.order?.held && item.action !== "frozen" && <span className={`${css.pill} ${css.pillIce}`}>❄️ заморожен</span>}
          {resolved && <span className={css.pill}>разобрано · {item.resolvedBy ?? "—"}</span>}
        </div>
      </div>
      {showActions && (
        <div className={css.actions}>
          {onToggle && (
            <button type="button" className={`${css.btn} ${resolved ? "" : css.btnPrimary}`} disabled={busy} onClick={() => onToggle(item)}>
              {resolved ? "Вернуть в открытые" : "Разобрано"}
            </button>
          )}
          {href && <Link className={css.btn} href={href}>Открыть заказ</Link>}
        </div>
      )}
    </article>
  );
}
