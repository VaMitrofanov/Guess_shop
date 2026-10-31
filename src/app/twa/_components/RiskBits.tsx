"use client";

/* Отзыв и покупатель в карточке заказа + досье покупателя (30.10.2026).
   Плашка отзыва стоит рядом с плашкой заморозки: «почему заморожен» и «что
   написал человек» читаются вместе. Тап по имени открывает досье. */

import { useCallback, useEffect, useState } from "react";
import BottomSheet from "./BottomSheet";
import { haptic } from "./haptics";
import { C } from "./theme";
import { starsText, type OrderRisk } from "@/lib/order-risk-types";
import {
  ORDER_STATUS_RU,
  RISK_KIND_META,
  riskActionText,
  type BuyerDossier,
  type RiskFeedItem,
} from "@/lib/risk-feed-types";

const TONE: Record<"red" | "green" | "amber" | "muted", string> = {
  red: C.red,
  green: C.green,
  amber: C.orange,
  muted: C.textTertiary,
};

export function fmtRiskDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** ★1 «текст» — или ★1 → ★5, если отзыв исправлен. */
export function ReviewPlaque({ review }: { review: NonNullable<OrderRisk["review"]> }) {
  const fixed = review.kind === "REVIEW_FIXED";
  const tone = fixed ? C.green : C.red;
  const action = riskActionText(review.action);
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px",
      borderRadius: 14, background: `${tone}17`, border: `1px solid ${tone}4d`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <strong style={{ fontSize: 14, fontWeight: 700, color: tone, letterSpacing: ".01em" }}>
          {fixed ? "ОТЗЫВ ИСПРАВЛЕН" : "ПЛОХОЙ ОТЗЫВ НА WB"}
        </strong>
        <span style={{ fontSize: 14, color: C.textTertiary, fontVariantNumeric: "tabular-nums" }}>{fmtRiskDate(review.at)}</span>
      </div>
      <span style={{ fontSize: 16, letterSpacing: 1, color: C.yellow }}>
        {fixed ? <>{starsText(review.starsBefore)} <span style={{ color: C.textTertiary }}>→</span> {starsText(review.stars)}</> : starsText(review.stars)}
      </span>
      {review.text && (
        <span style={{ fontSize: 15, color: C.textPrimary, lineHeight: 1.4, fontStyle: "italic", whiteSpace: "pre-wrap" }}>
          «{review.text}»
        </span>
      )}
      {action && <span style={{ fontSize: 14, color: C.textSecondary }}>{action}</span>}
    </div>
  );
}

/** Имя покупателя с WB: тап — досье, ⚠️ — отмечен «проблемным». */
export function BuyerLine({ risk, onOpen }: { risk: OrderRisk; onOpen: (name: string) => void }) {
  if (!risk.buyerName) return null;
  return (
    <button
      type="button"
      className="twa-press-sm"
      onClick={() => { haptic.select(); onOpen(risk.buyerName!); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "11px 14px", borderRadius: 14, cursor: "pointer",
        background: risk.flag ? `${C.orange}17` : C.cardTop,
        border: `1px solid ${risk.flag ? `${C.orange}4d` : C.hairline}`,
        color: C.textPrimary, font: "inherit",
      }}
    >
      <span style={{ fontSize: 14, color: C.textSecondary }}>Покупатель WB</span>
      <b style={{ fontSize: 15, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {risk.buyerName}
      </b>
      {risk.flag && <span style={{ fontSize: 14, fontWeight: 700, color: C.orange }}>⚠️ проблемный</span>}
      <span style={{ fontSize: 14, color: C.accent }}>Досье ›</span>
    </button>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, width: "fit-content",
      fontSize: 14, fontWeight: 600, padding: "4px 9px", borderRadius: 8,
      background: `${tone}22`, color: tone,
    }}>{children}</span>
  );
}

/** Одна строка ленты «Риски» — и в разделе, и в досье. */
export function RiskItemCard({
  item, busy, onToggleResolved, onOpenOrder, onOpenBuyer, compact,
}: {
  item: RiskFeedItem;
  busy?: boolean;
  onToggleResolved?: (item: RiskFeedItem) => void;
  onOpenOrder?: (code: string) => void;
  onOpenBuyer?: (name: string) => void;
  compact?: boolean;
}) {
  const meta = RISK_KIND_META[item.kind];
  const tone = TONE[meta.tone];
  const resolved = Boolean(item.resolvedAt);
  const action = riskActionText(item.action);
  const stars = item.kind === "REVIEW_FIXED"
    ? `${starsText(item.starsBefore)} → ${starsText(item.stars)}`
    : item.kind === "BAD_REVIEW" ? starsText(item.stars) : null;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "4px 1fr", gap: 12,
      padding: "13px 14px", borderRadius: 16, background: C.card,
      border: `1px solid ${C.hairline}`, opacity: resolved && !compact ? 0.62 : 1,
    }}>
      <span style={{ borderRadius: 4, background: tone }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            {meta.label}
            {item.wbCode && <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600, color: C.textSecondary }}> · {item.wbCode}</span>}
          </span>
          <span style={{ fontSize: 14, color: C.textTertiary, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{fmtRiskDate(item.occurredAt)}</span>
        </div>
        <span style={{ fontSize: 14, color: C.textSecondary }}>
          {item.buyerName ?? "без имени"}
          {item.amount ? ` · ${item.amount.toLocaleString("ru-RU")} R$` : ""}
          {item.order ? ` · ${ORDER_STATUS_RU[item.order.status] ?? item.order.status}` : " · код не вводили"}
        </span>
        {stars && <span style={{ fontSize: 16, color: C.yellow, letterSpacing: 1 }}>{stars}</span>}
        {item.text && (
          <span style={{ fontSize: 15, color: C.textPrimary, fontStyle: "italic", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
            «{item.text}»
          </span>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {action && <Pill tone={item.action === "frozen" ? C.ice : C.green}>{action}</Pill>}
          {item.order?.held && item.action !== "frozen" && <Pill tone={C.ice}>❄️ заморожен</Pill>}
          {resolved && <Pill tone={C.textTertiary}>разобрано · {item.resolvedBy ?? "—"}</Pill>}
        </div>
        {!compact && (onToggleResolved || onOpenOrder || onOpenBuyer) && (
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            {onToggleResolved && (
              <button type="button" disabled={busy} className="twa-press-sm" onClick={() => { haptic.impact("light"); onToggleResolved(item); }}
                style={btn(resolved ? C.elevated : C.accent, resolved ? C.textPrimary : "#140c24")}>
                {resolved ? "Вернуть" : "Разобрано"}
              </button>
            )}
            {onOpenOrder && item.wbCode && (
              <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onOpenOrder(item.wbCode!); }} style={btn(C.elevated, C.textPrimary)}>
                Заказ
              </button>
            )}
            {onOpenBuyer && item.buyerName && (
              <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onOpenBuyer(item.buyerName!); }} style={btn(C.elevated, C.textPrimary)}>
                Досье
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function btn(bg: string, color: string): React.CSSProperties {
  return {
    flex: 1, padding: "10px 8px", borderRadius: 11, border: 0, cursor: "pointer",
    background: bg, color, fontSize: 14, fontWeight: 700, font: "inherit",
  };
}

/** Шторка досье покупателя. */
export function BuyerDossierSheet({
  token, name, onClose, onOpenOrder,
}: {
  token: string;
  name: string | null;
  onClose: () => void;
  onOpenOrder?: (code: string) => void;
}) {
  const [data, setData] = useState<BuyerDossier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async (target: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/twa/buyers?name=${encodeURIComponent(target)}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setData(d);
      setNote(d.flag?.note ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, [token]);

  useEffect(() => {
    setData(null);
    if (name) void load(name);
  }, [name, load]);

  async function toggleFlag(on: boolean) {
    if (!data) return;
    setSaving(true);
    try {
      const res = await fetch("/api/twa/buyers", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "flag" : "unflag", name: data.key, displayName: data.displayName, note }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не сохранилось");
      haptic.notify("success");
      setData({ ...data, flag: d.flag });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={Boolean(name)} onClose={onClose} ariaLabel="Досье покупателя" expandable>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 16px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14, color: C.textSecondary, textTransform: "uppercase", letterSpacing: ".06em" }}>Досье покупателя WB</span>
          <strong style={{ fontSize: 24, color: C.textPrimary }}>{data?.displayName ?? name}</strong>
          {data?.flag && <Pill tone={C.orange}>⚠️ проблемный · {data.flag.by}, {fmtRiskDate(data.flag.at)}</Pill>}
        </div>

        {error && <span style={{ fontSize: 15, color: C.red }}>{error}</span>}
        {!data && !error && <span style={{ fontSize: 15, color: C.textSecondary }}>Загружаем…</span>}

        {data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {([
                ["заказов", data.stats.orders],
                ["выкуплено", data.stats.completed],
                ["плохих отзывов", data.stats.badReviews],
                ["возвратов", data.stats.claims],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ background: C.card, border: `1px solid ${C.hairline}`, borderRadius: 12, padding: "10px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                  <b style={{ fontSize: 20, color: C.textPrimary, fontVariantNumeric: "tabular-nums" }}>{value}</b>
                  <span style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.2 }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{
              fontSize: 14, lineHeight: 1.4, padding: "10px 12px", borderRadius: 12,
              color: data.likelyNamesakes ? C.orange : C.textSecondary,
              background: data.likelyNamesakes ? `${C.orange}14` : C.cardTop,
              border: `1px solid ${data.likelyNamesakes ? `${C.orange}40` : C.hairline}`,
            }}>
              {data.likelyNamesakes
                ? `Связь по имени: на «${data.displayName}» ${data.stats.orders} заказов — скорее всего это разные люди. Смотрите на даты и товар.`
                : "Связь по имени: WB не даёт ID покупателя. Заказов на это имя мало — совпадение похоже на одного человека."}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: ".06em" }}>Заказы</span>
              {data.orders.length === 0 && <span style={{ fontSize: 15, color: C.textTertiary }}>Заказов на это имя нет</span>}
              {data.orders.map((o) => (
                <button key={o.wbOrderId} type="button" className="twa-press-sm" disabled={!o.code || !onOpenOrder}
                  onClick={() => { if (o.code && onOpenOrder) { haptic.select(); onOpenOrder(o.code); } }}
                  style={{
                    display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", textAlign: "left",
                    padding: "11px 13px", borderRadius: 13, background: C.card, border: `1px solid ${C.hairline}`,
                    color: C.textPrimary, font: "inherit", cursor: o.code && onOpenOrder ? "pointer" : "default",
                  }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <b style={{ fontSize: 15, fontFamily: "ui-monospace, Menlo, monospace" }}>{o.code ?? `WB #${o.wbOrderId}`}</b>
                    <span style={{ fontSize: 14, color: C.textSecondary }}>
                      {fmtRiskDate(o.createdAt)} · {ORDER_STATUS_RU[o.status] ?? o.status}
                      {o.held ? " · ❄️" : ""}{o.claim ? " · возврат" : ""}
                    </span>
                  </span>
                  <b style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{o.amount ? `${o.amount.toLocaleString("ru-RU")} R$` : ""}</b>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: ".06em" }}>Отзывы и возвраты</span>
              {data.events.length === 0 && <span style={{ fontSize: 15, color: C.textTertiary }}>Ничего не было</span>}
              {data.events.map((e) => <RiskItemCard key={e.id} item={e} compact />)}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: ".06em" }}>Отметка</span>
              <textarea
                id="twa-buyer-flag-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Почему проблемный (необязательно)"
                rows={2}
                style={{
                  width: "100%", resize: "none", padding: "10px 12px", borderRadius: 12,
                  background: C.cardTop, border: `1px solid ${C.border}`, color: C.textPrimary,
                  fontSize: 15, font: "inherit",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={saving} className="twa-press-sm" onClick={() => void toggleFlag(true)} style={btn(C.orange, "#1b1000")}>
                  {data.flag ? "Сохранить заметку" : "⚠️ Отметить проблемным"}
                </button>
                {data.flag && (
                  <button type="button" disabled={saving} className="twa-press-sm" onClick={() => void toggleFlag(false)} style={btn(C.elevated, C.textPrimary)}>
                    Снять отметку
                  </button>
                )}
              </div>
              <span style={{ fontSize: 14, color: C.textTertiary, lineHeight: 1.4 }}>
                Отметка — подсказка: она всплывёт на карточках заказов с этим именем. Выкуп не блокирует.
              </span>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
