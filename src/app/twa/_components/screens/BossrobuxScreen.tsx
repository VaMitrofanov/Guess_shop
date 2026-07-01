"use client";
import { C, MONO, tabular, tint } from "../theme";
import { useEffect, useState, useCallback, useRef } from "react";
import { haptic } from "../haptics";
import { toast } from "../Toast";

interface AccountInfo {
  hasCookie:      boolean;
  cookieValid?:   boolean;
  cookieUpdatedAt: string | null;
  accountName:    string | null;
  accountId:      number | null;
  balance:        number | null;
}

interface GamepassItem {
  gamepassId: number;
  productId:  number;
  name:       string;
  price:      number;
  sellerName: string;
  sellerId?:  number;
  image:      string | null;
  isForSale?: boolean;
  isManagedPricing?: boolean;
  basePriceInRobux?: number;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingLeft: 4 }}>
      {title}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{children}</div>;
}

function InfoRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", gap: 12 }}>
        <span style={{ fontSize: 16, color: C.textSecondary }}>{label}</span>
        <span style={{ fontSize: 16, color: "#e5e5ea", fontWeight: 500, fontFamily: "monospace", letterSpacing: 0.2 }}>{value}</span>
      </div>
      {!last && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
    </>
  );
}

function StatusDot({ valid }: { valid: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: valid ? C.green : C.red,
      boxShadow: `0 0 6px ${valid ? C.green : C.red}44`,
      marginRight: 8, verticalAlign: "middle",
    }} />
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
      {[72, 100, 60].map((h, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

// ── Segment Control ─────────────────────────────────────────────────────────
function SegmentControl({ value, onChange }: { value: "nick" | "id"; onChange: (v: "nick" | "id") => void }) {
  const opts: { id: "nick" | "id"; label: string }[] = [
    { id: "nick", label: "По нику" },
    { id: "id",   label: "По ID / URL" },
  ];
  return (
    <div style={{
      display: "flex", background: C.elevated, borderRadius: 10, padding: 3, gap: 2,
    }}>
      {opts.map(o => (
        <button
          key={o.id}
          className="twa-press-sm"
          onClick={() => { if (o.id !== value) { haptic.select(); onChange(o.id); } }}
          style={{
            flex: 1, padding: "10px 0", border: "none", borderRadius: 8, cursor: "pointer",
            fontSize: 15, fontWeight: 600, fontFamily: "inherit",
            background: value === o.id ? C.card : "transparent",
            color: value === o.id ? "#e5e5ea" : C.textTertiary,
            boxShadow: value === o.id ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
            transition: "all 0.2s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Gamepass Card ────────────────────────────────────────────────────────────
function GamepassCard({
  gp, buying, bought, onBuy,
}: {
  gp: GamepassItem;
  buying: boolean;
  bought: boolean;
  onBuy: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 14px",
      background: bought ? `${C.green}11` : "transparent",
      transition: "background 0.3s",
    }}>
      {gp.image && (
        <img
          src={gp.image}
          alt=""
          style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 16, fontWeight: 600, color: "#e5e5ea",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {gp.name}
        </div>
        <div style={{ fontSize: 14, color: C.textTertiary, marginTop: 2 }}>
          {gp.price.toLocaleString()} R$ · {gp.sellerName}
          {gp.isManagedPricing && <span style={{ color: C.orange }}> · MP</span>}
        </div>
      </div>
      {bought ? (
        <span style={{ fontSize: 15, fontWeight: 600, color: C.green, flexShrink: 0 }}>✅</span>
      ) : (
        <button
          className="twa-press-sm"
          onClick={onBuy}
          disabled={buying || gp.isForSale === false}
          style={{
            flexShrink: 0, padding: "9px 16px", border: "none", borderRadius: 10,
            background: gp.isForSale === false ? C.elevated : C.green,
            color: "#fff", fontSize: 15, fontWeight: 600, cursor: buying ? "default" : "pointer",
            opacity: buying ? 0.5 : (gp.isForSale === false ? 0.4 : 1),
            fontFamily: "inherit", transition: "opacity 0.2s",
          }}
        >
          {buying ? "…" : gp.isForSale === false ? "Не продаётся" : "🛒"}
        </button>
      )}
    </div>
  );
}

// ── Confirm Modal ───────────────────────────────────────────────────────────
function ConfirmPurchase({
  gp, buying, onConfirm, onCancel,
}: {
  gp: GamepassItem;
  buying: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}
      onClick={e => { if (e.target === e.currentTarget && !buying) onCancel(); }}
    >
      <div style={{
        background: C.card, borderRadius: 18, padding: "24px 20px", width: "100%", maxWidth: 320,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          {gp.image && (
            <img src={gp.image} alt="" style={{ width: 56, height: 56, borderRadius: 12, marginBottom: 10 }} />
          )}
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>Купить «{gp.name}»?</div>
        </div>

        <div style={{ background: C.elevated, borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, color: "#e5e5ea", marginBottom: 6 }}>
            <span>Цена</span>
            <span style={{ fontWeight: 600 }}>{gp.price.toLocaleString()} R$</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: C.textSecondary }}>
            <span>Продавец</span>
            <span>{gp.sellerName}</span>
          </div>
        </div>

        {gp.isManagedPricing && (
          <div style={{
            background: `${C.orange}18`, borderRadius: 10, padding: "10px 12px", marginBottom: 12,
            fontSize: 14, color: C.orange, fontWeight: 500,
          }}>
            ⚠️ Managed pricing · база {gp.basePriceInRobux?.toLocaleString()} R$, Roblox выставил {gp.price.toLocaleString()} R$
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="twa-press"
            onClick={onCancel}
            disabled={buying}
            style={{
              flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
              background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Отмена
          </button>
          <button
            className="twa-press"
            onClick={onConfirm}
            disabled={buying}
            style={{
              flex: 1, padding: "13px 0", border: "none", borderRadius: 12,
              background: C.green, color: "#fff", fontSize: 15, fontWeight: 600,
              cursor: buying ? "default" : "pointer", fontFamily: "inherit",
              opacity: buying ? 0.6 : 1, transition: "opacity 0.2s",
            }}
          >
            {buying ? "Покупаю…" : "✅ Купить"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Transaction History — accordion grouped by robloxUsername
// ═════════════════════════════════════════════════════════════════════════════
interface TxOrder {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  robloxUsername: string | null;
  wbCode: string;
  isDirectOrder: boolean;
  createdAt: string;
  updatedAt: string;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

interface SellerGroup {
  seller: string;
  orders: TxOrder[];
  totalDirty: number;
  latestDate: string;
}

function extractGpId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

function fmtTxDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function pluralPurchases(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} покупка`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} покупки`;
  return `${n} покупок`;
}

function buildGroups(orders: TxOrder[]): SellerGroup[] {
  const map = new Map<string, TxOrder[]>();
  for (const o of orders) {
    const key = o.robloxUsername ?? "—";
    const arr = map.get(key);
    if (arr) arr.push(o); else map.set(key, [o]);
  }
  const groups: SellerGroup[] = [];
  for (const [seller, ords] of map) {
    ords.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    groups.push({
      seller,
      orders: ords,
      totalDirty: ords.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0),
      latestDate: ords[0].updatedAt,
    });
  }
  groups.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return groups;
}

function SellerAccordion({ group }: { group: SellerGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      {/* Header — always visible */}
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
          🎮 {group.seller}
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

      {/* Expanded: transaction rows */}
      {open && (
        <div>
          <div style={{ height: 1, background: C.border }} />
          {group.orders.map((tx, i) => {
            const dirty = Math.ceil(tx.amount / 0.7);
            const gpId = extractGpId(tx.gamepassUrl);
            const nick = tx.user.username ? `@${tx.user.username}` : tx.user.name ?? "—";
            const platform = tx.user.tgId ? "T" : tx.user.vkId ? "V" : "—";
            const platformColor = tx.user.tgId ? "#229ED9" : tx.user.vkId ? "#0077FF" : C.elevated;
            return (
              <div key={tx.id}>
                {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
                <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>{fmtTxDate(tx.updatedAt)}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: C.orange, ...tabular }}>
                      − {dirty.toLocaleString("ru-RU")} R$
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {gpId && (
                      <span style={{ fontSize: 14, color: C.textSecondary, ...tabular }}>
                        Pass {gpId}
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#fff",
                      background: platformColor, borderRadius: 4, padding: "2px 5px",
                      lineHeight: "15px", marginLeft: gpId ? 2 : 0,
                    }}>{platform}</span>
                    <span style={{
                      fontSize: 13, color: C.textTertiary,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{nick}</span>
                    <span style={{ fontSize: 13, color: C.textTertiary, fontFamily: MONO, letterSpacing: 0.3, marginLeft: "auto", flexShrink: 0 }}>
                      {tx.wbCode}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TransactionHistory({ token }: { token: string }) {
  const [orders, setOrders] = useState<TxOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [doneCount, setDoneCount] = useState(0);
  const [loadedAll, setLoadedAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let all: TxOrder[] = [];
      let page = 1;
      const limit = 50;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const params = new URLSearchParams({
          status: "DONE", limit: String(limit), page: String(page), lite: "1",
          ...(page === 1 ? {} : { skipCounts: "1" }),
        });
        const r = await fetch(`/api/twa/orders?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) break;
        const d = await r.json();
        const batch: TxOrder[] = d.orders ?? [];
        if (page === 1) setDoneCount(d.counts?.DONE ?? d.total ?? batch.length);
        all = all.concat(batch);
        if (batch.length < limit) break;
        page++;
      }
      setOrders(all);
      setLoadedAll(true);
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ background: C.card, borderRadius: 14, height: 80, animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  if (orders.length === 0) return (
    <Card>
      <div style={{ padding: "24px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 16, color: C.textTertiary }}>Нет завершённых покупок</div>
      </div>
    </Card>
  );

  const groups = buildGroups(orders);
  const totalDirty = groups.reduce((s, g) => s + g.totalDirty, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Summary */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px", background: tint(C.accent, 0.08), borderRadius: 12,
      }}>
        <span style={{ fontSize: 14, color: C.textSecondary }}>
          {doneCount > 0 ? pluralPurchases(doneCount) : pluralPurchases(orders.length)} · {groups.length} акк.
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.accent, ...tabular }}>
          − {totalDirty.toLocaleString("ru-RU")} R$
        </span>
      </div>

      {/* Seller groups */}
      {groups.map(g => <SellerAccordion key={g.seller} group={g} />)}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Buyout Orders Section (embedded in Account)
// ═════════════════════════════════════════════════════════════════════════════
interface BuyoutOrder {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  status: string;
  wbCode: string;
  isDirectOrder: boolean;
  robloxUsername: string | null;
  createdAt: string;
  pendingAt: string | null;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

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
  if (mins < 1440) return "#ff9500";
  return C.red;
}

function BuyoutSection({ token }: { token: string }) {
  const [orders, setOrders] = useState<BuyoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [rDirect, rBuyout] = await Promise.all([
        fetch(`/api/twa/orders?status=DIRECT&limit=20&lite=1`, { headers: hdrs }),
        fetch(`/api/twa/orders?status=BUYOUT&limit=20&lite=1`, { headers: hdrs }),
      ]);
      const direct = rDirect.ok ? ((await rDirect.json()).orders ?? []) : [];
      const buyout = rBuyout.ok ? ((await rBuyout.json()).orders ?? []) : [];
      setOrders([...direct, ...buyout]);
    } catch {}
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function doPurchase(order: BuyoutOrder) {
    if (buying) return;
    setBuying(order.id);
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
        setOrders(prev => prev.filter(o => o.id !== order.id));
      } else {
        haptic.notify("error");
        toast(`❌ ${d.msg}`, "error");
      }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setBuying(null); }
  }

  if (loading) return (
    <div style={{ background: C.card, borderRadius: 14, height: 80, animation: "pulse 1.5s ease-in-out infinite" }} />
  );

  if (orders.length === 0) return (
    <Card>
      <div style={{ padding: "20px 16px", textAlign: "center", color: C.textTertiary, fontSize: 16 }}>
        Нет заказов к выкупу
      </div>
    </Card>
  );

  return (
    <Card>
      {orders.map((order, i) => {
        const dirty = Math.ceil(order.amount / 0.7);
        const nick = order.user.username ? `@${order.user.username}` : order.user.name ?? "—";
        const timeRef = order.createdAt;
        const isBuying = buying === order.id;
        return (
          <div key={order.id}>
            {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 800, color: "#fff",
                    background: order.user.tgId ? "#229ED9" : order.user.vkId ? "#0077FF" : C.elevated,
                    borderRadius: 5, padding: "4px 8px", flexShrink: 0,
                  }}>
                    {order.user.tgId ? "T" : order.user.vkId ? "V" : "—"}
                  </span>
                  <span style={{
                    fontSize: 17, fontWeight: 600, color: "#7ec5ff",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{nick}</span>
                  {order.isDirectOrder && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: C.blue,
                      background: `${C.blue}1c`, padding: "4px 9px",
                      borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
                    }}>Прямой</span>
                  )}
                </div>
                <span style={{ fontSize: 15, fontWeight: 500, color: ageColor(timeRef), flexShrink: 0, ...tabular }}>
                  ⏱ {fmtAge(timeRef)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 700, color: "#e5e5ea", ...tabular }}>
                    {dirty.toLocaleString("ru-RU")}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
                  <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>
                    ({order.amount.toLocaleString("ru-RU")})
                  </span>
                </div>
                {order.gamepassUrl && (
                  <button
                    className="twa-press"
                    onClick={() => doPurchase(order)}
                    disabled={!!buying}
                    style={{
                      padding: "10px 18px", border: "none", borderRadius: 10,
                      background: "rgba(48,209,88,0.14)", color: "#30d158",
                      fontSize: 15, fontWeight: 600, cursor: "pointer",
                      opacity: isBuying ? 0.5 : 1,
                    }}
                  >
                    {isBuying ? "⏳…" : "Выкупить"}
                  </button>
                )}
              </div>

              {order.robloxUsername && (
                <div style={{ fontSize: 15, color: C.textSecondary }}>
                  🎮 {order.robloxUsername}
                </div>
              )}
              {order.wbCode && (
                <div style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 15 }}>
                  📦 {order.wbCode}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main Screen
// ═════════════════════════════════════════════════════════════════════════════
export default function BossrobuxScreen({ token }: { token: string }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [cookieInput, setCookieInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // ── Search & Purchase state ─────────────────────────────────────────────
  const [searchMode, setSearchMode] = useState<"nick" | "id">("nick");
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<GamepassItem[]>([]);
  const [resolvedUsername, setResolvedUsername] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const [confirmGp, setConfirmGp] = useState<GamepassItem | null>(null);
  const [buying, setBuying] = useState(false);
  const [boughtIds, setBoughtIds] = useState<Set<number>>(new Set());
  const buyLock = useRef(false);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const purchaseHeaders = { ...headers };

  // ── Account loading ─────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/twa/roblox-account", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Ошибка загрузки"); return; }
      const d = await r.json().catch(() => null);
      if (!d) { setError("Ошибка загрузки"); return; }
      setInfo(d);
    } catch { setError("Ошибка сети"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function refreshBalance() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "refresh-balance" }),
      });
      const d = await r.json();
      if (!r.ok) {
        haptic.notify("error");
        setSaveMsg({ text: d.error ?? "Ошибка", ok: false });
        return;
      }
      setInfo(prev => prev ? { ...prev, accountName: d.accountName, accountId: d.accountId, balance: d.balance, cookieValid: true } : prev);
      haptic.notify("success");
    } catch { haptic.notify("error"); }
    finally { setRefreshing(false); }
  }

  async function saveCookie() {
    if (!cookieInput.trim()) return;
    setSaving(true); setSaveMsg(null);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "set-cookie", cookie: cookieInput.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) {
        haptic.notify("error");
        setSaveMsg({ text: d?.error ?? (r.status >= 500 ? "Сервер недоступен — попробуй позже" : "Ошибка сохранения") , ok: false });
        return;
      }
      haptic.notify("success");
      setSaveMsg({ text: `Сохранено · ${d.accountName}`, ok: true });
      setCookieInput("");
      setInfo({
        hasCookie: true, cookieValid: true,
        cookieUpdatedAt: new Date().toISOString(),
        accountName: d.accountName, accountId: d.accountId, balance: d.balance,
      });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch { haptic.notify("error"); setSaveMsg({ text: "Ошибка сети — проверь подключение", ok: false }); }
    finally { setSaving(false); }
  }

  // ── Search ──────────────────────────────────────────────────────────────
  async function doSearch() {
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true); setSearchError(""); setSearchResults([]); setResolvedUsername(""); setHasSearched(true);
    setBoughtIds(new Set());

    try {
      if (searchMode === "nick") {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "search-by-username", username: q }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.username ?? q);
        setSearchResults(d.gamepasses ?? []);
        if ((d.gamepasses ?? []).length === 0) setSearchError(d.msg ?? "Геймпассы не найдены");
      } else {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "resolve-gamepass", gamepassId: q }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.sellerName ?? "");
        setSearchResults([d]);
      }
      haptic.notify("success");
    } catch { setSearchError("Ошибка сети"); haptic.notify("error"); }
    finally { setSearching(false); }
  }

  // ── Purchase ────────────────────────────────────────────────────────────
  async function doPurchase() {
    if (!confirmGp || buyLock.current) return;
    buyLock.current = true;
    setBuying(true);

    try {
      // If we came from nick-search, we need sellerId via resolve
      let { productId, sellerId } = confirmGp as GamepassItem & { sellerId?: number };
      const price = confirmGp.price;

      if (!productId || !sellerId) {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "resolve-gamepass", gamepassId: String(confirmGp.gamepassId) }),
        });
        const d = await r.json();
        if (!r.ok || !d.productId) {
          haptic.notify("error");
          setSearchError(d.error ?? "Не удалось получить данные ГП");
          setConfirmGp(null);
          return;
        }
        productId = d.productId;
        sellerId = d.sellerId;
        if (d.isManagedPricing) {
          setConfirmGp(prev => prev ? { ...prev, isManagedPricing: true, basePriceInRobux: d.basePriceInRobux, sellerId: d.sellerId, productId: d.productId } : prev);
        }
      }

      const r = await fetch("/api/twa/roblox-account/purchase", {
        method: "POST", headers: purchaseHeaders,
        body: JSON.stringify({ action: "purchase", productId, price, sellerId }),
      });
      const d = await r.json();

      if (d.success) {
        haptic.notify("success");
        setBoughtIds(prev => new Set(prev).add(confirmGp!.gamepassId));
        if (d.balance !== null && d.balance !== undefined) {
          setInfo(prev => prev ? { ...prev, balance: d.balance } : prev);
        }
        setConfirmGp(null);
      } else {
        haptic.notify("error");
        setSearchError(d.msg ?? d.error ?? "Ошибка покупки");
        setConfirmGp(null);
      }
    } catch {
      haptic.notify("error");
      setSearchError("Ошибка сети");
      setConfirmGp(null);
    } finally {
      setBuying(false);
      buyLock.current = false;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />;
  if (error) return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ color: C.red, fontSize: 16, marginBottom: 12 }}>{error}</div>
      <button className="twa-press" onClick={load} style={{
        background: C.card, border: "none", borderRadius: 10,
        color: C.accent, fontSize: 15, fontWeight: 600, padding: "12px 28px", cursor: "pointer",
      }}>Повторить</button>
    </div>
  );

  const cookieReady = info?.hasCookie && info?.cookieValid !== false;

  return (
    <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", height: "100%" }}>

      {/* Account info */}
      <section>
        <SectionHeader title="Roblox-аккаунт" />
        <Card>
          {info?.hasCookie ? (
            <>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot valid={info.cookieValid !== false} />
                <span style={{ fontSize: 18, fontWeight: 600, color: "#e5e5ea" }}>
                  {info.accountName ?? "Неизвестный"}
                </span>
                {info.cookieValid === false && (
                  <span style={{ fontSize: 14, color: C.red, fontWeight: 500 }}>Cookie истёк</span>
                )}
              </div>
              <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
              <InfoRow label="ID" value={info.accountId?.toLocaleString() ?? "—"} />
              <InfoRow label="Баланс" value={info.balance !== null ? `${info.balance.toLocaleString()} R$` : "—"} />
              <InfoRow label="Cookie обновлён" value={formatDate(info.cookieUpdatedAt)} last />
            </>
          ) : (
            <div style={{ padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
              <div style={{ fontSize: 16, color: C.textSecondary }}>Cookie не задан</div>
              <div style={{ fontSize: 14, color: C.textTertiary, marginTop: 4 }}>Вставьте .ROBLOSECURITY ниже</div>
            </div>
          )}
        </Card>

        {info?.hasCookie && (
          <button
            className="twa-press"
            onClick={() => { haptic.impact("light"); refreshBalance(); }}
            disabled={refreshing}
            style={{
              marginTop: 10, width: "100%",
              background: C.card, border: "none", borderRadius: 12,
              color: C.accent, fontSize: 15, fontWeight: 600,
              padding: "14px", cursor: refreshing ? "default" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Обновляю…" : "🔄 Обновить баланс"}
          </button>
        )}
      </section>

      {/* Set cookie */}
      <section>
        <SectionHeader title="Cookie" />
        <Card>
          <div style={{ padding: 12 }}>
            <textarea
              value={cookieInput}
              onChange={e => setCookieInput(e.target.value)}
              placeholder=".ROBLOSECURITY значение…"
              rows={3}
              style={{
                width: "100%", background: C.elevated, border: "none", borderRadius: 10,
                color: "#fff", fontSize: 15, padding: "12px 14px",
                resize: "vertical", outline: "none", fontFamily: "monospace",
                lineHeight: 1.4, boxSizing: "border-box",
              }}
            />
            <button
              className="twa-press"
              onClick={() => { haptic.impact("medium"); saveCookie(); }}
              disabled={saving || !cookieInput.trim()}
              style={{
                marginTop: 8, width: "100%",
                background: cookieInput.trim() ? C.green : C.elevated,
                border: "none", borderRadius: 10,
                color: "#fff", fontSize: 15, fontWeight: 600,
                padding: "14px", cursor: saving ? "default" : "pointer",
                opacity: saving || !cookieInput.trim() ? 0.5 : 1,
                transition: "background 0.2s, opacity 0.2s",
              }}
            >
              {saving ? "Проверяю…" : "💾 Сохранить cookie"}
            </button>
          </div>
        </Card>

        {saveMsg && (
          <div style={{
            marginTop: 8, padding: "10px 14px", borderRadius: 10,
            background: saveMsg.ok ? `${C.green}22` : `${C.red}22`,
            color: saveMsg.ok ? C.green : C.red,
            fontSize: 15, fontWeight: 500,
          }}>
            {saveMsg.ok ? "✅" : "❌"} {saveMsg.text}
          </div>
        )}

        <div style={{ fontSize: 13, color: C.textTertiary, paddingLeft: 4, marginTop: 6 }}>
          Cookie валидируется при сохранении. Обновляй когда меняешь аккаунт.
        </div>
      </section>

      {/* ── Search & Purchase ─────────────────────────────────────────────── */}
      {cookieReady && (
        <section>
          <SectionHeader title="Поиск и выкуп" />

          <div style={{ marginBottom: 10 }}>
            <SegmentControl value={searchMode} onChange={v => { setSearchMode(v); setSearchResults([]); setSearchError(""); setHasSearched(false); setSearchInput(""); }} />
          </div>

          <Card>
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && searchInput.trim()) doSearch(); }}
                  placeholder={searchMode === "nick" ? "Ник Roblox…" : "ID или URL геймпасса…"}
                  style={{
                    flex: 1, background: C.elevated, border: "none", borderRadius: 10,
                    color: "#fff", fontSize: 16, padding: "12px 14px",
                    outline: "none", fontFamily: "inherit", boxSizing: "border-box",
                    minWidth: 0,
                  }}
                />
                <button
                  className="twa-press"
                  onClick={() => { haptic.impact("light"); doSearch(); }}
                  disabled={searching || !searchInput.trim()}
                  style={{
                    flexShrink: 0, padding: "12px 18px", border: "none", borderRadius: 10,
                    background: searchInput.trim() ? C.accent : C.elevated,
                    color: "#fff", fontSize: 16, fontWeight: 600, cursor: searching ? "default" : "pointer",
                    opacity: searching || !searchInput.trim() ? 0.5 : 1,
                    fontFamily: "inherit", transition: "all 0.2s",
                  }}
                >
                  {searching ? "…" : "🔍"}
                </button>
              </div>
            </div>

            {/* Results */}
            {searchResults.length > 0 && (
              <>
                {resolvedUsername && (
                  <div style={{
                    padding: "10px 14px", fontSize: 14, color: C.textTertiary,
                    borderTop: `1px solid ${C.border}`,
                  }}>
                    {searchMode === "nick"
                      ? `${resolvedUsername} · ${searchResults.length} геймпасс${searchResults.length === 1 ? "" : searchResults.length < 5 ? "а" : "ов"}`
                      : resolvedUsername
                    }
                  </div>
                )}
                {searchResults.map((gp, i) => (
                  <div key={gp.gamepassId}>
                    {i > 0 && <div style={{ height: 1, background: C.border, marginLeft: 14 }} />}
                    <GamepassCard
                      gp={gp}
                      buying={buying && confirmGp?.gamepassId === gp.gamepassId}
                      bought={boughtIds.has(gp.gamepassId)}
                      onBuy={() => setConfirmGp(gp)}
                    />
                  </div>
                ))}
              </>
            )}

            {/* Error / empty */}
            {searchError && (
              <div style={{
                padding: "14px 14px", fontSize: 15, color: C.textSecondary, textAlign: "center",
                borderTop: hasSearched ? `1px solid ${C.border}` : "none",
              }}>
                {searchError}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* ── Buyout Orders ───────────────────────────────────────────────── */}
      {cookieReady && (
        <section>
          <SectionHeader title="К выкупу" />
          <BuyoutSection token={token} />
        </section>
      )}

      {/* ── Transaction History ──────────────────────────────────────── */}
      <section>
        <SectionHeader title="История покупок" />
        <TransactionHistory token={token} />
      </section>

      {/* Confirm modal */}
      {confirmGp && (
        <ConfirmPurchase
          gp={confirmGp}
          buying={buying}
          onConfirm={doPurchase}
          onCancel={() => { if (!buying) setConfirmGp(null); }}
        />
      )}
    </div>
  );
}
