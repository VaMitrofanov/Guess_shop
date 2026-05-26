"use client";
import { useEffect, useState, useRef } from "react";

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a",
  orange: "#ff9f0a", sec: "#8e8e93", bg: "#1c1c1e",
};

interface Rate {
  rate: number;
  robux_total: number;
  robux_max: number;
}

interface Gamepass {
  placeId: number;
  productId: number;
  gamepassId: number;
  name: string;
  robux: number;
  sellerName: string;
  image: string;
}

type View = "main" | "results" | "confirm" | "done";

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function BossrobuxScreen({ token }: { token: string }) {
  const [rate,      setRate]      = useState<Rate | null>(null);
  const [rateErr,   setRateErr]   = useState("");
  const [view,      setView]      = useState<View>("main");
  const [username,  setUsername]  = useState("");
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState<Gamepass[]>([]);
  const [searchErr, setSearchErr] = useState("");
  const [selected,  setSelected]  = useState<Gamepass | null>(null);
  const [buying,    setBuying]    = useState(false);
  const [doneMsg,   setDoneMsg]   = useState({ ok: false, msg: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/twa/bossrobux", { headers: authHeaders(token) })
      .then(r => r.json())
      .then(d => {
        if (d.error) setRateErr(d.error);
        else setRate(d);
      })
      .catch(() => setRateErr("Нет соединения"));
  }, [token]);

  async function handleSearch() {
    if (!username.trim()) return;
    setSearching(true);
    setSearchErr("");
    try {
      const res = await fetch("/api/twa/bossrobux", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "search", username: username.trim() }),
      });
      const d = await res.json();
      if (d.error) { setSearchErr(d.error); setSearching(false); return; }
      if (!d.gamepasses?.length) { setSearchErr("Геймпассы не найдены"); setSearching(false); return; }
      setResults(d.gamepasses);
      setView("results");
    } catch {
      setSearchErr("Ошибка сети");
    }
    setSearching(false);
  }

  async function handlePurchase() {
    if (!selected) return;
    setBuying(true);
    try {
      const res = await fetch("/api/twa/bossrobux", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ action: "purchase", gp: selected }),
      });
      const d = await res.json();
      setDoneMsg({ ok: d.success, msg: d.msg ?? "" });
      if (d.success && rate) {
        setRate({ ...rate, robux_total: Math.max(0, rate.robux_total - selected.robux) });
      }
    } catch {
      setDoneMsg({ ok: false, msg: "Ошибка сети" });
    }
    setBuying(false);
    setView("done");
  }

  function reset() {
    setView("main");
    setUsername("");
    setResults([]);
    setSearchErr("");
    setSelected(null);
  }

  return (
    <div style={{ padding: "12px 16px 80px" }}>

      {/* Balance card */}
      <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: C.sec, marginBottom: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" as const }}>
          Boss Robux — ЛК
        </div>
        {rateErr ? (
          <div style={{ color: C.red, fontSize: 13 }}>⚠️ {rateErr}</div>
        ) : rate ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <Stat label="Курс" value={`${rate.rate}`} unit="/ R$" />
            <Stat label="Доступно" value={`${rate.robux_total.toLocaleString("ru-RU")}`} unit="R$" color={rate.robux_total > 0 ? C.green : C.red} />
            <Stat label="Макс/орд." value={`${rate.robux_max.toLocaleString("ru-RU")}`} unit="R$" />
          </div>
        ) : (
          <div style={{ color: C.sec, fontSize: 13 }}>Загрузка…</div>
        )}
      </div>

      {/* Main: search */}
      {view === "main" && (
        <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 12, color: C.sec, marginBottom: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" as const }}>
            Выкуп геймпасса
          </div>
          <div style={{ fontSize: 13, color: C.sec, marginBottom: 12 }}>
            Введи Roblox-ник клиента (указан в карточке заказа)
          </div>
          <input
            ref={inputRef}
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="RobloxUsername"
            style={{
              width: "100%", boxSizing: "border-box" as const,
              background: C.elevated, border: `1px solid ${C.border}`,
              borderRadius: 10, padding: "10px 12px",
              color: "#fff", fontSize: 15, outline: "none",
              marginBottom: 10,
            }}
          />
          {searchErr && <div style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>⚠️ {searchErr}</div>}
          <button
            onClick={handleSearch}
            disabled={searching || !username.trim()}
            style={{
              width: "100%", padding: "11px 0", border: "none", borderRadius: 10,
              background: searching || !username.trim() ? C.elevated : C.accent,
              color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            {searching ? "Поиск…" : "🔍 Найти геймпассы"}
          </button>
        </div>
      )}

      {/* Results list */}
      {view === "results" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={reset} style={{ background: C.elevated, border: "none", borderRadius: 8, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>
              ← Назад
            </button>
            <div style={{ fontSize: 13, color: C.sec }}>
              {results.length} геймпасс{results.length === 1 ? "" : results.length < 5 ? "а" : "ов"} — @{username}
            </div>
          </div>
          {results.slice(0, 8).map((gp, i) => (
            <button
              key={i}
              onClick={() => { setSelected(gp); setView("confirm"); }}
              style={{
                width: "100%", background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: "12px 14px", marginBottom: 8,
                cursor: "pointer", textAlign: "left" as const, color: "#fff",
                display: "block",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{gp.name}</div>
              <div style={{ fontSize: 12, color: C.sec }}>
                <span style={{ color: C.yellow, fontWeight: 700 }}>💎 {gp.robux} R$</span>
                {"  "}· @{gp.sellerName}
              </div>
              <div style={{ fontSize: 10, color: C.sec, marginTop: 4 }}>
                GP: {gp.gamepassId} · Place: {gp.placeId}
              </div>
            </button>
          ))}
          {results.length > 8 && (
            <div style={{ fontSize: 12, color: C.sec, textAlign: "center" as const, padding: 8 }}>
              Показаны первые 8 из {results.length}
            </div>
          )}
        </div>
      )}

      {/* Confirm */}
      {view === "confirm" && selected && (
        <div style={{ background: C.card, borderRadius: 14, padding: "16px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>⚠️ Подтверди выкуп</div>
          <Row label="Геймпасс" value={selected.name} />
          <Row label="Сумма" value={`${selected.robux} R$`} valueColor={C.yellow} />
          <Row label="Продавец" value={`@${selected.sellerName}`} />
          <Row label="GamepassID" value={String(selected.gamepassId)} mono />
          <Row label="PlaceID" value={String(selected.placeId)} mono />
          <Row label="ProductID" value={String(selected.productId)} mono />
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => setView("results")}
              style={{ flex: 1, padding: "11px 0", border: "none", borderRadius: 10, background: C.elevated, color: "#fff", fontSize: 14, cursor: "pointer" }}
            >
              ← Назад
            </button>
            <button
              onClick={handlePurchase}
              disabled={buying}
              style={{ flex: 2, padding: "11px 0", border: "none", borderRadius: 10, background: buying ? C.elevated : C.green, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "background 0.15s" }}
            >
              {buying ? "Выкупаю…" : "✅ Выкупить"}
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {view === "done" && (
        <div style={{ background: C.card, borderRadius: 14, padding: "24px 16px", textAlign: "center" as const }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{doneMsg.ok ? "✅" : "❌"}</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: doneMsg.ok ? C.green : C.red }}>
            {doneMsg.ok ? "Выкуп успешен!" : "Ошибка выкупа"}
          </div>
          {selected && doneMsg.ok && (
            <div style={{ fontSize: 14, color: C.sec, marginBottom: 8 }}>
              {selected.name} · {selected.robux} R$
            </div>
          )}
          {doneMsg.msg && (
            <div style={{ fontSize: 13, color: C.sec, marginBottom: 16 }}>{doneMsg.msg}</div>
          )}
          <button
            onClick={reset}
            style={{ padding: "11px 32px", border: "none", borderRadius: 10, background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Новый выкуп
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" as const }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "#fff" }}>{value}</div>
      {unit && <div style={{ fontSize: 10, color: C.sec }}>{unit}</div>}
      <div style={{ fontSize: 10, color: C.sec, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function Row({ label, value, mono, valueColor }: { label: string; value: string; mono?: boolean; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.sec }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: mono ? "monospace" : undefined, color: valueColor ?? "#fff", maxWidth: "60%", textAlign: "right" as const, wordBreak: "break-all" as const }}>
        {value}
      </span>
    </div>
  );
}
