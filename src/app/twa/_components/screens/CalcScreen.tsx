"use client";
import { useEffect, useState } from "react";

interface UeData {
  kursRb:            number;
  kursUsd:           number;
  fixedCost:         number;
  cpo:               number;
  advertisedNmIds:   number[];
  spendByNmId:       Record<number, number>;
  storagePerUnit:    number;
  storageByArticle:  Record<string, number>;
  logPerUnit:        number;
  logByArticle:      Record<string, number>;
  retPct:            number;
  retByArticle:      Record<string, number>;
  penaltyPerUnit:    number;
  commByArticle:     Record<string, number>;
  products:          { nmID: number; article: string; price: number; discountedPrice: number; discount: number }[];
  costByArticle:     Record<string, { commission: number; taxRate: number; denomination: number | null }>;
  lastAdAttributedAt: string | null;
  adFromDate:        string;
}

const LS_KURS_MODE = "calc_kursMode";
const LS_KURS_RB   = "calc_kursRb";
const DENOMS       = [100, 200, 300, 500, 800, 1000, 1200, 1500, 2000];

const C = {
  bg:       "#1c1c1e",
  card:     "#2c2c2e",
  elevated: "#3a3a3c",
  border:   "#3a3a3c",
  accent:   "#bf5af2",
  green:    "#30d158",
  red:      "#ff453a",
  yellow:   "#ffd60a",
  sec:      "#8e8e93",
  muted:    "#48484a",
};

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}
function ls(key: string, def: string) {
  if (typeof window === "undefined") return def;
  return localStorage.getItem(key) ?? def;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4,
      background: color + "28", color, letterSpacing: 0.4, flexShrink: 0,
    }}>{label}</span>
  );
}

function Row({
  label, value, note, badge, negative = false, dim = false,
}: {
  label: string; value: string; note?: string; badge?: React.ReactNode;
  negative?: boolean; dim?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: dim ? C.muted : C.sec, whiteSpace: "nowrap" }}>{label}</span>
        {badge}
        {note && <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note}</span>}
      </div>
      <span style={{
        fontSize: 13, fontWeight: 500, flexShrink: 0, marginLeft: 8,
        color: dim ? C.muted : negative ? "#e5e5ea" : "#e5e5ea",
      }}>{value}</span>
    </div>
  );
}

export default function CalcScreen({ token }: { token: string }) {
  const [ueData,      setUeData]      = useState<UeData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [attributing, setAttributing] = useState(false);
  const [attributed,  setAttributed]  = useState<{ amount: number; at: string } | null>(null);
  const [withAdsOverride, setWithAdsOverride] = useState<boolean | null>(null);

  const [kursMode, setKursMode] = useState<"rate" | "rub" | "usd">(() => ls(LS_KURS_MODE, "rate") as "rate" | "rub" | "usd");
  const [kursVal,  setKursVal]  = useState(() => ls(LS_KURS_RB, ""));
  const [denom,    setDenom]    = useState(500);

  useEffect(() => {
    fetch("/api/twa/ue", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((d: UeData | null) => {
        setUeData(d);
        if (d && !ls(LS_KURS_RB, "")) setKursVal(String(d.kursRb));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const setDenomAndReset = (d: number) => { setDenom(d); setWithAdsOverride(null); };

  const updateKursMode = (m: typeof kursMode) => {
    setKursMode(m);
    localStorage.setItem(LS_KURS_MODE, m);
    setKursVal("");
  };
  const updateKursVal = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setKursVal(clean);
    localStorage.setItem(LS_KURS_RB, clean);
  };

  const ud      = ueData;
  const kursUsd = ud?.kursUsd ?? 75;
  const rawVal  = parseFloat(kursVal) || 0;

  let kursRb = 0;
  if (kursMode === "rate") kursRb = rawVal;
  else if (kursMode === "rub") kursRb = denom > 0 ? rawVal * 700 / (kursUsd * denom) : 0;
  else if (kursMode === "usd") kursRb = denom > 0 ? rawVal * 700 / denom : 0;

  const robuxCost = kursRb * kursUsd * denom / 700;

  const product   = ud?.products.find(p => p.article === String(denom));
  const sellPrice = product?.discountedPrice ?? 0;

  const article    = product?.article ?? String(denom);
  const costEntry  = product ? (ud?.costByArticle[product.article] ?? null) : null;

  // Real WB commission from realization report (commSum/revenue), fallback to DB/default
  const commFromRealiz = ud?.commByArticle?.[article];
  const commission     = commFromRealiz != null ? commFromRealiz / 100 : (costEntry?.commission ?? 0.245);
  const isRealComm     = commFromRealiz != null;

  const taxRate    = costEntry?.taxRate    ?? 0.07;
  const fixedCost  = ud?.fixedCost        ?? 87.5;
  const rawCpo     = ud?.cpo              ?? 0;

  const withAds = withAdsOverride !== null ? withAdsOverride : rawCpo > 0;
  const cpo     = withAds ? rawCpo : 0;

  const storage   = ud ? (ud.storageByArticle[article] ?? ud.storagePerUnit) : 0;
  const logistics = ud ? (ud.logByArticle[article]     ?? ud.logPerUnit)      : 0;
  const retPct    = ud ? (ud.retByArticle[article]     ?? ud.retPct)          : 0;
  const penalty   = ud?.penaltyPerUnit ?? 0;

  const afterComm = sellPrice * (1 - commission);
  const afterTax  = afterComm * (1 - taxRate);

  // Return loss: retPct% of orders come back — we lose afterTax and pay return delivery
  const returnLoss = retPct > 0 && sellPrice > 0
    ? Math.round(retPct / 100 * (afterTax + logistics))
    : 0;

  const hasPrice = sellPrice > 0;
  const hasKurs  = kursRb > 0;
  const canCalc  = hasPrice && hasKurs;

  const profit    = canCalc
    ? afterTax - fixedCost - robuxCost - cpo - storage - logistics - penalty - returnLoss
    : NaN;
  const profitUsd = !isNaN(profit) && kursUsd > 0 ? profit / kursUsd : NaN;
  const marginPct = !isNaN(profit) && sellPrice > 0 ? (profit / sellPrice) * 100 : NaN;

  const equivLabel = (() => {
    if (!hasKurs) return null;
    if (kursMode === "rate") return `= ${fmt(Math.round(robuxCost))} за ${denom} R$`;
    return `курс ${Math.round(kursRb * 100) / 100} руб/ед · = ${fmt(Math.round(robuxCost))} за ${denom} R$`;
  })();

  return (
    <div style={{ padding: 16, paddingBottom: 32, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Denomination selector */}
      <div>
        <div style={{ fontSize: 11, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>
          Номинал
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto" as const, paddingBottom: 4, marginBottom: 8 }}>
          <style>{`.denom-scroll::-webkit-scrollbar{display:none}`}</style>
          {DENOMS.map(d => {
            const prod   = ud?.products.find(p => p.article === String(d));
            const active = denom === d;
            return (
              <button key={d} onClick={() => setDenomAndReset(d)} style={{
                flexShrink: 0, padding: "8px 14px", borderRadius: 10, border: "none",
                cursor: "pointer", fontSize: 14, fontWeight: active ? 700 : 500,
                background: active ? C.accent : C.card,
                color: active ? "#fff" : prod ? "#e5e5ea" : C.muted,
                boxShadow: active ? `0 0 0 2px ${C.accent}50` : "none",
              }}>
                {d}
              </button>
            );
          })}
        </div>

        {product ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 22, fontWeight: 700 }}>
              {product.discountedPrice.toLocaleString("ru-RU")} ₽
            </span>
            {product.discount > 0 && (
              <>
                <span style={{ fontSize: 13, color: C.muted, textDecoration: "line-through" }}>
                  {product.price.toLocaleString("ru-RU")} ₽
                </span>
                <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>−{product.discount}%</span>
              </>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: C.muted }}>
            {loading ? "Загрузка…" : "Нет цены на WB — введите вручную"}
          </div>
        )}
      </div>

      {/* Manual price when no WB product */}
      {!product && !loading && (
        <div>
          <div style={{ fontSize: 11, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 6 }}>
            Цена на WB
          </div>
          <input
            type="text" inputMode="numeric"
            placeholder={String(denom * 2)}
            style={{
              width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "10px 14px", color: "#fff", fontSize: 16, boxSizing: "border-box" as const, outline: "none",
            }}
          />
        </div>
      )}

      {/* Kurs input */}
      <div style={{ background: C.card, borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Курс закупки</span>
          <div style={{ display: "flex", background: C.elevated, borderRadius: 8, padding: 2, gap: 1 }}>
            {(["rate", "rub", "usd"] as const).map(m => (
              <button key={m} onClick={() => updateKursMode(m)} style={{
                padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 600,
                background: kursMode === m ? C.accent : "none",
                color: kursMode === m ? "#fff" : C.sec,
              }}>
                {m === "rate" ? "курс" : m === "rub" ? "₽" : "$"}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="text" inputMode="decimal"
            value={kursVal}
            onChange={e => updateKursVal(e.target.value)}
            placeholder={kursMode === "rate" ? (ud ? String(ud.kursRb) : "4") : kursMode === "rub" ? "238" : "2.85"}
            style={{
              flex: 1, background: C.elevated, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "12px 14px", color: "#fff", fontSize: 22, fontWeight: 700,
              outline: "none", boxSizing: "border-box" as const,
              WebkitAppearance: "none" as const, minWidth: 0,
            }}
          />
          <span style={{ color: C.sec, fontSize: 14, flexShrink: 0 }}>
            {kursMode === "rate" ? "руб/ед" : kursMode === "rub" ? "₽" : "$"}
          </span>
        </div>

        {equivLabel && (
          <div style={{ fontSize: 12, color: C.green, marginTop: 8, fontWeight: 500 }}>{equivLabel}</div>
        )}
        {kursMode === "rate" && hasKurs && (
          <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
            {kursRb} × {kursUsd} × {denom} / 700
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div style={{ background: C.card, borderRadius: 14, padding: 16, opacity: canCalc ? 1 : 0.55 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6 }}>
            Юнит-экономика
          </span>
          {rawCpo > 0 && (
            <button
              onClick={() => setWithAdsOverride(withAds ? false : true)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <div style={{
                width: 32, height: 18, borderRadius: 9, position: "relative" as const, flexShrink: 0,
                background: withAds ? C.accent : C.elevated, transition: "background 0.2s",
              }}>
                <div style={{
                  position: "absolute" as const, top: 2, left: withAds ? 14 : 2, width: 14, height: 14,
                  borderRadius: "50%", background: "#fff", transition: "left 0.15s",
                }} />
              </div>
              <span style={{ fontSize: 11, color: withAds ? C.accent : C.sec }}>
                реклама{withAds ? ` ${Math.round(rawCpo)}₽` : ""}
                {withAdsOverride === null && <span style={{ color: C.muted }}> авто</span>}
              </span>
            </button>
          )}
        </div>

        {/* Revenue block */}
        <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
          <Row label="Цена продажи" value={hasPrice ? fmt(sellPrice) : "нет данных WB"} />
          <Row
            label={`−Комиссия WB (${Math.round(commission * 100)}%)`}
            value={hasPrice ? "−" + fmt(Math.round(sellPrice - afterComm)) : "—"}
            badge={isRealComm ? <Badge label="отч" color="#5ac8fa" /> : undefined}
          />
          <Row
            label={`−Налог УСН (${Math.round(taxRate * 100)}%)`}
            value={hasPrice ? "−" + fmt(Math.round(afterComm - afterTax)) : "—"}
          />
        </div>

        {/* Costs block */}
        <div style={{ borderBottom: `1px solid ${C.border}`, paddingBottom: 10, marginBottom: 10 }}>
          <Row label="−Фикс. затраты" value={"−" + fmt(fixedCost)} />
          <Row
            label="−Себестоимость"
            value={hasKurs ? "−" + fmt(Math.round(robuxCost)) : "—"}
            note={hasKurs ? `${kursRb}×${kursUsd}×${denom}/700` : undefined}
          />
          {withAds && cpo > 0 && (
            <Row
              label="−Реклама/ед"
              value={"−" + fmt(Math.round(cpo))}
              note="атрибут."
            />
          )}
          {logistics > 0 && (
            <Row
              label="−Логистика/ед"
              value={"−" + fmt(Math.round(logistics))}
              badge={<Badge label="отч" color="#5ac8fa" />}
              note={ud?.logByArticle[article] ? "арт." : "среднее"}
            />
          )}
          {storage > 0 && (
            <Row
              label="−Хранение/ед"
              value={"−" + fmt(Math.round(storage))}
              badge={<Badge label="отч" color="#5ac8fa" />}
              note={ud?.storageByArticle[article] ? "арт." : "среднее"}
            />
          )}
          {penalty > 0 && (
            <Row
              label="−Штрафы/ед"
              value={"−" + fmt(Math.round(penalty))}
              badge={<Badge label="отч" color="#5ac8fa" />}
              note="среднее"
            />
          )}
          {retPct > 0 && returnLoss > 0 && (
            <Row
              label={`−Возвраты (${retPct}%)`}
              value={canCalc ? "−" + fmt(returnLoss) : "—"}
              badge={<Badge label="отч" color="#5ac8fa" />}
              note={ud?.retByArticle[article] ? "арт." : "среднее"}
            />
          )}
        </div>

        {/* Profit result */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Чистая прибыль</span>
          <div style={{ textAlign: "right" as const }}>
            <div style={{
              fontSize: 30, fontWeight: 800, letterSpacing: -0.5,
              color: canCalc ? (profit >= 0 ? C.green : C.red) : C.muted,
            }}>
              {canCalc ? (profit >= 0 ? "+" : "") + fmt(Math.round(profit)) : "—"}
            </div>
            {canCalc && !isNaN(profitUsd) && (
              <div style={{ fontSize: 12, color: C.sec, marginTop: 2 }}>
                ${profitUsd.toFixed(2)} · {Math.round(marginPct)}% маржа
                {retPct > 0 && (
                  <span style={{ color: retPct >= 20 ? C.yellow : C.muted }}> · возвраты {retPct}%</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ad attribution */}
      {withAds && (
        <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, padding: 16 }}>
          <div style={{ fontSize: 12, color: C.sec, marginBottom: 4 }}>
            Реклама с{" "}
            <span style={{ color: "#e5e5ea" }}>
              {ud?.lastAdAttributedAt
                ? new Date(ud.lastAdAttributedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                : ud?.adFromDate ?? "…"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
            Весь расход за период = CPO следующего заказа. После выполнения нажми кнопку.
          </div>

          {attributed && (
            <div style={{ background: "#0d2a0d", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: C.green }}>
              ✓ Зафиксировано: {attributed.amount.toLocaleString("ru-RU")} ₽ на рекламу
            </div>
          )}

          {rawCpo === 0 && !attributed ? (
            <div style={{ textAlign: "center" as const, color: C.muted, fontSize: 14, padding: "10px 0" }}>
              Нет расходов на рекламу за этот период
            </div>
          ) : (
            <button
              disabled={attributing || rawCpo === 0}
              onClick={async () => {
                setAttributing(true);
                try {
                  const res = await fetch("/api/twa/ad-attr", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                  if (res.ok) {
                    const d = await res.json();
                    setAttributed({ amount: d.attributed ?? 0, at: d.lastAttributedAt });
                    const ueRes = await fetch("/api/twa/ue", { headers: { Authorization: `Bearer ${token}` } });
                    if (ueRes.ok) setUeData(await ueRes.json());
                  }
                } finally { setAttributing(false); }
              }}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                cursor: attributing ? "default" : "pointer",
                background: attributing ? C.elevated : C.accent,
                color: "#fff", fontSize: 15, fontWeight: 600,
              }}
            >
              {attributing ? "Фиксируем…" : "✓ Заказ выполнен — зафиксировать рекламу"}
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: C.muted, textAlign: "center" as const }}>
        Значки <span style={{ color: "#5ac8fa" }}>отч</span> — данные из отчёта реализации WB за 4 нед.
        Настройки — в боте → ⚙️ Юнит-экономика
      </div>
    </div>
  );
}
