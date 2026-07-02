"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import Pressable from "../Pressable";

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ERROR";
type FilterTab = "ALL" | "BUYOUT" | "DIRECT" | "AVITO" | "NEW" | "ERROR" | "AWAITING_LINK" | "DONE" | "FAVORITES";

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
  purchaserUsername: string | null;
  orderSource: "WB" | "DIRECT" | "AVITO" | "MANUAL";
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
  AVITO:         { label: "Авито",          color: C.orange },
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
  { id: "AVITO" },
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
  if (order.orderSource === "AVITO" && ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
    return { label: "Авито", color: C.orange };
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
        fontSize: 14,
        fontWeight: 500,
        padding: "8px 14px",
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
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 0", minWidth: 0,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
          Заметка
        </span>
        {flash && <span style={{ fontSize: 14, color: C.green, fontWeight: 600 }}>✓</span>}
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
          borderRadius: 10, color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
          padding: "10px 12px", resize: "vertical", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      {dirty && (
        <button
          className="twa-press"
          onClick={e => { e.stopPropagation(); commit(); }}
          disabled={saving}
          style={{
            alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8, border: "none",
            background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600,
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
    currentTab === "AVITO" ||
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
    <div style={{ display: "flex", gap: 8, padding: "12px 16px 16px" }}>
      {hasGamepass && (
        <button className="twa-press" onClick={doPurchase} disabled={loading}
          style={{ flex: 2, padding: "14px", border: "none", borderRadius: 12, background: "rgba(48,209,88,0.14)", color: "#30d158", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "⏳…" : "Выкупить"}
        </button>
      )}
      {showError && (
        <button className="twa-press" onClick={() => doAction("set-error")} disabled={loading}
          style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: "rgba(255,149,0,0.12)", color: C.orange, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          Ошибка
        </button>
      )}
      <button className="twa-press" onClick={() => doAction("complete")} disabled={loading}
        style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: "rgba(10,132,255,0.12)", color: C.blue, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
        Выкуплено
      </button>
      <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
        style={{ width: 44, flexShrink: 0, padding: "14px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
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
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Перевести в раздел:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {MOVE_TARGETS.map(t => (
          <button key={t.id} className="twa-press-sm"
            onClick={() => setTarget(t.id)}
            style={{
              padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer",
              background: target === t.id ? `${t.color}33` : "rgba(255,255,255,0.08)",
              color: target === t.id ? t.color : C.textSecondary,
              fontSize: 14, fontWeight: 600,
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
          color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
          padding: "10px 12px", resize: "none", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !target || !note.trim()}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading || !target || !note.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Перевести"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── Edit Avito Modal ───────────── */
function EditAvitoModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(order.amount));
  const [gpInput, setGpInput] = useState(order.gamepassUrl ?? "");
  const [nick, setNick] = useState(order.robloxUsername ?? "");
  const [note, setNote] = useState(order.adminNote ?? "");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 1) { toast("Укажи сумму R$", "error"); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "edit-avito", orderId: order.id,
          amount: amt,
          gamepassUrl: gpInput.trim(),
          robloxUsername: nick.trim(),
          note: note.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast("Сохранено", "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px",
      borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.orange }}>Редактировать Авито</div>
      <input value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Сумма R$" inputMode="numeric"
        style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <input value={gpInput} onChange={e => setGpInput(e.target.value)} placeholder="ID или URL геймпасса"
        style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <input value={nick} onChange={e => setNick(e.target.value)} placeholder="Ник продавца"
        style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка"
        style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10, color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !amount.trim()}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.orange, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading || !amount.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── RebindModal ───────────── */
interface RebindUser {
  id: string;
  tgId: string | null;
  vkId: string | null;
  username: string | null;
  name: string | null;
  robloxUsername: string | null;
}

function RebindModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RebindUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RebindUser | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "search-users", query: query.trim() }),
        });
        const d = await r.json();
        if (r.ok && d.users) setResults(d.users);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, token]);

  async function submit() {
    if (!selected) return;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "rebind-order", orderId: order.id, targetUserId: selected.id, note: note.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); setLoading(false); return; }
      haptic.notify("success");
      toast("Перепривязан", "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  const currentOwner = userShortName(order.user);
  const currentPlatform = order.user.tgId ? "TG" : order.user.vkId ? "VK" : "—";

  function userLabel(u: RebindUser) {
    const platform = u.tgId ? "TG" : u.vkId ? "VK" : "—";
    const name = u.username ? `@${u.username}` : u.name || u.tgId || u.vkId || u.id.slice(-6);
    return { platform, name };
  }

  if (selected) {
    const tgt = userLabel(selected);
    return (
      <div onClick={e => e.stopPropagation()} style={{
        padding: "12px 14px 14px", borderTop: `1px solid ${C.hairline}`,
        background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Перепривязать заказ?</div>
        <div style={{
          background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 15, color: C.textPrimary }}>
            <span style={{ fontWeight: 700, fontFamily: MONO, color: C.accent }}>{order.wbCode}</span>
            <span style={{ color: C.textTertiary }}> · </span>
            <span style={{ fontWeight: 600 }}>{Math.ceil(order.amount / 0.7).toLocaleString("ru-RU")} R$</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: C.textSecondary }}>
            <span>{currentOwner} ({currentPlatform})</span>
            <span style={{ color: C.accent }}>→</span>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{tgt.name} ({tgt.platform})</span>
          </div>
          {selected.robloxUsername && (
            <div style={{ fontSize: 14, color: C.textTertiary }}>🎮 {selected.robloxUsername}</div>
          )}
        </div>
        <input
          value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (опц.)…"
          style={{
            width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="twa-press" onClick={() => setSelected(null)}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Назад
          </button>
          <button className="twa-press" onClick={submit} disabled={loading}
            style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "Перепривязать"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px", borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
        🔄 Перепривязать {order.wbCode}
      </div>
      <div style={{ fontSize: 13, color: C.textTertiary }}>
        Сейчас: {currentOwner} ({currentPlatform})
      </div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="@username, имя, ID или ник Roblox"
        autoFocus
        style={{
          width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
          color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
        }}
      />
      {searching && <div style={{ fontSize: 13, color: C.textTertiary }}>Поиск…</div>}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
          {results.map(u => {
            const lbl = userLabel(u);
            return (
              <button key={u.id} className="twa-press-sm" onClick={() => { haptic.impact("light"); setSelected(u); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: "rgba(255,255,255,0.06)", textAlign: "left",
                }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, color: "#fff",
                  background: lbl.platform === "TG" ? "#229ED9" : lbl.platform === "VK" ? "#0077FF" : C.elevated,
                  borderRadius: 4, padding: "3px 6px", flexShrink: 0,
                }}>{lbl.platform}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lbl.name}
                  </div>
                  {u.robloxUsername && (
                    <div style={{ fontSize: 13, color: C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      🎮 {u.robloxUsername}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <div style={{ fontSize: 13, color: C.textTertiary }}>Никого не найдено</div>
      )}
      <button className="twa-press" onClick={onClose}
        style={{ padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
        Отмена
      </button>
    </div>
  );
}

/* ───────────── DONE tab: accordion grouped by purchaserUsername ───────────── */
type SourceFilter = "ALL" | "WB" | "DIRECT" | "AVITO" | "MANUAL";
const SOURCE_CHIPS: { id: SourceFilter; label: string; color: string }[] = [
  { id: "ALL",    label: "Все",     color: C.textPrimary },
  { id: "WB",     label: "WB",      color: C.green },
  { id: "DIRECT", label: "Прямой",  color: C.blue },
  { id: "AVITO",  label: "Авито",   color: C.orange },
  { id: "MANUAL", label: "Ручные",  color: C.textTertiary },
];

const SOURCE_BADGE_META: Record<string, { label: string; color: string }> = {
  WB:     { label: "WB",     color: C.green },
  DIRECT: { label: "Прямой", color: C.blue },
  AVITO:  { label: "Авито",  color: C.orange },
  MANUAL: { label: "Ручной", color: C.textTertiary },
};

interface DoneGroup {
  purchaser: string;
  orders: Order[];
  totalDirty: number;
  latestDate: string;
}

function buildDoneGroups(orders: Order[], sourceFilter: SourceFilter): DoneGroup[] {
  const filtered = sourceFilter === "ALL" ? orders : orders.filter(o => o.orderSource === sourceFilter);
  const map = new Map<string, Order[]>();
  for (const o of filtered) {
    const key = o.purchaserUsername ?? "Ручные";
    const arr = map.get(key);
    if (arr) arr.push(o); else map.set(key, [o]);
  }
  const groups: DoneGroup[] = [];
  for (const [purchaser, ords] of map) {
    ords.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    groups.push({
      purchaser,
      orders: ords,
      totalDirty: ords.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0),
      latestDate: ords[0].updatedAt,
    });
  }
  groups.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return groups;
}

function countBySource(orders: Order[]): Record<SourceFilter, number> {
  const c: Record<string, number> = { ALL: orders.length, WB: 0, DIRECT: 0, AVITO: 0, MANUAL: 0 };
  for (const o of orders) c[o.orderSource] = (c[o.orderSource] ?? 0) + 1;
  return c as Record<SourceFilter, number>;
}

function pluralPurchases(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} покупка`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} покупки`;
  return `${n} покупок`;
}

function fmtTxDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function extractGpId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

function DoneAccordion({ group, token, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onMoved, exiting }: {
  group: DoneGroup;
  token: string;
  onRunAction: (order: Order, action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (orderId: string, note: string) => Promise<ActionResult>;
  onPurchaseDone: (order: Order) => void;
  onToggleFavorite: (order: Order) => void;
  onMoved: (order: Order) => void;
  exiting: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(v => !v); }}
        style={{
          width: "100%", padding: "14px 16px", border: "none", background: "transparent",
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          textAlign: "left", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600, color: "#e5e5ea", flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          🎮 {group.purchaser}
        </span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.orange, ...tabular }}>
            − {group.totalDirty.toLocaleString("ru-RU")} R$
          </span>
          <span style={{ fontSize: 13, color: C.textTertiary }}>
            {pluralPurchases(group.orders.length)}
          </span>
        </div>
        <span style={{
          fontSize: 13, color: C.textTertiary, flexShrink: 0,
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.2s",
        }}>▶</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 10px 10px" }}>
          <div style={{ height: 1, background: C.border }} />
          {group.orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              token={token}
              currentTab={"DONE" as FilterTab}
              exiting={exiting.has(order.id)}
              onRunAction={(action, reason) => onRunAction(order, action, reason)}
              onSaveNote={(note) => onSaveNote(order.id, note)}
              onPurchaseDone={() => { onPurchaseDone(order); }}
              onToggleFavorite={() => { onToggleFavorite(order); }}
              onMoved={() => { onMoved(order); }}
            />
          ))}
        </div>
      )}
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
  const [editAvitoOpen, setEditAvitoOpen] = useState(false);
  const [rebindOpen, setRebindOpen] = useState(false);

  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const shortName = userShortName(order.user);
  const passId = extractGamepassId(order.gamepassUrl);

  const showDirty = currentTab === "BUYOUT" || currentTab === "DIRECT" || currentTab === "AVITO" || currentTab === "ERROR";
  const dirtyAmount = Math.ceil(order.amount / 0.7);
  const displayAmount = showDirty ? dirtyAmount : order.amount;
  const showCleanHint = currentTab === "BUYOUT";

  const tabBadge = currentTab === "ALL" ? orderTabBadge(order) : null;
  const showMoveBtn = currentTab === "AWAITING_LINK" || currentTab === "FAVORITES";
  const isEditableAvito = currentTab === "AVITO" && order.orderSource === "AVITO" && ["PENDING", "AWAITING_GAMEPASS", "ERROR"].includes(order.status);

  const timeRef = order.createdAt;

  return (
    <article className={exiting ? "twa-card-exit" : undefined} style={{
      background: C.card,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      position: "relative",
    }}>
      {/* Header: platform badge + nick + star */}
      <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{
              fontSize: 12, fontWeight: 800, color: "#fff",
              background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
              borderRadius: 5, padding: "4px 8px", flexShrink: 0,
            }}>
              {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
            </span>
            <span
              onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(order.user); }}
              style={{
                fontSize: 17, fontWeight: 600, color: "#7ec5ff", cursor: "pointer",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {shortName}
            </span>
            {tabBadge && (
              <span style={{
                fontSize: 12, fontWeight: 600, color: tabBadge.color,
                background: `${tabBadge.color}1c`, padding: "4px 9px",
                borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
              }}>
                {tabBadge.label}
              </span>
            )}
            {order.orderSource && order.orderSource !== "WB" && (() => {
              const sb = SOURCE_BADGE_META[order.orderSource];
              if (!sb) return null;
              return (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: sb.color,
                  background: `${sb.color}1c`, padding: "3px 8px",
                  borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
                }}>
                  {sb.label}
                </span>
              );
            })()}
          </div>
          <button
            className="twa-press-sm"
            onClick={e => { e.stopPropagation(); haptic.impact("light"); onToggleFavorite(); }}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 22, padding: "4px 6px", flexShrink: 0,
              opacity: order.isFavorite ? 1 : 0.35,
            }}
          >
            {order.isFavorite ? "★" : "☆"}
          </button>
        </div>

        {/* Time + amount row */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: ageColor(timeRef), ...tabular }}>
            ⏱ {fmtAge(timeRef)}
          </span>
          <span style={{ fontSize: 14, color: C.textTertiary }}>—</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, ...tabular }}>
            {displayAmount.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
          {showCleanHint && (
            <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>
              ({order.amount.toLocaleString("ru-RU")})
            </span>
          )}
        </div>
      </div>

      {/* Data rows */}
      <div style={{ padding: "6px 16px 12px" }}>
        {order.robloxUsername && (
          <DataRow icon="🎮" copyText={order.robloxUsername}>
            <span style={{ fontWeight: 600 }}>{order.robloxUsername}</span>
          </DataRow>
        )}
        {order.gamepassUrl && (
          <DataRow icon="🔗" copyText={order.gamepassUrl}>
            <span style={{ color: C.blue }}>{order.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</span>
          </DataRow>
        )}
        {!order.isDirectOrder && (
          <DataRow icon="📦" copyText={order.wbCode}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 16 }}>
              {order.wbCode}
            </span>
          </DataRow>
        )}

        {/* Notes */}
        <div style={{ marginTop: 8 }}>
          <NotesEditor order={order} onSave={onSaveNote} />
        </div>
      </div>

      {/* Rejection reason for ALL tab */}
      {currentTab === "ALL" && order.status === "REJECTED" && order.rejectionReason && (
        <div style={{
          margin: "0 14px 10px", padding: "6px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
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
              width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.accent}44`,
              background: "transparent", color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer",
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

      {/* Edit Avito button */}
      {isEditableAvito && !editAvitoOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setEditAvitoOpen(true); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.orange}44`,
              background: "transparent", color: C.orange, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            ✏️ Редактировать
          </button>
        </div>
      )}

      {editAvitoOpen && (
        <EditAvitoModal
          order={order}
          token={token}
          onDone={() => { setEditAvitoOpen(false); onMoved(); }}
          onClose={() => setEditAvitoOpen(false)}
        />
      )}

      {/* Rebind button */}
      {["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"].includes(order.status) && !rebindOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setRebindOpen(true); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.textTertiary}44`,
              background: "transparent", color: C.textSecondary, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            🔄 Перепривязать
          </button>
        </div>
      )}

      {rebindOpen && (
        <RebindModal
          order={order}
          token={token}
          onDone={() => { setRebindOpen(false); onMoved(); }}
          onClose={() => setRebindOpen(false)}
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
      borderRadius: 12, padding: "10px 14px",
    }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
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
          color: C.textPrimary, fontSize: 16, flex: 1, minWidth: 0,
          padding: 0, fontFamily: "inherit",
        }}
      />
      {local && (
        <button
          className="twa-press-sm"
          onClick={() => { haptic.impact("light"); setLocal(""); onChange(""); }}
          style={{
            background: "rgba(255,255,255,0.18)", border: "none",
            width: 22, height: 22, borderRadius: 11,
            color: C.bg, fontSize: 12, fontWeight: 700,
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
  const [doneSourceFilter, setDoneSourceFilter] = useState<SourceFilter>("ALL");
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
            const isUrgent = ["BUYOUT", "DIRECT", "AVITO", "ERROR"].includes(f.id) && count > 0;
            return (
              <button
                key={f.id}
                className="twa-press-sm"
                onClick={() => { if (f.id !== filter) haptic.select(); setFilter(f.id); }}
                style={{
                  flexShrink: 0, padding: "9px 16px", borderRadius: 999,
                  border: "none",
                  background: isActive ? C.accent : "rgba(118,118,128,0.22)",
                  color: isActive ? "#fff" : C.textPrimary,
                  fontSize: 15, fontWeight: isActive ? 600 : 500,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  letterSpacing: 0.1,
                }}
              >
                {meta.label}
                {count > 0 && (
                  <span style={{
                    background: isActive ? "rgba(255,255,255,0.28)" : isUrgent ? C.red : "rgba(255,255,255,0.18)",
                    color: "#fff", fontSize: 12, fontWeight: 700,
                    padding: "3px 8px", borderRadius: 999, minWidth: 20, textAlign: "center",
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
          <div className="twa-fade-in" style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
              <span style={{ fontSize: 14, color: C.textSecondary, letterSpacing: 0.1 }}>{summaryText}</span>
            </div>

            {filter === "DONE" ? (
              <>
                {/* Source filter chips */}
                {(() => {
                  const sc = countBySource(allOrders);
                  const hasMultiple = (Object.keys(sc) as SourceFilter[]).filter(k => k !== "ALL" && sc[k] > 0).length > 1;
                  if (!hasMultiple) return null;
                  return (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      {SOURCE_CHIPS.map(chip => {
                        const cnt = sc[chip.id];
                        if (chip.id !== "ALL" && cnt === 0) return null;
                        const isActive = doneSourceFilter === chip.id;
                        return (
                          <button
                            key={chip.id}
                            className="twa-press-sm"
                            onClick={() => { haptic.select(); setDoneSourceFilter(chip.id); }}
                            style={{
                              padding: "7px 14px", border: "none", borderRadius: 999, cursor: "pointer",
                              fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                              display: "flex", alignItems: "center", gap: 6,
                              background: isActive ? chip.color : C.elevated,
                              color: isActive ? "#fff" : chip.color,
                              opacity: isActive ? 1 : 0.7,
                              transition: "all 0.15s",
                            }}
                          >
                            {chip.label}
                            {cnt > 0 && (
                              <span style={{
                                fontSize: 12, fontWeight: 700,
                                background: isActive ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)",
                                color: "#fff", padding: "2px 7px", borderRadius: 999,
                                ...tabular,
                              }}>{cnt}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                {buildDoneGroups(allOrders, doneSourceFilter).map(g => (
                  <DoneAccordion
                    key={g.purchaser}
                    group={g}
                    token={token}
                    onRunAction={runAction}
                    onSaveNote={saveNote}
                    onPurchaseDone={handlePurchaseDone}
                    onToggleFavorite={toggleFavorite}
                    onMoved={handleMoved}
                    exiting={exiting}
                  />
                ))}
              </>

            ) : (
              allOrders.map(order => (
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
              ))
            )}

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
                    fontSize: 15, fontWeight: 500, padding: "14px",
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
              padding: "12px 14px",
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
              fontSize: 12, fontWeight: 600, color: g.color,
              letterSpacing: 0.3, textTransform: "uppercase",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              position: "relative",
            }}>
              {g.label}
            </div>
            <div style={{
              fontSize: 20, fontWeight: 700, color: C.textPrimary,
              letterSpacing: -0.5, ...tabular, lineHeight: 1.1,
              position: "relative",
            }}>
              {fmtRobux(primary)}
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textSecondary, marginLeft: 2 }}>R$</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.textTertiary, marginLeft: 4 }}>
                ({fmtRobux(secondary)})
              </span>
            </div>
            <div style={{
              fontSize: 13, color: C.textTertiary, ...tabular,
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
        <div style={{ fontSize: 16, marginBottom: 4 }}>Ничего не нашлось</div>
        <div style={{ fontSize: 14, color: C.textTertiary }}>
          Попробуй ник Roblox, @username, WB-код или ID
        </div>
      </div>
    );
  }
  const labels: Record<FilterTab, string> = {
    ALL: "Заказов пока нет",
    BUYOUT: "Нет заказов к выкупу",
    DIRECT: "Нет прямых заказов",
    AVITO: "Нет заказов Авито",
    NEW: "Нет новых заказов",
    ERROR: "Нет ошибок",
    AWAITING_LINK: "Все оформили заказы",
    DONE: "Нет выкупленных заказов",
    FAVORITES: "Нет избранных",
  };
  return (
    <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
      <div style={{ fontSize: 16 }}>{labels[filter]}</div>
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
