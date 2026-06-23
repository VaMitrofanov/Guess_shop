"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import Pressable from "../Pressable";

/* ─────────────────────────────────────────────────────────────────────────────
   OrdersScreen — Apple-grade admin order list.
   Palette/radii/shadows come from the shared theme. Interactions are tactile
   (haptics + press states), actions are optimistic (no full-list refetch), and
   the "Nth order / VIP / review" signals stream in via deferred enrichment.
   ───────────────────────────────────────────────────────────────────────── */

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
type FilterStatus = OrderStatus | "ALL" | "BUYOUT";

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
  paymentDetails: string | null;
  purchaseRate: number | null;
  createdAt: string;
  updatedAt: string;
  robloxUsername: string | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  userOrderNumber: number | null;
  userOrderTotal:  number | null;
  user: {
    tgId:                 string | null;
    vkId:                 string | null;
    name:                 string | null;
    username:             string | null;
    balance:              number | null;
    reviewBonusGrantedAt: string | null;
  };
}

interface OrdersData {
  orders: Order[];
  total: number;
  counts: Record<FilterStatus, number>;
  sums?: Record<string, number> | null;
  page: number;
  pages: number;
}

/* Per-order signals merged in after the list paints (deferred enrichment). */
interface EnrichValue {
  userOrderNumber: number | null;
  userOrderTotal:  number | null;
  reviewStatus:    "PENDING" | "SUBMITTED" | null;
}

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  AWAITING_PAYMENT:  { label: "Ждёт реквизиты", color: "#ac8e68" },
  PAYMENT_PENDING:   { label: "Ждёт оплату",    color: "#ac8e68" },
  AWAITING_GAMEPASS: { label: "Ждёт ссылку",    color: C.yellow },
  PENDING:           { label: "Новый",           color: C.accent },
  IN_PROGRESS:       { label: "В работе",        color: C.orange },
  COMPLETED:         { label: "Завершён",        color: C.green  },
  REJECTED:          { label: "Отклонён",        color: C.red    },
};

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: "ALL",               label: "Все"         },
  { id: "BUYOUT",            label: "К выкупу"    },
  { id: "PENDING",           label: "Новые"       },
  { id: "IN_PROGRESS",       label: "В работе"    },
  { id: "AWAITING_PAYMENT",  label: "Реквизиты"   },
  { id: "PAYMENT_PENDING",   label: "Оплата"      },
  { id: "AWAITING_GAMEPASS", label: "Ждут ссылку" },
  { id: "COMPLETED",         label: "Готово"      },
  { id: "REJECTED",          label: "Отклонено"   },
];

const URGENT_STATUSES: OrderStatus[] = ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"];

/* Common rejection reasons — one tap to fill, still freely editable. */
const REJECT_PRESETS = [
  "Приватный профиль",
  "Неверная ссылка",
  "Геймпасс не найден",
  "Цена не совпала",
  "Дубликат заказа",
  "Нет оплаты",
];

/* ───────────── Time formatting — short & contextual ───────────── */
function fmtRelative(iso: string) {
  const d       = new Date(iso);
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 1)    return "только что";
  if (diffMin < 60)   return `${Math.round(diffMin)} мин`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)} ч`;
  if (diffMin < 1440 * 7) return `${Math.floor(diffMin / 1440)} дн`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function fmtFull(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
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
        background:   copied ? `${C.green}26` : "transparent",
        border:    "none",
        borderRadius: 8,
        color:     copied ? C.green : C.textSecondary,
        fontSize:  12.5,
        fontWeight: 500,
        padding:   "6px 11px",
        cursor:    "pointer",
        flexShrink:0,
      }}
      title={copied ? "Скопировано" : "Скопировать"}
    >
      {copied ? "✓ Скопировано" : "Скопировать"}
    </button>
  );
}

/* ───────────── Avatar — initial circle with deterministic hue ───────────── */
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 55% 42%)`;
}
function Avatar({ name, platform }: { name: string; platform: "tg" | "vk" | "—" }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const bg = name === "—" ? C.elevated : colorForName(name);
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 18,
      background: bg,
      color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 700, fontSize: 15, letterSpacing: -0.2,
      flexShrink: 0,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
      position: "relative",
    }}>
      {initial}
      {platform !== "—" && (
        <div style={{
          position: "absolute", right: -2, bottom: -2,
          width: 14, height: 14, borderRadius: 7,
          background: platform === "tg" ? "#229ED9" : "#0077FF",
          border: `2px solid ${C.card}`,
          fontSize: 7, fontWeight: 800, color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {platform === "tg" ? "T" : "V"}
        </div>
      )}
    </div>
  );
}

/* ───────────── Status pill — refined dot+label ───────────── */
function StatusPill({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: `${meta.color}1c`,
      color:      meta.color,
      fontSize:   10.5,
      fontWeight: 700,
      padding:    "3px 9px 3px 7px",
      borderRadius: 999,
      letterSpacing: 0.4,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: meta.color, boxShadow: `0 0 0 2px ${meta.color}33` }} />
      {meta.label.toUpperCase()}
    </span>
  );
}

function Chip({ children, color, animate }: { children: React.ReactNode; color: string; animate?: boolean }) {
  return (
    <span className={animate ? "twa-chip-in" : undefined} style={{
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
      color, background: `${color}1c`,
      padding: "2.5px 8px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

/* OrderNumberChip — "N/Total" cluster-relative position (TG/VK/Roblox identity
   union). Green "НОВЫЙ" for a lone first order, blue for repeat, gold VIP at 5+. */
function OrderNumberChip({ n, total }: { n: number | null; total: number | null }) {
  if (!n || !total) return null;
  const isFirst = n === 1 && total === 1;
  const isVip   = total >= 5;
  const color = isVip ? "#ffd60a" : isFirst ? C.green : C.blue;
  const label = isFirst
    ? "НОВЫЙ"
    : isVip
    ? `${n}/${total} · VIP`
    : `${n}/${total}`;
  return <Chip color={color} animate>{isVip && "👑 "}{label}</Chip>;
}

/* ───────────── Info row with readable label/value (Apple Wallet style) ───────────── */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 0" }}>
      <span style={{
        fontSize: 11.5, color: C.textTertiary,
        letterSpacing: 0.4, textTransform: "uppercase" as const, fontWeight: 600,
      }}>
        {label}
      </span>
      <div style={{ fontSize: 16, color: C.textPrimary, lineHeight: 1.35, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}
function Divider() {
  return <div style={{ height: 1, background: C.hairline, margin: "2px 0" }} />;
}

/* Bonus expiry computation — bonus burns 30 days after reviewBonusGrantedAt */
const BONUS_EXPIRY_DAYS = 30;
function bonusExpiryInfo(grantedAtIso: string | null, balance: number | null) {
  if (!grantedAtIso || !balance || balance <= 0) return null;
  const grantedMs = new Date(grantedAtIso).getTime();
  const expiresAt = grantedMs + BONUS_EXPIRY_DAYS * 86_400_000;
  const daysLeft  = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
  const expiryStr = new Date(expiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  const color =
    daysLeft <= 3  ? C.red    :
    daysLeft <= 7  ? C.orange :
    daysLeft <= 14 ? C.yellow :
                     C.green;
  return { daysLeft, expiryStr, color, balance };
}
function daysWord(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "дня";
  return "дней";
}

type ActionResult = { ok: boolean; error?: string };

/* ───────────── ActionBar — controlled; the screen owns the optimistic mutation ───────────── */
function ActionBar({
  order, onRunAction,
}: { order: Order; onRunAction: (action: string, reason?: string) => Promise<ActionResult> }) {
  const [loading,      setLoading]      = useState(false);
  const [rejectMode,   setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [err,          setErr]          = useState("");

  async function doAction(action: string, reason?: string) {
    setLoading(true); setErr("");
    const res = await onRunAction(action, reason);
    setLoading(false);
    if (!res.ok) setErr(res.error ?? "Ошибка");
  }

  if (rejectMode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {REJECT_PRESETS.map(p => (
            <Pressable
              key={p}
              variant="press-sm"
              onClick={() => setRejectReason(p)}
              style={{
                background: rejectReason === p ? `${C.red}26` : "rgba(255,255,255,0.06)",
                border: "none", borderRadius: 999,
                color: rejectReason === p ? C.red : C.textSecondary,
                fontSize: 12, fontWeight: 500, padding: "6px 11px", cursor: "pointer",
              }}
            >
              {p}
            </Pressable>
          ))}
        </div>
        <textarea
          placeholder="Причина отклонения…"
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          rows={2}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "none", borderRadius: 12,
            color: C.textPrimary, fontSize: 14, lineHeight: 1.35,
            padding: "10px 12px",
            resize: "none", outline: "none", width: "100%", boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="twa-press"
            onClick={() => { haptic.impact("light"); setRejectMode(false); }}
            style={btn(C.elevated, C.textSecondary, 1)}
          >
            Отмена
          </button>
          <button
            className="twa-press"
            onClick={() => doAction("reject", rejectReason || "не указана")}
            disabled={loading}
            style={{ ...btn(C.red, "#fff", 2), opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "…" : "Отклонить"}
          </button>
        </div>
        {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
      </div>
    );
  }

  const showTakeWork = order.status === "PENDING";
  const showUntake   = order.status === "IN_PROGRESS";
  const showComplete = order.status === "PENDING" || order.status === "IN_PROGRESS";
  const showReject   = ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status);
  const hasMain      = showTakeWork || showComplete;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {showTakeWork && (
          <button className="twa-press" onClick={() => doAction("take-work")} disabled={loading}
            style={{ ...btn(C.orange, "#fff", 1), opacity: loading ? 0.7 : 1 }}>
            {loading ? "…" : "В работу"}
          </button>
        )}
        {showComplete && (
          <button className="twa-press" onClick={() => doAction("complete")} disabled={loading}
            style={{ ...btn(C.green, "#fff", 2), opacity: loading ? 0.7 : 1, fontWeight: 700 }}>
            {loading ? "…" : "✓ Выкуплено"}
          </button>
        )}
        {showReject && hasMain && (
          <button className="twa-press" onClick={() => { haptic.impact("light"); setRejectMode(true); }} disabled={loading}
            style={{
              flexShrink: 0, width: 46,
              padding: "12px 0", borderRadius: 12,
              border: `1px solid ${C.red}66`, background: "transparent",
              color: C.red, fontSize: 20, lineHeight: 1, cursor: "pointer",
            }}>
            ✕
          </button>
        )}
      </div>
      {showReject && !hasMain && (
        <button className="twa-press" onClick={() => { haptic.impact("light"); setRejectMode(true); }} disabled={loading}
          style={{
            width: "100%", padding: "11px", borderRadius: 12,
            border: `1px solid ${C.red}55`, background: "transparent",
            color: C.red, fontSize: 14, fontWeight: 500, cursor: "pointer",
          }}>
          Отклонить заказ
        </button>
      )}
      {showUntake && (
        <button className="twa-press" onClick={() => doAction("untake")} disabled={loading}
          style={{
            width: "100%", padding: "11px", borderRadius: 12,
            border: `1px solid ${C.orange}55`, background: "transparent",
            color: C.orange, fontSize: 13.5, fontWeight: 600, cursor: "pointer",
          }}>
          ↩︎ Вернуть в «Новые»
        </button>
      )}
      {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
    </div>
  );
}
function btn(bg: string, color: string, flex: number): React.CSSProperties {
  return {
    flex, padding: "12px", borderRadius: 12, border: "none",
    background: bg, color, fontSize: 14, fontWeight: 600, cursor: "pointer",
    letterSpacing: 0.1,
  };
}

/* ───────────── NotesEditor — admin-only free-text note, autosave on blur ─────────────
   Where the manager jots the current status / problem for an order. Highlighted
   when set so a noted order stands out at a glance. Never shown to the customer. */
function NotesEditor({ order, onSave }: { order: Order; onSave: (note: string) => Promise<ActionResult> }) {
  const [note, setNote]   = useState(order.adminNote ?? "");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  // Re-sync local draft when the persisted note changes elsewhere (optimistic patch).
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
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textSecondary }}>
          📝 Заметка <span style={{ color: C.textTertiary, fontWeight: 400 }}>· видят только админы</span>
        </span>
        {flash && <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>Сохранено ✓</span>}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        placeholder="Текущий статус или проблема по заказу…"
        rows={2}
        style={{
          background: hasNote ? `${C.yellow}14` : "rgba(255,255,255,0.06)",
          border: hasNote ? `1px solid ${C.yellow}40` : "1px solid transparent",
          borderRadius: 12, color: C.textPrimary, fontSize: 14, lineHeight: 1.4,
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
            alignSelf: "flex-start", padding: "8px 16px", borderRadius: 10, border: "none",
            background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: "pointer", opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "Сохранить заметку"}
        </button>
      )}
    </div>
  );
}

/* ───────────── QuickTools — open / copy gamepass & nick, grouped with actions ───────────── */
function QuickTools({ order }: { order: Order }) {
  const gp   = order.gamepassUrl;
  const nick = order.robloxUsername;
  if (!gp && !nick) return null;
  const toolStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "10px 8px", borderRadius: 11, border: "none",
    background: "rgba(255,255,255,0.06)", color: C.textSecondary,
    fontSize: 12.5, fontWeight: 600, cursor: "pointer", textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const copy = (text: string, label: string) => {
    copyText(text); haptic.impact("light"); toast(`${label} скопирован`, "success");
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {gp && (
        <a href={gp} target="_blank" rel="noreferrer"
           onClick={e => { e.stopPropagation(); haptic.impact("light"); }} style={toolStyle}>
          🔗 Открыть
        </a>
      )}
      {gp && (
        <button className="twa-press-sm" onClick={e => { e.stopPropagation(); copy(gp, "Ссылка"); }} style={toolStyle}>
          📋 Ссылка
        </button>
      )}
      {nick && (
        <button className="twa-press-sm" onClick={e => { e.stopPropagation(); copy(nick, "Ник"); }} style={toolStyle}>
          📋 Ник
        </button>
      )}
    </div>
  );
}

function extractGamepassId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass\/(\d+)/i);
  return m ? m[1] : null;
}

/* ───────────── Contact button — direct chat link ─────────────
   Inside Telegram WebApp openTelegramLink only accepts https://t.me/* URLs;
   tg://user?id=... is silently ignored. For tgId-only users there is no
   reliable in-WebApp way to open the profile, so we always copy the ID as a
   guaranteed fallback, then best-effort the deep link. */
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
    toast(`📋 ID ${user.tgId} скопирован — вставь в поиск Telegram`, "success");
    return;
  }
  if (user.vkId) {
    const url = `https://vk.com/im?sel=${user.vkId}`;
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  }
}
function contactLabel(user: Order["user"]): string | null {
  if (user.username) return `Написать @${user.username}`;
  if (user.tgId)     return `Скопировать ID · ${user.tgId}`;
  if (user.vkId)     return "Написать в ВКонтакте";
  return null;
}
function ContactButton({ user }: { user: Order["user"] }) {
  const label = contactLabel(user);
  if (!label) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <button
        className="twa-press"
        onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(user); }}
        style={{
          display: "block", textAlign: "center" as const,
          width: "100%", padding: "13px", borderRadius: 13, border: "none",
          background: "linear-gradient(180deg, rgba(10,132,255,0.20), rgba(10,132,255,0.10))",
          boxShadow: `inset 0 0 0 1px rgba(10,132,255,0.35)`,
          color: "#7ec5ff", fontSize: 15, fontWeight: 600, letterSpacing: 0.2,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        💬 {label}
      </button>
    </div>
  );
}

/* ───────────── User identity helpers — @username everywhere ───────────── */
function userDisplayName(u: Order["user"]): string {
  if (u.username) return `@${u.username}`;
  const realName = u.name && u.name !== "VK User" ? u.name : null;
  if (realName) return realName;
  if (u.tgId)    return `TG · ${u.tgId}`;
  if (u.vkId)    return `VK · ${u.vkId}`;
  return "—";
}
function userSubHandle(u: Order["user"]): string {
  if (u.username && u.name && u.name !== "VK User") return u.name;
  if (u.tgId)    return `TG · ${u.tgId}`;
  if (u.vkId)    return `VK · ${u.vkId}`;
  return "";
}

/* ─────────────────────────────────────────────────────────────────────────────
   OrderCard — premium hierarchy
   ───────────────────────────────────────────────────────────────────────── */
function OrderCard({
  order, token, exiting, onGoToBossrobux, onRunAction, onSaveNote,
}: {
  order: Order;
  token: string;
  exiting: boolean;
  onGoToBossrobux?: (gamepassId?: string) => void;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (note: string) => Promise<ActionResult>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fetchedCreator, setFetchedCreator] = useState<string | false | null>(null);

  const isActive  = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status);
  const isHistory = ["COMPLETED", "REJECTED"].includes(order.status);

  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const displayName = userDisplayName(order.user);
  const subHandle   = userSubHandle(order.user);
  const avatarSeed  = (order.user.name && order.user.name !== "VK User")
    ? order.user.name
    : displayName;

  const displayCreator = order.robloxUsername
    ?? (typeof fetchedCreator === "string" ? fetchedCreator || null : null);
  const shortId = order.id.slice(-6).toUpperCase();

  useEffect(() => {
    if (!detailsOpen || order.robloxUsername || !order.gamepassUrl || fetchedCreator !== null) return;
    const gpId = extractGamepassId(order.gamepassUrl);
    if (!gpId) return;
    setFetchedCreator(false);
    fetch("/api/twa/bossrobux", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "lookup", gamepassId: gpId }),
    })
      .then(r => r.json())
      .then(d => setFetchedCreator(d?.gamepass?.sellerName ?? ""))
      .catch(() => setFetchedCreator(""));
  }, [detailsOpen, order.robloxUsername, order.gamepassUrl, fetchedCreator, token]);

  return (
    <article className={exiting ? "twa-card-exit" : undefined} style={{
      background: C.card,
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      position: "relative",
    }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: 18, pointerEvents: "none",
        background: `linear-gradient(180deg, ${C.cardTop} 0%, rgba(255,255,255,0) 28%)`,
      }} />

      {/* ─── Header ─── */}
      <div
        className={isHistory ? "twa-card-press" : undefined}
        onClick={() => { if (isHistory) { haptic.impact("light"); setDetailsOpen(d => !d); } }}
        style={{ padding: "14px 16px 12px", cursor: isHistory ? "pointer" : "default", position: "relative" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
            <StatusPill status={order.status} />
            <OrderNumberChip n={order.userOrderNumber} total={order.userOrderTotal} />
            {order.isDirectOrder && <Chip color={C.blue}>ПРЯМОЙ</Chip>}
            {order.reviewStatus === "PENDING"   && <Chip color={C.yellow} animate>📸 ОТЗЫВ</Chip>}
            {order.reviewStatus === "SUBMITTED" && <Chip color={C.green}  animate>⭐ ОТЗЫВ</Chip>}
          </div>
          <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, letterSpacing: -0.6, ...tabular, lineHeight: 1.05 }}>
              {order.amount.toLocaleString("ru-RU")} <span style={{ fontSize: 14, color: C.textSecondary, fontWeight: 600, letterSpacing: 0 }}>R$</span>
            </div>
            <div style={{ fontSize: 11, color: C.textTertiary, marginTop: 2, ...tabular }}>
              #{shortId} · {fmtRelative(order.createdAt)}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <Avatar name={avatarSeed} platform={platform} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 15, fontWeight: 600, color: C.textPrimary,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {displayName}
            </div>
            {subHandle && (
              <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 1, ...tabular }}>
                {subHandle}
              </div>
            )}
          </div>
          {isHistory && (
            <span style={{
              fontSize: 11, color: C.textTertiary, fontWeight: 500,
              padding: "4px 10px", borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              flexShrink: 0,
            }}>
              {detailsOpen ? "Скрыть" : "Детали"}
            </span>
          )}
        </div>

        {!detailsOpen && order.status === "REJECTED" && order.rejectionReason && (
          <div style={{
            marginTop: 10, padding: "8px 11px",
            background: `${C.red}14`, borderRadius: 10,
            fontSize: 12, color: C.red,
            display: "flex", gap: 7,
            overflow: "hidden",
          }}>
            <span style={{ flexShrink: 0 }}>💬</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {order.rejectionReason}
            </span>
          </div>
        )}
      </div>

      {/* ─── Body ─── */}
      {(isActive || detailsOpen) && (
        <div onClick={e => e.stopPropagation()} style={{ padding: "0 18px 16px" }}>
          <div style={{ height: 1, background: C.hairline, marginBottom: 4 }} />

          {order.gamepassUrl ? (
            <Row label="Геймпасс">
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <a
                  href={order.gamepassUrl} target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{
                    color: C.blue, fontSize: 15.5, fontWeight: 500,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    minWidth: 0, flex: 1, textDecoration: "none",
                  }}>
                  {order.gamepassUrl.replace(/^https?:\/\//, "")}
                </a>
                <CopyBtn text={order.gamepassUrl} label="Ссылка" />
              </div>
            </Row>
          ) : order.status === "AWAITING_GAMEPASS" ? (
            <Row label="Геймпасс">
              <span style={{ fontSize: 14.5, color: C.textTertiary, fontStyle: "italic" }}>
                Ждём ссылку от пользователя
              </span>
            </Row>
          ) : null}

          {(order.robloxUsername || (detailsOpen && (displayCreator || fetchedCreator === false))) && (
            <>
              <Divider />
              <Row label="Ник в Roblox">
                {fetchedCreator === false && !order.robloxUsername ? (
                  <span style={{ fontSize: 14.5, color: C.textTertiary }}>загружаю…</span>
                ) : (order.robloxUsername ?? displayCreator) ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary }}>
                      {order.robloxUsername ?? displayCreator}
                    </span>
                    <CopyBtn text={order.robloxUsername ?? displayCreator ?? ""} label="Ник" />
                  </div>
                ) : (
                  <span style={{ fontSize: 14.5, color: C.textTertiary }}>—</span>
                )}
              </Row>
            </>
          )}

          {!order.isDirectOrder && (
            <>
              <Divider />
              <Row label="Код WB">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontFamily: MONO,
                    fontSize: 19, fontWeight: 700, color: C.accent,
                    letterSpacing: 2.2,
                  }}>
                    {order.wbCode}
                  </span>
                  <CopyBtn text={order.wbCode} label="Код" />
                </div>
              </Row>
            </>
          )}

          <Divider />
          <Row label="Пользователь">
            {(() => {
              const realName = order.user.name && order.user.name !== "VK User" ? order.user.name : null;
              const linkStyle = { color: "#7ec5ff", textDecoration: "none" as const, cursor: "pointer" as const };
              const handleTap = (e: React.MouseEvent) => {
                e.stopPropagation();
                haptic.impact("light");
                openContact(order.user);
              };
              if (order.user.username) {
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span onClick={handleTap} style={{ fontSize: 17, fontWeight: 600, ...linkStyle, fontFamily: MONO }}>
                        @{order.user.username}
                      </span>
                      <CopyBtn text={`@${order.user.username}`} />
                    </div>
                    <span style={{ fontSize: 12.5, color: C.textTertiary, ...tabular }}>
                      {realName ? `${realName} · ` : ""}
                      {order.user.tgId ? `TG · ${order.user.tgId}` : order.user.vkId ? `VK · ${order.user.vkId}` : ""}
                    </span>
                  </div>
                );
              }
              if (realName) {
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span onClick={handleTap} style={{ fontSize: 17, fontWeight: 600, ...linkStyle }}>{realName}</span>
                      <CopyBtn text={realName} />
                    </div>
                    <span style={{ fontSize: 12.5, color: C.textTertiary, ...tabular }}>
                      {order.user.tgId ? `TG · ${order.user.tgId}` : order.user.vkId ? `VK · ${order.user.vkId}` : ""}
                    </span>
                  </div>
                );
              }
              if (order.user.tgId) {
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span onClick={handleTap} style={{ fontSize: 17, fontWeight: 600, ...linkStyle, ...tabular }}>TG · {order.user.tgId}</span>
                    <CopyBtn text={order.user.tgId} />
                  </div>
                );
              }
              if (order.user.vkId) {
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span onClick={handleTap} style={{ fontSize: 17, fontWeight: 600, ...linkStyle, ...tabular }}>vk.com/id{order.user.vkId}</span>
                    <CopyBtn text={order.user.vkId} />
                  </div>
                );
              }
              return <span style={{ fontSize: 14.5, color: C.textTertiary }}>—</span>;
            })()}
          </Row>

          {order.purchaseRate != null && (
            <>
              <Divider />
              <Row label="Себестоимость">
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, ...tabular }}>
                    ${(order.amount / 1000 * order.purchaseRate).toFixed(2)}
                  </span>
                  <span style={{ fontSize: 12.5, color: C.textSecondary, ...tabular }}>
                    по ${order.purchaseRate}/1K R$
                  </span>
                </div>
              </Row>
            </>
          )}

          {order.paymentDetails && (
            <>
              <Divider />
              <Row label="Реквизиты">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontSize: 14.5, color: "#e5e5ea",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {order.paymentDetails}
                  </span>
                  <CopyBtn text={order.paymentDetails} label="Реквизиты" />
                </div>
              </Row>
            </>
          )}

          {detailsOpen && order.rejectionReason && order.status === "REJECTED" && (
            <>
              <Divider />
              <Row label="Причина">
                <span style={{ fontSize: 15, color: C.red, lineHeight: 1.45 }}>{order.rejectionReason}</span>
              </Row>
            </>
          )}

          {detailsOpen && order.reviewStatus != null && (() => {
            const bonus = order.reviewStatus === "SUBMITTED"
              ? bonusExpiryInfo(order.user.reviewBonusGrantedAt, order.user.balance)
              : null;
            return (
              <>
                <Divider />
                <Row label="Отзыв WB">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {order.reviewStatus === "SUBMITTED" ? (
                      <span style={{ color: C.green, fontSize: 15, fontWeight: 600 }}>
                        ⭐ Получен · +100&nbsp;R$ начислено
                      </span>
                    ) : (
                      <span style={{ color: C.yellow, fontSize: 15 }}>
                        📸 Ожидается от пользователя
                      </span>
                    )}
                    {bonus && (
                      <div style={{
                        display: "flex", flexDirection: "column", gap: 2,
                        padding: "10px 12px", borderRadius: 12,
                        background: `${bonus.color}14`,
                        border: `1px solid ${bonus.color}33`,
                      }}>
                        <span style={{ fontSize: 14, color: bonus.color, fontWeight: 600 }}>
                          ⏳ Сгорает через {bonus.daysLeft}&nbsp;{daysWord(bonus.daysLeft)}
                        </span>
                        <span style={{ fontSize: 12, color: C.textSecondary, ...tabular }}>
                          до&nbsp;{bonus.expiryStr} · на счету {bonus.balance}&nbsp;R$
                        </span>
                      </div>
                    )}
                  </div>
                </Row>
              </>
            );
          })()}

          {detailsOpen && (
            <>
              <Divider />
              <div style={{
                display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
                fontSize: 12, color: C.textTertiary, ...tabular, paddingTop: 10,
              }}>
                <span>Создан · {fmtFull(order.createdAt)}</span>
                <span>Обновлён · {fmtFull(order.updatedAt)}</span>
              </div>
            </>
          )}

          <Divider />
          <div style={{ paddingTop: 12 }}>
            <NotesEditor order={order} onSave={onSaveNote} />
          </div>

          <ContactButton user={order.user} />
        </div>
      )}

      {/* ─── Actions ─── */}
      {isActive && (
        <div onClick={e => e.stopPropagation()} style={{
          borderTop: `1px solid ${C.hairline}`,
          padding: "12px 16px 14px",
          display: "flex", flexDirection: "column", gap: 10,
          background: "rgba(0,0,0,0.12)",
        }}>
          <ActionBar order={order} onRunAction={onRunAction} />
          <QuickTools order={order} />
          {onGoToBossrobux && order.gamepassUrl && (order.status === "PENDING" || order.status === "IN_PROGRESS") && (
            <button
              className="twa-press"
              onClick={e => { e.stopPropagation(); haptic.impact("light"); onGoToBossrobux(extractGamepassId(order.gamepassUrl) ?? undefined); }}
              style={{
                width: "100%", padding: "11px", border: "none", borderRadius: 12,
                background: "rgba(191,90,242,0.14)", color: C.accent,
                fontSize: 13.5, fontWeight: 600, cursor: "pointer", letterSpacing: 0.1,
              }}
            >
              🛒 Выкупить через Boss Robux
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Search input — debounced, with clear button
   ───────────────────────────────────────────────────────────────────────── */
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
          title="Очистить"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* shiftCounts — move one order between status buckets in the chip counts.
   ALL stays constant (an order changing status doesn't change the grand total). */
function shiftCounts(counts: Record<string, number>, from: string, to: string): Record<string, number> {
  const next = { ...counts };
  if (from in next) next[from] = Math.max(0, (next[from] ?? 0) - 1);
  if (to in next)   next[to]   = (next[to]   ?? 0) + 1;
  return next;
}

function shiftSums(sums: Record<string, number>, from: string, to: string, amount: number): Record<string, number> {
  const next = { ...sums };
  if (from in next) next[from] = Math.max(0, (next[from] ?? 0) - amount);
  if (to in next)   next[to]   = (next[to]   ?? 0) + amount;
  return next;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Main screen
   ───────────────────────────────────────────────────────────────────────── */
export default function OrdersScreen({
  token, onGoToBossrobux, onActionDone, initialQuery, onInitialQueryConsumed,
}: {
  token: string;
  onGoToBossrobux?: (gamepassId?: string) => void;
  onActionDone?: () => void;
  initialQuery?: string;
  onInitialQueryConsumed?: () => void;
}) {
  const [filter,    setFilter]    = useState<FilterStatus>("ALL");
  const [query,     setQuery]     = useState(initialQuery ?? "");
  useEffect(() => {
    if (initialQuery) onInitialQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [data,        setData]        = useState<OrdersData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page,        setPage]        = useState(1);
  const [allOrders,   setAllOrders]   = useState<Order[]>([]);
  const [exiting,     setExiting]     = useState<Set<string>>(new Set());
  const reqIdRef = useRef(0);

  // Deferred-enrichment cache: id → signals. Applied to every fetched page so
  // the chips survive filter switches without re-requesting.
  const enrichCache  = useRef<Map<string, EnrichValue>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  const applyCache = useCallback((list: Order[]): Order[] =>
    list.map(o => {
      const e = enrichCache.current.get(o.id);
      return e ? { ...o, ...e } : o;
    }), []);

  const fetchOrders = useCallback(async (f: FilterStatus, q: string, p: number, append = false) => {
    if (!append) setLoading(true); else setLoadingMore(true);
    const reqId = ++reqIdRef.current;
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (f === "BUYOUT")   params.set("status", "PENDING,IN_PROGRESS");
      else if (f !== "ALL") params.set("status", f);
      if (q)                params.set("q", q);
      if (append)      params.set("skipCounts", "1");
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

  // Deferred enrichment — runs after the list paints; fills VIP / N-Total / review.
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
      } catch { /* enrichment is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [allOrders, token]);

  const loadMore = useCallback(() => {
    if (!data || page >= data.pages || loadingMore || loading) return;
    const next = page + 1;
    setPage(next);
    fetchOrders(filter, query, next, true);
  }, [data, page, loadingMore, loading, filter, query, fetchOrders]);

  // Infinite scroll — observe a sentinel near the list bottom.
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

  /* Optimistic action: mutate locally first (status + counts + maybe exit),
     POST in the background, roll back on failure. Never refetches the whole
     list, so scroll position and loaded pages are preserved. */
  const runAction = useCallback(async (order: Order, action: string, reason?: string): Promise<ActionResult> => {
    const prevStatus = order.status;
    const newStatus: OrderStatus | null =
      action === "take-work" ? "IN_PROGRESS" :
      action === "untake"    ? "PENDING"     :
      action === "complete"  ? "COMPLETED"   :
      action === "reject"    ? "REJECTED"    : null;
    if (!newStatus) return { ok: false, error: "Invalid action" };

    haptic.impact(action === "complete" ? "medium" : "light");

    const BUYOUT_STATUSES: OrderStatus[] = ["PENDING", "IN_PROGRESS"];
    const leaves = filter !== "ALL" && (
      filter === "BUYOUT" ? !BUYOUT_STATUSES.includes(newStatus) : filter !== newStatus
    );

    setAllOrders(prev => prev.map(o => o.id === order.id
      ? { ...o, status: newStatus, rejectionReason: action === "reject" ? (reason || "не указана") : o.rejectionReason }
      : o));
    setData(prev => prev ? {
      ...prev,
      counts: shiftCounts(prev.counts, prevStatus, newStatus),
      sums: prev.sums ? shiftSums(prev.sums, prevStatus, newStatus, order.amount) : prev.sums,
    } : prev);
    if (leaves) setExiting(prev => new Set(prev).add(order.id));

    const rollback = () => {
      setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: prevStatus } : o));
      setData(prev => prev ? {
        ...prev,
        counts: shiftCounts(prev.counts, newStatus, prevStatus),
        sums: prev.sums ? shiftSums(prev.sums, newStatus, prevStatus, order.amount) : prev.sums,
      } : prev);
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
      toast(
        action === "complete"  ? "Заказ выкуплен ✓" :
        action === "take-work" ? "Взято в работу"   :
        action === "untake"    ? "Возвращён в «Новые»" :
                                 "Заказ отклонён",
        action === "reject" ? "default" : "success",
      );
      return { ok: true };
    } catch {
      rollback(); haptic.notify("error");
      return { ok: false, error: "Ошибка сети" };
    }
  }, [token, filter, onActionDone]);

  /* Admin note save — optimistic patch + POST, rollback on failure. Status/counts
     are untouched, so this never reorders or drops the card. */
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

  const urgentCount = data ? URGENT_STATUSES.reduce((sum, s) => sum + (data.counts[s] ?? 0), 0) : 0;

  const summaryText = useMemo(() => {
    if (!data) return "";
    if (query) return `По запросу «${query}» · ${data.total}`;
    if (filter === "ALL") return `Всего · ${data.total}`;
    if (filter === "BUYOUT") return `К выкупу · ${data.total}`;
    return `Найдено · ${data.total}`;
  }, [data, query, filter]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: C.bg }}>

      {/* Sticky top: search + chips */}
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
            const count    = f.id === "BUYOUT"
              ? (data?.counts["PENDING"] ?? 0) + (data?.counts["IN_PROGRESS"] ?? 0)
              : data?.counts[f.id] ?? 0;
            const isActive = filter === f.id;
            const isUrgent = (f.id === "BUYOUT" || URGENT_STATUSES.includes(f.id as OrderStatus)) && count > 0;
            return (
              <button
                key={f.id}
                className="twa-press-sm"
                onClick={() => { if (f.id !== filter) haptic.select(); setFilter(f.id); }}
                style={{
                  flexShrink: 0, padding: "6.5px 13px", borderRadius: 999,
                  border: "none",
                  background: isActive ? C.accent : "rgba(118,118,128,0.22)",
                  color:      isActive ? "#fff"  : C.textPrimary,
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  letterSpacing: 0.1,
                }}
              >
                {f.label}
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
        {/* Mini dashboard */}
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
              {urgentCount > 0 && filter === "ALL" && !query && (
                <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>
                  ⚡ {urgentCount} требуют обработки
                </span>
              )}
            </div>

            {allOrders.map(order => (
              <OrderCard
                key={order.id}
                order={order}
                token={token}
                exiting={exiting.has(order.id)}
                onGoToBossrobux={onGoToBossrobux}
                onRunAction={(action, reason) => runAction(order, action, reason)}
                onSaveNote={(note) => saveNote(order.id, note)}
              />
            ))}

            {/* Infinite-scroll sentinel + status footer */}
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

/* ───────────── MiniDashboard — compact robux stats above the list ───────────── */
function fmtRobux(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000)    return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ru-RU");
}

const DASHBOARD_GROUPS: { key: string; label: string; statuses: string[]; filter: FilterStatus; color: string; icon: string }[] = [
  { key: "buyout",  label: "К выкупу",    statuses: ["PENDING", "IN_PROGRESS"],               filter: "BUYOUT",           color: C.green,  icon: "R$" },
  { key: "link",    label: "Ждут ссылку", statuses: ["AWAITING_GAMEPASS"],                    filter: "AWAITING_GAMEPASS", color: C.yellow, icon: "🔗" },
  { key: "payment", label: "Ждут оплату", statuses: ["AWAITING_PAYMENT", "PAYMENT_PENDING"],  filter: "AWAITING_PAYMENT",  color: C.orange, icon: "💳" },
];

function MiniDashboard({ counts, sums, onTap }: {
  counts: Record<string, number>;
  sums: Record<string, number>;
  onTap: (filter: FilterStatus) => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 8,
      padding: "0 16px 6px",
    }}>
      {DASHBOARD_GROUPS.map(g => {
        const count = g.statuses.reduce((s, st) => s + (counts[st] ?? 0), 0);
        const robux = g.statuses.reduce((s, st) => s + (sums[st] ?? 0), 0);
        if (count === 0) return null;
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
              {g.icon} {g.label}
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: C.textPrimary,
              letterSpacing: -0.5, ...tabular, lineHeight: 1.1,
              position: "relative",
            }}>
              {fmtRobux(robux)}
              <span style={{ fontSize: 11, fontWeight: 500, color: C.textSecondary, marginLeft: 2 }}>R$</span>
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

function EmptyState({ filter, query }: { filter: FilterStatus; query: string }) {
  if (query) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
        <div style={{ fontSize: 14, marginBottom: 4 }}>Ничего не нашлось</div>
        <div style={{ fontSize: 12, color: C.textTertiary }}>
          Попробуй ник Roblox, @username, WB-код или TG/VK ID
        </div>
      </div>
    );
  }
  const labels: Record<FilterStatus, string> = {
    ALL:               "Заказов пока нет",
    BUYOUT:            "Нет заказов к выкупу",
    AWAITING_PAYMENT:  "Нет ожидающих реквизиты",
    PAYMENT_PENDING:   "Нет ожидающих оплату",
    PENDING:           "Нет новых заказов",
    IN_PROGRESS:       "Нет заказов в работе",
    AWAITING_GAMEPASS: "Нет ожидающих ссылку",
    COMPLETED:         "Нет завершённых заказов",
    REJECTED:          "Нет отклонённых заказов",
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
      {[120, 100, 120, 100].map((h, i) => (
        <div key={i} style={{
          background: C.card, borderRadius: 18, height: h,
          animation: "pulse 1.5s ease-in-out infinite",
          boxShadow: SHADOW.card,
        }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
    </div>
  );
}
