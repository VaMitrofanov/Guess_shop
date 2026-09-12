"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { C, RADIUS, tabular, tint } from "../theme";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import {
  DEFAULT_FEE_RATES, computeOrder, computeTotals, costKopFor, grossFor, ratesValid,
  type DirectEconomics, type DirectEconomicsSource, type EconomicsRates, type UsnMode,
} from "@/lib/economics-model";

/* ─────────────────────────────────────────────────────────────────────────────
   «Экономика» — все не-WB заказы (прямые, сайт, Авито, ручные) и деньги по ним.

   Ключевое отличие от старого виджета «Профит»: себестоимость НЕ берётся из
   снапшотов заказа, а считается здесь из трёх редактируемых параметров —
   курса ₽/$, ставки закупа $/1000 грязных R$ и комиссии Roblox. Снапшоты в
   базе посчитаны курсом, который стоял в Настройках на момент выкупа, и если
   он не совпадает с реальным курсом закупки, они врут. Экран показывает обе
   цифры и расхождение.

   Прайс тоже редактируемый: колонка «модель» отвечает на вопрос «сколько бы мы
   заработали на этих же заказах по другим ценам».

   Все правки живут в localStorage этого админа и никуда не отправляются, пока
   он явно не нажмёт «Сохранить курс в Настройки».
   ───────────────────────────────────────────────────────────────────────── */

type Source = DirectEconomicsSource;
type EconData = DirectEconomics;

const SOURCE_LABEL: Record<Source, string> = {
  DIRECT: "Прямые",
  SITE:   "Сайт",
  AVITO:  "Авито",
  MANUAL: "Ручные",
};

const LS_PRICES = "econ_prices";

const PERIODS = [
  { id: 0,  label: "Всё время" },
  { id: 90, label: "90 дней" },
  { id: 30, label: "30 дней" },
] as const;

// ── Формат ────────────────────────────────────────────────────────────────────

const rub = (n: number) =>
  n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ₽";
const rubKop = (kop: number) => rub(Math.round(kop / 100));
const rubKop2 = (kop: number) =>
  (kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const rbx = (n: number) => n.toLocaleString("ru-RU") + " R$";
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

// ── Мелкие примитивы ──────────────────────────────────────────────────────────

function Field({
  label, hint, value, onChange, step = 0.1, suffix,
}: {
  label: string; hint?: string; value: string;
  onChange: (v: string) => void; step?: number; suffix?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 40 }}>
      <span style={{ fontSize: 14 }}>
        {label}
        {hint && <small style={{ display: "block", fontSize: 11, color: C.textTertiary, marginTop: 1 }}>{hint}</small>}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <input
          type="number" inputMode="decimal" step={step} value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            background: C.elevated, border: "none", borderRadius: 8, color: C.textPrimary,
            fontSize: 16, padding: "7px 10px", width: 96, textAlign: "right",
            outline: "none", WebkitAppearance: "none", ...tabular,
          }}
        />
        {suffix && <span style={{ fontSize: 13, color: C.textSecondary, width: 34 }}>{suffix}</span>}
      </span>
    </label>
  );
}

function Pills<T extends string | number>({
  items, value, onChange,
}: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", background: C.elevated, borderRadius: 10, padding: 3, gap: 2 }}>
      {items.map((it) => (
        <button
          key={String(it.id)} type="button"
          onClick={() => { haptic.select(); onChange(it.id); }}
          style={{
            flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 13, whiteSpace: "nowrap", fontFamily: "inherit",
            fontWeight: value === it.id ? 600 : 400,
            background: value === it.id ? C.bgElevated : "transparent",
            color: value === it.id ? C.textPrimary : C.textSecondary,
          }}
        >{it.label}</button>
      ))}
    </div>
  );
}

function Card({ children, pad = 16 }: { children: React.ReactNode; pad?: number }) {
  return <div style={{ background: C.card, borderRadius: RADIUS.lg, padding: pad }}>{children}</div>;
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: C.card, borderRadius: RADIUS.md, padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: C.textSecondary }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, color: tone ?? C.textPrimary, ...tabular }}>{value}</div>
    </div>
  );
}

// ── Экран ─────────────────────────────────────────────────────────────────────

export default function EconomicsScreen({ token }: { token: string }) {
  const [data, setData]       = useState<EconData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  const [usdStr, setUsdStr]   = useState("");
  const [rateStr, setRateStr] = useState("");
  const [taxStr, setTaxStr]   = useState("");
  const [acqStr, setAcqStr]   = useState(String(DEFAULT_FEE_RATES.acquiringPct));
  const [recStr, setRecStr]   = useState(String(DEFAULT_FEE_RATES.receiptPct));
  const [usnStr, setUsnStr]   = useState(String(DEFAULT_FEE_RATES.usnPct));
  const [usnMode, setUsnMode] = useState<UsnMode>(DEFAULT_FEE_RATES.usnMode);
  const [prices, setPrices]   = useState<Record<number, number>>({});

  const [period, setPeriod]   = useState<number>(0);
  // Границу периода фиксируем в момент выбора, а не на каждом рендере: иначе
  // «30 дней» плыли бы вместе с часами и пересчёт был бы недетерминированным.
  const [periodFrom, setPeriodFrom] = useState<number>(0);
  const [channel, setChannel] = useState<Source | "ALL">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPacks, setShowPacks] = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/twa/direct-economics", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EconData | null) => {
        if (!alive) return;
        if (!d) { setFailed(true); return; }
        setData(d);
        // Сохранённые правки админа имеют приоритет над значениями из БД.
        // Курсы всегда из базы, а НЕ из localStorage. Иначе браузер, открывший
        // экран до смены курса, держал бы старое значение и кнопка «Сохранить
        // курс в Настройки» вернула бы его в прод (ровно так курс 85 дважды
        // откатывался на 77.99 29.07). Правки в полях живут в рамках сессии.
        const saved = (k: string) => (typeof window === "undefined" ? null : localStorage.getItem(k));
        setUsdStr(String(d.defaults.usdToRub));
        setRateStr(String(d.defaults.purchaseRateUsdPer1k ?? 4.3));
        setTaxStr(String(d.defaults.robloxTaxPct));
        const base: Record<number, number> = {};
        for (const [k, v] of Object.entries(d.prices)) base[Number(k)] = v;
        const rawSaved = saved(LS_PRICES);
        if (rawSaved) {
          try {
            const parsed = JSON.parse(rawSaved) as Record<string, number>;
            for (const [k, v] of Object.entries(parsed)) {
              if (Number.isFinite(Number(k)) && Number.isFinite(v)) base[Number(k)] = v;
            }
          } catch { /* мусор в localStorage — молча берём прайс из БД */ }
        }
        setPrices(base);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const persist = useCallback((key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* приватный режим — не беда */ }
  }, []);

  const setUsd  = setUsdStr;
  const setRate = setRateStr;
  const setTax  = setTaxStr;
  const setPrice = (pack: number, v: string) => {
    const n = Math.max(0, Math.round(Number(v) || 0));
    const next = { ...prices, [pack]: n };
    setPrices(next);
    persist(LS_PRICES, JSON.stringify(next));
  };

  // ── Модель ──────────────────────────────────────────────────────────────────
  // Формула и типы — общие с веб-админкой (`@/lib/economics-model`), чтобы две
  // поверхности не считали прибыль по-разному.
  const rates: EconomicsRates = useMemo(
    () => ({
      usdToRub: Number(usdStr), rateUsdPer1k: Number(rateStr), taxPct: Number(taxStr),
      acquiringPct: Number(acqStr), receiptPct: Number(recStr),
      usnPct: Number(usnStr), usnMode,
    }),
    [usdStr, rateStr, taxStr, acqStr, recStr, usnStr, usnMode],
  );
  const { usdToRub: usd, rateUsdPer1k: rate, taxPct: tax } = rates;
  const valid = ratesValid(rates);

  const resetRates = () => {
    if (!data) return;
    haptic.impact("light");
    setUsd(String(data.defaults.usdToRub));
    setRate(String(data.defaults.purchaseRateUsdPer1k ?? 4.3));
    setTax(String(data.defaults.robloxTaxPct));
    setAcqStr(String(DEFAULT_FEE_RATES.acquiringPct));
    setRecStr(String(DEFAULT_FEE_RATES.receiptPct));
    setUsnStr(String(DEFAULT_FEE_RATES.usnPct));
    setUsnMode(DEFAULT_FEE_RATES.usnMode);
    const base: Record<number, number> = {};
    for (const [k, v] of Object.entries(data.prices)) base[Number(k)] = v;
    setPrices(base);
    persist(LS_PRICES, JSON.stringify(base));
    toast("Вернул значения из базы", "success");
  };

  const saveRates = async () => {
    if (!valid || saving) return;
    setSaving(true);
    haptic.impact("medium");
    try {
      const res = await fetch("/api/twa/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ usdToRub: usd, purchaseRate: rate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Не удалось сохранить", "error");
      } else {
        toast("Курс сохранён — новые выкупы считаются по нему", "success");
      }
    } catch {
      toast("Сеть недоступна", "error");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const since = period > 0 ? periodFrom : 0;
    return data.orders
      .filter((o) => channel === "ALL" || o.source === channel)
      .filter((o) => {
        if (!since) return true;
        return new Date(o.completedAt ?? o.createdAt).getTime() >= since;
      })
      .map((o) => computeOrder(o, rates, prices))
      .sort((a, b) =>
        new Date(b.order.completedAt ?? b.order.createdAt).getTime() -
        new Date(a.order.completedAt ?? a.order.createdAt).getTime());
  }, [data, period, periodFrom, channel, rates, prices]);

  const totals = useMemo(() => computeTotals(rows), [rows]);

  // Профит внутри `computeTotals` считается только по заказам с известной
  // выручкой: иначе себестоимость «бесплатных» съела бы маржу остальных.
  const { knownCostKop, profitKop, marginPct, modelProfitKop } = totals;

  const packs = useMemo(
    () => Object.keys(prices).map(Number).filter((n) => n > 0).sort((a, b) => a - b),
    [prices],
  );

  // ── Рендер ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ height: i === 0 ? 118 : 92, borderRadius: RADIUS.lg, background: C.card, opacity: 0.8 - i * 0.18 }} />
        ))}
      </div>
    );
  }
  if (failed || !data) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>💸</div>
        Не удалось загрузить экономику
      </div>
    );
  }

  const channelItems: { id: Source | "ALL"; label: string }[] = [
    { id: "ALL", label: "Все" },
    ...(Object.keys(SOURCE_LABEL) as Source[])
      .filter((s) => data.orders.some((o) => o.source === s))
      .map((s) => ({ id: s, label: SOURCE_LABEL[s] })),
  ];

  return (
    <div style={{ padding: "12px 16px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      <Pills
        items={[...PERIODS]} value={period}
        onChange={(days) => {
          setPeriod(days);
          setPeriodFrom(days > 0 ? Date.now() - days * 86_400_000 : 0);
        }}
      />
      {channelItems.length > 2 && <Pills items={channelItems} value={channel} onChange={setChannel} />}

      {/* Итог */}
      <Card pad={18}>
        <div style={{ fontSize: 12, color: C.textSecondary }}>Заработано (выручка − себестоимость)</div>
        <div style={{
          fontSize: 32, fontWeight: 700, marginTop: 4, ...tabular,
          color: totals.withRevenue === 0 ? C.textTertiary : profitKop >= 0 ? C.green : C.red,
        }}>
          {totals.withRevenue === 0 ? "—" : rubKop(profitKop)}
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 5, lineHeight: 1.5 }}>
          {totals.withRevenue === 0
            ? "нет заказов с известной ценой"
            : <>получили {rubKop(totals.revenueKop)} · робуксы −{rubKop(knownCostKop)} · эквайринг −{rubKop(totals.acquiringKop)} · налог −{rubKop(totals.usnKop)}
              {marginPct !== null && <> · маржа <b style={{ color: C.textPrimary }}>{marginPct}%</b></>}</>}
        </div>
      </Card>

      {/* Робуксы */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Tile label="Заказов" value={String(totals.orders)} />
        <Tile label="Выдано клиентам" value={rbx(totals.delivered)} />
        <Tile label="Из них бонусных" value={rbx(totals.bonus)} tone={totals.bonus > 0 ? C.yellow : undefined} />
        <Tile label="Куплено грязных" value={rbx(totals.gross)} />
      </div>

      {totals.bonus > 0 && (
        <Card pad={14}>
          <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.55 }}>
            Бонусные <b style={{ color: C.yellow }}>{rbx(totals.bonus)}</b> обошлись нам в{" "}
            <b style={{ color: C.textPrimary }}>{rubKop(totals.bonusCostKop)}</b> —{" "}
            {pct(totals.bonusCostKop, totals.revenueKop || 1)}% выручки. За деньги продано{" "}
            {rbx(totals.paidRobux)}.
          </div>
        </Card>
      )}

      {/* Интерактивная формула */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Формула</div>
          <button
            type="button" onClick={resetRates}
            style={{
              display: "flex", alignItems: "center", gap: 5, background: "none", border: "none",
              color: C.accent, fontSize: 13, cursor: "pointer", padding: 0, fontFamily: "inherit",
            }}
          ><RotateCcw size={13} /> Сброс</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Field label="Курс доллара" hint="₽ за 1 $" value={usdStr} onChange={setUsd} step={0.5} suffix="₽" />
          <Field label="Закуп робуксов" hint="$ за 1000 грязных R$" value={rateStr} onChange={setRate} step={0.1} suffix="$" />
          <Field label="Комиссия Roblox" hint="сколько съедает геймпасс" value={taxStr} onChange={setTax} step={1} suffix="%" />
          <Field label="Эквайринг" hint="% с платежа — сверь с договором" value={acqStr} onChange={setAcqStr} step={0.1} suffix="%" />
          <Field label="Сервис «Чеки»" hint="% с платежа с чеком" value={recStr} onChange={setRecStr} step={0.1} suffix="%" />
          <Field label="Налог УСН" hint={usnMode === "income" ? "с выручки" : "с прибыли до налога"} value={usnStr} onChange={setUsnStr} step={1} suffix="%" />
          <Pills
            items={[{ id: "income" as UsnMode, label: "Доходы" }, { id: "income-minus-expenses" as UsnMode, label: "Доходы − расходы" }]}
            value={usnMode} onChange={setUsnMode}
          />
        </div>

        {!valid ? (
          <div style={{ marginTop: 12, fontSize: 13, color: C.red }}>
            Проверь значения: курс и ставка должны быть больше нуля, комиссия — от 0 до 99%.
          </div>
        ) : (
          <div style={{
            marginTop: 12, padding: "11px 13px", borderRadius: RADIUS.md,
            background: C.elevated, fontSize: 12.5, color: C.textSecondary, lineHeight: 1.7,
          }}>
            <div>грязные R$ = выдано ÷ {(1 - tax / 100).toFixed(2)} <span style={{ color: C.muted }}>(комиссия {tax}%)</span></div>
            <div>себестоимость = грязные ÷ 1000 × {rate} $ × {usd} ₽</div>
            <div>эквайринг = платёж × {(rates.acquiringPct + rates.receiptPct).toFixed(1)}%</div>
            <div>налог = {usnMode === "income" ? "выручка" : "(выручка − робуксы − эквайринг)"} × {rates.usnPct}%</div>
            <div style={{ color: C.textPrimary, marginTop: 3 }}>
              1000 чистых R$ ⟶ {grossFor(1000, rates).toLocaleString("ru-RU")} грязных ⟶ {rubKop2(costKopFor(grossFor(1000, rates), rates))}
            </div>
          </div>
        )}

        {data.defaults.purchaseRateUsdPer1k !== null && (
          <div style={{ marginTop: 10, fontSize: 12, color: C.textTertiary, lineHeight: 1.5 }}>
            В Настройках сейчас: {data.defaults.usdToRub} ₽/$ и {data.defaults.purchaseRateUsdPer1k} $/1k —
            этим считаются снапшоты новых выкупов.
          </div>
        )}
        <button
          type="button" onClick={saveRates}
          disabled={!valid || saving || (usd === data.defaults.usdToRub && rate === (data.defaults.purchaseRateUsdPer1k ?? 4.3))}
          className="twa-press-sm"
          style={{
            marginTop: 10, width: "100%", padding: "11px 0", borderRadius: RADIUS.md,
            border: "none", cursor: valid && !saving ? "pointer" : "default",
            background: valid && !saving ? tint(C.accent, 0.18) : C.elevated,
            color: valid && !saving ? C.accent : C.textTertiary,
            fontSize: 14, fontWeight: 600, fontFamily: "inherit",
          }}
        >{saving ? "Сохраняю…" : usd === data.defaults.usdToRub && rate === (data.defaults.purchaseRateUsdPer1k ?? 4.3) ? "Совпадает с Настройками" : `Записать ${usd} ₽/$ в Настройки`}</button>
      </Card>

      {/* Расхождение со снапшотами */}
      {totals.snapshotCount > 0 && Math.abs(totals.snapshotCostKop - knownCostKop) >= 100 && (
        <div style={{
          background: tint(C.yellow, 0.12), border: `1px solid ${tint(C.yellow, 0.3)}`,
          borderRadius: RADIUS.md, padding: "12px 14px", fontSize: 13, lineHeight: 1.55,
        }}>
          <b style={{ color: C.yellow }}>Снапшоты в базе не сходятся с этой формулой.</b> По {totals.snapshotCount}{" "}
          заказам записано {rubKop(totals.snapshotCostKop)} себестоимости, по текущим курсам выходит{" "}
          {rubKop(knownCostKop)}. Снапшот пишется курсом из Настроек на момент выкупа — если он был занижен,
          прибыль в старых отчётах завышена.
        </div>
      )}

      {/* Неполные данные */}
      {totals.orders - totals.withRevenue > 0 && (
        <div style={{
          background: tint(C.orange, 0.12), border: `1px solid ${tint(C.orange, 0.3)}`,
          borderRadius: RADIUS.md, padding: "12px 14px", fontSize: 13, lineHeight: 1.55,
        }}>
          <b style={{ color: C.orange }}>Без цены: {totals.orders - totals.withRevenue} из {totals.orders}.</b>{" "}
          Робуксов на них ушло на {rubKop(totals.costNoRevenueKop)}, но сколько за них заплатили — в базе
          не записано. В прибыль выше эти заказы не входят вообще.
        </div>
      )}

      {/* Заказы */}
      <Card pad={0}>
        <div style={{ padding: "14px 16px 10px", fontWeight: 600, fontSize: 15 }}>
          Заказы <span style={{ color: C.textTertiary, fontWeight: 400 }}>· {rows.length}</span>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "0 16px 16px", fontSize: 13, color: C.textSecondary }}>
            За этот период ничего нет
          </div>
        )}
        {rows.map(({ order: o, paidRobux, gross, costKop, bonusCostKop, acquiringKop, usnKop, profitKop, modelRevenueKop, modelProfitKop }) => {
          const open = expanded === o.id;
          return (
            <div key={o.id} style={{ borderTop: `1px solid ${C.hairline}` }}>
              <button
                type="button"
                onClick={() => { haptic.select(); setExpanded(open ? null : o.id); }}
                style={{
                  width: "100%", background: "none", border: "none", cursor: "pointer",
                  padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
                  textAlign: "left", fontFamily: "inherit", color: C.textPrimary,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, ...tabular }}>{o.wbCode}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                    {shortDate(o.completedAt ?? o.createdAt)} · {SOURCE_LABEL[o.source]} · {o.platform} · {rbx(o.robuxDelivered)}
                    {o.bonusRobux > 0 && <span style={{ color: C.yellow }}> (+{o.bonusRobux} бонус)</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 600, ...tabular,
                    color: profitKop == null ? C.textTertiary : profitKop >= 0 ? C.green : C.red,
                  }}>{profitKop == null ? "—" : rubKop(profitKop)}</div>
                  <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2, ...tabular }}>
                    {o.revenueKopecks == null ? "цена ?" : rubKop(o.revenueKopecks)}
                  </div>
                </div>
                <ChevronDown
                  size={16} color={C.textTertiary}
                  style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s", flexShrink: 0 }}
                />
              </button>

              {open && (
                <div style={{ padding: "0 16px 14px", fontSize: 12.5, color: C.textSecondary, lineHeight: 1.75 }}>
                  <div style={{ padding: "10px 12px", background: C.elevated, borderRadius: RADIUS.md }}>
                    <Line k="Ник Roblox" v={o.robloxUsername ?? "—"} />
                    <Line k="Оплачено клиентом" v={o.revenueKopecks == null ? "неизвестно" : rubKop2(o.revenueKopecks)}
                      note={o.revenueSource === "intent" ? "из заявки" : o.revenueSource === "unknown" ? "нет в базе" : undefined} />
                    <Line k="Выдано / за деньги" v={`${rbx(o.robuxDelivered)} / ${rbx(paidRobux)}`} />
                    {o.bonusRobux > 0 && (
                      <Line k="Бонус" v={`${rbx(o.bonusRobux)} = ${rubKop2(bonusCostKop)}`}
                        note={o.bonusSource === "intent" ? "из заявки" : o.bonusSource === "ledger" ? "из журнала" : undefined} />
                    )}
                    <Line k={`Куплено грязных (÷${(1 - tax / 100).toFixed(2)})`} v={rbx(gross)} />
                    <Line k={`Себестоимость (×${rate}$ ×${usd}₽)`} v={rubKop2(costKop)} />
                    {o.costSnapshotKopecks != null && o.costSnapshotKopecks !== costKop && (
                      <Line k="В базе записано" v={rubKop2(o.costSnapshotKopecks)}
                        note={o.usdToRubSnapshot ? `курс ${o.usdToRubSnapshot} ₽/$` : undefined} />
                    )}
                    <Line k={`Эквайринг + «Чеки» (${(rates.acquiringPct + rates.receiptPct).toFixed(1)}%)`} v={`−${rubKop2(acquiringKop)}`} />
                    <Line k={`Налог УСН ${rates.usnPct}%`} v={`−${rubKop2(usnKop)}`} />
                    <Line k="Прибыль на руки" v={profitKop == null ? "—" : rubKop2(profitKop)} strong />
                    <Line k="По вашему прайсу" v={`${rubKop(modelRevenueKop)} → ${rubKop(modelProfitKop)}`} />
                    {!o.paid && o.source === "DIRECT" && (
                      <div style={{ color: C.orange, marginTop: 4 }}>Оплата в базе не отмечена</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {/* Прайс */}
      <Card pad={0}>
        <button
          type="button"
          onClick={() => { haptic.select(); setShowPacks((v) => !v); }}
          style={{
            width: "100%", background: "none", border: "none", cursor: "pointer",
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
            textAlign: "left", fontFamily: "inherit", color: C.textPrimary,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Наши цены</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              маржа по каждому паку · цены можно менять
            </div>
          </div>
          <ChevronDown size={16} color={C.textTertiary}
            style={{ transform: showPacks ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
        </button>

        {showPacks && valid && (
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 84px 1fr 52px", gap: "0 8px",
              fontSize: 11, color: C.textTertiary, paddingBottom: 6,
              borderBottom: `1px solid ${C.hairline}`,
            }}>
              <span>пак</span><span style={{ textAlign: "right" }}>цена ₽</span>
              <span style={{ textAlign: "right" }}>прибыль</span><span style={{ textAlign: "right" }}>маржа</span>
            </div>
            {packs.map((pack) => {
              const cost   = costKopFor(grossFor(pack, rates), rates);
              const price  = (prices[pack] ?? 0) * 100;
              const profit = price - cost;
              const margin = price > 0 ? Math.round((profit / price) * 100) : 0;
              return (
                <div key={pack} style={{
                  display: "grid", gridTemplateColumns: "1fr 84px 1fr 52px", gap: "0 8px",
                  alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${C.hairline}`,
                  fontSize: 13, ...tabular,
                }}>
                  <span>{pack.toLocaleString("ru-RU")}</span>
                  <input
                    type="number" inputMode="numeric" step={10} value={String(prices[pack] ?? 0)}
                    onChange={(e) => setPrice(pack, e.target.value)}
                    style={{
                      background: C.elevated, border: "none", borderRadius: 7, color: C.textPrimary,
                      fontSize: 14, padding: "5px 8px", width: "100%", textAlign: "right",
                      outline: "none", WebkitAppearance: "none", ...tabular,
                    }}
                  />
                  <span style={{ textAlign: "right", color: profit >= 0 ? C.green : C.red }}>{rubKop(profit)}</span>
                  <span style={{ textAlign: "right", color: C.textSecondary }}>{margin}%</span>
                </div>
              );
            })}
            <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 10, lineHeight: 1.55 }}>
              Себестоимость пака = ceil(пак ÷ {(1 - tax / 100).toFixed(2)}) ÷ 1000 × {rate} $ × {usd} ₽.
              Правки цен живут только в этом экране — в боте и на сайте прайс не меняется.
            </div>
          </div>
        )}
      </Card>

      {/* Что было бы по этим ценам */}
      {valid && totals.orders > 0 && (
        <Card pad={14}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: C.textSecondary }}>
            <b style={{ color: C.textPrimary }}>По вашему прайсу</b> эти же {totals.orders} заказов дали бы{" "}
            {rubKop(totals.modelRevenueKop)} выручки и <b style={{
              color: modelProfitKop >= profitKop ? C.green : C.orange,
            }}>{rubKop(modelProfitKop)}</b> прибыли
            {totals.withRevenue === totals.orders && (
              <> — это {modelProfitKop >= profitKop ? "+" : ""}{rubKop(modelProfitKop - profitKop)} к факту</>
            )}.
            {totals.withRevenue !== totals.orders && (
              <span style={{ color: C.textTertiary }}> {" "}(модель считает все заказы, факт — только {totals.withRevenue} с известной ценой)</span>
            )}
          </div>
        </Card>
      )}

      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.55, padding: "0 2px" }}>
        WB-коридор сюда не входит: там платит Wildberries, и выручки заказа в базе нет.
        {data.truncated && " Показаны последние 2000 заказов."}
      </div>
    </div>
  );
}

function Line({ k, v, note, strong }: { k: string; v: string; note?: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span>{k}</span>
      <span style={{ color: strong ? C.textPrimary : C.textSecondary, fontWeight: strong ? 600 : 400, textAlign: "right", ...tabular }}>
        {v}
        {note && <small style={{ display: "block", fontSize: 11, color: C.muted }}>{note}</small>}
      </span>
    </div>
  );
}
