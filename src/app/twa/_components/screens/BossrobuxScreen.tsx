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
  gp, buying, bought, onBuy, onCreateAvito, creatingAvito,
}: {
  gp: GamepassItem;
  buying: boolean;
  bought: boolean;
  onBuy: () => void;
  onCreateAvito?: () => void;
  creatingAvito?: boolean;
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
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {onCreateAvito && (
            <button
              className="twa-press-sm"
              onClick={onCreateAvito}
              disabled={!!creatingAvito}
              style={{
                padding: "9px 14px", border: "none", borderRadius: 10,
                background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: creatingAvito ? "default" : "pointer",
                opacity: creatingAvito ? 0.5 : 1,
                fontFamily: "inherit", transition: "opacity 0.2s",
              }}
            >
              {creatingAvito ? "…" : "Авито"}
            </button>
          )}
          <button
            className="twa-press-sm"
            onClick={onBuy}
            disabled={buying || gp.isForSale === false}
            style={{
              padding: "9px 16px", border: "none", borderRadius: 10,
              background: gp.isForSale === false ? C.elevated : C.green,
              color: "#fff", fontSize: 15, fontWeight: 600, cursor: buying ? "default" : "pointer",
              opacity: buying ? 0.5 : (gp.isForSale === false ? 0.4 : 1),
              fontFamily: "inherit", transition: "opacity 0.2s",
            }}
          >
            {buying ? "…" : gp.isForSale === false ? "Не продаётся" : "🛒"}
          </button>
        </div>
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
// Transaction History — accordion grouped by purchaserUsername (cookie account)
// ═════════════════════════════════════════════════════════════════════════════
interface TxOrder {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  robloxUsername: string | null;
  purchaserUsername: string | null;
  wbCode: string;
  isDirectOrder: boolean;
  orderSource: "WB" | "DIRECT" | "AVITO" | "MANUAL";
  createdAt: string;
  updatedAt: string;
  user: { tgId: string | null; vkId: string | null; name: string | null; username: string | null };
}

type TxSourceFilter = "ALL" | "WB" | "DIRECT" | "AVITO" | "MANUAL";
const TX_SOURCE_CHIPS: { id: TxSourceFilter; label: string; color: string }[] = [
  { id: "ALL",    label: "Все",     color: C.textPrimary },
  { id: "WB",     label: "WB",      color: C.green },
  { id: "DIRECT", label: "Прямой",  color: C.blue },
  { id: "AVITO",  label: "Авито",   color: C.orange },
  { id: "MANUAL", label: "Ручные",  color: C.textTertiary },
];

const TX_SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  WB:     { label: "WB",     color: C.green },
  DIRECT: { label: "Прямой", color: C.blue },
  AVITO:  { label: "Авито",  color: C.orange },
  MANUAL: { label: "Ручной", color: C.textTertiary },
};

interface PurchaserGroup {
  purchaser: string;
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

function buildGroups(orders: TxOrder[], sourceFilter: TxSourceFilter = "ALL"): PurchaserGroup[] {
  const filtered = sourceFilter === "ALL" ? orders : orders.filter(o => o.orderSource === sourceFilter);
  const map = new Map<string, TxOrder[]>();
  for (const o of filtered) {
    const key = o.purchaserUsername ?? "Ручные";
    const arr = map.get(key);
    if (arr) arr.push(o); else map.set(key, [o]);
  }
  const groups: PurchaserGroup[] = [];
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

function txCountBySource(orders: TxOrder[]): Record<TxSourceFilter, number> {
  const c: Record<string, number> = { ALL: orders.length, WB: 0, DIRECT: 0, AVITO: 0, MANUAL: 0 };
  for (const o of orders) c[o.orderSource] = (c[o.orderSource] ?? 0) + 1;
  return c as Record<TxSourceFilter, number>;
}

function PurchaserAccordion({ group }: { group: PurchaserGroup }) {
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
                    {tx.orderSource && tx.orderSource !== "WB" && (() => {
                      const sb = TX_SOURCE_BADGE[tx.orderSource];
                      if (!sb) return null;
                      return (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: sb.color,
                          background: `${sb.color}1c`, padding: "2px 6px",
                          borderRadius: 999, flexShrink: 0,
                        }}>{sb.label}</span>
                      );
                    })()}
                    {gpId && (
                      <span style={{ fontSize: 14, color: C.textSecondary, ...tabular }}>
                        Pass {gpId}
                      </span>
                    )}
                    {tx.robloxUsername && (
                      <span style={{ fontSize: 13, color: C.accent, fontWeight: 500 }}>
                        → {tx.robloxUsername}
                      </span>
                    )}
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#fff",
                      background: platformColor, borderRadius: 4, padding: "2px 5px",
                      lineHeight: "15px",
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
  const [sourceFilter, setSourceFilter] = useState<TxSourceFilter>("ALL");

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

  const sc = txCountBySource(orders);
  const hasMultipleSources = (Object.keys(sc) as TxSourceFilter[]).filter(k => k !== "ALL" && sc[k] > 0).length > 1;
  const groups = buildGroups(orders, sourceFilter);
  const totalDirty = groups.reduce((s, g) => s + g.totalDirty, 0);
  const filteredCount = groups.reduce((s, g) => s + g.orders.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Source filter chips */}
      {hasMultipleSources && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TX_SOURCE_CHIPS.map(chip => {
            const cnt = sc[chip.id];
            if (chip.id !== "ALL" && cnt === 0) return null;
            const isActive = sourceFilter === chip.id;
            return (
              <button
                key={chip.id}
                className="twa-press-sm"
                onClick={() => { haptic.select(); setSourceFilter(chip.id); }}
                style={{
                  padding: "6px 12px", border: "none", borderRadius: 999, cursor: "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 5,
                  background: isActive ? chip.color : C.elevated,
                  color: isActive ? "#fff" : chip.color,
                  opacity: isActive ? 1 : 0.7,
                  transition: "all 0.15s",
                }}
              >
                {chip.label}
                {cnt > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    background: isActive ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)",
                    color: "#fff", padding: "2px 6px", borderRadius: 999,
                    ...tabular,
                  }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px", background: tint(C.accent, 0.08), borderRadius: 12,
      }}>
        <span style={{ fontSize: 14, color: C.textSecondary }}>
          {pluralPurchases(filteredCount)} · {groups.length} акк.
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.accent, ...tabular }}>
          − {totalDirty.toLocaleString("ru-RU")} R$
        </span>
      </div>

      {/* Seller groups */}
      {groups.map(g => <PurchaserAccordion key={g.purchaser} group={g} />)}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Create Avito Order
// ═════════════════════════════════════════════════════════════════════════════
function CreateAvitoSection({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [gpInput, setGpInput] = useState("");
  const [nick, setNick] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const amt = parseInt(amount, 10);
    if (!amt || amt < 1) { haptic.notify("error"); toast("Укажи сумму R$", "error"); return; }
    setSaving(true);
    try {
      let gamepassUrl: string | null = null;
      const raw = gpInput.trim();
      if (raw) {
        if (raw.includes("roblox.com")) gamepassUrl = raw;
        else if (/^\d+$/.test(raw)) gamepassUrl = `https://www.roblox.com/game-pass/${raw}`;
        else gamepassUrl = raw;
      }

      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create-avito",
          amount: amt,
          gamepassUrl,
          robloxUsername: nick.trim() || null,
          note: note.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast(`Заказ Авито создан · ${amt} R$`, "success");
      setAmount(""); setGpInput(""); setNick(""); setNote("");
      setOpen(false);
      onCreated();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(true); }}
        style={{
          width: "100%", padding: "14px", border: `1px dashed ${C.orange}55`,
          borderRadius: 14, background: `${C.orange}0a`, cursor: "pointer",
          fontSize: 15, fontWeight: 600, color: C.orange,
          fontFamily: "inherit",
        }}
      >
        + Авито заказ
      </button>
    );
  }

  return (
    <Card>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.orange }}>Новый заказ Авито</span>
          <button className="twa-press-sm" onClick={() => { setOpen(false); }}
            style={{ background: "transparent", border: "none", fontSize: 14, color: C.textTertiary, cursor: "pointer", padding: "4px 8px" }}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="Сумма R$"
            inputMode="numeric"
            style={{
              flex: 1, background: C.elevated, border: "none", borderRadius: 10,
              color: "#fff", fontSize: 16, padding: "12px 14px",
              outline: "none", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </div>

        <input
          value={gpInput}
          onChange={e => setGpInput(e.target.value)}
          placeholder="ID или URL геймпасса (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        <input
          value={nick}
          onChange={e => setNick(e.target.value)}
          placeholder="Ник Roblox продавца (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Заметка (опционально)"
          style={{
            width: "100%", background: C.elevated, border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "12px 14px",
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />

        <button
          className="twa-press"
          onClick={submit}
          disabled={saving || !amount.trim()}
          style={{
            width: "100%", padding: "14px", border: "none", borderRadius: 12,
            background: amount.trim() ? C.orange : C.elevated,
            color: "#fff", fontSize: 16, fontWeight: 600, cursor: saving ? "default" : "pointer",
            opacity: saving || !amount.trim() ? 0.5 : 1,
            fontFamily: "inherit", transition: "all 0.2s",
          }}
        >
          {saving ? "Создаю…" : "Создать заказ Авито"}
        </button>
      </div>
    </Card>
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
  orderSource: string;
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

function buildBuyoutPlan(orders: BuyoutOrder[], balance: number) {
  const sorted = [...orders].sort((a, b) => {
    const tA = new Date(a.pendingAt ?? a.createdAt).getTime();
    const tB = new Date(b.pendingAt ?? b.createdAt).getTime();
    return tA - tB;
  });
  let remaining = balance;
  let totalDirty = 0;
  const selected: BuyoutOrder[] = [];
  const waiting: BuyoutOrder[] = [];
  for (const o of sorted) {
    const dirty = Math.ceil(o.amount / 0.7);
    if (dirty <= remaining) {
      selected.push(o);
      remaining -= dirty;
      totalDirty += dirty;
    } else {
      waiting.push(o);
    }
  }
  return { selected, waiting, totalDirty, remainingBalance: remaining };
}

function groupBySource(orders: BuyoutOrder[]) {
  const direct = orders.filter(o => o.isDirectOrder && o.orderSource !== "AVITO");
  const avito = orders.filter(o => o.orderSource === "AVITO");
  const wb = orders.filter(o => !o.isDirectOrder && o.orderSource !== "AVITO");
  return { direct, avito, wb };
}

function BuyoutOrderCard({
  order, buying, onPurchase, dimmed,
}: { order: BuyoutOrder; buying: string | null; onPurchase: (o: BuyoutOrder) => void; dimmed?: boolean }) {
  const dirty = Math.ceil(order.amount / 0.7);
  const nick = order.user.username ? `@${order.user.username}` : order.user.name ?? "—";
  const isBuying = buying === order.id;
  return (
    <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, opacity: dimmed ? 0.45 : 1 }}>
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
          {order.orderSource === "AVITO" ? (
            <span style={{
              fontSize: 12, fontWeight: 600, color: C.orange,
              background: `${C.orange}1c`, padding: "4px 9px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>Авито</span>
          ) : order.isDirectOrder && (
            <span style={{
              fontSize: 12, fontWeight: 600, color: C.blue,
              background: `${C.blue}1c`, padding: "4px 9px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>Прямой</span>
          )}
        </div>
        <span style={{ fontSize: 15, fontWeight: 500, color: ageColor(order.createdAt), flexShrink: 0, ...tabular }}>
          ⏱ {fmtAge(order.createdAt)}
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
        {order.gamepassUrl && !dimmed && (
          <button
            className="twa-press"
            onClick={() => onPurchase(order)}
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
  );
}

function renderGroupedOrders(
  orders: BuyoutOrder[], buying: string | null, onPurchase: (o: BuyoutOrder) => void, dimmed?: boolean,
) {
  const { direct, avito, wb } = groupBySource(orders);
  const groups: { label: string; color: string; items: BuyoutOrder[] }[] = [];
  if (direct.length) groups.push({ label: "Прямые", color: C.blue, items: direct });
  if (avito.length) groups.push({ label: "Авито", color: C.orange, items: avito });
  if (wb.length) groups.push({ label: "WB", color: C.green, items: wb });

  const multiGroup = groups.length > 1;
  let idx = 0;
  return groups.map((g, gi) => (
    <div key={g.label}>
      {gi > 0 && <div style={{ height: 2, background: C.border, margin: "6px 0" }} />}
      {multiGroup && (
        <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: g.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {g.label} · {g.items.length}
        </div>
      )}
      {g.items.map((order, oi) => {
        const showSep = multiGroup ? oi > 0 : idx > 0;
        idx++;
        return (
          <div key={order.id}>
            {showSep && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
            <BuyoutOrderCard order={order} buying={buying} onPurchase={onPurchase} dimmed={dimmed} />
          </div>
        );
      })}
    </div>
  ));
}

function BuyoutSection({ token, balance, onBalanceChange }: { token: string; balance: number | null; onBalanceChange: (delta: number) => void }) {
  const [orders, setOrders] = useState<BuyoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const hdrs = { Authorization: `Bearer ${token}` };
      const [rDirect, rBuyout, rAvito] = await Promise.all([
        fetch(`/api/twa/orders?status=DIRECT&limit=50&lite=1`, { headers: hdrs }),
        fetch(`/api/twa/orders?status=BUYOUT&limit=50&lite=1`, { headers: hdrs }),
        fetch(`/api/twa/orders?status=AVITO&limit=50&lite=1`, { headers: hdrs }),
      ]);
      const direct = rDirect.ok ? ((await rDirect.json()).orders ?? []) : [];
      const buyout = rBuyout.ok ? ((await rBuyout.json()).orders ?? []) : [];
      const avito = rAvito.ok ? ((await rAvito.json()).orders ?? []) : [];
      setOrders([...direct, ...buyout, ...avito]);
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
        const dirty = Math.ceil(order.amount / 0.7);
        onBalanceChange(-dirty);
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

  if (balance === null) {
    return <Card>{renderGroupedOrders(orders, buying, doPurchase)}</Card>;
  }

  const plan = buildBuyoutPlan(orders, balance);
  const allDirty = orders.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Summary bar */}
      <Card>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Баланс</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea", ...tabular }}>
              {balance.toLocaleString("ru-RU")} <span style={{ fontSize: 14, color: C.accent }}>R$</span>
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Пачка</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: C.green, ...tabular }}>
              {plan.selected.length} из {orders.length} · {plan.totalDirty.toLocaleString("ru-RU")} R$
            </span>
          </div>
          {plan.waiting.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, color: C.textSecondary }}>Не хватает</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.orange, ...tabular }}>
                {(allDirty - balance).toLocaleString("ru-RU")} R$
              </span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Остаток</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: plan.remainingBalance > 0 ? C.textSecondary : C.red, ...tabular }}>
              {plan.remainingBalance.toLocaleString("ru-RU")} R$
            </span>
          </div>
        </div>
      </Card>

      {/* Selected — ready to buy */}
      {plan.selected.length > 0 && (
        <Card>
          <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Выкупить · {plan.selected.length}
          </div>
          {renderGroupedOrders(plan.selected, buying, doPurchase)}
        </Card>
      )}

      {/* Waiting — not enough balance */}
      {plan.waiting.length > 0 && (
        <Card>
          <div style={{ padding: "10px 16px 4px", fontSize: 12, fontWeight: 700, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Ожидают баланс · {plan.waiting.length}
          </div>
          {renderGroupedOrders(plan.waiting, buying, doPurchase, true)}
        </Card>
      )}
    </div>
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
  const [historyKey, setHistoryKey] = useState(0);
  const [showCookie, setShowCookie] = useState(false);
  const [creatingAvito, setCreatingAvito] = useState(false);

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

  // ── Search (auto-detect: URL → ID → nick) ──────────────────────────────
  async function doSearch() {
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true); setSearchError(""); setSearchResults([]); setResolvedUsername(""); setHasSearched(true);
    setBoughtIds(new Set());

    const urlMatch = q.match(/game-pass(?:es)?\/(\d+)/i);
    const isIdLike = !urlMatch && /^\d{6,}$/.test(q);
    const searchById = !!(urlMatch || isIdLike);
    const gamepassId = urlMatch ? urlMatch[1] : q;

    try {
      if (searchById) {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "resolve-gamepass", gamepassId }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.sellerName ?? "");
        setSearchResults([d]);
      } else {
        const r = await fetch("/api/twa/roblox-account/purchase", {
          method: "POST", headers: purchaseHeaders,
          body: JSON.stringify({ action: "search-by-username", username: q }),
        });
        const d = await r.json();
        if (!r.ok) { setSearchError(d.error ?? "Ошибка"); return; }
        setResolvedUsername(d.username ?? q);
        setSearchResults(d.gamepasses ?? []);
        if ((d.gamepasses ?? []).length === 0) setSearchError(d.msg ?? "Геймпассы не найдены");
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

  // ── Create Avito from search result ─────────────────────────────────────
  async function createAvitoFromSearch(gp: GamepassItem) {
    if (creatingAvito) return;
    setCreatingAvito(true);
    try {
      const amount = Math.floor(gp.price * 0.7);
      const gamepassUrl = `https://www.roblox.com/game-pass/${gp.gamepassId}`;
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({
          action: "create-avito",
          amount,
          gamepassUrl,
          robloxUsername: gp.sellerName || null,
          note: null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast(`Авито · ${gp.name} · ${amount} R$`, "success");
      setHistoryKey(k => k + 1);
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setCreatingAvito(false); }
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

      {/* ── Search & Purchase (FIRST — main function) ──────────────────── */}
      {cookieReady && (
        <section>
          <SectionHeader title="Поиск и выкуп" />

          <Card>
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && searchInput.trim()) doSearch(); }}
                  placeholder="Ник, ID или URL геймпасса…"
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
                    {searchResults.length > 1
                      ? `${resolvedUsername} · ${searchResults.length} геймпасс${searchResults.length < 5 ? "а" : "ов"}`
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
                      onCreateAvito={() => createAvitoFromSearch(gp)}
                      creatingAvito={creatingAvito}
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

      {/* ── Account info + inline cookie ───────────────────────────────── */}
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
              <InfoRow label="Баланс" value={
                info.balance !== null
                  ? <>{info.balance.toLocaleString()} R$ <span style={{ color: C.textTertiary, fontWeight: 400 }}>({Math.floor(info.balance * 0.7).toLocaleString()} чистых)</span></>
                  : "—"
              } />
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

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {info?.hasCookie && (
            <button
              className="twa-press"
              onClick={() => { haptic.impact("light"); refreshBalance(); }}
              disabled={refreshing}
              style={{
                flex: 1,
                background: C.card, border: "none", borderRadius: 12,
                color: C.accent, fontSize: 15, fontWeight: 600,
                padding: "14px", cursor: refreshing ? "default" : "pointer",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              {refreshing ? "Обновляю…" : "🔄 Обновить баланс"}
            </button>
          )}
          <button
            className="twa-press"
            onClick={() => { haptic.impact("light"); setShowCookie(v => !v); }}
            style={{
              flex: info?.hasCookie ? "none" : 1,
              background: C.card, border: "none", borderRadius: 12,
              color: showCookie ? C.orange : C.textSecondary, fontSize: 15, fontWeight: 600,
              padding: "14px 18px", cursor: "pointer",
            }}
          >
            🔑 Cookie
          </button>
        </div>

        {showCookie && (
          <div style={{ marginTop: 10 }}>
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
          </div>
        )}
      </section>

      {/* ── Buyout Orders ───────────────────────────────────────────────── */}
      {cookieReady && (
        <section>
          <SectionHeader title="К выкупу" />
          <BuyoutSection
            token={token}
            balance={info?.balance ?? null}
            onBalanceChange={(delta) => setInfo(prev => prev && prev.balance !== null ? { ...prev, balance: prev.balance + delta } : prev)}
          />
        </section>
      )}

      {/* ── Transaction History ──────────────────────────────────────── */}
      <section>
        <SectionHeader title="История покупок" />
        <TransactionHistory key={historyKey} token={token} />
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
