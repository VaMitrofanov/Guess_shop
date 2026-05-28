"use client";
import { useEffect, useState, useCallback, useRef } from "react";

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a",
  orange: "#ff9f0a", blue: "#0a84ff",
  sec: "#8e8e93", muted: "#48484a", bg: "#1c1c1e",
};

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
  createdAt: string;
  updatedAt: string;
  robloxUsername: string | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  user: { tgId: string | null; vkId: string | null; name: string | null };
}

interface OrdersData {
  orders: Order[];
  total: number;
  counts: Record<FilterStatus, number>;
  page: number;
  pages: number;
}

const STATUS_META: Record<OrderStatus, { label: string; color: string; dot: string }> = {
  AWAITING_GAMEPASS: { label: "Ждёт ссылку", color: C.yellow,  dot: "🟡" },
  PENDING:           { label: "Новый",        color: C.accent,  dot: "🟣" },
  IN_PROGRESS:       { label: "В работе",     color: C.orange,  dot: "🟠" },
  COMPLETED:         { label: "Завершён",      color: C.green,   dot: "🟢" },
  REJECTED:          { label: "Отклонён",      color: C.red,     dot: "🔴" },
};

const FILTERS: { id: FilterStatus; label: string }[] = [
  { id: "ALL",              label: "Все"         },
  { id: "PENDING",          label: "Новые"       },
  { id: "IN_PROGRESS",      label: "В работе"    },
  { id: "AWAITING_GAMEPASS",label: "Ждут ссылку" },
  { id: "COMPLETED",        label: "Готово"      },
  { id: "REJECTED",         label: "Отклонено"   },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = (now.getTime() - d.getTime()) / 60000;
  if (diffMin < 60) return `${Math.round(diffMin)} мин назад`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)} ч назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={e => { e.stopPropagation(); copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{
        background: copied ? C.green : C.elevated, border: "none", borderRadius: 6,
        color: "#fff", fontSize: 11, padding: "3px 8px", cursor: "pointer",
        flexShrink: 0, transition: "background 0.2s",
      }}
    >
      {copied ? "✓" : "Копировать"}
    </button>
  );
}

function ActionBar({ order, token, onDone }: { order: Order; token: string; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [err, setErr] = useState("");

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
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
        <textarea
          placeholder="Причина отклонения…"
          value={rejectReason}
          onChange={e => setRejectReason(e.target.value)}
          rows={2}
          style={{
            background: C.elevated, border: "none", borderRadius: 10, color: "#fff",
            fontSize: 14, padding: "8px 12px", resize: "none", outline: "none", width: "100%",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setRejectMode(false)}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: C.elevated, color: C.sec, fontSize: 13, cursor: "pointer" }}
          >
            Отмена
          </button>
          <button
            onClick={() => doAction("reject", { reason: rejectReason || "не указана" })}
            disabled={loading}
            style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "…" : "❌ Отклонить"}
          </button>
        </div>
        {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {order.status === "PENDING" && (
          <button
            onClick={() => doAction("take-work")}
            disabled={loading}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: C.orange, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "…" : "🟠 В работу"}
          </button>
        )}
        {(order.status === "PENDING" || order.status === "IN_PROGRESS") && (
          <button
            onClick={() => doAction("complete")}
            disabled={loading}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: C.green, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "…" : "✅ Готово"}
          </button>
        )}
        {["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status) && (
          <button
            onClick={() => setRejectMode(true)}
            disabled={loading}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: C.red + "22", color: C.red, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            ❌ Отклонить
          </button>
        )}
      </div>
      {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
    </div>
  );
}

function extractGamepassId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass\/(\d+)/i);
  return m ? m[1] : null;
}

function OrderCard({ order, token, onGoToBossrobux, onRefresh }: { order: Order; token: string; onGoToBossrobux?: (gamepassId?: string) => void; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  // null = not started, false = loading, string = done (empty string = not found)
  const [fetchedCreator, setFetchedCreator] = useState<string | false | null>(null);
  const meta = STATUS_META[order.status];
  const userHandle = order.user.tgId
    ? `TG: ${order.user.tgId}${order.user.name ? ` · ${order.user.name}` : ""}`
    : order.user.vkId
    ? `VK: ${order.user.vkId}${order.user.name ? ` · ${order.user.name}` : ""}`
    : "Неизвестный";

  const shortId = order.id.slice(-6).toUpperCase();
  const displayCreator = order.robloxUsername ?? (typeof fetchedCreator === "string" ? fetchedCreator || null : null);

  useEffect(() => {
    if (!expanded || order.robloxUsername || !order.gamepassUrl || fetchedCreator !== null) return;
    const gpId = extractGamepassId(order.gamepassUrl);
    if (!gpId) return;
    setFetchedCreator(false); // loading
    fetch("/api/twa/bossrobux", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "lookup", gamepassId: gpId }),
    })
      .then(r => r.json())
      .then(d => setFetchedCreator(d?.gamepass?.sellerName ?? ""))
      .catch(() => setFetchedCreator(""));
  }, [expanded, order.robloxUsername, order.gamepassUrl, fetchedCreator, token]);

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: C.card, borderRadius: 14, overflow: "hidden",
        cursor: "pointer", transition: "opacity 0.1s",
        borderLeft: `3px solid ${meta.color}`,
      }}
    >
      {/* Main row */}
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" as const }}>
            <span style={{
              background: meta.color + "22", color: meta.color, fontSize: 11,
              fontWeight: 600, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" as const,
            }}>
              {meta.dot} {meta.label}
            </span>
            {order.isDirectOrder && (
              <span style={{ fontSize: 10, color: C.blue, background: C.blue + "22", padding: "2px 6px", borderRadius: 20 }}>
                прямой
              </span>
            )}
            {order.reviewStatus === "PENDING" && (
              <span style={{ fontSize: 10, color: C.yellow, background: C.yellow + "22", padding: "2px 6px", borderRadius: 20, whiteSpace: "nowrap" as const }}>
                📸 отзыв
              </span>
            )}
            {order.reviewStatus === "SUBMITTED" && (
              <span style={{ fontSize: 10, color: C.green, background: C.green + "22", padding: "2px 6px", borderRadius: 20, whiteSpace: "nowrap" as const }}>
                ⭐ отзыв
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>{order.amount} R$</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.sec }}>{userHandle}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{fmtDate(order.createdAt)}</span>
        </div>

        {/* Gamepass URL preview (always visible if exists) */}
        {order.gamepassUrl && !expanded && (
          <div style={{ marginTop: 6, fontSize: 11, color: C.sec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            🔗 {order.gamepassUrl}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ borderTop: `1px solid ${C.border}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          {/* Gamepass URL */}
          {order.gamepassUrl && (
            <DetailRow label="Геймпасс">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <a
                  href={order.gamepassUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ color: C.blue, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 }}
                >
                  {order.gamepassUrl}
                </a>
                <CopyBtn text={order.gamepassUrl} />
              </div>
            </DetailRow>
          )}

          {/* Roblox username */}
          {(order.gamepassUrl || displayCreator) && (
            <DetailRow label="Ник в Roblox">
              {fetchedCreator === false
                ? <span style={{ fontSize: 13, color: C.sec }}>загружаю…</span>
                : displayCreator
                ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{displayCreator}</span>
                    <CopyBtn text={displayCreator} />
                  </div>
                : <span style={{ fontSize: 13, color: C.muted }}>—</span>}
            </DetailRow>
          )}

          {/* Boss Robux quick buy */}
          {onGoToBossrobux && order.gamepassUrl && (order.status === "PENDING" || order.status === "IN_PROGRESS") && (
            <button
              onClick={e => { e.stopPropagation(); onGoToBossrobux(extractGamepassId(order.gamepassUrl) ?? undefined); }}
              style={{
                width: "100%", padding: "10px", border: "none", borderRadius: 10,
                background: "rgba(191,90,242,0.15)", color: "#bf5af2",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              🛒 Выкупить через Boss Robux
            </button>
          )}

          {/* WB Code */}
          <DetailRow label="Код WB">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 14, color: C.accent, fontWeight: 700 }}>{order.wbCode}</span>
              <CopyBtn text={order.wbCode} />
            </div>
          </DetailRow>

          {/* Platform */}
          <DetailRow label="Платформа">
            <span style={{ fontSize: 13 }}>{order.platform === "TELEGRAM" ? "Telegram" : order.platform === "VK" ? "VK" : order.platform}</span>
          </DetailRow>

          {/* Payment details */}
          {order.paymentDetails && (
            <DetailRow label="Реквизиты">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#e5e5ea" }}>{order.paymentDetails}</span>
                <CopyBtn text={order.paymentDetails} />
              </div>
            </DetailRow>
          )}

          {/* Rejection reason */}
          {order.rejectionReason && (
            <DetailRow label="Причина отклонения">
              <span style={{ fontSize: 12, color: C.red }}>{order.rejectionReason}</span>
            </DetailRow>
          )}

          {/* Order ID */}
          <DetailRow label="ID заказа">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: C.muted }}>{order.id}</span>
              <CopyBtn text={order.id} />
            </div>
          </DetailRow>

          {/* Review status — only for first WB order */}
          {order.reviewStatus != null && (
            <DetailRow label="Отзыв WB">
              {order.reviewStatus === "SUBMITTED"
                ? <span style={{ color: C.green, fontSize: 13, fontWeight: 600 }}>⭐ Получен · +100 R$ начислено</span>
                : <span style={{ color: C.yellow, fontSize: 13 }}>📸 Ожидается от пользователя</span>}
            </DetailRow>
          )}

          {/* Timestamps */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, paddingTop: 4 }}>
            <span>Создан: {new Date(order.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            <span>Обновлён: {new Date(order.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>

          {/* Action buttons */}
          <ActionBar order={order} token={token} onDone={() => { setExpanded(false); onRefresh(); }} />
        </div>
      )}

      {/* Expand toggle */}
      <div style={{ textAlign: "center" as const, padding: "4px 0 8px", color: C.muted, fontSize: 11 }}>
        {expanded ? "▲ свернуть" : "▼ подробнее"}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.sec, marginBottom: 4 }}>{label}</div>
      <div style={{ color: "#e5e5ea" }}>{children}</div>
    </div>
  );
}

export default function OrdersScreen({ token, onGoToBossrobux }: { token: string; onGoToBossrobux?: (gamepassId?: string) => void; }) {
  const [filter,   setFilter]   = useState<FilterStatus>("ALL");
  const [data,     setData]     = useState<OrdersData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page,     setPage]     = useState(1);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const filterRef = useRef<HTMLDivElement>(null);

  const fetchOrders = useCallback(async (f: FilterStatus, p: number, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({ page: String(p), limit: "20" });
      if (f !== "ALL") params.set("status", f);
      const res = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const d: OrdersData = await res.json();
      setData(d);
      setAllOrders(prev => append ? [...prev, ...d.orders] : d.orders);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    fetchOrders(filter, 1, false);
  }, [filter, fetchOrders]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchOrders(filter, next, true);
  };

  const urgentCount = data ? ((data.counts["PENDING"] ?? 0) + (data.counts["IN_PROGRESS"] ?? 0)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Filter chips row */}
      <div
        ref={filterRef}
        style={{
          display: "flex", gap: 8, padding: "10px 16px",
          overflowX: "auto", flexShrink: 0,
          scrollbarWidth: "none",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <style>{`.orders-chips::-webkit-scrollbar{display:none}`}</style>
        {FILTERS.map(f => {
          const count = data?.counts[f.id] ?? 0;
          const isActive = filter === f.id;
          const isUrgent = (f.id === "PENDING" || f.id === "IN_PROGRESS") && count > 0;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                flexShrink: 0, padding: "6px 12px", borderRadius: 20, border: "none",
                background: isActive ? C.accent : C.elevated,
                color: isActive ? "#fff" : C.sec,
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                transition: "background 0.15s, color 0.15s",
                position: "relative" as const,
              }}
            >
              {f.label}
              {count > 0 && (
                <span style={{
                  background: isActive ? "rgba(255,255,255,0.25)" : isUrgent ? C.red : C.muted,
                  color: "#fff", fontSize: 10, fontWeight: 700,
                  padding: "1px 5px", borderRadius: 10, minWidth: 18, textAlign: "center" as const,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
        {loading ? (
          <Skeleton />
        ) : allOrders.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div style={{ padding: "12px 16px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Summary line */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.sec }}>
                {filter === "ALL" ? `Всего заказов: ${data?.total ?? 0}` : `Найдено: ${data?.total ?? 0}`}
              </span>
              {urgentCount > 0 && filter === "ALL" && (
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
                onRefresh={() => fetchOrders(filter, 1, false)}
              />
            ))}

            {data && page < data.pages && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                style={{
                  background: C.elevated, border: "none", borderRadius: 12,
                  color: loadingMore ? C.muted : "#fff", fontSize: 14, padding: "12px",
                  cursor: loadingMore ? "default" : "pointer", marginTop: 4,
                  opacity: loadingMore ? 0.6 : 1,
                }}
              >
                {loadingMore ? "Загрузка…" : `Ещё (${data.total - allOrders.length})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ filter }: { filter: FilterStatus }) {
  const labels: Record<FilterStatus, string> = {
    ALL: "Заказов пока нет",
    PENDING: "Нет новых заказов",
    IN_PROGRESS: "Нет заказов в работе",
    AWAITING_GAMEPASS: "Нет ожидающих ссылку",
    COMPLETED: "Нет завершённых заказов",
    REJECTED: "Нет отклонённых заказов",
  };
  return (
    <div style={{ padding: 48, textAlign: "center" as const, color: C.sec }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
      <div style={{ fontSize: 14 }}>{labels[filter]}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[80, 80, 80, 80].map((h, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
