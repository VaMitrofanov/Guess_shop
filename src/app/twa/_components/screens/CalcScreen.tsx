"use client";
import { useEffect, useState } from "react";

interface UeData {
  kursRb:            number;
  kursUsd:           number;
  fixedCost:         number;
  cpo:               number;
  storagePerUnit:    number;
  products:          { nmID: number; article: string; price: number; discountedPrice: number; discount: number }[];
  costByArticle:     Record<string, { commission: number; taxRate: number; denomination: number | null }>;
  lastAdAttributedAt: string | null;
  adFromDate:        string;
}

const LS_KURS_MODE = "calc_kursMode";
const LS_KURS_RB   = "calc_kursRb";

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

function ls(key: string, def: string) {
  if (typeof window === "undefined") return def;
  return localStorage.getItem(key) ?? def;
}

export default function CalcScreen({ token }: { token: string }) {
  const [ueData,      setUeData]      = useState<UeData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [attributing, setAttributing] = useState(false);
  const [attributed,  setAttributed]  = useState<{ amount: number; at: string } | null>(null);
  const [withAds,     setWithAds]     = useState(true);

  // The one thing the user inputs: purchase rate
  // kursMode: "rate" = kursRb directly | "rub" = total ₽ for denom | "usd" = total $ for denom
  const [kursMode, setKursMode] = useState<"rate" | "rub" | "usd">(() => ls(LS_KURS_MODE, "rate") as any);
  const [kursVal,  setKursVal]  = useState(() => ls(LS_KURS_RB, ""));
  const [denom,    setDenom]    = useState(500);

  useEffect(() => {
    fetch("/api/twa/ue", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: UeData | null) => {
        setUeData(d);
        // pre-fill kursRb from settings if user hasn't typed anything
        if (d && !ls(LS_KURS_RB, "")) setKursVal(String(d.kursRb));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  // Persist mode + value
  const updateKursMode = (m: typeof kursMode) => {
    setKursMode(m);
    localStorage.setItem(LS_KURS_MODE, m);
    setKursVal(""); // reset input when switching mode
  };
  const updateKursVal = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setKursVal(clean);
    localStorage.setItem(LS_KURS_RB, clean);
  };

  // --- Resolve kursRb from whichever mode the user is in ---
  const ud = ueData;
  const kursUsd = ud?.kursUsd ?? 75;
  const rawVal  = parseFloat(kursVal) || 0;

  let kursRb = 0;
  if (kursMode === "rate") kursRb = rawVal;
  else if (kursMode === "rub") kursRb = denom > 0 ? rawVal * 700 / (kursUsd * denom) : 0;
  else if (kursMode === "usd") kursRb = denom > 0 ? rawVal * 700 / denom : 0;

  // computed total purchase cost for current denom
  const robuxCost = kursRb * kursUsd * denom / 700;

  // Find matching product for current denomination
  const product = ud?.products.find(p => p.article === String(denom));
  const sellPrice = product?.discountedPrice ?? 0;

  // Per-product costs (or global defaults)
  const costEntry = product ? (ud?.costByArticle[product.article] ?? null) : null;
  const commission = costEntry?.commission ?? 0.245;
  const taxRate    = costEntry?.taxRate    ?? 0.07;
  const fixedCost  = ud?.fixedCost ?? 87.5;
  const rawCpo     = ud?.cpo ?? 0;
  const cpo        = withAds ? rawCpo : 0;
  const storage    = ud?.storagePerUnit ?? 0;

  // Profit chain
  const afterComm = sellPrice * (1 - commission);
  const afterTax  = afterComm * (1 - taxRate);
  const profit    = sellPrice > 0 && kursRb > 0
    ? afterTax - fixedCost - robuxCost - cpo - storage
    : NaN;
  const profitUsd = !isNaN(profit) && kursUsd > 0 ? profit / kursUsd : NaN;
  const marginPct = !isNaN(profit) && sellPrice > 0 ? (profit / sellPrice) * 100 : NaN;

  const hasPrice  = sellPrice > 0;
  const hasKurs   = kursRb > 0;
  const canCalc   = hasPrice && hasKurs;

  // Label for equivalent cost
  const equivLabel = (() => {
    if (!hasKurs) return null;
    if (kursMode === "rate")
      return `= ${fmt(Math.round(robuxCost))} за ${denom} R$`;
    if (kursMode === "rub" || kursMode === "usd") {
      const rate = Math.round(kursRb * 100) / 100;
      return `kursRb = ${rate} · = ${fmt(Math.round(robuxCost))} за ${denom} R$`;
    }
    return null;
  })();

  const inputStyle: React.CSSProperties = {
    flex: 1, background: "#2c2c2e", border: "1px solid #3a3a3c", borderRadius: 10,
    padding: "10px 14px", color: "#fff", fontSize: 18, fontWeight: 600,
    outline: "none", boxSizing: "border-box", WebkitAppearance: "none",
    minWidth: 0,
  };

  const row = (lbl: string, val: string, red = false, sub?: string) => (
    <div key={lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: 13, padding: "2px 0" }}>
      <span style={{ color: "#636366", flex: 1 }}>{lbl}</span>
      <div style={{ textAlign: "right" }}>
        <span style={{ color: red ? "#ff6b6b" : "#e5e5ea", fontWeight: red ? 400 : 500 }}>{val}</span>
        {sub && <div style={{ fontSize: 11, color: "#48484a", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );

  const DENOMS = [100, 200, 300, 500, 800, 1000, 1200, 1500, 2000];

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Header */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#bf5af2" }}>Калькулятор прибыли</div>
        {ud && (
          <div style={{ fontSize: 12, color: "#48484a", marginTop: 2 }}>
            Курс: {ud.kursRb} руб/ед · $1={ud.kursUsd}₽ · Фикс: {ud.fixedCost}₽
            {cpo > 0 && ` · CPO: ${Math.round(cpo)}₽`}
          </div>
        )}
        {loading && <div style={{ fontSize: 12, color: "#48484a", marginTop: 2 }}>Загрузка настроек…</div>}
      </div>

      {/* Denomination chips */}
      <div>
        <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Номинал</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DENOMS.map(d => {
            const prod  = ud?.products.find(p => p.article === String(d));
            const active = denom === d;
            return (
              <button key={d} onClick={() => setDenom(d)} style={{
                padding: "7px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                background: active ? "#bf5af2" : "#2c2c2e",
                color: active ? "#fff" : prod ? "#e5e5ea" : "#48484a",
                fontWeight: active ? 700 : 400, fontSize: 14, position: "relative",
              }}>
                {d} R$
                {prod && !active && (
                  <span style={{ position: "absolute", top: 2, right: 2, width: 5, height: 5, borderRadius: "50%", background: "#30d158" }} />
                )}
              </button>
            );
          })}
        </div>
        {product && (
          <div style={{ fontSize: 11, color: "#48484a", marginTop: 6 }}>
            WB: {product.discountedPrice} ₽ (полная {product.price} ₽, −{product.discount}%)
          </div>
        )}
        {!product && !loading && ud && (
          <div style={{ fontSize: 11, color: "#636366", marginTop: 6 }}>Товар не найден на WB — введите цену вручную</div>
        )}
      </div>

      {/* Sell price override if no WB product */}
      {!product && !loading && (
        <div>
          <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Цена на WB (вручную)</div>
          <ManualSellPrice denom={denom} onPrice={() => {}} />
        </div>
      )}

      {/* Kurs input */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5 }}>Курс закупки</div>
          <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 8, padding: 2, gap: 1 }}>
            {([
              { id: "rate", label: "курс" },
              { id: "rub",  label: "₽" },
              { id: "usd",  label: "$" },
            ] as { id: "rate" | "rub" | "usd"; label: string }[]).map(opt => (
              <button key={opt.id} onClick={() => updateKursMode(opt.id)} style={{
                padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: kursMode === opt.id ? "#bf5af2" : "none",
                color: kursMode === opt.id ? "#fff" : "#636366",
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="text" inputMode="decimal"
            value={kursVal}
            onChange={e => updateKursVal(e.target.value)}
            placeholder={kursMode === "rate" ? (ud ? String(ud.kursRb) : "4") : kursMode === "rub" ? "238" : "2.85"}
            style={inputStyle}
          />
          <span style={{ color: "#8e8e93", fontSize: 16, flexShrink: 0 }}>
            {kursMode === "rate" ? "руб/ед" : kursMode === "rub" ? "₽" : "$"}
          </span>
        </div>
        {equivLabel && (
          <div style={{ fontSize: 12, color: "#30d158", marginTop: 5 }}>{equivLabel}</div>
        )}
        {kursMode === "rate" && (
          <div style={{ fontSize: 11, color: "#48484a", marginTop: 3 }}>
            формула: kursRb × {kursUsd} × номинал / 700
          </div>
        )}
      </div>

      {/* Calculation breakdown */}
      <div style={{ background: "#2c2c2e", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 2, opacity: canCalc ? 1 : 0.45 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5 }}>Юнит-экономика</div>
          {rawCpo > 0 && (
            <button onClick={() => setWithAds(v => !v)} style={{
              display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
              cursor: "pointer", padding: "2px 0",
            }}>
              <div style={{
                width: 32, height: 18, borderRadius: 9, position: "relative", flexShrink: 0,
                background: withAds ? "#bf5af2" : "#48484a", transition: "background 0.2s",
              }}>
                <div style={{
                  position: "absolute", top: 2, left: withAds ? 14 : 2, width: 14, height: 14,
                  borderRadius: "50%", background: "#fff", transition: "left 0.2s",
                }} />
              </div>
              <span style={{ fontSize: 11, color: withAds ? "#bf5af2" : "#636366" }}>
                {withAds ? `реклама ${Math.round(rawCpo)}₽` : "без рекламы"}
              </span>
            </button>
          )}
        </div>

        {row("Цена продажи", hasPrice ? fmt(sellPrice) : "нет данных WB")}
        {row(`−Комса WB (${Math.round(commission * 100)}%)`, hasPrice ? "−" + fmt(Math.round(sellPrice - afterComm)) : "—", true)}
        {row(`−Налог УСН (${Math.round(taxRate * 100)}%)`, hasPrice ? "−" + fmt(Math.round(afterComm - afterTax)) : "—", true)}
        {row("−Фикс. затраты", "−" + fmt(fixedCost), true)}
        {row(`−Себест. Robux`, hasKurs ? "−" + fmt(Math.round(robuxCost)) : "—", true,
          hasKurs ? `${kursRb}×${kursUsd}×${denom}/700` : undefined
        )}
        {withAds && cpo > 0 && row("−Реклама/ед", "−" + fmt(Math.round(cpo)), true, "WB CPO")}
        {storage > 0 && row("−Хранение/ед", "−" + fmt(Math.round(storage)), true, "из реализации")}

        <div style={{ borderTop: "1px solid #3a3a3c", margin: "8px 0 6px" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Чистая прибыль</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: canCalc ? (profit >= 0 ? "#30d158" : "#ff453a") : "#636366" }}>
              {canCalc ? (profit >= 0 ? "+" : "") + fmt(Math.round(profit)) : "—"}
            </div>
            {canCalc && !isNaN(profitUsd) && (
              <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                ${profitUsd.toFixed(2)} · маржа {Math.round(marginPct)}%
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mark order complete — only relevant when ads are included */}
      {withAds && <div style={{ background: "#1c1c1e", borderRadius: 14, border: "1px solid #2c2c2e", padding: 14 }}>
        <div style={{ fontSize: 12, color: "#8e8e93", marginBottom: 4 }}>
          Реклама считается с{" "}
          <span style={{ color: "#e5e5ea" }}>
            {ud?.lastAdAttributedAt
              ? new Date(ud.lastAdAttributedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
              : ud?.adFromDate ?? "…"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#636366", marginBottom: 10 }}>
          Весь расход за этот период = CPO следующего заказа.
          После выполнения — нажми кнопку, счётчик сбросится.
        </div>

        {attributed && (
          <div style={{ background: "#0d2a0d", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#30d158" }}>
            ✓ Зафиксировано: {attributed.amount.toLocaleString("ru-RU")} ₽ на рекламу
          </div>
        )}

        {rawCpo === 0 && !attributed ? (
          <div style={{ background: "#2c2c2e", borderRadius: 10, padding: "12px 14px", textAlign: "center", color: "#636366", fontSize: 14 }}>
            Нет расходов на рекламу за этот период
          </div>
        ) : (
          <button
            disabled={attributing || rawCpo === 0}
            onClick={async () => {
              setAttributing(true);
              try {
                const res = await fetch("/api/twa/ad-attr", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const data = await res.json();
                  setAttributed({ amount: data.attributed ?? 0, at: data.lastAttributedAt });
                  const ueRes = await fetch("/api/twa/ue", { headers: { Authorization: `Bearer ${token}` } });
                  if (ueRes.ok) setUeData(await ueRes.json());
                }
              } finally {
                setAttributing(false);
              }
            }}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
              cursor: attributing ? "default" : "pointer",
              background: attributing ? "#2c2c2e" : "#bf5af2",
              color: "#fff", fontSize: 15, fontWeight: 600,
            }}
          >
            {attributing ? "Фиксируем…" : "✓ Заказ выполнен — зафиксировать рекламу"}
          </button>
        )}
      </div>}

      <div style={{ fontSize: 11, color: "#3a3a3c", textAlign: "center" }}>
        Настройки (комиссия, налог, курс USD) меняются в боте → ⚙️ Юнит-экономика
      </div>
    </div>
  );
}

// Stub — only shown when product not in WB API (rare edge case)
function ManualSellPrice({ denom, onPrice }: { denom: number; onPrice: (p: number) => void }) {
  const [val, setVal] = useState("");
  return (
    <input
      type="text" inputMode="numeric"
      value={val}
      onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ""); setVal(v); onPrice(parseInt(v) || 0); }}
      placeholder={String(denom * 2)}
      style={{
        width: "100%", background: "#2c2c2e", border: "1px solid #3a3a3c", borderRadius: 10,
        padding: "10px 14px", color: "#fff", fontSize: 16, boxSizing: "border-box", outline: "none",
      }}
    />
  );
}
