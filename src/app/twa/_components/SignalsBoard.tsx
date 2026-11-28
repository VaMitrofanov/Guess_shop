"use client";

/* ⚠ «Разобрать» — срез в «Заказах» вместо отдельного раздела «Риски»
   (19.11.2026, владелец: «никак не связано с заказами визуально»).

   Раньше лента показывала СОБЫТИЯ: отзыв, заявка и просьба об отмене по
   одному заказу шли тремя карточками без статуса и ника. Теперь карточка =
   заказ: статус, ник, сумма, все его сигналы строками, подсказка «что делать»
   и кнопки. Три вкладки по тому, чей ход:
   • «Решить сейчас» — заказ заморожен, открыт возврат, просят отмену, деньги
     не сходятся;
   • «Ждём покупателя» — нет пасса или код ещё не вводили;
   • «Следим» — остальное (вопрос на WB, «нужен человек» по живому заказу).
   Данные — та же лента `RiskEvent` (`/api/twa/risks`), сгруппированная здесь. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "./theme";
import { haptic } from "./haptics";
import { fmtRiskDate } from "./RiskBits";
import { starsText } from "@/lib/order-risk-types";
import { ORDER_STATUS_RU, RISK_KIND_META, type RiskFeed, type RiskFeedItem, type RiskKind } from "@/lib/risk-feed-types";

export type SignalLane = "now" | "buyer" | "watch";

const LANES: { id: SignalLane; label: string }[] = [
  { id: "now", label: "Решить сейчас" },
  { id: "buyer", label: "Ждём покупателя" },
  { id: "watch", label: "Следим" },
];

const URGENT: ReadonlySet<RiskKind> = new Set<RiskKind>([
  "CLAIM_OPENED", "BUYER_CANCEL", "REFUND_OPEN", "REFUND_AFTER_DELIVERY", "SALE_UNMATCHED", "SALE_NO_CODE",
]);

export interface SignalGroup {
  key: string;
  code: string | null;
  items: RiskFeedItem[];
  order: RiskFeedItem["order"];
  buyerName: string | null;
  amount: number | null;
  lane: SignalLane;
  latest: string;
}

/** События → карточки по заказу. Без кода каждое событие — своя карточка. */
export function groupSignals(items: RiskFeedItem[]): SignalGroup[] {
  const map = new Map<string, RiskFeedItem[]>();
  for (const it of items) {
    const key = it.wbCode ?? `event:${it.id}`;
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  const out: SignalGroup[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const order = list.find((i) => i.order)?.order ?? null;
    const urgent = list.some((i) => URGENT.has(i.kind)) || Boolean(order?.held);
    const waitingBuyer = !order || order.status === "AWAITING_GAMEPASS" || order.status === "PAYMENT_PENDING";
    out.push({
      key,
      code: list[0].wbCode,
      items: list,
      order,
      buyerName: list.find((i) => i.buyerName)?.buyerName ?? null,
      amount: order?.amount ?? list.find((i) => i.amount)?.amount ?? null,
      lane: urgent ? "now" : waitingBuyer ? "buyer" : "watch",
      latest: list[0].occurredAt,
    });
  }
  return out.sort((a, b) => b.latest.localeCompare(a.latest));
}

/** Одна подсказка «что делать» — по самому острому сигналу. */
export function nextStep(g: SignalGroup): string {
  const kinds = new Set(g.items.map((i) => i.kind));
  if (kinds.has("REFUND_AFTER_DELIVERY") || kinds.has("SALE_UNMATCHED") || kinds.has("SALE_NO_CODE")) return "Сверить деньги WB с выдачей";
  if (kinds.has("CLAIM_OPENED") || kinds.has("REFUND_OPEN")) return "Решить по возврату: вернуть или выкупить";
  if (kinds.has("BUYER_CANCEL")) return "Просит отмену — ответить и решить";
  if (kinds.has("BAD_REVIEW") && g.order?.held) return "Прочитать отзыв: разморозить или оставить";
  if (!g.order) return "Код не вводили — напомнить в чате WB";
  if (g.order.status === "AWAITING_GAMEPASS") return "Помочь с геймпассом в чате";
  if (kinds.has("BAD_REVIEW")) return "Ответить на отзыв";
  return "Ответить покупателю";
}

const TONE: Record<"red" | "green" | "amber" | "muted", string> = {
  red: C.red, green: C.green, amber: C.orange, muted: C.textTertiary,
};

function signalTag(i: RiskFeedItem): string {
  if (i.kind === "BAD_REVIEW") return `${starsText(i.stars)} отзыв`;
  if (i.kind === "REVIEW_FIXED") return `${starsText(i.starsBefore)}→${starsText(i.stars)}`;
  return RISK_KIND_META[i.kind]?.label ?? i.kind;
}

function statusPill(g: SignalGroup): { text: string; fg: string } {
  if (!g.order) return { text: "код не вводили", fg: C.textSecondary };
  if (g.order.held) return { text: "❄️ заморожен", fg: C.ice };
  return { text: ORDER_STATUS_RU[g.order.status] ?? g.order.status, fg: C.textSecondary };
}

export default function SignalsBoard({
  token, onOpenOrder, onOpenBuyer, onCount,
}: {
  token: string;
  onOpenOrder: (code: string) => void;
  onOpenBuyer: (name: string) => void;
  onCount?: (n: number) => void;
}) {
  const [feed, setFeed] = useState<RiskFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lane, setLane] = useState<SignalLane>("now");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/twa/risks?state=open&limit=200", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setFeed(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupSignals(feed?.items ?? []), [feed]);
  useEffect(() => { if (feed) onCount?.(groups.length); }, [feed, groups.length, onCount]);
  const counts = useMemo(() => {
    const c: Record<SignalLane, number> = { now: 0, buyer: 0, watch: 0 };
    for (const g of groups) c[g.lane] += 1;
    return c;
  }, [groups]);
  const shown = groups.filter((g) => g.lane === lane);

  async function resolveGroup(g: SignalGroup) {
    setBusy(g.key);
    try {
      for (const it of g.items) {
        const res = await fetch("/api/twa/risks", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: it.id, action: "resolve" }),
        });
        if (!res.ok) throw new Error("Не сохранилось");
      }
      haptic.notify("success");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="twa-fade-in" style={{ padding: "8px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {LANES.map((l) => {
          const on = l.id === lane;
          return (
            <button key={l.id} type="button" className="twa-press-sm"
              onClick={() => { haptic.select(); setLane(l.id); }}
              style={{
                minHeight: 36, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                fontSize: 14, fontWeight: 700, border: 0,
                background: on ? C.textPrimary : C.card, color: on ? C.bg : C.textSecondary,
              }}>
              {l.label} {counts[l.id]}
            </button>
          );
        })}
      </div>

      {error && <div style={{ color: C.red, fontSize: 14 }}>{error}</div>}
      {!feed && !error && <div style={{ color: C.textSecondary, fontSize: 15, padding: 8 }}>Загружаем…</div>}
      {feed && shown.length === 0 && (
        <div style={{ color: C.textSecondary, fontSize: 15, padding: "20px 8px", textAlign: "center" }}>
          {lane === "now" ? "Срочного нет — всё разобрано 🎉" : "Здесь пусто"}
        </div>
      )}

      {shown.map((g) => {
        const pill = statusPill(g);
        return (
          <div key={g.key} style={{ borderRadius: 18, background: C.card, border: `1px solid ${C.hairline}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: pill.fg }}>{pill.text}</span>
              <span style={{ marginLeft: "auto", fontSize: 14, color: C.textTertiary }}>{fmtRiskDate(g.latest)}</span>
              {g.code && (
                <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 14, color: C.textSecondary, background: C.cardTop, padding: "3px 8px", borderRadius: 8 }}>{g.code}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[g.buyerName ?? "без имени", g.order?.nick].filter(Boolean).join(" · ")}
              </span>
              {g.amount ? <span style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, flexShrink: 0 }}>{g.amount.toLocaleString("ru-RU")} <span style={{ color: C.green }}>R$</span></span> : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.items.map((i) => (
                <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: TONE[RISK_KIND_META[i.kind]?.tone ?? "muted"] }}>
                    {signalTag(i)} <span style={{ fontWeight: 500, color: C.textTertiary }}>· {fmtRiskDate(i.occurredAt)}</span>
                  </span>
                  {i.text && <span style={{ fontSize: 15, color: C.textPrimary, fontStyle: "italic", lineHeight: 1.35, whiteSpace: "pre-wrap" }}>«{i.text}»</span>}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 14, color: C.textSecondary, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>👉 {nextStep(g)}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {g.code && (
                <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onOpenOrder(g.code!); }}
                  style={{ minHeight: 44, flex: "1 1 120px", borderRadius: 12, border: 0, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                  Открыть заказ
                </button>
              )}
              {g.buyerName && (
                <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onOpenBuyer(g.buyerName!); }}
                  style={{ minHeight: 44, flex: "1 1 90px", borderRadius: 12, border: `1px solid ${C.hairline}`, background: C.cardTop, color: C.textPrimary, fontSize: 15, fontFamily: "inherit", cursor: "pointer" }}>
                  Досье
                </button>
              )}
              <button type="button" className="twa-press-sm" disabled={busy === g.key} onClick={() => { haptic.impact("light"); void resolveGroup(g); }}
                style={{ minHeight: 44, flex: "1 1 110px", borderRadius: 12, border: `1px solid ${C.hairline}`, background: C.cardTop, color: C.green, fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", opacity: busy === g.key ? 0.5 : 1 }}>
                {busy === g.key ? "…" : "Разобрано ✓"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
