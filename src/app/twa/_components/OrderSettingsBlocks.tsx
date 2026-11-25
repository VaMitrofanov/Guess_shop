"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Карточка заказа, волны 2–3 (25.11.2026, мокап «Карточка заказа — порядок
   в настройках»).

   «Состав заказа» — ник, номинал и пассы одним блоком. Раньше их правили
   четыре двери (поле пасса в «Редактировать», «Ссылка», «Разбить», «Ключ»),
   и правка номинала молча ломала разбивку. Один пасс — это состав из одной
   части, разбивка — из двух и больше; номинал у разбитого заказа меняется
   только пересборкой состава (сервер: `splitEditRefusal`).

   «Где заказ» — одно место вместо шести кнопок. Переходы собираются из
   существующих серверных действий (`placeRequests` в `@/lib/order-actions`),
   так что их проверки, след и уведомления не меняются.
   ───────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { C, MONO } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import { canOrderAction, ORDER_PLACES, orderPlaceOf, placeRequests, type OrderPlace } from "@/lib/order-actions";
import { gamepassToolsFor, type GamepassToolId, type GamepassToolOrder } from "@/lib/gamepass-tools";
import { parseGamepassRef } from "@/lib/gamepass-id";

interface SettingsOrder extends GamepassToolOrder {
  id: string;
  amount: number;
  gamepassUrl?: string | null;
  splitGamepasses?: { gamepassId: string; amount: number; position?: number; purchasedAt?: string | Date | null }[] | null;
}

async function post(token: string, body: Record<string, unknown>) {
  const r = await fetch("/api/twa/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error ?? `Сервер ответил ${r.status}`);
  return d;
}

const rowStyle = {
  display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 50,
  padding: "10px 14px", boxSizing: "border-box" as const, border: "none",
  borderTop: `1px solid ${C.hairline}`, background: "transparent", color: C.textPrimary,
  font: "inherit", textAlign: "left" as const, cursor: "pointer",
};
const fieldStyle = {
  flex: 1, minWidth: 0, background: C.elevated, border: "none", borderRadius: 10,
  color: "#fff", fontSize: 16, padding: "10px 12px", outline: "none", fontFamily: "inherit",
};

/* ── Состав заказа ─────────────────────────────────────────────────────────── */
export function OrderComposition({ order, token, activeTool, onTool, onChanged }: {
  order: SettingsOrder;
  token: string;
  activeTool: GamepassToolId | null;
  /** Открыть инструмент пасса (формы живут в шторке). */
  onTool: (id: GamepassToolId) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<"nick" | "amount" | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const nick = order.robloxUsername ?? order.probableNick ?? null;
  const parts = [...(order.splitGamepasses ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const passId = parseGamepassRef(order.gamepassUrl ?? null);
  const editable = canOrderAction(order, "edit");
  const amountEditable = editable && parts.length === 0 && !order.isDirectOrder && order.status !== "COMPLETED";
  const tools = gamepassToolsFor(order).map(tool => tool.id);

  function startEdit(kind: "nick" | "amount") {
    haptic.select();
    setEditing(kind);
    setValue(kind === "nick" ? (order.robloxUsername ?? order.probableNick ?? "") : String(order.amount));
  }

  async function save() {
    if (!editing || busy) return;
    const payload = editing === "nick"
      ? { robloxUsername: value.trim() }
      : { amount: Number(value.replace(/\s/g, "")) };
    setBusy(true);
    try {
      await post(token, { action: "edit-order", orderId: order.id, ...payload });
      haptic.notify("success");
      toast(editing === "nick" ? "Ник сохранён" : "Номинал сохранён", "success");
      setEditing(null);
      onChanged();
    } catch (err) {
      haptic.notify("error");
      toast(err instanceof Error ? err.message : "Не сохранилось", "error");
    } finally { setBusy(false); }
  }

  const editor = (
    <div style={{ display: "flex", gap: 8, padding: "8px 14px 12px" }}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(null); }}
        inputMode={editing === "amount" ? "numeric" : "text"}
        autoComplete="off"
        aria-label={editing === "nick" ? "Ник Roblox" : "Номинал, R$"}
        style={fieldStyle}
      />
      <button type="button" className="twa-press" onClick={() => void save()} disabled={busy}
        style={{ padding: "0 14px", borderRadius: 10, border: "none", background: C.accent, color: "#120f1c", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
        {busy ? "…" : "Сохранить"}
      </button>
    </div>
  );

  const toolBtn = (id: GamepassToolId, label: string) => (
    <button key={id} type="button" className="twa-press-sm" onClick={() => { haptic.select(); onTool(id); }}
      style={{
        flex: 1, minHeight: 44, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
        border: `1px solid ${activeTool === id ? C.accent : C.hairline}`,
        background: activeTool === id ? `${C.accent}1f` : C.elevated,
        color: C.textPrimary, fontSize: 14, fontWeight: 650,
      }}>{label}</button>
  );

  return (
    <div style={{ margin: "0 14px 10px", borderRadius: 14, background: C.card, overflow: "hidden" }}>
      <button type="button" className="twa-press-sm" style={{ ...rowStyle, borderTop: "none" }}
        disabled={!editable} onClick={() => editable && startEdit("nick")}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Ник Roblox</span>
        <span style={{ fontSize: 15, color: nick ? C.textPrimary : C.textTertiary }}>{nick ?? "не указан"}</span>
        {editable && <span aria-hidden="true" style={{ color: C.textTertiary, fontSize: 18 }}>›</span>}
      </button>
      {editing === "nick" && editor}

      <button type="button" className="twa-press-sm" style={rowStyle}
        disabled={!amountEditable} onClick={() => amountEditable && startEdit("amount")}>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Номинал</span>
          <span style={{ fontSize: 14, color: C.textTertiary }}>{Math.ceil(order.amount / 0.7).toLocaleString("ru-RU")} грязными</span>
        </span>
        <span style={{ fontSize: 15 }}>{order.amount.toLocaleString("ru-RU")} R$</span>
        {amountEditable && <span aria-hidden="true" style={{ color: C.textTertiary, fontSize: 18 }}>›</span>}
      </button>
      {editing === "amount" && editor}

      {parts.length > 0 ? parts.map((part, index) => (
        <div key={`${part.gamepassId}-${index}`} style={{ ...rowStyle, cursor: "default" }}>
          <span style={{ flex: "none", width: 24, height: 24, borderRadius: 7, background: C.elevated, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: C.textSecondary }}>{index + 1}</span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 15 }}>{part.gamepassId}</span>
          {part.purchasedAt && <span style={{ color: C.green, fontWeight: 700 }} aria-label="выкуплена">✓</span>}
          <b style={{ fontSize: 15 }}>{part.amount.toLocaleString("ru-RU")}</b>
        </div>
      )) : (
        <div style={{ ...rowStyle, cursor: "default" }}>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>Пасс</span>
          <span style={{ fontFamily: passId ? MONO : "inherit", fontSize: 15, color: passId ? C.textPrimary : C.textTertiary }}>{passId ?? "пока нет"}</span>
        </div>
      )}

      {tools.some(id => id !== "ask") && (
        <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px", borderTop: `1px solid ${C.hairline}` }}>
          {tools.includes("link") && toolBtn("link", "+ Пасс")}
          {tools.includes("nick") && toolBtn("nick", "По нику")}
          {tools.includes("key") && toolBtn("key", "Ключом")}
          {tools.includes("split") && toolBtn("split", parts.length > 0 ? "Части" : "Разбить")}
        </div>
      )}
    </div>
  );
}

/* ── Где заказ ─────────────────────────────────────────────────────────────── */
const REASON_CHIPS: Record<OrderPlace, string[]> = {
  ERROR: ["не та цена", "пасс снят", "донор пуст", "AlreadyOwned"],
  REJECTED: ["дубль заказа", "деньги вернули", "по просьбе покупателя"],
  BUYOUT: ["пасс поправили", "цену поправили"],
  AWAITING: ["нужен новый пасс", "пасс не тот"],
};

export function OrderPlaceBlock({ order, token, onChanged }: {
  order: SettingsOrder;
  token: string;
  onChanged: () => void;
}) {
  const current = orderPlaceOf(order.status);
  const [target, setTarget] = useState<OrderPlace | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!current) return null;
  const held = Boolean(order.heldAt);

  async function apply() {
    if (!target || busy) return;
    const plan = placeRequests(order, target, reason);
    if ("error" in plan) { haptic.notify("error"); toast(plan.error, "error"); return; }
    setBusy(true);
    try {
      for (const request of plan.requests) await post(token, { ...request, orderId: order.id });
      haptic.notify("success");
      toast(`Перенесён: ${ORDER_PLACES.find(p => p.id === target)?.label}`, "success");
      setTarget(null);
      setReason("");
      onChanged();
    } catch (err) {
      haptic.notify("error");
      toast(err instanceof Error ? err.message : "Не перенёсся", "error");
    } finally { setBusy(false); }
  }

  const tone = (id: OrderPlace) => (id === "BUYOUT" ? C.green : id === "ERROR" ? C.orange : id === "REJECTED" ? C.red : C.yellow);

  return (
    <div style={{ margin: "0 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div role="radiogroup" aria-label="Где заказ"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 12, background: C.elevated }}>
        {ORDER_PLACES.map(place => {
          const isCurrent = place.id === current;
          const isTarget = place.id === target;
          return (
            <button key={place.id} type="button" role="radio" aria-checked={isCurrent}
              disabled={held || isCurrent || busy}
              onClick={() => { haptic.select(); setTarget(prev => (prev === place.id ? null : place.id)); setReason(""); }}
              style={{
                minHeight: 40, borderRadius: 9, border: isTarget ? `1px solid ${tone(place.id)}` : "1px solid transparent",
                background: isCurrent ? C.card : isTarget ? `${tone(place.id)}1f` : "transparent",
                color: isCurrent ? tone(place.id) : isTarget ? "#fff" : C.textSecondary,
                fontSize: 14, fontWeight: 650, fontFamily: "inherit", cursor: held || isCurrent ? "default" : "pointer",
                padding: "0 2px",
              }}>
              {place.label}
            </button>
          );
        })}
      </div>
      {held && <div style={{ fontSize: 14, color: C.textTertiary }}>Заморожен — сначала разморозить</div>}

      {target && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REASON_CHIPS[target].map(chip => (
              <button key={chip} type="button" className="twa-press-sm" onClick={() => { haptic.select(); setReason(chip); }}
                style={{
                  minHeight: 34, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${reason === chip ? tone(target) : C.hairline}`, background: C.elevated,
                  color: C.textPrimary, fontSize: 14, fontWeight: 600,
                }}>{chip}</button>
            ))}
          </div>
          <input
            value={reason}
            onChange={e => setReason(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void apply(); }}
            placeholder={target === "REJECTED" ? "Причина — её увидит покупатель" : "Причина"}
            aria-label="Причина переноса"
            autoComplete="off"
            style={{ ...fieldStyle, flex: "none", width: "100%", boxSizing: "border-box" }}
          />
          <button type="button" className="twa-press" onClick={() => void apply()} disabled={busy || !reason.trim()}
            style={{
              minHeight: 48, borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit",
              background: tone(target), color: "#16110a", fontSize: 15, fontWeight: 800,
              opacity: busy || !reason.trim() ? 0.5 : 1,
            }}>
            {busy ? "…" : `В «${ORDER_PLACES.find(p => p.id === target)?.label}»`}
          </button>
        </div>
      )}
    </div>
  );
}
