"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   Palette — refined Apple-style dark, vibrant accents at limited contrast,
   hairlines instead of thick borders. Tokens are referenced everywhere so the
   look stays consistent across the screen.
   ───────────────────────────────────────────────────────────────────────── */
const C = {
  bg:          "#1c1c1e",
  card:        "#2c2c2e",
  cardTop:     "rgba(255,255,255,0.04)",      // inner top-edge highlight
  cardShadow:  "0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 20px rgba(0,0,0,0.18)",
  elevated:    "#3a3a3c",
  hairline:    "rgba(255,255,255,0.07)",
  textPrimary: "#f2f2f7",
  textSecondary:"#98989d",
  textTertiary:"#636366",
  accent:      "#bf5af2",
  green:       "#30d158",
  red:         "#ff453a",
  yellow:      "#ffd60a",
  orange:      "#ff9f0a",
  blue:        "#0a84ff",
};

const tabular = { fontVariantNumeric: "tabular-nums" as const };

type OrderStatus = "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED";
type FilterStatus = OrderStatus | "ALL";

interface Order {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  status: OrderStatus;
  platform: string;
  wbCode: string;
  rejectionReason: string | null;
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
  page: number;
  pages: number;
}

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  AWAITING_GAMEPASS: { label: "Ждёт ссылку", color: C.yellow },
  PENDING:           { label: "Новый",        color: C.accent },
  IN_PROGRESS:       { label: "В работе",     color: C.orange },
  COMPLETED:         { label: "Завершён",     color: C.green  },
  REJECTED:          { label: "Отклонён",     color: C.red    },
};

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: "ALL",               label: "Все"         },
  { id: "PENDING",           label: "Новые"       },
  { id: "IN_PROGRESS",       label: "В работе"    },
  { id: "AWAITING_GAMEPASS", label: "Ждут ссылку" },
  { id: "COMPLETED",         label: "Готово"      },
  { id: "REJECTED",          label: "Отклонено"   },
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

function CopyBtn({ text, variant = "ghost" }: { text: string; variant?: "ghost" | "tinted" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => {
        e.stopPropagation();
        copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      style={{
        background:
          copied ? `${C.green}26` :
          variant === "tinted" ? "rgba(255,255,255,0.06)" : "transparent",
        border:    "none",
        borderRadius: 8,
        color:     copied ? C.green : C.textSecondary,
        fontSize:  12.5,
        fontWeight: 500,
        padding:   "6px 11px",
        cursor:    "pointer",
        flexShrink:0,
        transition:"background 0.18s, color 0.18s",
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

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
      color, background: `${color}1c`,
      padding: "2.5px 8px", borderRadius: 999, whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

/* OrderNumberChip — shows "N/Total" where N is the cluster-relative position.
   Cluster = same person across TG/VK/Roblox identity union. Pale-blue for 1st,
   neutral for 2-4, gold for 5+ (VIP). */
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
  return <Chip color={color}>{isVip && "👑 "}{label}</Chip>;
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

/* ───────────── ActionBar (preserved logic, polished visuals) ───────────── */
function ActionBar({
  order, token, onDone,
}: { order: Order; token: string; onDone: () => void }) {
  const [loading,      setLoading]      = useState(false);
  const [rejectMode,   setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [err,          setErr]          = useState("");

  async function doAction(action: string, extra?: Record<string, unknown>) {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId: order.id, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Ошибка"); return; }
      onDone();
    } catch { setErr("Ошибка сети"); }
    finally  { setLoading(false); }
  }

  if (rejectMode) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
            onClick={() => setRejectMode(false)}
            style={btn(C.elevated, C.textSecondary, 1)}
          >
            Отмена
          </button>
          <button
            onClick={() => doAction("reject", { reason: rejectReason || "не указана" })}
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
  const showComplete = order.status === "PENDING" || order.status === "IN_PROGRESS";
  const showReject   = ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status);
  const hasMain      = showTakeWork || showComplete;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {showTakeWork && (
          <button onClick={() => doAction("take-work")} disabled={loading}
            style={{ ...btn(C.orange, "#fff", 1), opacity: loading ? 0.7 : 1 }}>
            {loading ? "…" : "В работу"}
          </button>
        )}
        {showComplete && (
          <button onClick={() => doAction("complete")} disabled={loading}
            style={{ ...btn(C.green, "#fff", 2), opacity: loading ? 0.7 : 1, fontWeight: 700 }}>
            {loading ? "…" : "✓ Выкуплено"}
          </button>
        )}
        {showReject && hasMain && (
          <button onClick={() => setRejectMode(true)} disabled={loading}
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
        <button onClick={() => setRejectMode(true)} disabled={loading}
          style={{
            width: "100%", padding: "11px", borderRadius: 12,
            border: `1px solid ${C.red}55`, background: "transparent",
            color: C.red, fontSize: 14, fontWeight: 500, cursor: "pointer",
          }}>
          Отклонить заказ
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

function extractGamepassId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass\/(\d+)/i);
  return m ? m[1] : null;
}

/* ───────────── Contact button — direct chat link ─────────────
   Inside Telegram WebApp:
   - Telegram.WebApp.openTelegramLink ONLY accepts https://t.me/* URLs.
     Passing tg://user?id=... is silently ignored — that was the "ничего не происходит"
     bug for users without a public @username (item 3).
   - For tgId-only users there is no reliable in-WebApp way to open the profile,
     so we always copy the ID to clipboard as a guaranteed fallback, then attempt
     the deep link via openLink and window.location as best-effort.
   Result: тап на кнопку всегда что-то делает (минимум — ID в буфере + тост).
*/
function openContact(
  user: Order["user"],
  notify: (msg: string) => void,
) {
  const tg = (typeof window !== "undefined" ? window.Telegram?.WebApp : undefined) as any;
  if (user.username) {
    const url = `https://t.me/${user.username}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
    return;
  }
  if (user.tgId) {
    // Best-effort: try opening the deep link via the generic openLink
    // (some clients pass tg:// through to the system handler), then via
    // window.location as a second attempt. Both may silently no-op.
    const deepLink = `tg://user?id=${user.tgId}`;
    try { tg?.openLink?.(deepLink); } catch {}
    try { window.location.href = deepLink; } catch {}
    // Guaranteed fallback — copy the ID so the manager can paste it
    // into Telegram's global search and open the profile in one tap.
    copyText(String(user.tgId));
    notify(`📋 ID ${user.tgId} скопирован — вставь в поиск Telegram`);
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
  const [toast, setToast] = useState<string | null>(null);
  const label = contactLabel(user);
  if (!label) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={e => {
          e.stopPropagation();
          openContact(user, msg => {
            setToast(msg);
            setTimeout(() => setToast(null), 2400);
          });
        }}
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
      {toast && (
        <div style={{
          marginTop: 8, padding: "8px 12px", borderRadius: 10,
          background: `${C.green}26`, color: C.green,
          fontSize: 12.5, fontWeight: 500, textAlign: "center" as const,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ───────────── User identity helpers — @username everywhere ─────────────
   Display priority for TG users: @username (canonical) → name → "TG · <id>".
   For VK: name (enriched from VK API) → "VK · <id>".
*/
function userDisplayName(u: Order["user"]): string {
  if (u.username) return `@${u.username}`;
  const realName = u.name && u.name !== "VK User" ? u.name : null;
  if (realName) return realName;
  if (u.tgId)    return `TG · ${u.tgId}`;
  if (u.vkId)    return `VK · ${u.vkId}`;
  return "—";
}
function userSubHandle(u: Order["user"]): string {
  // Show the secondary identifier under the main name when both exist.
  if (u.username && u.name && u.name !== "VK User") return u.name;
  if (u.tgId)    return `TG · ${u.tgId}`;
  if (u.vkId)    return `VK · ${u.vkId}`;
  return "";
}

/* ─────────────────────────────────────────────────────────────────────────────
   OrderCard — premium hierarchy
   ───────────────────────────────────────────────────────────────────────── */
function OrderCard({
  order, token, onGoToBossrobux, onRefresh,
}: { order: Order; token: string; onGoToBossrobux?: (gamepassId?: string) => void; onRefresh: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fetchedCreator, setFetchedCreator] = useState<string | false | null>(null);

  const isActive  = ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status);
  const isHistory = ["COMPLETED", "REJECTED"].includes(order.status);

  // User identity for the card header — @username canonical, with secondary line
  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const displayName = userDisplayName(order.user);
  const subHandle   = userSubHandle(order.user);
  // Avatar uses the real name when available (better visual identity than "@handle"),
  // otherwise falls back to the display name.
  const avatarSeed  = (order.user.name && order.user.name !== "VK User")
    ? order.user.name
    : displayName;

  const displayCreator = order.robloxUsername
    ?? (typeof fetchedCreator === "string" ? fetchedCreator || null : null);
  const shortId = order.id.slice(-6).toUpperCase();

  // Late-fetch Roblox username for older orders missing it from DB
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
    <article style={{
      background: C.card,
      borderRadius: 18,
      overflow: "hidden",
      boxShadow: C.cardShadow,
      position: "relative",
    }}>
      {/* Inner top-edge highlight */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: 18, pointerEvents: "none",
        background: `linear-gradient(180deg, ${C.cardTop} 0%, rgba(255,255,255,0) 28%)`,
      }} />

      {/* ─── Header ─── */}
      <div
        onClick={() => isHistory && setDetailsOpen(d => !d)}
        style={{ padding: "14px 16px 12px", cursor: isHistory ? "pointer" : "default", position: "relative" }}
      >
        {/* Top row: status + chips + amount */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
            <StatusPill status={order.status} />
            <OrderNumberChip n={order.userOrderNumber} total={order.userOrderTotal} />
            {order.isDirectOrder && <Chip color={C.blue}>ПРЯМОЙ</Chip>}
            {order.reviewStatus === "PENDING"   && <Chip color={C.yellow}>📸 ОТЗЫВ</Chip>}
            {order.reviewStatus === "SUBMITTED" && <Chip color={C.green}>⭐ ОТЗЫВ</Chip>}
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

        {/* Bottom row: avatar + user identity */}
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

        {/* Rejection reason preview (collapsed cards) */}
        {!detailsOpen && order.status === "REJECTED" && order.rejectionReason && (
          <div style={{
            marginTop: 10, padding: "8px 11px",
            background: `${C.red}14`, borderRadius: 10,
            fontSize: 12, color: C.red,
            display: "flex", gap: 7,
            overflow: "hidden",
          }}>
            <span style={{ flexShrink: 0 }}>💬</span>
            <span style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {order.rejectionReason}
            </span>
          </div>
        )}
      </div>

      {/* ─── Body ─── */}
      {(isActive || detailsOpen) && (
        <div onClick={e => e.stopPropagation()} style={{ padding: "0 18px 16px" }}>
          <div style={{ height: 1, background: C.hairline, marginBottom: 4 }} />

          {/* Gamepass URL */}
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
                <CopyBtn text={order.gamepassUrl} />
              </div>
            </Row>
          ) : order.status === "AWAITING_GAMEPASS" ? (
            <Row label="Геймпасс">
              <span style={{ fontSize: 14.5, color: C.textTertiary, fontStyle: "italic" }}>
                Ждём ссылку от пользователя
              </span>
            </Row>
          ) : null}

          {/* Roblox username */}
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
                    <CopyBtn text={order.robloxUsername ?? displayCreator ?? ""} />
                  </div>
                ) : (
                  <span style={{ fontSize: 14.5, color: C.textTertiary }}>—</span>
                )}
              </Row>
            </>
          )}

          {/* WB code */}
          {!order.isDirectOrder && (
            <>
              <Divider />
              <Row label="Код WB">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 19, fontWeight: 700, color: C.accent,
                    letterSpacing: 2.2,
                  }}>
                    {order.wbCode}
                  </span>
                  <CopyBtn text={order.wbCode} />
                </div>
              </Row>
            </>
          )}

          {/* User identity — tappable name opens profile/chat, @username copyable */}
          <Divider />
          <Row label="Пользователь">
            {(() => {
              const realName = order.user.name && order.user.name !== "VK User" ? order.user.name : null;
              const linkStyle = { color: "#7ec5ff", textDecoration: "none" as const, cursor: "pointer" as const };
              const handleTap = (e: React.MouseEvent) => {
                e.stopPropagation();
                openContact(order.user, () => {});
              };
              if (order.user.username) {
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span onClick={handleTap} style={{ fontSize: 17, fontWeight: 600, ...linkStyle, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
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

          {/* Purchase cost */}
          {order.purchaseRate != null && (
            <>
              <Divider />
              <Row label="Себестоимость">
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, ...tabular }}>
                    {Math.round(order.amount * order.purchaseRate).toLocaleString("ru-RU")} ₽
                  </span>
                  <span style={{ fontSize: 12.5, color: C.textSecondary, ...tabular }}>
                    по {order.purchaseRate} ₽/R$
                  </span>
                </div>
              </Row>
            </>
          )}

          {/* Payment details (direct) */}
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
                  <CopyBtn text={order.paymentDetails} />
                </div>
              </Row>
            </>
          )}

          {/* Rejection reason (full) */}
          {detailsOpen && order.rejectionReason && order.status === "REJECTED" && (
            <>
              <Divider />
              <Row label="Причина">
                <span style={{ fontSize: 15, color: C.red, lineHeight: 1.45 }}>{order.rejectionReason}</span>
              </Row>
            </>
          )}

          {/* Review status + bonus expiry timer */}
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

          {/* Timestamps */}
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

          {/* Write-to-user button — surfaces in both active and historical contexts */}
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
          <ActionBar order={order} token={token} onDone={onRefresh} />
          {onGoToBossrobux && order.gamepassUrl && (order.status === "PENDING" || order.status === "IN_PROGRESS") && (
            <button
              onClick={e => { e.stopPropagation(); onGoToBossrobux(extractGamepassId(order.gamepassUrl) ?? undefined); }}
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
        placeholder="Ник Roblox, ID, ссылка, WB-код, TG/VK"
        style={{
          background: "transparent", border: "none", outline: "none",
          color: C.textPrimary, fontSize: 14.5, flex: 1, minWidth: 0,
          padding: 0, fontFamily: "inherit",
        }}
      />
      {local && (
        <button
          onClick={() => { setLocal(""); onChange(""); }}
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

/* ─────────────────────────────────────────────────────────────────────────────
   Main screen
   ───────────────────────────────────────────────────────────────────────── */
export default function OrdersScreen({
  token, onGoToBossrobux, initialQuery, onInitialQueryConsumed,
}: {
  token: string;
  onGoToBossrobux?: (gamepassId?: string) => void;
  initialQuery?: string;
  onInitialQueryConsumed?: () => void;
}) {
  const [filter,    setFilter]    = useState<FilterStatus>("ALL");
  const [query,     setQuery]     = useState(initialQuery ?? "");
  useEffect(() => {
    if (initialQuery) onInitialQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [data,      setData]      = useState<OrdersData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page,      setPage]      = useState(1);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const reqIdRef = useRef(0);

  const cacheKey = useCallback((f: FilterStatus, q: string) =>
    `twa_orders_${f}_${q}`, []);

  const fetchOrders = useCallback(async (f: FilterStatus, q: string, p: number, append = false) => {
    if (!append) setLoading(true); else setLoadingMore(true);
    const reqId = ++reqIdRef.current;
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (f !== "ALL") params.set("status", f);
      if (q)           params.set("q", q);
      if (append)      params.set("skipCounts", "1");
      const res = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || reqId !== reqIdRef.current) return;
      const d: OrdersData = await res.json();
      if (reqId !== reqIdRef.current) return;
      setData(prev => append && prev
        ? { ...d, counts: prev.counts }
        : d);
      setAllOrders(prev => append ? [...prev, ...d.orders] : d.orders);
      if (p === 1 && !append) {
        try { sessionStorage.setItem(cacheKey(f, q), JSON.stringify({ t: Date.now(), d })); } catch {}
      }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [token, cacheKey]);

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    const key = cacheKey(filter, query);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const { t, d } = JSON.parse(raw) as { t: number; d: OrdersData };
        if (Date.now() - t < 60_000) {
          setData(d);
          setAllOrders(d.orders);
          setLoading(false);
          fetchOrders(filter, query, 1, false);
          return;
        }
      }
    } catch {}
    fetchOrders(filter, query, 1, false);
  }, [filter, query, fetchOrders, cacheKey]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchOrders(filter, query, next, true);
  };

  const urgentCount = data ? ((data.counts["PENDING"] ?? 0) + (data.counts["IN_PROGRESS"] ?? 0)) : 0;

  const summaryText = useMemo(() => {
    if (!data) return "";
    if (query) return `По запросу «${query}» · ${data.total}`;
    return filter === "ALL" ? `Всего · ${data.total}` : `Найдено · ${data.total}`;
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

        <div className="orders-chips" style={{
          display: "flex", gap: 7,
          overflowX: "auto", scrollbarWidth: "none",
          marginRight: -16, paddingRight: 16,           // edge-fade bleed
        }}>
          <style>{`.orders-chips::-webkit-scrollbar{display:none}`}</style>
          {FILTERS.map(f => {
            const count    = data?.counts[f.id] ?? 0;
            const isActive = filter === f.id;
            const isUrgent = (f.id === "PENDING" || f.id === "IN_PROGRESS") && count > 0;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  flexShrink: 0, padding: "6.5px 13px", borderRadius: 999,
                  border: "none",
                  background: isActive ? C.accent : "rgba(118,118,128,0.22)",
                  color:      isActive ? "#fff"  : C.textPrimary,
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  transition: "background 0.15s, color 0.15s",
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
        {loading ? (
          <Skeleton />
        ) : allOrders.length === 0 ? (
          <EmptyState filter={filter} query={query} />
        ) : (
          <div style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 11 }}>
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
                onGoToBossrobux={onGoToBossrobux}
                onRefresh={() => fetchOrders(filter, query, 1, false)}
              />
            ))}

            {data && page < data.pages && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: "rgba(118,118,128,0.18)", border: "none", borderRadius: 12,
                  color: loadingMore ? C.textTertiary : C.textPrimary,
                  fontSize: 14, fontWeight: 500, padding: "13px",
                  cursor: loadingMore ? "default" : "pointer",
                  marginTop: 4, opacity: loadingMore ? 0.6 : 1,
                  letterSpacing: 0.1,
                }}
              >
                {loadingMore ? "Загрузка…" : `Показать ещё (${data.total - allOrders.length})`}
              </button>
            )}
          </div>
        )}
      </div>
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
          Попробуй ник Roblox, ID геймпасса, WB-код или TG/VK ID
        </div>
      </div>
    );
  }
  const labels: Record<FilterStatus, string> = {
    ALL:               "Заказов пока нет",
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
          boxShadow: C.cardShadow,
        }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
    </div>
  );
}
