"use client";
import { C } from "../theme";
import { useEffect, useMemo, useRef, useState } from "react";
import { haptic } from "../haptics";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface CodesData {
  inventory: { denom: number; count: number }[];
  usedToday: number; usedWeek: number;
  chart: { date: string; count: number }[];
}

type WbCodeStatus = "AVAILABLE" | "RESERVED" | "CLAIMED";

interface WbCodeRow {
  id:                 string;
  code:               string;
  denomination:       number;
  status:             WbCodeStatus;
  isUsed:             boolean;
  reservedUntil:      string | null;
  usedAt:             string | null;
  batch:              string | null;
  reviewBonusClaimed: boolean;
  createdAt:          string;
  updatedAt:          string;
  user: {
    id:       string;
    tgId:     string | null;
    vkId:     string | null;
    name:     string | null;
    username: string | null;
  } | null;
  order: {
    id:        string;
    wbCode:    string;
    status:    string;
    createdAt: string;
    amount:    number;
  } | null;
}

interface SearchData {
  codes: WbCodeRow[];
  total: number;
  page:  number;
  pages: number;
  limit: number;
}


const STATUS_META: Record<WbCodeStatus, { label: string; color: string }> = {
  AVAILABLE: { label: "Свободен",      color: C.green  },
  RESERVED:  { label: "Зарезервирован", color: C.yellow },
  CLAIMED:   { label: "Забран",         color: C.accent },
};

const STATUS_FILTERS: { id: WbCodeStatus | "ALL"; label: string }[] = [
  { id: "ALL",       label: "Все"        },
  { id: "AVAILABLE", label: "Свободные" },
  { id: "RESERVED",  label: "Резерв"    },
  { id: "CLAIMED",   label: "Забраны"   },
];

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default function CodesScreen({ token }: { token: string }) {
  // ── Inventory dashboard ────────────────────────────────────────────────
  const [data,    setData]    = useState<CodesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/codes", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  // ── Search ─────────────────────────────────────────────────────────────
  const [q,           setQ]           = useState("");
  const [status,      setStatus]      = useState<WbCodeStatus | "ALL">("ALL");
  const [searchData,  setSearchData]  = useState<SearchData | null>(null);
  const [searching,   setSearching]   = useState(false);
  const reqIdRef = useRef(0);

  const hasFilter = q.trim().length > 0 || status !== "ALL";

  useEffect(() => {
    if (!hasFilter) {
      setSearchData(null);
      setSearching(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    setSearching(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim())         params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      fetch(`/api/twa/wbcodes/search?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (myReq !== reqIdRef.current) return; // stale
          setSearchData(d);
        })
        .catch(() => {})
        .finally(() => { if (myReq === reqIdRef.current) setSearching(false); });
    }, 220);
    return () => clearTimeout(t);
  }, [q, status, token, hasFilter]);

  const total = useMemo(() => data?.inventory.reduce((a, c) => a + c.count, 0) ?? 0, [data]);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Search bar */}
      <SearchBar
        q={q} onChange={setQ}
        status={status} onStatusChange={setStatus}
      />

      {hasFilter ? (
        <SearchResults data={searchData} loading={searching} />
      ) : (
        <>
          {/* Stats */}
          {loading ? (
            <Skeleton />
          ) : !data ? (
            <div style={{ padding: 40, textAlign: "center" as const, color: "#8e8e93" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 14 }}>Ошибка загрузки</div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "Активаций сегодня", val: data.usedToday, accent: data.usedToday > 0 },
                  { label: "За 7 дней",         val: data.usedWeek,  accent: false },
                ].map(c => (
                  <div key={c.label} style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
                    <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 5 }}>{c.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: c.accent ? C.accent : "#fff" }}>{c.val}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div style={{ background: C.card, borderRadius: 14, padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Активации за 7 дней</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={data.chart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: C.elevated, border: "none", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "#fff" }}
                    />
                    <Bar dataKey="count" name="Активаций" fill={C.accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Inventory */}
              <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>Остатки кодов</span>
                  <span style={{ color: C.textSecondary, fontSize: 13 }}>Всего: {total} шт</span>
                </div>

                {data.inventory.length === 0 ? (
                  <div style={{ color: C.red, fontSize: 13, textAlign: "center" as const, padding: "8px 0" }}>⚠️ Нет кодов!</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {data.inventory.map(c => {
                      const color = c.count < 5 ? C.red : c.count < 10 ? C.yellow : C.green;
                      const pct   = Math.min(100, (c.count / 50) * 100);
                      return (
                        <div key={c.denom}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ color: C.accent, fontWeight: 600, fontSize: 15 }}>{c.denom} R$</span>
                            <span style={{ color, fontWeight: 600, fontSize: 13 }}>{c.count} шт</span>
                          </div>
                          <div style={{ background: C.elevated, borderRadius: 4, height: 5 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── Search bar + filters ────────────────────────── */

function SearchBar({
  q, onChange, status, onStatusChange,
}: {
  q: string; onChange: (v: string) => void;
  status: WbCodeStatus | "ALL"; onStatusChange: (s: WbCodeStatus | "ALL") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{
        position: "relative", display: "flex", alignItems: "center",
        background: "rgba(118,118,128,0.24)", borderRadius: 11,
        padding: "9px 12px", gap: 8,
      }}>
        <span style={{ color: C.textSecondary, fontSize: 15 }}>🔍</span>
        <input
          value={q}
          onChange={e => onChange(e.target.value)}
          placeholder="Код WB, часть кода, фрагмент…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: C.textPrimary, fontSize: 15, fontFamily: "inherit",
            letterSpacing: 0.2,
          }}
        />
        {q && (
          <button
            className="twa-press-sm"
            onClick={() => { haptic.impact("light"); onChange(""); }}
            style={{
              border: "none", background: "transparent", color: C.textSecondary,
              fontSize: 15, cursor: "pointer", padding: 4,
            }}
            aria-label="Очистить"
          >
            ✕
          </button>
        )}
      </div>

      <div style={{
        display: "flex", gap: 6, overflowX: "auto" as const,
        scrollbarWidth: "none" as any, WebkitOverflowScrolling: "touch" as any,
      }}>
        {STATUS_FILTERS.map(f => {
          const active = status === f.id;
          return (
            <button
              key={f.id}
              className="twa-press-sm"
              onClick={() => { if (f.id !== status) haptic.select(); onStatusChange(f.id); }}
              style={{
                padding: "6px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                background:  active ? C.accent          : C.card,
                color:       active ? "#fff"            : C.textSecondary,
                fontSize:    12.5, fontWeight: active ? 600 : 500,
                whiteSpace:  "nowrap",
                flexShrink:  0,
                transition:  "all 0.15s",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Search results list ─────────────────────────── */

function SearchResults({ data, loading }: { data: SearchData | null; loading: boolean }) {
  if (loading && !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            height: 84, borderRadius: 14, background: C.card,
            opacity: 0.7 - i * 0.15,
          }} />
        ))}
      </div>
    );
  }
  if (!data || data.codes.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center" as const, color: C.textSecondary }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
        <div style={{ fontSize: 14 }}>Ничего не нашлось</div>
        <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>
          Поменяй запрос или фильтр статуса
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: C.textSecondary, fontSize: 12.5, padding: "2px 4px" }}>
        Найдено: <span style={{ color: C.textPrimary, fontWeight: 600 }}>{data.total}</span>
        {data.total > data.codes.length && (
          <span style={{ color: C.textTertiary }}> · показано {data.codes.length}</span>
        )}
      </div>
      {data.codes.map(c => <CodeRow key={c.id} c={c} />)}
    </div>
  );
}

function CodeRow({ c }: { c: WbCodeRow }) {
  const meta    = STATUS_META[c.status];
  const dateStr = new Date(c.updatedAt).toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const userLabel =
    c.user
      ? c.user.username ? `@${c.user.username}`
      : c.user.name     ? c.user.name
      : c.user.tgId     ? `TG · ${c.user.tgId}`
      : c.user.vkId     ? `VK · ${c.user.vkId}`
      : null
      : null;
  const reservedActive = c.status === "RESERVED" && c.reservedUntil && new Date(c.reservedUntil).getTime() > Date.now();

  return (
    <div style={{
      background: C.card, borderRadius: 14, padding: "12px 14px",
      boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <button
          className="twa-press-sm"
          onClick={() => { haptic.impact("light"); copy(c.code); }}
          style={{
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontWeight: 700, fontSize: 17, letterSpacing: 1.5,
            color: C.textPrimary,
          }}
          title="Скопировать"
        >
          {c.code}
        </button>
        <span style={{
          background: `${meta.color}1c`, color: meta.color,
          padding: "3px 9px", borderRadius: 999,
          fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
          textTransform: "uppercase" as const,
          whiteSpace: "nowrap",
        }}>
          {meta.label}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>
          {c.denomination} R$
        </span>
        {c.isUsed && (
          <span style={{
            color: C.blue, background: `${C.blue}1c`,
            fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
            padding: "2px 7px", borderRadius: 999,
          }}>
            ИСПОЛЬЗОВАН
          </span>
        )}
        {c.reviewBonusClaimed && (
          <span style={{
            color: C.yellow, background: `${C.yellow}1c`,
            fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
            padding: "2px 7px", borderRadius: 999,
          }}>
            ⭐ +100
          </span>
        )}
        {c.batch && (
          <span style={{
            color: C.textTertiary, fontSize: 11,
          }}>
            батч: {c.batch}
          </span>
        )}
      </div>

      {(userLabel || c.order || reservedActive) && (
        <div style={{ borderTop: `1px solid ${C.hairline}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          {userLabel && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textPrimary }}>
              <span style={{ color: C.textTertiary, fontSize: 11.5, letterSpacing: 0.3, textTransform: "uppercase" as const, fontWeight: 600 }}>
                Юзер
              </span>
              <span>{userLabel}</span>
            </div>
          )}
          {c.order && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textPrimary }}>
              <span style={{ color: C.textTertiary, fontSize: 11.5, letterSpacing: 0.3, textTransform: "uppercase" as const, fontWeight: 600 }}>
                Заказ
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                #{c.order.id.slice(-6).toUpperCase()}
              </span>
              <span style={{ color: C.textSecondary, fontSize: 12 }}>
                · {c.order.status} · {c.order.amount} R$
              </span>
            </div>
          )}
          {reservedActive && c.reservedUntil && (
            <div style={{ fontSize: 12, color: C.yellow }}>
              ⏳ Резерв до {new Date(c.reservedUntil).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      )}

      <div style={{ color: C.textTertiary, fontSize: 11 }}>
        Обновлён: {dateStr}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {[76, 170, 200].map((h, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
