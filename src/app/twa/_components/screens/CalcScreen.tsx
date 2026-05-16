"use client";
import { useEffect, useState, useCallback } from "react";

interface WbProduct { nmID: number; article: string; price: number; discountedPrice: number; discount: number }

const DENOMS = [100, 200, 300, 500, 800, 1000, 1200, 1500, 2000];

const LS_AD = "calc_adSpend";
const LS_COMM = "calc_comm";
const LS_TAX  = "calc_tax";
const LS_LOG  = "calc_log";
const LS_USD  = "calc_usdRate";

function fmt(n: number) { return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽"; }

const BASE_INPUT: React.CSSProperties = {
  width: "100%", background: "#2c2c2e", border: "1px solid #3a3a3c",
  borderRadius: 10, padding: "10px 42px 10px 14px",
  color: "#fff", fontSize: 16, boxSizing: "border-box",
  outline: "none", WebkitAppearance: "none",
};

function NumInput({ value, onChange, placeholder, suffix, small }: {
  value: string; onChange: (v: string) => void; placeholder?: string; suffix: string; small?: boolean;
}) {
  const style: React.CSSProperties = small
    ? { width: "100%", background: "#3a3a3c", border: "none", borderRadius: 8, padding: "6px 24px 6px 8px", color: "#fff", fontSize: 14, textAlign: "right", outline: "none", boxSizing: "border-box", WebkitAppearance: "none" }
    : BASE_INPUT;
  return (
    <div style={{ position: "relative" }}>
      <input
        type="text" inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder={placeholder ?? "0"}
        style={style}
      />
      <span style={{ position: "absolute", right: small ? 6 : 14, top: "50%", transform: "translateY(-50%)", color: "#8e8e93", fontSize: small ? 12 : 14, pointerEvents: "none" }}>{suffix}</span>
    </div>
  );
}

export default function CalcScreen({ token }: { token: string }) {
  const [products,  setProducts]  = useState<WbProduct[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [denom,     setDenom]     = useState(500);
  const [sellPrice, setSellPrice] = useState("");
  const [priceAuto, setPriceAuto] = useState(false);
  const [currency,  setCurrency]  = useState<"rub" | "usd">("rub");
  const [purchase,  setPurchase]  = useState("");
  const [usdRate,   setUsdRate]   = useState(() => typeof window !== "undefined" ? localStorage.getItem(LS_USD) ?? "90" : "90");
  const [comm,      setComm]      = useState(() => typeof window !== "undefined" ? localStorage.getItem(LS_COMM) ?? "24.5" : "24.5");
  const [taxRate,   setTaxRate]   = useState(() => typeof window !== "undefined" ? localStorage.getItem(LS_TAX) ?? "7" : "7");
  const [logistics, setLogistics] = useState(() => typeof window !== "undefined" ? localStorage.getItem(LS_LOG) ?? "87.5" : "87.5");
  const [adSpend,   setAdSpend]   = useState(() => typeof window !== "undefined" ? localStorage.getItem(LS_AD) ?? "" : "");
  const [advanced,  setAdvanced]  = useState(false);

  // Persist settings to localStorage
  const persist = useCallback((key: string, val: string) => {
    if (typeof window !== "undefined") localStorage.setItem(key, val);
  }, []);

  // Load real discounted prices from WB Prices API
  useEffect(() => {
    fetch("/api/twa/products", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { items: [] })
      .then(({ items }: { items: WbProduct[] }) => {
        if (Array.isArray(items)) setProducts(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-fill discounted price when denomination changes
  useEffect(() => {
    const found = products.find(p => p.article === String(denom));
    if (found && found.discountedPrice > 0) {
      setSellPrice(String(found.discountedPrice));
      setPriceAuto(true);
    } else {
      setPriceAuto(false);
    }
  }, [denom, products]);

  const sp  = parseFloat(sellPrice)  || 0;
  const p   = parseFloat(purchase)   || 0;
  const ur  = parseFloat(usdRate)    || 90;
  const c   = (parseFloat(comm)      || 24.5) / 100;
  const t   = (parseFloat(taxRate)   || 7)    / 100;
  const l   = parseFloat(logistics)  || 87.5;
  const ad  = parseFloat(adSpend)    || 0;

  const robuxCost = currency === "rub" ? p : p * ur;
  const afterComm = sp * (1 - c);
  const afterTax  = afterComm * (1 - t);
  const canCalc   = sp > 0 && p > 0;
  const profit    = canCalc ? afterTax - l - robuxCost - ad : NaN;
  const profitUsd = !isNaN(profit) && ur > 0 ? profit / ur : NaN;
  const marginPct = !isNaN(profit) && sp > 0 ? (profit / sp) * 100 : NaN;

  const label: React.CSSProperties = { fontSize: 12, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5 };

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#bf5af2" }}>Калькулятор прибыли</div>

      {/* Denomination chips */}
      <div>
        <div style={{ ...label, marginBottom: 8 }}>Номинал</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DENOMS.map(d => {
            const prod = products.find(p => p.article === String(d));
            const has  = !!prod;
            return (
              <button key={d} onClick={() => setDenom(d)} style={{
                padding: "7px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                background: denom === d ? "#bf5af2" : "#2c2c2e",
                color: denom === d ? "#fff" : has ? "#e5e5ea" : "#48484a",
                fontWeight: denom === d ? 700 : 400, fontSize: 14,
                position: "relative",
              }}>
                {d} R$
                {has && denom !== d && (
                  <span style={{ position: "absolute", top: 2, right: 2, width: 5, height: 5, borderRadius: "50%", background: "#30d158" }} />
                )}
              </button>
            );
          })}
        </div>
        {loading && <div style={{ fontSize: 12, color: "#48484a", marginTop: 6 }}>Загрузка цен WB…</div>}
      </div>

      {/* WB selling price */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={label}>Цена на WB</span>
          {priceAuto && <span style={{ fontSize: 11, color: "#30d158", fontWeight: 600 }}>● АВТО с WB</span>}
        </div>
        <NumInput value={sellPrice} onChange={v => { setSellPrice(v); setPriceAuto(false); }} placeholder="0" suffix="₽" />
        {priceAuto && (() => {
          const prod = products.find(p => p.article === String(denom));
          return prod ? (
            <div style={{ fontSize: 11, color: "#48484a", marginTop: 4 }}>
              полная {fmt(prod.price)} · скидка {prod.discount}% → {fmt(prod.discountedPrice)}
            </div>
          ) : null;
        })()}
      </div>

      {/* Purchase price */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={label}>Цена закупки</span>
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
        <NumInput
          value={purchase}
          onChange={setPurchase}
          placeholder={currency === "rub" ? "238" : "2.65"}
          suffix={currency === "rub" ? "₽" : "$"}
        />
        {currency === "usd" && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "#636366", marginBottom: 5 }}>Курс USD → ₽</div>
            <NumInput value={usdRate} onChange={v => { setUsdRate(v); persist(LS_USD, v); }} placeholder="90" suffix="₽/$" />
          </div>
        )}
      </div>

      {/* Ad spend */}
      <div>
        <div style={{ ...label, marginBottom: 6 }}>Расход на рекламу / заказ</div>
        <NumInput
          value={adSpend}
          onChange={v => { setAdSpend(v); persist(LS_AD, v); }}
          placeholder="0 — без рекламы"
          suffix="₽"
        />
        <div style={{ fontSize: 11, color: "#48484a", marginTop: 4 }}>
          CPO из WB кабинета, либо бюджет ÷ кол-во заказов за период
        </div>
      </div>

      {/* Advanced */}
      <button
        onClick={() => setAdvanced(a => !a)}
        style={{ background: "none", border: "none", color: "#636366", fontSize: 12, cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 4 }}
      >
        <span style={{ fontSize: 10 }}>{advanced ? "▲" : "▼"}</span>
        Параметры: комиссия · налог · логистика
      </button>

      {advanced && (
        <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {([
            { lbl: "Комиссия WB", val: comm,      set: (v: string) => { setComm(v); persist(LS_COMM, v); }, sfx: "%" },
            { lbl: "Налог УСН",   val: taxRate,   set: (v: string) => { setTaxRate(v); persist(LS_TAX, v); }, sfx: "%" },
            { lbl: "Логистика",   val: logistics, set: (v: string) => { setLogistics(v); persist(LS_LOG, v); }, sfx: "₽" },
          ] as { lbl: string; val: string; set: (v: string) => void; sfx: string }[]).map(f => (
            <div key={f.lbl} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#8e8e93" }}>{f.lbl}</span>
              <div style={{ width: 90 }}>
                <NumInput value={f.val} onChange={f.set} suffix={f.sfx} small />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Result */}
      <div style={{ background: "#2c2c2e", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8, opacity: canCalc ? 1 : 0.45 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Расчёт</div>

        {([
          { lbl: "Цена продажи",                          val: sp > 0 ? fmt(sp) : "—",                                   red: false },
          { lbl: `−Комиссия WB (${parseFloat(comm)||24.5}%)`, val: sp > 0 ? "−"+fmt(Math.round(sp - afterComm)) : "—",    red: true  },
          { lbl: `−Налог УСН (${parseFloat(taxRate)||7}%)`,   val: sp > 0 ? "−"+fmt(Math.round(afterComm - afterTax)) : "—", red: true },
          { lbl: "−Логистика",                             val: "−"+fmt(l),                                              red: true  },
          { lbl: `−Закупка (${denom} R$)`,                  val: canCalc ? "−"+fmt(Math.round(robuxCost)) : "—",         red: true  },
          ...(ad > 0 ? [{ lbl: "−Реклама / заказ", val: "−"+fmt(ad), red: true }] : []),
        ] as { lbl: string; val: string; red: boolean }[]).map(row => (
          <div key={row.lbl} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "#636366" }}>{row.lbl}</span>
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
