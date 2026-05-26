"use client";
import { useEffect, useState, useRef, useCallback } from "react";

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a",
  yellow: "#ffd60a", orange: "#ff9f0a",
  sec: "#8e8e93", muted: "#48484a", bg: "#1c1c1e",
};

const ANIM = `
  @keyframes shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position:  200% 0; }
  }
  .br-skel {
    background: linear-gradient(90deg, #3a3a3c 25%, #4a4a4c 50%, #3a3a3c 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
`;

interface Rate {
  rate:        number;
  robux_total: number;
  robux_max:   number;
}

interface Gamepass {
  placeId:    number;
  productId:  number;
  gamepassId: number;
  name:       string;
  robux:      number;
  sellerName: string;
  image:      string;
}

function authH(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Skeleton block ────────────────────────────────────────────────────────────

function Skel({ w, h, r = 8 }: { w: string | number; h: number; r?: number }) {
  return <div className="br-skel" style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }} />;
}

// ── Gamepass image with fallback ──────────────────────────────────────────────

function GpImage({ src, size = 44 }: { src: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (err || !src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: size * 0.27, flexShrink: 0,
        background: C.elevated, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.45,
      }}>💎</div>
    );
  }
  return (
    <img
      src={src} alt=""
      onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: size * 0.27, objectFit: "cover" as const, flexShrink: 0 }}
    />
  );
}

// ── Balance card ──────────────────────────────────────────────────────────────

function BalanceCard({
  rate, error, fetching, ageSeconds, onRefresh,
}: {
  rate: Rate | null; error: string; fetching: boolean; ageSeconds: number; onRefresh: () => void;
}) {
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: C.sec, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase" as const }}>
          Boss Robux — ЛК
        </span>
        <button
          onClick={onRefresh} disabled={fetching}
          style={{
            background: "none", border: "none", padding: "2px 6px",
            color: fetching ? C.muted : C.accent, cursor: "pointer",
            fontSize: 18, lineHeight: 1, transition: "color 0.15s",
            transform: fetching ? "rotate(180deg)" : "none",
          }}
        >↻</button>
      </div>

      {error ? (
        <div style={{ color: C.red, fontSize: 13 }}>⚠️ {error}</div>
      ) : !rate ? (
        <div style={{ display: "flex", gap: 8 }}>
          <Skel w="33%" h={52} r={12} />
          <Skel w="33%" h={52} r={12} />
          <Skel w="33%" h={52} r={12} />
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <StatBox label="Курс" value={`${rate.rate}`} sub="₫ / R$" />
            <StatBox
              label="Доступно" value={rate.robux_total.toLocaleString("ru-RU")} sub="R$"
              valueColor={rate.robux_total > 0 ? C.green : C.red}
            />
            <StatBox label="Макс/орд." value={rate.robux_max.toLocaleString("ru-RU")} sub="R$" />
          </div>

          <div style={{ fontSize: 10, color: C.muted, marginTop: 8, textAlign: "right" as const }}>
            {ageSeconds < 5 ? "только что" : `${ageSeconds}с назад`}
            {fetching && " · обновляю…"}
          </div>
        </>
      )}
    </div>
  );
}

function StatBox({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ background: C.elevated, borderRadius: 12, padding: "10px 8px", textAlign: "center" as const }}>
      <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1, color: valueColor ?? "#fff", letterSpacing: -0.4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: C.sec, marginTop: 2 }}>{sub}</div>}
      <div style={{ fontSize: 10, color: C.sec, marginTop: 5 }}>{label}</div>
    </div>
  );
}

// ── Gamepass list card ────────────────────────────────────────────────────────

function GamepassCard({ gp, onSelect }: { gp: Gamepass; onSelect: (gp: Gamepass) => void }) {
  return (
    <button
      onClick={() => onSelect(gp)}
      style={{
        width: "100%", background: C.card, border: "none", borderRadius: 14,
        padding: "12px 14px", marginBottom: 8,
        cursor: "pointer", textAlign: "left" as const, color: "#fff",
        display: "flex", alignItems: "center", gap: 12,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <GpImage src={gp.image} size={46} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 600, marginBottom: 3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
        }}>
          {gp.name}
        </div>
        <div style={{ fontSize: 12, color: C.sec }}>@{gp.sellerName}</div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right" as const }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.yellow, letterSpacing: -0.3 }}>
          {gp.robux.toLocaleString("ru-RU")}
        </div>
        <div style={{ fontSize: 10, color: C.sec }}>R$</div>
      </div>
      <div style={{ color: C.muted, fontSize: 18, flexShrink: 0, marginLeft: 2 }}>›</div>
    </button>
  );
}

// ── Skeleton result cards ─────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          background: C.card, borderRadius: 14, padding: "12px 14px",
          marginBottom: 8, display: "flex", alignItems: "center", gap: 12,
        }}>
          <Skel w={46} h={46} r={12} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <Skel w="65%" h={13} />
            <Skel w="40%" h={11} />
          </div>
          <Skel w={52} h={20} />
        </div>
      ))}
    </>
  );
}

// ── Purchase bottom sheet ─────────────────────────────────────────────────────

type SheetPhase = "idle" | "buying" | "ok" | "err";

function PurchaseSheet({
  gp, open, onClose, token, onPurchased,
}: {
  gp: Gamepass | null; open: boolean; onClose: () => void;
  token: string; onPurchased: (robux: number) => void;
}) {
  const [phase, setPhase] = useState<SheetPhase>("idle");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (open) { setPhase("idle"); setErrMsg(""); }
  }, [open, gp?.gamepassId]);

  async function buy() {
    if (!gp || phase === "buying") return;
    setPhase("buying");
    try {
      const res = await fetch("/api/twa/bossrobux", {
        method: "POST",
        headers: authH(token),
        body: JSON.stringify({ action: "purchase", gp }),
      });
      const d = await res.json();
      if (d.success) {
        setPhase("ok");
        onPurchased(gp.robux);
      } else {
        setErrMsg(d.msg ?? "Ошибка выкупа");
        setPhase("err");
      }
    } catch {
      setErrMsg("Ошибка сети");
      setPhase("err");
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={phase === "buying" ? undefined : onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.28s",
        }}
      />

      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 201,
        background: "#2c2c2e",
        borderRadius: "22px 22px 0 0",
        transform: open ? "translateY(0)" : "translateY(110%)",
        transition: "transform 0.38s cubic-bezier(0.32, 0.72, 0, 1)",
        paddingBottom: "env(safe-area-inset-bottom, 20px)",
        boxShadow: "0 -8px 40px rgba(0,0,0,0.6)",
        maxHeight: "90dvh",
        overflowY: "auto",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 6px" }}>
          <div style={{ width: 38, height: 5, background: C.muted, borderRadius: 3 }} />
        </div>

        {gp && (
          <div style={{ padding: "10px 20px 24px" }}>
            {phase === "ok" ? (
              <div style={{ textAlign: "center" as const, padding: "28px 0 8px" }}>
                <div style={{ fontSize: 60, marginBottom: 14, lineHeight: 1 }}>✅</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.green, marginBottom: 8 }}>Выкуплено!</div>
                <div style={{ fontSize: 15, color: C.sec, marginBottom: 28 }}>
                  {gp.name} · {gp.robux.toLocaleString("ru-RU")} R$
                </div>
                <button
                  onClick={onClose}
                  style={{
                    width: "100%", padding: "16px", border: "none", borderRadius: 14,
                    background: C.green, color: "#fff", fontSize: 17, fontWeight: 600, cursor: "pointer",
                  }}
                >Готово</button>
              </div>
            ) : (
              <>
                {/* Header */}
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 20 }}>
                  <GpImage src={gp.image} size={76} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25, marginBottom: 5, wordBreak: "break-word" as const }}>
                      {gp.name}
                    </div>
                    <div style={{ fontSize: 13, color: C.sec, marginBottom: 8 }}>@{gp.sellerName}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.yellow, letterSpacing: -1, lineHeight: 1 }}>
                      {gp.robux.toLocaleString("ru-RU")} <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0 }}>R$</span>
                    </div>
                  </div>
                </div>

                {/* IDs */}
                <div style={{ background: C.elevated, borderRadius: 13, padding: "2px 14px", marginBottom: 16 }}>
                  <IdRow label="GamepassID" value={String(gp.gamepassId)} />
                  <IdRow label="PlaceID"    value={String(gp.placeId)} />
                  <IdRow label="ProductID"  value={String(gp.productId)} last />
                </div>

                {/* Error pill */}
                {phase === "err" && (
                  <div style={{
                    background: "rgba(255,69,58,0.14)", border: "1px solid rgba(255,69,58,0.3)",
                    borderRadius: 12, padding: "10px 14px", marginBottom: 14,
                    color: C.red, fontSize: 13,
                  }}>
                    ❌ {errMsg}
                  </div>
                )}

                {/* Buy button */}
                <button
                  onClick={buy} disabled={phase === "buying"}
                  style={{
                    width: "100%", padding: "17px", border: "none", borderRadius: 14,
                    background: phase === "buying" ? C.elevated
                              : phase === "err"    ? C.orange
                              : C.green,
                    color: "#fff", fontSize: 17, fontWeight: 700, cursor: phase === "buying" ? "default" : "pointer",
                    transition: "background 0.2s", letterSpacing: -0.3,
                  }}
                >
                  {phase === "buying" ? "Выкупаю…"
                 : phase === "err"    ? "🔄 Попробовать снова"
                 : `✅ Выкупить ${gp.robux.toLocaleString("ru-RU")} R$`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function IdRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 0",
      borderBottom: last ? "none" : `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 13, color: C.sec }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: 13, color: "#fff", letterSpacing: 0.2 }}>{value}</span>
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function BossrobuxScreen({ token }: { token: string }) {
  const [rate,     setRate]     = useState<Rate | null>(null);
  const [rateErr,  setRateErr]  = useState("");
  const [fetching, setFetching] = useState(false);
  const [ageS,     setAgeS]     = useState(0);

  const [username,  setUsername]  = useState("");
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState<Gamepass[] | null>(null);
  const [searchErr, setSearchErr] = useState("");

  const [selected,  setSelected]  = useState<Gamepass | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const rateIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ageIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRate = useCallback(async () => {
    setFetching(true);
    try {
      const d = await fetch("/api/twa/bossrobux", { headers: authH(token) }).then(r => r.json());
      if (d.error) { setRateErr(d.error); }
      else { setRate(d); setRateErr(""); setAgeS(0); }
    } catch { setRateErr("Нет соединения"); }
    finally { setFetching(false); }
  }, [token]);

  useEffect(() => {
    fetchRate();
    rateIntervalRef.current = setInterval(fetchRate, 30_000);
    ageIntervalRef.current  = setInterval(() => setAgeS(a => a + 1), 1_000);
    return () => {
      if (rateIntervalRef.current) clearInterval(rateIntervalRef.current);
      if (ageIntervalRef.current)  clearInterval(ageIntervalRef.current);
    };
  }, [fetchRate]);

  async function handleSearch() {
    if (!username.trim() || searching) return;
    setSearching(true);
    setSearchErr("");
    setResults(null);
    try {
      const d = await fetch("/api/twa/bossrobux", {
        method: "POST",
        headers: authH(token),
        body: JSON.stringify({ action: "search", username: username.trim() }),
      }).then(r => r.json());
      if (d.error) setSearchErr(d.error);
      else if (!d.gamepasses?.length) setSearchErr("Геймпассы не найдены");
      else setResults(d.gamepasses);
    } catch { setSearchErr("Ошибка сети"); }
    finally { setSearching(false); }
  }

  function openSheet(gp: Gamepass) {
    setSelected(gp);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setTimeout(() => setSelected(null), 380);
  }

  function clearSearch() {
    setUsername("");
    setResults(null);
    setSearchErr("");
  }

  return (
    <div style={{ padding: "12px 16px 100px" }}>
      <style>{ANIM}</style>

      <BalanceCard
        rate={rate} error={rateErr} fetching={fetching}
        ageSeconds={ageS} onRefresh={fetchRate}
      />

      {/* Search */}
      <div style={{ background: C.card, borderRadius: 16, padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.sec, fontSize: 15, flexShrink: 0 }}>🔍</span>
          <input
            value={username}
            onChange={e => { setUsername(e.target.value); }}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Roblox-ник клиента"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "#fff", fontSize: 16, caretColor: C.accent,
              paddingTop: 4, paddingBottom: 4,
            }}
          />
          {username && (
            <button
              onClick={clearSearch}
              style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 19, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}
            >×</button>
          )}
        </div>

        {username.trim() && (
          <button
            onClick={handleSearch} disabled={searching}
            style={{
              width: "100%", marginTop: 10, padding: "12px 0",
              background: searching ? C.muted : C.accent, border: "none", borderRadius: 12,
              color: "#fff", fontSize: 15, fontWeight: 600, cursor: searching ? "default" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {searching ? "Поиск…" : "Найти геймпассы"}
          </button>
        )}
      </div>

      {/* Search error */}
      {searchErr && (
        <div style={{ fontSize: 13, color: C.red, padding: "0 4px 10px" }}>⚠️ {searchErr}</div>
      )}

      {/* Skeleton while searching */}
      {searching && <SkeletonCards />}

      {/* Results */}
      {results && results.slice(0, 10).map(gp => (
        <GamepassCard key={gp.gamepassId} gp={gp} onSelect={openSheet} />
      ))}
      {results && results.length > 10 && (
        <div style={{ fontSize: 12, color: C.sec, textAlign: "center" as const, padding: "4px 0 12px" }}>
          Показаны первые 10 из {results.length}
        </div>
      )}

      {/* Bottom sheet */}
      <PurchaseSheet
        gp={selected} open={sheetOpen}
        onClose={closeSheet} token={token}
        onPurchased={robux => {
          if (rate) setRate({ ...rate, robux_total: Math.max(0, rate.robux_total - robux) });
        }}
      />
    </div>
  );
}
