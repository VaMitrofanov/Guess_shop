"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import Pressable from "../Pressable";

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ERROR";
type FilterTab = "ALL" | "BUYOUT" | "DIRECT" | "NEW" | "ERROR" | "AWAITING_LINK" | "DONE" | "FAVORITES";

interface Order {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  status: OrderStatus;
  platform: string;
  wbCode: string;
  rejectionReason: string | null;
  adminNote: string | null;
  isDirectOrder: boolean;
  isFavorite: boolean;
  paymentDetails: string | null;
  purchaseRate: number | null;
  createdAt: string;
  updatedAt: string;
  pendingAt: string | null;
  takenAt: string | null;
  robloxUsername: string | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  user: {
    tgId: string | null;
    vkId: string | null;
    name: string | null;
    username: string | null;
    balance: number | null;
    reviewBonusGrantedAt: string | null;
  };
}

interface OrdersData {
  orders: Order[];
  total: number;
  counts: Record<string, number>;
  sums?: Record<string, number> | null;
  page: number;
  pages: number;
}

interface EnrichValue {
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
}

const TAB_META: Record<FilterTab, { label: string; color: string }> = {
  ALL:           { label: "Все",            color: C.textPrimary },
  BUYOUT:        { label: "К выкупу",       color: C.green },
  DIRECT:        { label: "Прямой",         color: C.blue },
  NEW:           { label: "Новые",          color: C.accent },
  ERROR:         { label: "Ошибка",         color: C.red },
  AWAITING_LINK: { label: "Ждут ссылку",    color: C.yellow },
  DONE:          { label: "Готово",          color: C.green },
  FAVORITES:     { label: "Избранное",      color: "#ffd60a" },
};

const FILTERS: { id: FilterTab }[] = [
  { id: "ALL" },
  { id: "BUYOUT" },
  { id: "DIRECT" },
  { id: "NEW" },
  { id: "ERROR" },
  { id: "AWAITING_LINK" },
  { id: "DONE" },
  { id: "FAVORITES" },
];

function orderTabBadge(order: Order): { label: string; color: string } | null {
  const cutoff = Date.now() - 40 * 3600_000;
  const created = new Date(order.createdAt).getTime();

  if (order.isFavorite) return { label: "Избранное", color: "#ffd60a" };
  if (order.status === "COMPLETED") return { label: "Готово", color: C.green };
  if (order.status === "REJECTED") return { label: "Отменено", color: C.red };
  if (order.status === "ERROR") return { label: "Ошибка", color: C.red };
  if (order.isDirectOrder && ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status))
    return { label: "Прямой", color: C.blue };
  if (order.status === "AWAITING_GAMEPASS" && created > cutoff) return { label: "Новые", color: C.accent };
  if (order.status === "AWAITING_GAMEPASS" && created <= cutoff) return { label: "Ждут ссылку", color: C.yellow };
  if (["PENDING", "IN_PROGRESS"].includes(order.status)) return { label: "К выкупу", color: C.green };
  return null;
}

/* ───────────── Time formatting ───────────── */
function fmtAge(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return "< 1 мин";
  if (mins < 60) return `${Math.round(mins)} мин`;
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d === 0) return `${h}ч`;
  const rem = h % 24;
  return rem > 0 ? `${d}д ${rem}ч` : `${d}д`;
}
function ageColor(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 120) return C.green;
  if (mins < 720) return C.yellow;
  if (mins < 1440) return C.orange;
  return C.red;
}

function fallbackCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "-9999px";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(el);
}

function copyText(text: string) {
  if (typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
    fallbackCopy(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="twa-press-sm"
      onClick={e => {
        e.stopPropagation();
        copyText(text);
        haptic.impact("light");
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
        if (label) toast(`${label} скопирован`, "success");
      }}
      style={{
        background: copied ? `${C.green}26` : "transparent",
        border: "none",
        borderRadius: 8,
        color: copied ? C.green : C.textSecondary,
        fontSize: 12.5,
        fontWeight: 500,
        padding: "6px 11px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {copied ? "✓" : "Скопировать"}
    </button>
  );
}

/* ───────────── Contact ───────────── */
function openContact(user: Order["user"]) {
  const tg = (typeof window !== "undefined" ? window.Telegram?.WebApp : undefined) as any;
  if (user.username) {
    const url = `https://t.me/${user.username}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
    return;
  }
  if (user.tgId) {
    const deepLink = `tg://user?id=${user.tgId}`;
    try { tg?.openLink?.(deepLink); } catch {}
    try { window.location.href = deepLink; } catch {}
    copyText(String(user.tgId));
    toast(`ID ${user.tgId} скопирован`, "success");
    return;
  }
  if (user.vkId) {
    const url = `https://vk.com/im?sel=${user.vkId}`;
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  }
}

function userShortName(u: Order["user"]): string {
  if (u.username) return `@${u.username}`;
  const realName = u.name && u.name !== "VK User" ? u.name : null;
  if (realName) {
    const parts = realName.split(" ");
    return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  }
  if (u.tgId) return `TG ${u.tgId}`;
  if (u.vkId) return `VK ${u.vkId}`;
  return "—";
}

function extractGamepassId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

type ActionResult = { ok: boolean; error?: string };

/* ───────────── DataRow ───────────── */
function DataRow({ icon, children, copyText: ct }: {
  icon: string; children: React.ReactNode; copyText?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 0", minWidth: 0,
    }}>
      <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </div>
      {ct && <CopyBtn text={ct} />}
    </div>
  );
}

/* ───────────── NotesEditor ───────────── */
function NotesEditor({ order, onSave }: { order: Order; onSave: (note: string) => Promise<ActionResult> }) {
  const [note, setNote] = useState(order.adminNote ?? "");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastSaved = useRef(order.adminNote ?? "");
  useEffect(() => {
    if ((order.adminNote ?? "") !== lastSaved.current) {
      lastSaved.current = order.adminNote ?? "";
      setNote(order.adminNote ?? "");
    }
  }, [order.adminNote]);

  const dirty = note.trim() !== lastSaved.current.trim();

  async function commit() {
    if (!dirty || saving) return;
    setSaving(true);
    const res = await onSave(note.trim());
    setSaving(false);
    if (res.ok) {
      lastSaved.current = note.trim();
      haptic.notify("success");
      setFlash(true); setTimeout(() => setFlash(false), 1600);
    }
  }

  const hasNote = !!(order.adminNote && order.adminNote.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.textSecondary }}>
          Заметка
        </span>
        {flash && <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>✓</span>}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        placeholder="Заметка…"
        rows={2}
        style={{
          background: hasNote ? `${C.yellow}14` : "rgba(255,255,255,0.06)",
          border: hasNote ? `1px solid ${C.yellow}40` : "1px solid transparent",
          borderRadius: 10, color: C.textPrimary, fontSize: 13, lineHeight: 1.35,
          padding: "8px 10px", resize: "vertical", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      {dirty && (
        <button
          className="twa-press"
          onClick={e => { e.stopPropagation(); commit(); }}
          disabled={saving}
          style={{
            alignSelf: "flex-start", padding: "6px 14px", borderRadius: 8, border: "none",
            background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600,
            cursor: "pointer", opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "Сохранить"}
        </button>
      )}
    </div>
  );
}

/* ───────────── ActionPanel per tab ───────────── */
function ActionPanel({
  order, currentTab, token, onRunAction, onPurchaseDone,
}: {
  order: Order;
  currentTab: FilterTab;
  token: string;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onPurchaseDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  const showPanel =
    currentTab === "BUYOUT" ||
    currentTab === "DIRECT" ||
    currentTab === "ERROR";

  if (!showPanel) return null;

  async function doAction(action: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    const res = await onRunAction(action);
    setLoading(false);
    busyRef.current = false;
  }

  async function doPurchase() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "purchase", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      if (d.success) {
        haptic.notify("success");
        toast(`✅ ${d.msg}`, "success");
        onPurchaseDone?.();
      } else {
        haptic.notify("error");
        toast(`❌ ${d.msg}`, "error");
      }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { busyRef.current = false; setLoading(false); }
  }

  const showError = currentTab !== "ERROR";
  const hasGamepass = !!order.gamepassUrl;

  return (
    <div style={{ display: "flex", gap: 6, padding: "10px 14px 12px" }}>
      {hasGamepass && (
        <button className="twa-press" onClick={doPurchase} disabled={loading}
          style={{ flex: 2, padding: "10px", border: "none", borderRadius: 10, background: "rgba(48,209,88,0.14)", color: "#30d158", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "⏳…" : "Выкупить"}
        </button>
      )}
      {showError && (
        <button className="twa-press" onClick={() => doAction("set-error")} disabled={loading}
          style={{ flex: 1, padding: "10px", border: "none", borderRadius: 10, background: "rgba(255,149,0,0.12)", color: C.orange, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          Ошибка
        </button>
      )}
      <button className="twa-press" onClick={() => doAction("complete")} disabled={loading}
        style={{ flex: 1, padding: "10px", border: "none", borderRadius: 10, background: "rgba(10,132,255,0.12)", color: C.blue, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
        Выкуплено
      </button>
      <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
        style={{ width: 38, flexShrink: 0, padding: "10px 0", border: `1px solid ${C.red}55`, borderRadius: 10, background: "transparent", color: C.red, fontSize: 16, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
        ✕
      </button>
    </div>
  );
}

/* ───────────── MoveToModal ───────────── */
const MOVE_TARGETS: { id: string; label: string; color: string }[] = [
  { id: "BUYOUT", label: "К выкупу", color: C.green },
  { id: "DIRECT", label: "Прямой выкуп", color: C.blue },
  { id: "NEW", label: "Новые", color: C.accent },
  { id: "ERROR", label: "Ошибка", color: C.red },
  { id: "AWAITING_LINK", label: "Ждут ссылку", color: C.yellow },
];

function MoveToModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!target || !note.trim()) {
      toast("Выберите раздел и напишите заметку", "error");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "move-to", orderId: order.id, target, note: note.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast("Перенесено", "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px",
      borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Перевести в раздел:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {MOVE_TARGETS.map(t => (
          <button key={t.id} className="twa-press-sm"
            onClick={() => setTarget(t.id)}
            style={{
              padding: "6px 12px", borderRadius: 999, border: "none", cursor: "pointer",
              background: target === t.id ? `${t.color}33` : "rgba(255,255,255,0.08)",
              color: target === t.id ? t.color : C.textSecondary,
              fontSize: 12, fontWeight: 600,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="Заметка (обязательно)…"
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        style={{
          background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
          color: C.textPrimary, fontSize: 13, lineHeight: 1.35,
          padding: "8px 10px", resize: "none", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !target || !note.trim()}
          style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading || !target || !note.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Перевести"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── OrderCard — compact layout ───────────── */
function OrderCard({
  order, token, currentTab, exiting, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onMoved,
}: {
  order: Order;
  token: string;
  currentTab: FilterTab;
  exiting: boolean;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (note: string) => Promise<ActionResult>;
  onPurchaseDone?: () => void;
  onToggleFavorite: () => void;
  onMoved: () => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);

  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const shortName = userShortName(order.user);
  const passId = extractGamepassId(order.gamepassUrl);

  const showDirty = currentTab === "BUYOUT" || currentTab === "DIRECT" || currentTab === "ERROR";
  const displayAmount = showDirty ? Math.ceil(order.amount / 0.7) : order.amount;

  const tabBadge = currentTab === "ALL" ? orderTabBadge(order) : null;
  const showMoveBtn = currentTab === "AWAITING_LINK" || currentTab === "FAVORITES";

  const timeRef = (() => {
    if (currentTab === "BUYOUT" || currentTab === "DIRECT") return order.pendingAt ?? order.createdAt;
    return order.createdAt;
  })();

  return (
    <article className={exiting ? "twa-card-exit" : undefined} style={{
      background: C.card,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      position: "relative",
    }}>
      {/* Header: platform badge + nick + star */}
      <div style={{ padding: "12px 14px 0", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, color: "#fff",
              background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
              borderRadius: 4, padding: "2px 5px", flexShrink: 0,
            }}>
              {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
            </span>
            <span
              onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(order.user); }}
              style={{
                fontSize: 14, fontWeight: 600, color: "#7ec5ff", cursor: "pointer",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {shortName}
            </span>
            {tabBadge && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: tabBadge.color,
                background: `${tabBadge.color}1c`, padding: "2px 7px",
                borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
              }}>
                {tabBadge.label}
              </span>
            )}
          </div>
          <button
            className="twa-press-sm"
            onClick={e => { e.stopPropagation(); haptic.impact("light"); onToggleFavorite(); }}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 18, padding: "2px 4px", flexShrink: 0,
              opacity: order.isFavorite ? 1 : 0.35,
            }}
          >
            {order.isFavorite ? "★" : "☆"}
          </button>
        </div>

        {/* Time + amount row */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: ageColor(timeRef), ...tabular }}>
            ⏱ {fmtAge(timeRef)}
          </span>
          <span style={{ fontSize: 11, color: C.textTertiary }}>—</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, ...tabular }}>
            {displayAmount.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.accent }}>R$</span>
        </div>
      </div>

      {/* Data rows */}
      <div style={{ padding: "4px 14px 10px" }}>
        {order.robloxUsername && (
          <DataRow icon="🎮" copyText={order.robloxUsername}>
            <span style={{ fontWeight: 600 }}>{order.robloxUsername}</span>
          </DataRow>
        )}
        {order.gamepassUrl && (
          <DataRow icon="🔗" copyText={order.gamepassUrl}>
            <span style={{ color: C.blue, fontSize: 13 }}>{order.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</span>
          </DataRow>
        )}
        {!order.isDirectOrder && (
          <DataRow icon="📦" copyText={order.wbCode}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 14 }}>
              {order.wbCode}
            </span>
          </DataRow>
        )}

        {/* Notes */}
        <div style={{ marginTop: 6 }}>
          <NotesEditor order={order} onSave={onSaveNote} />
        </div>
      </div>

      {/* Rejection reason for ALL tab */}
      {currentTab === "ALL" && order.status === "REJECTED" && order.rejectionReason && (
        <div style={{
          margin: "0 14px 10px", padding: "6px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 12, color: C.red,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {order.rejectionReason}
        </div>
      )}

      {/* Move button for AWAITING_LINK / FAVORITES */}
      {showMoveBtn && !moveOpen && (
        <div style={{ padding: "0 14px 10px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setMoveOpen(true); }}
            style={{
              width: "100%", padding: "9px", borderRadius: 10, border: `1px solid ${C.accent}44`,
              background: "transparent", color: C.accent, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>
            Перевести в другой раздел
          </button>
        </div>
      )}

      {moveOpen && (
        <MoveToModal
          order={order}
          token={token}
          onDone={() => { setMoveOpen(false); onMoved(); }}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {/* Action panel */}
      <ActionPanel
        order={order}
        currentTab={currentTab}
        token={token}
        onRunAction={onRunAction}
        onPurchaseDone={onPurchaseDone}
      />
    </article>
  );
}

/* ───────────── Search ───────────── */
function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, 250);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(118,118,128,0.24)",
      borderRadius: 11, padding: "8px 11px",
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke={C.textSecondary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
           style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder="Ник, @username, WB-код, ссылка, ID"
        style={{
          background: "transparent", border: "none", outline: "none",
          color: C.textPrimary, fontSize: 14.5, flex: 1, minWidth: 0,
          padding: 0, fontFamily: "inherit",
        }}
      />
      {local && (
        <button
          className="twa-press-sm"
          onClick={() => { haptic.impact("light"); setLocal(""); onChange(""); }}
          style={{
            background: "rgba(255,255,255,0.18)", border: "none",
            width: 18, height: 18, borderRadius: 9,
            color: C.bg, fontSize: 11, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ───────────── Counts helpers ───────────── */
function shiftCounts(counts: Record<string, number>, fromTab: string, toTab: string): Record<string, number> {
  const next = { ...counts };
  if (fromTab in next) next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - 1);
  if (toTab in next) next[toTab] = (next[toTab] ?? 0) + 1;
  return next;
}

function shiftSums(sums: Record<string, number>, fromTab: string, toTab: string, amount: number): Record<string, number> {
  const next = { ...sums };
  if (fromTab in next) next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - amount);
  if (toTab in next) next[toTab] = (next[toTab] ?? 0) + amount;
  return next;
}

function orderToTab(order: Order): FilterTab {
  const cutoff = Date.now() - 40 * 3600_000;
  const created = new Date(order.createdAt).getTime();
  if (order.isFavorite) return "FAVORITES";
  if (order.status === "COMPLETED") return "DONE";
  if (order.status === "ERROR") return "ERROR";
  if (order.status === "AWAITING_GAMEPASS") return created > cutoff ? "NEW" : "AWAITING_LINK";
  if (order.isDirectOrder && ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) return "DIRECT";
  if (["PENDING", "IN_PROGRESS"].includes(order.status)) return "BUYOUT";
  return "ALL";
}

/* ─────────────────────────────────────────────────────────────────────────────
   Main screen
   ───────────────────────────────────────────────────────────────────────── */
export default function OrdersScreen({
  token, onActionDone, initialQuery, onInitialQueryConsumed,
}: {
  token: string;
  onActionDone?: () => void;
  initialQuery?: string;
  onInitialQueryConsumed?: () => void;
}) {
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const [query, setQuery] = useState(initialQuery ?? "");
  useEffect(() => {
    if (initialQuery) onInitialQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [data, setData] = useState<OrdersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const reqIdRef = useRef(0);

  const enrichCache = useRef<Map<string, EnrichValue>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  const applyCache = useCallback((list: Order[]): Order[] =>
    list.map(o => {
      const e = enrichCache.current.get(o.id);
      return e ? { ...o, ...e } : o;
    }), []);

  const fetchOrders = useCallback(async (f: FilterTab, q: string, p: number, append = false) => {
    if (!append) setLoading(true); else setLoadingMore(true);
    const reqId = ++reqIdRef.current;
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20", status: f });
      if (q) params.set("q", q);
      if (append) params.set("skipCounts", "1");
      params.set("lite", "1");
      const res = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || reqId !== reqIdRef.current) return;
      const d: OrdersData = await res.json();
      if (reqId !== reqIdRef.current) return;
      setData(prev => append && prev ? { ...d, counts: prev.counts } : d);
      setAllOrders(prev => append ? [...prev, ...applyCache(d.orders)] : applyCache(d.orders));
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [token, applyCache]);

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    fetchOrders(filter, query, 1, false);
  }, [filter, query, fetchOrders]);

  useEffect(() => {
    const need = allOrders
      .filter(o => !enrichCache.current.has(o.id) && !requestedRef.current.has(o.id))
      .map(o => o.id)
      .slice(0, 60);
    if (need.length === 0) return;
    need.forEach(id => requestedRef.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/twa/orders/enrich?ids=${need.join(",")}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled || !d?.enrich) return;
        const map = d.enrich as Record<string, EnrichValue>;
        for (const [id, v] of Object.entries(map)) enrichCache.current.set(id, v);
        setAllOrders(prev => prev.map(o => (map[o.id] ? { ...o, ...map[o.id] } : o)));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [allOrders, token]);

  const loadMore = useCallback(() => {
    if (!data || page >= data.pages || loadingMore || loading) return;
    const next = page + 1;
    setPage(next);
    fetchOrders(filter, query, next, true);
  }, [data, page, loadingMore, loading, filter, query, fetchOrders]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && data && page < data.pages && !loadingMore && !loading) {
        loadMore();
      }
    }, { rootMargin: "320px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data, page, loadingMore, loading, loadMore]);

  const runAction = useCallback(async (order: Order, action: string, reason?: string): Promise<ActionResult> => {
    const fromTab = orderToTab(order);
    let toTab: FilterTab | null = null;
    let newStatus: OrderStatus | null = null;

    if (action === "complete") { newStatus = "COMPLETED"; toTab = "ALL"; }
    else if (action === "reject") { newStatus = "REJECTED"; toTab = "ALL"; }
    else if (action === "set-error") { newStatus = "ERROR"; toTab = "ERROR"; }
    else return { ok: false, error: "Invalid action" };

    haptic.impact(action === "complete" ? "medium" : "light");

    const leaves = filter !== "ALL" && (toTab === "ALL" || toTab !== filter);

    setAllOrders(prev => prev.map(o => o.id === order.id
      ? { ...o, status: newStatus!, rejectionReason: action === "reject" ? (reason || "не указана") : o.rejectionReason }
      : o));
    if (data?.counts && toTab) {
      setData(prev => prev ? {
        ...prev,
        counts: shiftCounts(prev.counts, fromTab, toTab!),
        sums: prev.sums ? shiftSums(prev.sums, fromTab, toTab!, order.amount) : prev.sums,
      } : prev);
    }
    if (leaves) setExiting(prev => new Set(prev).add(order.id));

    const rollback = () => {
      setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: order.status } : o));
      if (data?.counts && toTab) {
        setData(prev => prev ? {
          ...prev,
          counts: shiftCounts(prev.counts, toTab!, fromTab),
          sums: prev.sums ? shiftSums(prev.sums, toTab!, fromTab, order.amount) : prev.sums,
        } : prev);
      }
      setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
    };

    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId: order.id, ...(reason ? { reason } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { rollback(); haptic.notify("error"); return { ok: false, error: d.error ?? "Ошибка" }; }

      haptic.notify("success");
      onActionDone?.();
      if (leaves) {
        window.setTimeout(() => {
          setAllOrders(prev => prev.filter(o => o.id !== order.id));
          setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
          setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
        }, 260);
      }
      const msg = action === "complete" ? "Выкуплено ✓" : action === "set-error" ? "→ Ошибка" : "Отклонён";
      toast(msg, action === "reject" ? "default" : "success");
      return { ok: true };
    } catch {
      rollback(); haptic.notify("error");
      return { ok: false, error: "Ошибка сети" };
    }
  }, [token, filter, data, onActionDone]);

  const saveNote = useCallback(async (orderId: string, note: string): Promise<ActionResult> => {
    let prevNote: string | null = null;
    setAllOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      prevNote = o.adminNote;
      return { ...o, adminNote: note || null };
    }));
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-note", orderId, note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, adminNote: prevNote } : o));
        haptic.notify("error");
        return { ok: false, error: d.error ?? "Ошибка" };
      }
      return { ok: true };
    } catch {
      setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, adminNote: prevNote } : o));
      haptic.notify("error");
      return { ok: false, error: "Ошибка сети" };
    }
  }, [token]);

  const toggleFavorite = useCallback(async (order: Order) => {
    haptic.impact("medium");
    const wasFav = order.isFavorite;
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, isFavorite: !wasFav } : o));
    setData(prev => {
      if (!prev?.counts) return prev;
      const next = { ...prev.counts };
      if (wasFav) {
        next["FAVORITES"] = Math.max(0, (next["FAVORITES"] ?? 0) - 1);
      } else {
        next["FAVORITES"] = (next["FAVORITES"] ?? 0) + 1;
        const fromTab = orderToTab(order);
        if (fromTab !== "ALL") next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - 1);
      }
      return { ...prev, counts: next };
    });

    if (filter !== "ALL" && !wasFav) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }

    try {
      await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle-favorite", orderId: order.id }),
      });
      cachedCountsInvalidate();
    } catch {
      setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, isFavorite: wasFav } : o));
    }
  }, [token, filter]);

  function cachedCountsInvalidate() {
    // force refresh on next tab switch
  }

  const handlePurchaseDone = useCallback((order: Order) => {
    const fromTab = orderToTab(order);
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "COMPLETED" as any } : o));
    setData(prev => prev ? {
      ...prev,
      counts: shiftCounts(prev.counts, fromTab, "ALL"),
      sums: prev.sums ? shiftSums(prev.sums, fromTab, "ALL", order.amount) : prev.sums,
    } : prev);
    if (filter !== "ALL") {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }
    onActionDone?.();
  }, [filter, onActionDone]);

  const handleMoved = useCallback((order: Order) => {
    if (filter !== "ALL") {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }
    onActionDone?.();
  }, [filter, onActionDone]);

  const summaryText = useMemo(() => {
    if (!data) return "";
    if (query) return `По запросу «${query}» · ${data.total}`;
    const meta = TAB_META[filter];
    return `${meta.label} · ${data.total}`;
  }, [data, query, filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: C.bg }}>

      {/* Sticky: search + tab chips */}
      <div style={{
        padding: "10px 16px 8px",
        background: C.bg,
        borderBottom: `1px solid ${C.hairline}`,
        flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 9,
      }}>
        <SearchBar value={query} onChange={setQuery} />

        <div className="twa-no-scrollbar" style={{
          display: "flex", gap: 7,
          overflowX: "auto",
          marginRight: -16, paddingRight: 16,
          WebkitMaskImage: "linear-gradient(90deg, #000 90%, transparent)",
          maskImage: "linear-gradient(90deg, #000 90%, transparent)",
        }}>
          {FILTERS.map(f => {
            const meta = TAB_META[f.id];
            const count = data?.counts?.[f.id] ?? 0;
            const isActive = filter === f.id;
            const isUrgent = ["BUYOUT", "DIRECT", "ERROR"].includes(f.id) && count > 0;
            return (
              <button
                key={f.id}
                className="twa-press-sm"
                onClick={() => { if (f.id !== filter) haptic.select(); setFilter(f.id); }}
                style={{
                  flexShrink: 0, padding: "6.5px 13px", borderRadius: 999,
                  border: "none",
                  background: isActive ? C.accent : "rgba(118,118,128,0.22)",
                  color: isActive ? "#fff" : C.textPrimary,
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  letterSpacing: 0.1,
                }}
              >
                {meta.label}
                {count > 0 && (
                  <span style={{
                    background: isActive ? "rgba(255,255,255,0.28)" : isUrgent ? C.red : "rgba(255,255,255,0.18)",
                    color: "#fff", fontSize: 10.5, fontWeight: 700,
                    padding: "1px 6px", borderRadius: 999, minWidth: 18, textAlign: "center",
                    ...tabular,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
        {/* Mini dashboard for ALL tab */}
        {data?.sums && !query && filter === "ALL" && (
          <div style={{ paddingTop: 10 }}>
            <MiniDashboard counts={data.counts} sums={data.sums} onTap={setFilter} />
          </div>
        )}

        {loading ? (
          <Skeleton />
        ) : allOrders.length === 0 ? (
          <EmptyState filter={filter} query={query} />
        ) : (
          <div className="twa-fade-in" style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
              <span style={{ fontSize: 12, color: C.textSecondary, letterSpacing: 0.1 }}>{summaryText}</span>
            </div>

            {allOrders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                token={token}
                currentTab={filter}
                exiting={exiting.has(order.id)}
                onRunAction={(action, reason) => runAction(order, action, reason)}
                onSaveNote={(note) => saveNote(order.id, note)}
                onPurchaseDone={() => handlePurchaseDone(order)}
                onToggleFavorite={() => toggleFavorite(order)}
                onMoved={() => handleMoved(order)}
              />
            ))}

            {data && page < data.pages && (
              <div ref={sentinelRef} style={{ minHeight: 1 }}>
                <button
                  className="twa-press"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    width: "100%",
                    background: "rgba(118,118,128,0.18)", border: "none", borderRadius: 12,
                    color: loadingMore ? C.textTertiary : C.textPrimary,
                    fontSize: 14, fontWeight: 500, padding: "13px",
                    cursor: loadingMore ? "default" : "pointer",
                    marginTop: 4, opacity: loadingMore ? 0.6 : 1,
                    letterSpacing: 0.1,
                  }}
                >
                  {loadingMore ? "Загрузка…" : `Показать ещё (${Math.max(0, data.total - allOrders.length)})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── MiniDashboard ───────────── */
function fmtRobux(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ru-RU");
}

const DASHBOARD_GROUPS: { key: string; label: string; sumKey: string; filter: FilterTab; color: string; showClean: boolean }[] = [
  { key: "buyout", label: "К выкупу", sumKey: "BUYOUT", filter: "BUYOUT", color: C.green, showClean: false },
  { key: "link", label: "Ждут ссылку", sumKey: "AWAITING_LINK", filter: "AWAITING_LINK", color: C.yellow, showClean: true },
];

function MiniDashboard({ counts, sums, onTap }: {
  counts: Record<string, number>;
  sums: Record<string, number>;
  onTap: (filter: FilterTab) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "0 16px 6px" }}>
      {DASHBOARD_GROUPS.map(g => {
        const count = counts[g.filter] ?? 0;
        const dirtyRobux = sums[g.sumKey] ?? 0;
        if (count === 0) return null;

        const grossRobux = Math.ceil(dirtyRobux / 0.7);
        const primary = g.showClean ? dirtyRobux : grossRobux;
        const secondary = g.showClean ? grossRobux : dirtyRobux;

        return (
          <Pressable
            key={g.key}
            variant="press-sm"
            onClick={() => { haptic.impact("light"); onTap(g.filter); }}
            style={{
              flex: 1, minWidth: 0,
              background: C.card,
              borderRadius: 14,
              padding: "10px 12px",
              display: "flex", flexDirection: "column", gap: 3,
              boxShadow: SHADOW.card,
              position: "relative",
              overflow: "hidden",
              border: "none", cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{
              position: "absolute", inset: 0, borderRadius: 14, pointerEvents: "none",
              background: `linear-gradient(180deg, ${g.color}0d 0%, transparent 60%)`,
            }} />
            <div style={{
              fontSize: 10.5, fontWeight: 600, color: g.color,
              letterSpacing: 0.3, textTransform: "uppercase",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              position: "relative",
            }}>
              {g.label}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: C.textPrimary,
              letterSpacing: -0.5, ...tabular, lineHeight: 1.1,
              position: "relative",
            }}>
              {fmtRobux(primary)}
              <span style={{ fontSize: 11, fontWeight: 500, color: C.textSecondary, marginLeft: 2 }}>R$</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: C.textTertiary, marginLeft: 4 }}>
                ({fmtRobux(secondary)})
              </span>
            </div>
            <div style={{
              fontSize: 11, color: C.textTertiary, ...tabular,
              position: "relative",
            }}>
              {count} {count === 1 ? "заказ" : count < 5 ? "заказа" : "заказов"}
            </div>
          </Pressable>
        );
      })}
    </div>
  );
}

function EmptyState({ filter, query }: { filter: FilterTab; query: string }) {
  if (query) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
        <div style={{ fontSize: 14, marginBottom: 4 }}>Ничего не нашлось</div>
        <div style={{ fontSize: 12, color: C.textTertiary }}>
          Попробуй ник Roblox, @username, WB-код или ID
        </div>
      </div>
    );
  }
  const labels: Record<FilterTab, string> = {
    ALL: "Заказов пока нет",
    BUYOUT: "Нет заказов к выкупу",
    DIRECT: "Нет прямых заказов",
    NEW: "Нет новых заказов",
    ERROR: "Нет ошибок",
    AWAITING_LINK: "Все оформили заказы",
    DONE: "Нет выкупленных заказов",
    FAVORITES: "Нет избранных",
  };
  return (
    <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
      <div style={{ fontSize: 14 }}>{labels[filter]}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
      {[100, 100, 100, 100].map((h, i) => (
        <div key={i} style={{
          background: C.card, borderRadius: 16, height: h,
          animation: "pulse 1.5s ease-in-out infinite",
          boxShadow: SHADOW.card,
        }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
    </div>
  );
}
