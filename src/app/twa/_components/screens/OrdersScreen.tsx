"use client";
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import Pressable from "../Pressable";
import CreateManualModal, { type RebindUser } from "../CreateManualModal";

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ERROR";
// ATTENTION — не чип, а серверная выборка «Требуют внимания» для вкладки «Все».
type FilterTab = "ALL" | "BUYOUT" | "DIRECT" | "AVITO" | "NEW" | "ERROR" | "AWAITING_LINK" | "DONE" | "FAVORITES" | "ATTENTION";

// «Ждут ссылку»: сервер отдаёт первые N — самые свежие, дальше хвост от самых
// старых (см. fetchAwaitingLinkHybrid в api/twa/orders). Здесь — для разделителя.
const AWAITING_LINK_HEAD = 5;

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
  probableNick: string | null;
  gpWatchNotifiedPassId: string | null;
  /** П3: клиент ответил «❌ Не мой ник» на GP-watch-пинг — дожимать вручную. */
  gpWatchDeclinedAt: string | null;
  purchaserUsername: string | null;
  orderSource: "WB" | "DIRECT" | "AVITO" | "MANUAL";
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  /** true — сообщество не может написать VK-юзеру (VK 901); только личка менеджера. */
  vkUnreachable?: boolean | null;
  user: {
    tgId: string | null;
    vkId: string | null;
    name: string | null;
    username: string | null;
    balance: number | null;
    reviewBonusGrantedAt: string | null;
  };
}

/** Заявка прямого заказа (DirectIntent) — «⏳ Ожидаем реквизиты». */
interface Intent {
  id: string;
  amount: number;
  bonus: number;
  totalAmount: number;
  rublePrice: number;
  robloxUsername: string;
  gamepassId: string;
  gamepassUrl: string;
  platform: string;
  createdAt: string;
  prevOrders: number;
  user: Order["user"];
}

interface OrdersData {
  orders: Order[];
  total: number;
  counts: Record<string, number>;
  sums?: Record<string, number> | null;
  oldest?: Record<string, string | null> | null;
  page: number;
  pages: number;
}

interface EnrichValue {
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  vkUnreachable?: boolean | null;
}

/** Живая проверка ГП (gp-live-check): фактическая цена vs ожидаемая по номиналу. */
interface GpLiveInfo {
  expected: number;
  livePrice: number | null;
  isForSale: boolean | null;
  priceMismatch: boolean;
  reusedIn: string | null;
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
  ATTENTION:     { label: "Требуют внимания", color: C.orange },
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

  // Прямой заказ до подтверждения оплаты: выкупать/завершать нечего (сервер
  // отвергнет), оплату подтверждает скриншот в боте. Доступна только отмена.
  if (["AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px 16px" }}>
        <span style={{
          flex: 1, padding: "12px 14px", borderRadius: 12,
          background: `${C.yellow}14`, color: C.yellow, fontSize: 14, fontWeight: 600,
        }}>
          💳 {order.status === "PAYMENT_PENDING" ? "Ждём оплату — скрин придёт в бота" : "Ожидает реквизиты"}
        </span>
        <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
          style={{ width: 44, flexShrink: 0, padding: "14px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          ✕
        </button>
      </div>
    );
  }

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
// Все разделы, кроме «Все» (заказ и так виден в «Все») и текущего
// (перенаправляем ИЗ него — выбор себя бессмыслен, фильтруется по currentTab).
const MOVE_TARGETS: { id: string; label: string; color: string }[] = [
  { id: "BUYOUT", label: "К выкупу", color: C.green },
  { id: "DIRECT", label: "Прямой выкуп", color: C.blue },
  { id: "AVITO", label: "Авито", color: C.orange },
  { id: "NEW", label: "Новые", color: C.accent },
  { id: "ERROR", label: "Ошибка", color: C.red },
  { id: "AWAITING_LINK", label: "Ждут ссылку", color: C.yellow },
  { id: "DONE", label: "Готово", color: C.green },
  { id: "FAVORITES", label: "Избранное", color: "#ffd60a" },
];

function MoveToModal({ order, token, currentTab, onDone, onClose }: {
  order: Order; token: string; currentTab: FilterTab; onDone: () => void; onClose: () => void;
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
        {MOVE_TARGETS.filter(t => t.id !== currentTab).map(t => (
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
// RebindUser — общий тип, живёт в CreateManualModal (модалка тоже ищет клиентов).
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
        else toast(d.error ?? "Ошибка поиска", "error");
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
      // Честный статус доставки — как у 📎-привязки (VK 901 теряется молча).
      if (d.notified) toast(`Перепривязан · клиент уведомлён (${String(d.notified).toUpperCase()})`, "success");
      else toast("Перепривязан, но уведомление клиенту НЕ доставлено", "error");
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
  order, token, currentTab, exiting, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onMoved, live,
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
  /** Прайс-гард (Ш4): живая цена ГП — бейдж расхождения с номиналом. */
  live?: GpLiveInfo;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [editAvitoOpen, setEditAvitoOpen] = useState(false);
  const [rebindOpen, setRebindOpen] = useState(false);
  // GP-watch: локально трекаем «клиент оповещён об этом ГП» — сервер после
  // «Оповестить» отдаёт свежий passId, перезагрузка вкладки не нужна.
  const [gpwPassId, setGpwPassId] = useState<string | null>(order.gpWatchNotifiedPassId);
  const [gpwLoading, setGpwLoading] = useState(false);

  async function gpwNotify() {
    if (gpwLoading) return;
    setGpwLoading(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "gpwatch-notify", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      if (d.notified) {
        haptic.notify("success");
        setGpwPassId(String(d.pass.gamepassId));
        toast(`Клиент оповещён (${String(d.notified).toUpperCase()}): «${d.pass.name}» · ${d.pass.price} R$`, "success");
      } else {
        toast(`ГП найден («${d.pass.name}» · ${d.pass.price} R$), но пинг НЕ доставлен`, "error");
      }
    } catch { toast("Ошибка сети", "error"); }
    finally { setGpwLoading(false); }
  }

  const showGpWatch = order.status === "AWAITING_GAMEPASS" && !!order.probableNick && !order.robloxUsername;

  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const shortName = userShortName(order.user);
  const passId = extractGamepassId(order.gamepassUrl);

  // В «Требуют внимания» карточка ведёт себя как в родной вкладке заказа:
  // те же кнопки действий и формат суммы, что видел бы менеджер в BUYOUT/ERROR/….
  const viewTab = currentTab === "ATTENTION" ? orderToTab(order) : currentTab;

  const showDirty = viewTab === "BUYOUT" || viewTab === "DIRECT" || viewTab === "AVITO" || viewTab === "ERROR";
  const dirtyAmount = Math.ceil(order.amount / 0.7);
  const displayAmount = showDirty ? dirtyAmount : order.amount;
  const showCleanHint = viewTab === "BUYOUT";

  const tabBadge = currentTab === "ALL" || currentTab === "ATTENTION" ? orderTabBadge(order) : null;
  const showMoveBtn = viewTab === "AWAITING_LINK" || viewTab === "FAVORITES";
  const isEditableAvito = viewTab === "AVITO" && order.orderSource === "AVITO" && ["PENDING", "AWAITING_GAMEPASS", "ERROR"].includes(order.status);

  const timeRef = order.createdAt;
  // Second timer: how long the order has been sitting in the "К выкупу" queue
  // (since it entered PENDING). pendingAt is set when the gamepass link arrives.
  const inBuyoutQueue = !!order.pendingAt && ["PENDING", "IN_PROGRESS"].includes(order.status);

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
          {inBuyoutQueue && (
            <span
              title="В очереди «К выкупу»"
              style={{ fontSize: 16, fontWeight: 500, color: ageColor(order.pendingAt!), ...tabular }}>
              🛒 {fmtAge(order.pendingAt!)}
            </span>
          )}
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
        {!order.robloxUsername && order.probableNick && (
          <DataRow icon="👁" copyText={order.probableNick}>
            <span style={{ fontWeight: 600, color: C.yellow }}>{order.probableNick}</span>
            <span style={{ fontSize: 13, color: C.textTertiary }}> · вероятный ник</span>
          </DataRow>
        )}
        {order.gamepassUrl && (
          <DataRow icon="🔗" copyText={order.gamepassUrl}>
            <span style={{ color: C.blue }}>{order.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</span>
          </DataRow>
        )}
        {/* Прайс-гард (Ш4): расхождение живой цены пасса с номиналом видно до
            нажатия «Выкупить» — сервер такой выкуп всё равно заблокирует. */}
        {live?.priceMismatch && live.livePrice != null && (
          <DataRow icon="⚠️">
            <span style={{ color: C.orange, fontWeight: 600 }}>
              цена ≠ номиналу: пасс {live.livePrice.toLocaleString("ru-RU")} R$, ожид {live.expected.toLocaleString("ru-RU")} R$
            </span>
          </DataRow>
        )}
        {live?.isForSale === false && (
          <DataRow icon="⛔">
            <span style={{ color: C.red, fontWeight: 600 }}>геймпасс не на продаже</span>
          </DataRow>
        )}
        {!order.isDirectOrder && (
          <DataRow icon="📦" copyText={order.wbCode}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 16 }}>
              {order.wbCode}
            </span>
          </DataRow>
        )}
        {order.status === "COMPLETED" && currentTab !== "DONE" && (
          <DataRow icon="💳" copyText={order.purchaserUsername ?? undefined}>
            <span style={{ color: C.textSecondary }}>
              Выкуп:{" "}
              <span style={{ fontWeight: 600, color: order.purchaserUsername ? "#e5e5ea" : C.textTertiary }}>
                {order.purchaserUsername ?? "Ручные"}
              </span>
            </span>
          </DataRow>
        )}
        {order.status === "COMPLETED" && order.reviewStatus && (() => {
          const granted = order.user.reviewBonusGrantedAt;
          if (order.reviewStatus === "PENDING") {
            return (
              <DataRow icon="📸">
                <span style={{ color: C.yellow, fontWeight: 600 }}>Ждёт отзыв</span>
                <span style={{ fontSize: 13, color: C.textTertiary }}> · скрин = +100 R$</span>
              </DataRow>
            );
          }
          const bal = order.user.balance ?? 0;
          if (bal > 0 && granted) {
            const expiry = new Date(new Date(granted).getTime() + 30 * 86_400_000);
            return (
              <DataRow icon="✅">
                <span style={{ color: C.green, fontWeight: 600 }}>+100 R$ начислен</span>
                <span style={{ fontSize: 13, color: C.textTertiary }}>
                  {" · "}баланс {bal} R$ до {expiry.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                </span>
              </DataRow>
            );
          }
          return (
            <DataRow icon="💳">
              <span style={{ color: C.textTertiary, fontWeight: 600 }}>Бонус использован</span>
            </DataRow>
          );
        })()}

        {/* Notes */}
        <div style={{ marginTop: 8 }}>
          <NotesEditor order={order} onSave={onSaveNote} />
        </div>
      </div>

      {/* 👁 GP-watch: вероятный ник есть, подтверждённого нет — найти ГП и оповестить */}
      {showGpWatch && (
        <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {gpwPassId && (
            <div style={{
              padding: "8px 10px", background: `${C.green}14`, borderRadius: 8,
              fontSize: 14, color: C.green, display: "flex", alignItems: "center", gap: 6,
              flexWrap: "wrap",
            }}>
              <span style={{ fontWeight: 600 }}>👁 ГП найден по нику — клиент оповещён, ждём ✅</span>
              <a
                href={`https://www.roblox.com/game-pass/${gpwPassId}`}
                target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ color: C.blue, fontSize: 13 }}
              >
                game-pass/{gpwPassId}
              </a>
            </div>
          )}
          <button className="twa-press-sm" disabled={gpwLoading}
            onClick={e => { e.stopPropagation(); gpwNotify(); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10,
              border: `1px solid ${gpwPassId ? C.textTertiary + "44" : C.yellow + "55"}`,
              background: "transparent", color: gpwPassId ? C.textSecondary : C.yellow,
              fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: gpwLoading ? 0.5 : 1,
            }}>
            {gpwLoading ? "Ищу ГП на Roblox…" : gpwPassId ? "📣 Оповестить клиента ещё раз" : "👁 Найти ГП по нику и оповестить"}
          </button>
        </div>
      )}

      {/* ❌ П3: клиент отверг GP-watch-ник — вероятного ника больше нет, дожать вручную */}
      {order.gpWatchDeclinedAt && order.status === "AWAITING_GAMEPASS" && !order.robloxUsername && (
        <div style={{
          margin: "0 14px 10px", padding: "8px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 600 }}>❌ Клиент сказал: не его ник</span>
          <span style={{ fontSize: 13, color: C.textTertiary }}>
            {new Date(order.gpWatchDeclinedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
            {" · "}ждём правильный ник — дожать вручную
          </span>
        </div>
      )}

      {/* 🚫 VK-клиент недостижим для сообщества (VK 901) — писать только с личного акка */}
      {order.vkUnreachable === true && order.user.vkId && (
        <div style={{
          margin: "0 14px 10px", padding: "8px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 600 }}>🚫 Бот не может написать (VK)</span>
          <a
            href={`https://vk.com/id${order.user.vkId}`}
            target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: C.blue, fontSize: 13, fontWeight: 600 }}
          >
            профиль VK — писать с личного
          </a>
        </div>
      )}

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
          currentTab={viewTab}
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
        currentTab={viewTab}
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
  token, onActionDone, initialQuery, initialTab, onInitialQueryConsumed,
}: {
  token: string;
  onActionDone?: () => void;
  initialQuery?: string;
  /** Ф2: открыть сразу на вкладке (виджет «Ошибки» дашборда «Свои» → ERROR). */
  initialTab?: string;
  onInitialQueryConsumed?: () => void;
}) {
  const [filter, setFilter] = useState<FilterTab>((initialTab as FilterTab) || "ALL");
  const [query, setQuery] = useState(initialQuery ?? "");
  // Вкладка «Все»: по умолчанию хронологическая лента (новые сверху),
  // подборка «Требуют внимания» — по кнопке «⚠ Внимание (N)» (решение 2026-07-06).
  const [allView, setAllView] = useState<"attention" | "list">("list");
  // П4: модалка «➕ Создать заказ» (ручной заказ целиком из TWA).
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => {
    if (initialQuery || initialTab) onInitialQueryConsumed?.();
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

  // Заявки прямых заказов (DirectIntent) — видны на вкладке «Прямой».
  const [intents, setIntents] = useState<Intent[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(false);
  const [qrConfigured, setQrConfigured] = useState(true);

  const enrichCache = useRef<Map<string, EnrichValue>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  // Прайс-гард (Ш4): живая цена ГП для карточек выкупных статусов —
  // бейдж «⚠️ цена ≠ номиналу» до нажатия «Выкупить», не блокируя список.
  const [liveMap, setLiveMap] = useState<Record<string, GpLiveInfo>>({});
  const liveRequestedRef = useRef<Set<string>>(new Set());

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
      // append-страницы идут с skipCounts=1 (counts/sums/oldest = null) — сохраняем прежние.
      setData(prev => append && prev ? { ...d, counts: prev.counts, sums: prev.sums, oldest: prev.oldest } : d);
      setAllOrders(prev => append ? [...prev, ...applyCache(d.orders)] : applyCache(d.orders));
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [token, applyCache]);

  const isAttentionView = filter === "ALL" && !query && allView === "attention";
  const serverTab: FilterTab = isAttentionView ? "ATTENTION" : filter;

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    fetchOrders(serverTab, query, 1, false);
  }, [serverTab, query, fetchOrders]);

  const fetchIntents = useCallback(async () => {
    setIntentsLoading(true);
    try {
      const r = await fetch("/api/twa/intents", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      setIntents(d.intents ?? []);
      setQrConfigured(d.qrConfigured !== false);
    } catch { /* non-fatal */ }
    finally { setIntentsLoading(false); }
  }, [token]);

  useEffect(() => {
    if (filter === "DIRECT" && !query) fetchIntents();
  }, [filter, query, fetchIntents]);

  const handleIntentGone = useCallback((id: string, result: "consumed" | "rejected") => {
    setIntents(prev => prev.filter(i => i.id !== id));
    setData(prev => prev?.counts
      ? { ...prev, counts: { ...prev.counts, INTENTS: Math.max(0, (prev.counts["INTENTS"] ?? 0) - 1) } }
      : prev);
    // QR/реквизиты создают заказ DIR-… (PAYMENT_PENDING) — сразу дотягиваем список.
    if (result === "consumed") { setPage(1); fetchOrders(serverTab, query, 1, false); }
    onActionDone?.();
  }, [serverTab, query, fetchOrders, onActionDone]);

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

  // gp-live-check для карточек с геймпассом в выкупных статусах (сервер отдаёт
  // expected/livePrice/priceMismatch, режет пачку до 30). Ошибки не критичны.
  useEffect(() => {
    const need = allOrders
      .filter(o => o.gamepassUrl
        && ["PENDING", "IN_PROGRESS", "ERROR"].includes(o.status)
        && !liveRequestedRef.current.has(o.id))
      .map(o => o.id)
      .slice(0, 30);
    if (need.length === 0) return;
    need.forEach(id => liveRequestedRef.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "gp-live-check", orderIds: need }),
        });
        const d = await r.json().catch(() => null);
        if (cancelled || !r.ok || !d?.results) return;
        setLiveMap(prev => ({ ...prev, ...d.results }));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [allOrders, token]);

  const loadMore = useCallback(() => {
    if (!data || page >= data.pages || loadingMore || loading) return;
    const next = page + 1;
    setPage(next);
    fetchOrders(serverTab, query, next, true);
  }, [data, page, loadingMore, loading, serverTab, query, fetchOrders]);

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

    // В «Требуют внимания» карточка уходит после выкупа/отклонения;
    // set-error оставляет её в подборке (ошибки — тоже «внимание»).
    const leaves = isAttentionView
      ? toTab === "ALL"
      : filter !== "ALL" && (toTab === "ALL" || toTab !== filter);
    const attnDelta = isAttentionView && leaves ? 1 : 0;

    setAllOrders(prev => prev.map(o => o.id === order.id
      ? { ...o, status: newStatus!, rejectionReason: action === "reject" ? (reason || "не указана") : o.rejectionReason }
      : o));
    if (data?.counts && toTab) {
      setData(prev => {
        if (!prev) return prev;
        let counts = shiftCounts(prev.counts, fromTab, toTab!);
        if (attnDelta) counts = { ...counts, ATTENTION: Math.max(0, (counts["ATTENTION"] ?? 0) - attnDelta) };
        return {
          ...prev,
          counts,
          sums: prev.sums ? shiftSums(prev.sums, fromTab, toTab!, order.amount) : prev.sums,
        };
      });
    }
    if (leaves) setExiting(prev => new Set(prev).add(order.id));

    const rollback = () => {
      setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: order.status } : o));
      if (data?.counts && toTab) {
        setData(prev => {
          if (!prev) return prev;
          let counts = shiftCounts(prev.counts, toTab!, fromTab);
          if (attnDelta) counts = { ...counts, ATTENTION: (counts["ATTENTION"] ?? 0) + attnDelta };
          return {
            ...prev,
            counts,
            sums: prev.sums ? shiftSums(prev.sums, toTab!, fromTab, order.amount) : prev.sums,
          };
        });
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
  }, [token, filter, data, onActionDone, isAttentionView]);

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
        // Избранное исключается из «Требуют внимания» по определению выборки.
        if (isAttentionView) next["ATTENTION"] = Math.max(0, (next["ATTENTION"] ?? 0) - 1);
      }
      return { ...prev, counts: next };
    });

    if ((filter !== "ALL" || isAttentionView) && !wasFav) {
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
  }, [token, filter, isAttentionView]);

  function cachedCountsInvalidate() {
    // force refresh on next tab switch
  }

  const handlePurchaseDone = useCallback((order: Order) => {
    const fromTab = orderToTab(order);
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "COMPLETED" as any } : o));
    setData(prev => {
      if (!prev) return prev;
      let counts = shiftCounts(prev.counts, fromTab, "ALL");
      if (isAttentionView) counts = { ...counts, ATTENTION: Math.max(0, (counts["ATTENTION"] ?? 0) - 1) };
      return {
        ...prev,
        counts,
        sums: prev.sums ? shiftSums(prev.sums, fromTab, "ALL", order.amount) : prev.sums,
      };
    });
    if (filter !== "ALL" || isAttentionView) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }
    onActionDone?.();
  }, [filter, onActionDone, isAttentionView]);

  const handleMoved = useCallback((order: Order) => {
    if (filter !== "ALL" || isAttentionView) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }
    onActionDone?.();
  }, [filter, onActionDone, isAttentionView]);

  const summaryText = useMemo(() => {
    if (!data) return "";
    if (query) return `По запросу «${query}» · ${data.total}`;
    if (isAttentionView) return `Требуют внимания · ${data.total}`;
    const meta = TAB_META[filter];
    return `${meta.label} · ${data.total}`;
  }, [data, query, filter, isAttentionView]);

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
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchBar value={query} onChange={setQuery} />
          </div>
          <button
            className="twa-press-sm"
            title="Создать заказ вручную"
            onClick={() => { haptic.impact("light"); setCreateOpen(true); }}
            style={{
              flexShrink: 0, width: 42, borderRadius: 10, border: "none",
              background: C.accent, color: "#fff", fontSize: 24, fontWeight: 500,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              lineHeight: 1, paddingBottom: 2,
            }}
          >
            +
          </button>
        </div>

        <div className="twa-no-scrollbar" style={{
          display: "flex", gap: 7,
          overflowX: "auto",
          marginRight: -16, paddingRight: 16,
          WebkitMaskImage: "linear-gradient(90deg, #000 90%, transparent)",
          maskImage: "linear-gradient(90deg, #000 90%, transparent)",
        }}>
          {FILTERS.map(f => {
            const meta = TAB_META[f.id];
            // «Прямой»: бейдж = заказы + заявки (DirectIntent, «ожидаем реквизиты»).
            const count = (data?.counts?.[f.id] ?? 0)
              + (f.id === "DIRECT" ? (data?.counts?.["INTENTS"] ?? 0) : 0);
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
        {/* Dashboard: сетка категорий на «Все», своя карточка внутри BUYOUT / AWAITING_LINK */}
        {data?.sums && !query && filter === "ALL" && (
          <div style={{ paddingTop: 10 }}>
            <MiniDashboard counts={data.counts} sums={data.sums} oldest={data.oldest} onTap={setFilter} />
          </div>
        )}
        {data?.sums && !query && (filter === "BUYOUT" || filter === "AWAITING_LINK") && (
          <div style={{ paddingTop: 10 }}>
            <MiniDashboard
              counts={data.counts}
              sums={data.sums}
              oldest={data.oldest}
              groups={DASHBOARD_GROUPS.filter(g => g.filter === filter)}
            />
          </div>
        )}

        {/* Заявки прямых заказов — до отправки реквизитов (видны даже при пустом списке заказов) */}
        {filter === "DIRECT" && !query && (
          <IntentsSection
            token={token}
            intents={intents}
            qrConfigured={qrConfigured}
            loading={intentsLoading}
            onIntentGone={handleIntentGone}
          />
        )}

        {loading ? (
          <Skeleton />
        ) : allOrders.length === 0 ? (
          <EmptyState
            filter={filter}
            query={query}
            attention={isAttentionView}
            onShowAll={isAttentionView ? () => { haptic.select(); setAllView("list"); } : undefined}
          />
        ) : (
          <div className="twa-fade-in" style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
              <span style={{ fontSize: 14, color: C.textSecondary, letterSpacing: 0.1 }}>
                {isAttentionView && "⚠ "}{summaryText}
              </span>
              {filter === "ALL" && !query && (
                <button
                  className="twa-press-sm"
                  onClick={() => { haptic.select(); setAllView(v => v === "attention" ? "list" : "attention"); }}
                  style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: C.accent, fontSize: 14, fontWeight: 600,
                    padding: "4px 2px", flexShrink: 0, whiteSpace: "nowrap",
                  }}
                >
                  {allView === "attention"
                    ? "Все заказы →"
                    : `⚠ Внимание${(data?.counts?.["ATTENTION"] ?? 0) > 0 ? ` (${data?.counts?.["ATTENTION"]})` : ""}`}
                </button>
              )}
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
              allOrders.map((order, idx) => (
                <Fragment key={order.id}>
                  {filter === "AWAITING_LINK" && !query && idx === AWAITING_LINK_HEAD && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px" }}>
                      <div style={{ flex: 1, height: 1, background: C.hairline }} />
                      <span style={{ fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap" }}>
                        ⬆ свежие · ниже — с самых старых
                      </span>
                      <div style={{ flex: 1, height: 1, background: C.hairline }} />
                    </div>
                  )}
                  <OrderCard
                    order={order}
                    token={token}
                    currentTab={isAttentionView ? "ATTENTION" : filter}
                    live={liveMap[order.id]}
                    exiting={exiting.has(order.id)}
                    onRunAction={(action, reason) => runAction(order, action, reason)}
                    onSaveNote={(note) => saveNote(order.id, note)}
                    onPurchaseDone={() => handlePurchaseDone(order)}
                    onToggleFavorite={() => toggleFavorite(order)}
                    onMoved={() => handleMoved(order)}
                  />
                </Fragment>
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

      {/* П4: модалка ручного создания заказа */}
      {createOpen && (
        <CreateManualModal
          token={token}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            setPage(1);
            fetchOrders(serverTab, query, 1, false);
            onActionDone?.();
          }}
        />
      )}
    </div>
  );
}

/* ───────────── Direct intents («⏳ Ожидаем реквизиты») ─────────────
   Заявки прямых заказов из ботов до отправки реквизитов. Кнопки = TG-карточке
   заявки: 📷 QR (СБП) / 💳 Реквизиты текстом / ❌ Отклонить. После QR или
   реквизитов заявка превращается в заказ DIR-… (PAYMENT_PENDING) и появляется
   в списке вкладки «Прямой» штатно. */
function IntentCard({ intent, token, qrConfigured, onGone }: {
  intent: Intent;
  token: string;
  qrConfigured: boolean;
  onGone: (result: "consumed" | "rejected") => void;
}) {
  const [busy, setBusy] = useState<null | "qr" | "details" | "reject">(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsText, setDetailsText] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  const platform: "tg" | "vk" | "—" = intent.user.tgId ? "tg" : intent.user.vkId ? "vk" : "—";
  const expectedPass = Math.ceil(intent.totalAmount / 0.7);

  async function run(action: "send-qr" | "send-details" | "reject") {
    if (busy) return;
    setBusy(action === "send-qr" ? "qr" : action === "send-details" ? "details" : "reject");
    try {
      const r = await fetch("/api/twa/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action, intentId: intent.id,
          ...(action === "send-details" ? { details: detailsText.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        haptic.notify("error");
        toast(d.error ?? "Ошибка", "error");
        // 409/410 — заявку уже обработали из TG или она просрочена: убираем.
        if (r.status === 409 || r.status === 410) onGone("consumed");
        return;
      }
      haptic.notify("success");
      if (action === "reject") {
        toast(d.notified ? "Заявка отклонена, клиент уведомлён" : "Заявка отклонена (уведомление не доставлено)", "default");
        onGone("rejected");
      } else {
        const what = action === "send-qr" ? "QR отправлен" : "Реквизиты отправлены";
        toast(
          d.notified
            ? `✅ ${what} (${String(d.notified).toUpperCase()}) · заказ ${d.code}`
            : `⚠️ Заказ ${d.code} создан, но сообщение НЕ доставлено — напиши клиенту сам`,
          d.notified ? "success" : "error",
        );
        onGone("consumed");
      }
    } catch {
      haptic.notify("error");
      toast("Ошибка сети", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article style={{
      background: C.card,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      border: `1px solid ${C.blue}33`,
    }}>
      <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, color: "#fff",
            background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
            borderRadius: 5, padding: "4px 8px", flexShrink: 0,
          }}>
            {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
          </span>
          <span
            onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(intent.user); }}
            style={{
              fontSize: 17, fontWeight: 600, color: "#7ec5ff", cursor: "pointer",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
            }}
          >
            {userShortName(intent.user)}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: C.blue,
            background: `${C.blue}1c`, padding: "4px 9px",
            borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
          }}>
            ⏳ заявка
          </span>
          {intent.prevOrders > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: C.green,
              background: `${C.green}1c`, padding: "3px 8px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>
              🔄 ×{intent.prevOrders}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: ageColor(intent.createdAt), ...tabular }}>
            ⏱ {fmtAge(intent.createdAt)}
          </span>
          <span style={{ fontSize: 14, color: C.textTertiary }}>—</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, ...tabular }}>
            {intent.totalAmount.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.green, ...tabular }}>
            → {intent.rublePrice.toLocaleString("ru-RU")} ₽
          </span>
          {intent.bonus > 0 && (
            <span style={{ fontSize: 13, color: C.yellow }}>🎁 +{intent.bonus}</span>
          )}
        </div>
      </div>

      <div style={{ padding: "6px 16px 12px" }}>
        <DataRow icon="🎮" copyText={intent.robloxUsername}>
          <span style={{ fontWeight: 600 }}>{intent.robloxUsername}</span>
        </DataRow>
        <DataRow icon="🔗" copyText={intent.gamepassUrl}>
          <a
            href={intent.gamepassUrl}
            target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: C.blue }}
          >
            {intent.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
          </a>
        </DataRow>
        <div style={{ fontSize: 13, color: C.textTertiary, padding: "2px 0 0 26px" }}>
          геймпасс ≈ {expectedPass.toLocaleString("ru-RU")} R$ · выдать {intent.totalAmount.toLocaleString("ru-RU")} R$
        </div>
      </div>

      {detailsOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          padding: "10px 14px 4px",
          borderTop: `1px solid ${C.hairline}`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <textarea
            placeholder="Реквизиты (номер карты/телефона, банк)…"
            value={detailsText}
            onChange={e => setDetailsText(e.target.value)}
            rows={2}
            style={{
              background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
              color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
              padding: "10px 12px", resize: "none", outline: "none",
              width: "100%", boxSizing: "border-box", fontFamily: "inherit",
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px" }}>
        {!detailsOpen ? (
          <>
            <button className="twa-press" disabled={!!busy || !qrConfigured}
              title={qrConfigured ? undefined : "QR не загружен в БД"}
              onClick={() => run("send-qr")}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: "rgba(10,132,255,0.14)", color: C.blue, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || !qrConfigured ? 0.5 : 1 }}>
              {busy === "qr" ? "⏳…" : "📷 QR (СБП)"}
            </button>
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setDetailsOpen(true); setConfirmReject(false); }}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: "rgba(48,209,88,0.12)", color: C.green, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              💳 Реквизиты
            </button>
          </>
        ) : (
          <>
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setDetailsOpen(false); setDetailsText(""); }}
              style={{ flex: 1, padding: "13px", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              Отмена
            </button>
            <button className="twa-press" disabled={!!busy || !detailsText.trim()}
              onClick={() => run("send-details")}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || !detailsText.trim() ? 0.5 : 1 }}>
              {busy === "details" ? "⏳…" : "Отправить клиенту"}
            </button>
          </>
        )}
        {!detailsOpen && (
          confirmReject ? (
            <button className="twa-press" disabled={!!busy}
              onClick={() => run("reject")}
              style={{ flexShrink: 0, padding: "13px 12px", border: "none", borderRadius: 12, background: C.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              {busy === "reject" ? "⏳…" : "Точно?"}
            </button>
          ) : (
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setConfirmReject(true); window.setTimeout(() => setConfirmReject(false), 3500); }}
              style={{ width: 44, flexShrink: 0, padding: "13px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              ✕
            </button>
          )
        )}
      </div>
    </article>
  );
}

function IntentsSection({ token, intents, qrConfigured, loading, onIntentGone }: {
  token: string;
  intents: Intent[];
  qrConfigured: boolean;
  loading: boolean;
  onIntentGone: (id: string, result: "consumed" | "rejected") => void;
}) {
  if (loading && intents.length === 0) return null;
  if (intents.length === 0) return null;
  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>
          ⏳ Заявки · ожидают реквизиты ({intents.length})
        </span>
        <div style={{ flex: 1, height: 1, background: C.hairline }} />
      </div>
      {intents.map(i => (
        <IntentCard
          key={i.id}
          intent={i}
          token={token}
          qrConfigured={qrConfigured}
          onGone={(result) => onIntentGone(i.id, result)}
        />
      ))}
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

// Режим суммы: amount в БД — чистые R$ (клиенту), грязные = ceil(amount / 0.7)
// (цена геймпасса, что спишется с донора). Крупная цифра — то, чем оперирует
// менеджер в этой категории; в скобках — второе значение (grossOnly — без скобок,
// в этих вкладках карточки показывают только грязные).
type DashSumMode = "grossClean" | "cleanGross" | "grossOnly";

const DASHBOARD_GROUPS: { key: string; label: string; sumKey: string; filter: FilterTab; color: string; mode: DashSumMode; oldestKey?: string }[] = [
  { key: "buyout", label: "К выкупу",    sumKey: "BUYOUT",        filter: "BUYOUT",        color: C.green,  mode: "grossClean", oldestKey: "BUYOUT" },
  { key: "link",   label: "Ждут ссылку", sumKey: "AWAITING_LINK", filter: "AWAITING_LINK", color: C.yellow, mode: "cleanGross", oldestKey: "AWAITING_LINK" },
  { key: "direct", label: "Прямой",      sumKey: "DIRECT",        filter: "DIRECT",        color: C.blue,   mode: "grossOnly" },
  { key: "avito",  label: "Авито",       sumKey: "AVITO",         filter: "AVITO",         color: C.orange, mode: "grossOnly" },
  { key: "new",    label: "Новые",       sumKey: "NEW",           filter: "NEW",           color: C.accent, mode: "cleanGross" },
  { key: "error",  label: "Ошибка",      sumKey: "ERROR",         filter: "ERROR",         color: C.red,    mode: "grossClean" },
];

function MiniDashboard({ counts, sums, oldest, onTap, groups = DASHBOARD_GROUPS }: {
  counts: Record<string, number>;
  sums: Record<string, number>;
  oldest?: Record<string, string | null> | null;
  onTap?: (filter: FilterTab) => void;
  groups?: typeof DASHBOARD_GROUPS;
}) {
  const visible = groups.filter(g => (counts[g.filter] ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: visible.length > 1 ? "1fr 1fr" : "1fr",
      gap: 8, padding: "0 16px 6px",
    }}>
      {visible.map(g => {
        const count = counts[g.filter] ?? 0;
        const cleanRobux = sums[g.sumKey] ?? 0;
        const grossRobux = Math.ceil(cleanRobux / 0.7);
        const primary = g.mode === "cleanGross" ? cleanRobux : grossRobux;
        const secondary = g.mode === "grossClean" ? cleanRobux : g.mode === "cleanGross" ? grossRobux : null;
        const oldestIso = g.oldestKey ? (oldest?.[g.oldestKey] ?? null) : null;

        const cardStyle: React.CSSProperties = {
          minWidth: 0,
          background: C.card,
          borderRadius: 14,
          padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 3,
          boxShadow: SHADOW.card,
          position: "relative",
          overflow: "hidden",
          border: "none",
          cursor: onTap ? "pointer" : "default",
          textAlign: "left",
        };

        const inner = (
          <>
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
              {secondary !== null && (
                <span style={{ fontSize: 13, fontWeight: 500, color: C.textTertiary, marginLeft: 4 }}>
                  ({fmtRobux(secondary)})
                </span>
              )}
            </div>
            <div style={{
              fontSize: 13, color: C.textTertiary, ...tabular,
              position: "relative",
              display: "flex", justifyContent: "space-between", gap: 6,
            }}>
              <span>{count} {count === 1 ? "заказ" : count < 5 ? "заказа" : "заказов"}</span>
              {oldestIso && (
                <span title="Старейший в очереди" style={{ color: ageColor(oldestIso) }}>
                  ⏳ {fmtAge(oldestIso)}
                </span>
              )}
            </div>
          </>
        );

        return onTap ? (
          <Pressable
            key={g.key}
            variant="press-sm"
            onClick={() => { haptic.impact("light"); onTap(g.filter); }}
            style={cardStyle}
          >
            {inner}
          </Pressable>
        ) : (
          <div key={g.key} style={cardStyle}>{inner}</div>
        );
      })}
    </div>
  );
}

function EmptyState({ filter, query, attention, onShowAll }: {
  filter: FilterTab;
  query: string;
  attention?: boolean;
  onShowAll?: () => void;
}) {
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
  if (attention) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
        <div style={{ fontSize: 16, marginBottom: 4 }}>Всё под контролем</div>
        <div style={{ fontSize: 14, color: C.textTertiary, marginBottom: 18 }}>
          Ничего не требует внимания
        </div>
        {onShowAll && (
          <button
            className="twa-press-sm"
            onClick={onShowAll}
            style={{
              background: "rgba(118,118,128,0.18)", border: "none", borderRadius: 10,
              color: C.accent, fontSize: 15, fontWeight: 600,
              padding: "10px 18px", cursor: "pointer",
            }}
          >
            Все заказы →
          </button>
        )}
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
    ATTENTION: "Ничего не требует внимания",
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
