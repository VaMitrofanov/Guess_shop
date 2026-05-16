"use client";
import { useEffect, useState } from "react";

interface Product { article: string; price: number }

const DENOMS = [100, 200, 300, 500, 800, 1000, 1500, 2000];

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "#2c2c2e",
  border: "1px solid #3a3a3c",
  borderRadius: 10,
  padding: "10px 40px 10px 14px",
  color: "#fff",
  fontSize: 16,
  boxSizing: "border-box",
  outline: "none",
  WebkitAppearance: "none",
};

export default function CalcScreen({ token }: { token: string }) {
  const [products,  setProducts]  = useState<Product[]>([]);
  const [denom,     setDenom]     = useState(500);
  const [sellPrice, setSellPrice] = useState("");
  const [currency,  setCurrency]  = useState<"rub" | "usd">("rub");
  const [purchase,  setPurchase]  = useState("");
  const [usdRate,   setUsdRate]   = useState("90");
  const [comm,      setComm]      = useState("24.5");
  const [taxRate,   setTaxRate]   = useState("7");
  const [logistics, setLogistics] = useState("87.5");
  const [advanced,  setAdvanced]  = useState(false);

  useEffect(() => {
    fetch("/api/twa/stocks", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => {
        if (Array.isArray(data)) setProducts(data.map(p => ({ article: p.article, price: p.price })));
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    const found = products.find(p => p.article === String(denom));
    if (found && found.price > 0) setSellPrice(String(found.price));
  }, [denom, products]);

  const sp = parseFloat(sellPrice) || 0;
  const p  = parseFloat(purchase)  || 0;
  const ur = parseFloat(usdRate)   || 90;
  const c  = (parseFloat(comm)     || 24.5) / 100;
  const t  = (parseFloat(taxRate)  || 7)    / 100;
  const l  = parseFloat(logistics) || 87.5;

  const robuxCost = currency === "rub" ? p : p * ur;
  const afterComm = sp * (1 - c);
  const afterTax  = afterComm * (1 - t);
  const canCalc   = sp > 0 && p > 0;
  const profit    = canCalc ? afterTax - l - robuxCost : NaN;
  const profitUsd = !isNaN(profit) && ur > 0 ? profit / ur : NaN;
  const marginPct = !isNaN(profit) && sp > 0 ? (profit / sp) * 100 : NaN;

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#bf5af2" }}>Калькулятор прибыли</div>

      {/* Denomination */}
      <div>
        <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Номинал</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DENOMS.map(d => {
            const has = products.some(p => p.article === String(d));
            return (
              <button key={d} onClick={() => setDenom(d)} style={{
                padding: "7px 13px", borderRadius: 8, border: "none", cursor: "pointer",
                background: denom === d ? "#bf5af2" : "#2c2c2e",
                color: denom === d ? "#fff" : has ? "#fff" : "#636366",
                fontWeight: denom === d ? 700 : 400, fontSize: 14,
              }}>{d} R$</button>
            );
          })}
        </div>
      </div>

      {/* WB selling price */}
      <div>
        <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          Цена на WB
          {products.some(p => p.article === String(denom)) && (
            <span style={{ color: "#30d158", fontWeight: 400, marginLeft: 6, textTransform: "none" }}>авто</span>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <input
            inputMode="numeric" type="text"
            value={sellPrice}
            onChange={e => setSellPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            style={INPUT}
          />
          <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#8e8e93", pointerEvents: "none" }}>₽</span>
        </div>
      </div>

      {/* Purchase price with ₽/$ toggle */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5 }}>Цена закупки</div>
          <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 8, padding: 2, gap: 1 }}>
            {(["rub", "usd"] as const).map(cur => (
              <button key={cur} onClick={() => setCurrency(cur)} style={{
                padding: "3px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: currency === cur ? "#bf5af2" : "none",
                color: currency === cur ? "#fff" : "#636366",
              }}>{cur === "rub" ? "₽" : "$"}</button>
            ))}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <input
            inputMode="decimal" type="text"
            value={purchase}
            onChange={e => setPurchase(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={currency === "rub" ? "238" : "2.65"}
            style={INPUT}
          />
          <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#8e8e93", pointerEvents: "none" }}>
            {currency === "rub" ? "₽" : "$"}
          </span>
        </div>
        {currency === "usd" && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#636366", marginBottom: 5 }}>Курс USD → ₽</div>
            <div style={{ position: "relative" }}>
              <input
                inputMode="numeric" type="text"
                value={usdRate}
                onChange={e => setUsdRate(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="90"
                style={{ ...INPUT, padding: "8px 50px 8px 14px", fontSize: 15 }}
              />
              <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#8e8e93", fontSize: 12, pointerEvents: "none" }}>₽/$</span>
            </div>
          </div>
        )}
      </div>

      {/* Advanced params */}
      <button
        onClick={() => setAdvanced(a => !a)}
        style={{ background: "none", border: "none", color: "#636366", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
      >
        <span style={{ fontSize: 10 }}>{advanced ? "▲" : "▼"}</span>
        Параметры: комиссия · налог · логистика
      </button>

      {advanced && (
        <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Комиссия WB", val: comm, set: setComm, sfx: "%" },
            { label: "Налог УСН",   val: taxRate, set: setTaxRate, sfx: "%" },
            { label: "Логистика",   val: logistics, set: setLogistics, sfx: "₽" },
          ].map(f => (
            <div key={f.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#8e8e93" }}>{f.label}</span>
              <div style={{ position: "relative", width: 90 }}>
                <input
                  type="text" inputMode="decimal"
                  value={f.val}
                  onChange={e => f.set(e.target.value.replace(/[^0-9.]/g, ""))}
                  style={{
                    width: "100%", background: "#3a3a3c", border: "none", borderRadius: 8,
                    padding: "6px 24px 6px 8px", color: "#fff", fontSize: 14,
                    textAlign: "right", outline: "none", boxSizing: "border-box", WebkitAppearance: "none",
                  }}
                />
                <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: "#8e8e93", fontSize: 12, pointerEvents: "none" }}>{f.sfx}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      <div style={{ background: "#2c2c2e", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8, opacity: canCalc ? 1 : 0.5 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Расчёт</div>

        {([
          { label: "Цена продажи",                   val: sp > 0 ? fmt(sp) : "—",                              red: false },
          { label: `−Комиссия WB (${parseFloat(comm)||24.5}%)`, val: sp > 0 ? "−"+fmt(Math.round(sp - afterComm)) : "—", red: true },
          { label: `−Налог УСН (${parseFloat(taxRate)||7}%)`,   val: sp > 0 ? "−"+fmt(Math.round(afterComm - afterTax)) : "—", red: true },
          { label: "−Логистика",                     val: "−"+fmt(l),                                          red: true },
          { label: `−Закупка (${denom} R$)`,          val: canCalc ? "−"+fmt(Math.round(robuxCost)) : "—",    red: true },
        ] as { label: string; val: string; red: boolean }[]).map(row => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "#636366" }}>{row.label}</span>
            <span style={{ color: row.red ? "#ff6b6b" : "#fff" }}>{row.val}</span>
          </div>
        ))}

        <div style={{ borderTop: "1px solid #3a3a3c", paddingTop: 10, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>Чистая прибыль</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: canCalc ? (profit >= 0 ? "#30d158" : "#ff453a") : "#636366" }}>
              {canCalc ? (profit >= 0 ? "+" : "") + fmt(Math.round(profit)) : "—"}
            </div>
            {canCalc && !isNaN(profitUsd) && (
              <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                ${(Math.round(profitUsd * 100) / 100).toFixed(2)} · маржа {Math.round(marginPct)}%
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
