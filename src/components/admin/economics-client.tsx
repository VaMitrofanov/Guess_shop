"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import styles from "./admin-shell.module.css";
import { cn } from "@/lib/utils";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";
import {
  DEFAULT_FEE_RATES, computeOrder, computeTotals, costKopFor, grossFor, ratesValid,
  type DirectEconomics, type EconomicsRates, type DirectEconomicsSource, type UsnMode,
} from "@/lib/economics-model";

/* ─────────────────────────────────────────────────────────────────────────────
   «Экономика» — все не-WB заказы и деньги по ним.

   Себестоимость НЕ берётся из снапшотов заказа: снапшот пишется курсом, который
   стоял в Настройках на момент выкупа, и если курс занижен, прибыль завышена.
   Здесь курс, ставка закупа и комиссия Roblox редактируются, а формула —
   `@/lib/direct-economics`, общая с TWA-экраном: две поверхности не должны
   считать деньги по-разному.
   ───────────────────────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<DirectEconomicsSource, string> = {
  DIRECT: "Прямые", SITE: "Сайт", AVITO: "Авито", MANUAL: "Ручные",
};

const LS_PRICES = "econ_prices";

const PERIODS = [
  { id: 0, label: "Всё время" },
  { id: 90, label: "90 дней" },
  { id: 30, label: "30 дней" },
] as const;

const rub = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽";
const rubKop = (kop: number) => rub(kop / 100);
const rubKop2 = (kop: number) =>
  (kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
const rbx = (n: number) => n.toLocaleString("ru-RU") + " R$";
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: ADMIN_TIME_ZONE, day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso));

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div>
      <span>{k}</span>
      <b>{v}{note && <small>{note}</small>}</b>
    </div>
  );
}

export default function AdminEconomicsClient({ initialData }: { initialData: DirectEconomics }) {
  const [data] = useState(initialData);

  const [usdStr, setUsdStr] = useState(String(initialData.defaults.usdToRub));
  const [rateStr, setRateStr] = useState(String(initialData.defaults.purchaseRateUsdPer1k ?? 4.3));
  const [taxStr, setTaxStr] = useState(String(initialData.defaults.robloxTaxPct));
  const [acqStr, setAcqStr] = useState(String(DEFAULT_FEE_RATES.acquiringPct));
  const [recStr, setRecStr] = useState(String(DEFAULT_FEE_RATES.receiptPct));
  const [usnStr, setUsnStr] = useState(String(DEFAULT_FEE_RATES.usnPct));
  const [usnMode, setUsnMode] = useState<UsnMode>(DEFAULT_FEE_RATES.usnMode);
  const [prices, setPrices] = useState<Record<number, number>>(() =>
    Object.fromEntries(Object.entries(initialData.prices).map(([key, value]) => [Number(key), value])),
  );

  const [period, setPeriod] = useState(0);
  const [periodFrom, setPeriodFrom] = useState(0);
  const [channel, setChannel] = useState<DirectEconomicsSource | "ALL">("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Только локальный экспериментальный прайс читаем после hydration. Курсы
  // всегда приходят из БД вместе с server render, поэтому старый браузер не
  // может вернуть в production устаревшее значение.
  useEffect(() => {
    const rawSaved = localStorage.getItem(LS_PRICES);
    if (!rawSaved) return;
    try {
      const parsed = JSON.parse(rawSaved) as Record<string, number>;
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        setPrices((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(parsed)) {
            if (Number.isFinite(Number(key)) && Number.isFinite(value)) next[Number(key)] = value;
          }
          return next;
        });
      });
      return () => { active = false; };
    } catch { /* мусор в localStorage — берём прайс из БД */ }
  }, []);

  const persist = useCallback((key: string, value: string) => {
    try { localStorage.setItem(key, value); } catch { /* приватный режим */ }
  }, []);

  const setUsd = setUsdStr;
  const setRate = setRateStr;
  const setTax = setTaxStr;
  const resetFees = () => {
    setAcqStr(String(DEFAULT_FEE_RATES.acquiringPct));
    setRecStr(String(DEFAULT_FEE_RATES.receiptPct));
    setUsnStr(String(DEFAULT_FEE_RATES.usnPct));
    setUsnMode(DEFAULT_FEE_RATES.usnMode);
  };
  const setPrice = (pack: number, v: string) => {
    const next = { ...prices, [pack]: Math.max(0, Math.round(Number(v) || 0)) };
    setPrices(next);
    persist(LS_PRICES, JSON.stringify(next));
  };

  // useMemo, а не литерал: объект курсов уходит в зависимости useMemo ниже, и
  // новая ссылка на каждый рендер пересчитывала бы всю таблицу впустую.
  const rates: EconomicsRates = useMemo(
    () => ({
      usdToRub: Number(usdStr), rateUsdPer1k: Number(rateStr), taxPct: Number(taxStr),
      acquiringPct: Number(acqStr), receiptPct: Number(recStr),
      usnPct: Number(usnStr), usnMode,
    }),
    [usdStr, rateStr, taxStr, acqStr, recStr, usnStr, usnMode],
  );
  const valid = ratesValid(rates);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  };

  const reset = () => {
    if (!data) return;
    setUsd(String(data.defaults.usdToRub));
    setRate(String(data.defaults.purchaseRateUsdPer1k ?? 4.3));
    setTax(String(data.defaults.robloxTaxPct));
    resetFees();
    const base: Record<number, number> = {};
    for (const [k, v] of Object.entries(data.prices)) base[Number(k)] = v;
    setPrices(base);
    persist(LS_PRICES, JSON.stringify(base));
    showToast("Вернул значения из базы");
  };

  const saveRates = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usdToRub: rates.usdToRub, purchaseRate: rates.rateUsdPer1k }),
      });
      const body = await res.json().catch(() => ({}));
      showToast(res.ok ? "Курс сохранён — новые выкупы считаются по нему" : (body.error ?? "Не удалось сохранить"));
    } catch {
      showToast("Сеть недоступна");
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const since = period > 0 ? periodFrom : 0;
    return data.orders
      .filter((o) => channel === "ALL" || o.source === channel)
      .filter((o) => !since || new Date(o.completedAt ?? o.createdAt).getTime() >= since)
      .map((o) => computeOrder(o, rates, prices))
      .sort((a, b) =>
        new Date(b.order.completedAt ?? b.order.createdAt).getTime() -
        new Date(a.order.completedAt ?? a.order.createdAt).getTime());
  }, [data, period, periodFrom, channel, rates, prices]);

  const totals = useMemo(() => computeTotals(rows), [rows]);
  const packs = useMemo(
    () => Object.keys(prices).map(Number).filter((n) => n > 0).sort((a, b) => a - b),
    [prices],
  );

  const channels: (DirectEconomicsSource | "ALL")[] = [
    "ALL",
    ...(Object.keys(SOURCE_LABEL) as DirectEconomicsSource[]).filter((s) => data.orders.some((o) => o.source === s)),
  ];
  // Кнопка записи активна только когда значение реально отличается от базы:
  // случайный клик не должен возвращать в прод то, что уже там стоит.
  const rateChanged =
    rates.usdToRub !== data.defaults.usdToRub ||
    rates.rateUsdPer1k !== (data.defaults.purchaseRateUsdPer1k ?? 4.3);
  const snapshotDrift = totals.snapshotCount > 0 && Math.abs(totals.snapshotCostKop - totals.knownCostKop) >= 100;
  const noRevenue = totals.orders - totals.withRevenue;

  return (
    <div className={styles.stack}>
      {toast && <div className={styles.noteInfo}><TriangleAlert /><div>{toast}</div></div>}

      <div className={styles.toolbar}>
        {PERIODS.map((p) => (
          <button
            key={p.id} type="button"
            className={cn(styles.chip, period === p.id && styles.chipActive)}
            onClick={() => {
              setPeriod(p.id);
              setPeriodFrom(p.id > 0 ? Date.now() - p.id * 86_400_000 : 0);
            }}
          >{p.label}</button>
        ))}
        <div className={styles.toolbarSpacer} />
        {channels.map((c) => (
          <button
            key={c} type="button"
            className={cn(styles.chip, channel === c && styles.chipActive)}
            onClick={() => setChannel(c)}
          >{c === "ALL" ? "Все каналы" : SOURCE_LABEL[c]}</button>
        ))}
      </div>

      <div className={styles.splitGrid}>
        <div className={styles.stack}>
          {/* Итог */}
          <section className={cn(styles.panel, styles.hero, totals.withRevenue === 0 ? styles.heroFlat : styles.heroGood)}>
            <span>Заработано (выручка − себестоимость)</span>
            <strong>{totals.withRevenue === 0 ? "—" : rubKop(totals.profitKop)}</strong>
            <p>
              {totals.withRevenue === 0
                ? "нет заказов с известной ценой"
                : <>получили <b>{rubKop(totals.revenueKop)}</b> · робуксы <b>−{rubKop(totals.knownCostKop)}</b>
                  {" "}· эквайринг <b>−{rubKop(totals.acquiringKop)}</b> · налог <b>−{rubKop(totals.usnKop)}</b>
                  {totals.marginPct !== null && <> · маржа <b>{totals.marginPct}%</b></>}</>}
            </p>
            {totals.withRevenue > 0 && (
              <p style={{ marginTop: 4, fontSize: 13 }}>
                До комиссий и налога было бы {rubKop(totals.grossProfitKop)} — платёжный контур
                забирает {rubKop(totals.acquiringKop + totals.usnKop)}
                {totals.grossProfitKop > 0 && <>, это {Math.round(((totals.acquiringKop + totals.usnKop) / totals.grossProfitKop) * 100)}% «грязной» прибыли</>}.
              </p>
            )}
          </section>

          <div className={styles.metricGrid}>
            {[
              { label: "Заказов", value: String(totals.orders) },
              { label: "Выдано клиентам", value: rbx(totals.delivered) },
              { label: "Из них бонусных", value: rbx(totals.bonus) },
              { label: "Куплено грязных", value: rbx(totals.gross) },
            ].map((m) => (
              <div key={m.label} className={styles.metricCard}>
                <strong style={{ marginTop: 0 }}>{m.value}</strong>
                <span>{m.label}</span>
              </div>
            ))}
          </div>

          {snapshotDrift && (
            <div className={styles.noteWarn}>
              <TriangleAlert />
              <div>
                <b>Снапшоты в базе не сходятся с этой формулой.</b> По {totals.snapshotCount} заказам
                записано {rubKop(totals.snapshotCostKop)} себестоимости, по текущим курсам выходит{" "}
                {rubKop(totals.knownCostKop)}. Снапшот пишется курсом из Настроек на момент выкупа —
                если он был занижен, прибыль в старых отчётах завышена.
              </div>
            </div>
          )}

          {noRevenue > 0 && (
            <div className={styles.noteWarn}>
              <TriangleAlert />
              <div>
                <b>Без цены: {noRevenue} из {totals.orders}.</b> Робуксов на них ушло на{" "}
                {rubKop(totals.costNoRevenueKop)}, но сколько за них заплатили — в базе не записано.
                В прибыль выше эти заказы не входят вообще.
              </div>
            </div>
          )}

          {/* Заказы */}
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <strong>Заказы</strong><span>{rows.length}</span>
            </div>
            <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
              <table className={cn(styles.table, styles.responsiveTable)}>
                <thead>
                  <tr>
                    <th>Код</th><th>Канал</th>
                    <th style={{ textAlign: "right" }}>Выдано</th>
                    <th style={{ textAlign: "right" }}>Бонус</th>
                    <th style={{ textAlign: "right" }}>Оплачено</th>
                    <th style={{ textAlign: "right" }}>Себест.</th>
                    <th style={{ textAlign: "right" }}>Прибыль</th>
                    <th style={{ textAlign: "right" }}>Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const o = r.order;
                    const open = expanded === o.id;
                    const margin = o.revenueKopecks && o.revenueKopecks > 0 && r.profitKop != null
                      ? Math.round((r.profitKop / o.revenueKopecks) * 100) : null;
                    return (
                      <Fragment key={o.id}>
                        <tr
                          className={styles.expandRow}
                          onClick={() => setExpanded(open ? null : o.id)}
                        >
                          <td data-label="Код">
                            <span className={styles.tablePrimary}>{o.wbCode}</span>
                            <small className={styles.tableSecondary}>
                              {shortDate(o.completedAt ?? o.createdAt)} · {o.platform}
                            </small>
                          </td>
                          <td data-label="Канал">{SOURCE_LABEL[o.source]}</td>
                          <td data-label="Выдано" className={styles.numeric}>{o.robuxDelivered.toLocaleString("ru-RU")}</td>
                          <td data-label="Бонус" className={cn(styles.numeric, o.bonusRobux > 0 ? "" : styles.dim)}>
                            {o.bonusRobux > 0 ? o.bonusRobux.toLocaleString("ru-RU") : "—"}
                          </td>
                          <td data-label="Оплачено" className={styles.numeric}>
                            {o.revenueKopecks == null ? <span className={styles.dim}>цена ?</span> : rubKop(o.revenueKopecks)}
                          </td>
                          <td data-label="Себест." className={styles.numeric}>{rubKop(r.costKop)}</td>
                          <td data-label="Прибыль" className={cn(styles.numeric, r.profitKop == null ? styles.dim : r.profitKop >= 0 ? styles.good : styles.bad)}>
                            {r.profitKop == null ? "—" : rubKop(r.profitKop)}
                          </td>
                          <td data-label="Маржа" className={cn(styles.numeric, styles.dim)}>{margin == null ? "—" : `${margin}%`}</td>
                        </tr>
                        {open && (
                          <tr key={`${o.id}-x`} className={styles.expandPanel}>
                            <td colSpan={8}>
                              <div className={styles.expandInner}>
                                <Row k="Ник Roblox" v={o.robloxUsername ?? "—"} />
                                <Row
                                  k="Оплачено клиентом"
                                  v={o.revenueKopecks == null ? "неизвестно" : rubKop2(o.revenueKopecks)}
                                  note={o.revenueSource === "intent" ? "из заявки" : o.revenueSource === "unknown" ? "нет в базе" : undefined}
                                />
                                <Row k="Выдано / за деньги" v={`${rbx(o.robuxDelivered)} / ${rbx(r.paidRobux)}`} />
                                {o.bonusRobux > 0 && (
                                  <Row
                                    k="Бонус" v={`${rbx(o.bonusRobux)} = ${rubKop2(r.bonusCostKop)}`}
                                    note={o.bonusSource === "intent" ? "из заявки" : o.bonusSource === "ledger" ? "из журнала" : undefined}
                                  />
                                )}
                                <Row k={`Куплено грязных (÷${(1 - rates.taxPct / 100).toFixed(2)})`} v={rbx(r.gross)} />
                                <Row k={`Себестоимость (×${rates.rateUsdPer1k}$ ×${rates.usdToRub}₽)`} v={rubKop2(r.costKop)} />
                                {o.costSnapshotKopecks != null && o.costSnapshotKopecks !== r.costKop && (
                                  <Row
                                    k="В базе записано" v={rubKop2(o.costSnapshotKopecks)}
                                    note={o.usdToRubSnapshot ? `курс ${o.usdToRubSnapshot} ₽/$` : undefined}
                                  />
                                )}
                                <Row k={`Эквайринг + «Чеки» (${(rates.acquiringPct + rates.receiptPct).toFixed(1)}%)`} v={`−${rubKop2(r.acquiringKop)}`} />
                                <Row k={`Налог УСН ${rates.usnPct}% (${rates.usnMode === "income" ? "с выручки" : "с прибыли"})`} v={`−${rubKop2(r.usnKop)}`} />
                                <Row k="До комиссий и налога" v={r.grossProfitKop == null ? "—" : rubKop2(r.grossProfitKop)} />
                                <Row k="По вашему прайсу" v={`${rubKop(r.modelRevenueKop)} → ${rubKop(r.modelProfitKop)}`} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={8} className={styles.empty}>За этот период ничего нет</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Правая колонка: формула и прайс */}
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <strong>Формула</strong>
              <button type="button" className={styles.ghostButton} onClick={reset}>
                <RotateCcw /> Сброс
              </button>
            </div>
            <div className={styles.rateGrid}>
              <div className={styles.rateField}>
                <label htmlFor="econ-usd">Курс доллара</label>
                <input id="econ-usd" className={styles.rateInput} type="number" step={0.5}
                  value={usdStr} onChange={(e) => setUsd(e.target.value)} />
                <small>₽ за 1 $</small>
              </div>
              <div className={styles.rateField}>
                <label htmlFor="econ-rate">Закуп робуксов</label>
                <input id="econ-rate" className={styles.rateInput} type="number" step={0.1}
                  value={rateStr} onChange={(e) => setRate(e.target.value)} />
                <small>$ за 1000 грязных R$</small>
              </div>
              <div className={styles.rateField}>
                <label htmlFor="econ-tax">Комиссия Roblox</label>
                <input id="econ-tax" className={styles.rateInput} type="number" step={1}
                  value={taxStr} onChange={(e) => setTax(e.target.value)} />
                <small>% — съедает геймпасс</small>
              </div>
            </div>

            <div className={styles.rateGrid}>
              <div className={styles.rateField}>
                <label htmlFor="econ-acq">Эквайринг</label>
                <input id="econ-acq" className={styles.rateInput} type="number" step={0.1}
                  value={acqStr} onChange={(e) => setAcqStr(e.target.value)} />
                <small>% с платежа · сверь с договором</small>
              </div>
              <div className={styles.rateField}>
                <label htmlFor="econ-rec">Сервис «Чеки»</label>
                <input id="econ-rec" className={styles.rateInput} type="number" step={0.1}
                  value={recStr} onChange={(e) => setRecStr(e.target.value)} />
                <small>% с платежа с чеком</small>
              </div>
              <div className={styles.rateField}>
                <label htmlFor="econ-usn">Налог УСН</label>
                <input id="econ-usn" className={styles.rateInput} type="number" step={1}
                  value={usnStr} onChange={(e) => setUsnStr(e.target.value)} />
                <small>%</small>
              </div>
            </div>

            <div style={{ padding: "0 18px 14px" }}>
              <div className={styles.toolbar} style={{ margin: 0 }}>
                {([["income", "Доходы"], ["income-minus-expenses", "Доходы − расходы"]] as const).map(([m, label]) => (
                  <button
                    key={m} type="button"
                    className={cn(styles.chip, usnMode === m && styles.chipActive)}
                    onClick={() => setUsnMode(m)}
                  >{label}</button>
                ))}
              </div>
            </div>

            <div className={styles.formulaBox}>
              {valid ? (
                <>
                  <div>грязные R$ = выдано ÷ {(1 - rates.taxPct / 100).toFixed(2)}</div>
                  <div>себестоимость = грязные ÷ 1000 × {rates.rateUsdPer1k} $ × {rates.usdToRub} ₽</div>
                  <div>эквайринг = платёж × {(rates.acquiringPct + rates.receiptPct).toFixed(1)}% <span style={{ opacity: .7 }}>({rates.acquiringPct}% + {rates.receiptPct}% «Чеки»)</span></div>
                  <div>
                    налог = {rates.usnMode === "income"
                      ? <>выручка × {rates.usnPct}%</>
                      : <>(выручка − робуксы − эквайринг) × {rates.usnPct}%</>}
                  </div>
                  <div><b>1000 чистых R$ ⟶ {grossFor(1000, rates).toLocaleString("ru-RU")} грязных ⟶ {rubKop2(costKopFor(grossFor(1000, rates), rates))}</b></div>
                </>
              ) : (
                <div className={styles.bad}>
                  Курс и ставка должны быть больше нуля, комиссия — от 0 до 99%.
                </div>
              )}
            </div>

            <div style={{ padding: "0 18px 18px" }}>
              <p style={{ margin: "0 0 10px", color: "var(--admin-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                В Настройках сейчас: {data.defaults.usdToRub} ₽/$
                {data.defaults.purchaseRateUsdPer1k !== null && <> и {data.defaults.purchaseRateUsdPer1k} $/1k</>} —
                этим считаются снапшоты новых выкупов.
              </p>
              {rateChanged ? (
                <button
                  type="button" className={styles.primaryButton} style={{ width: "100%" }}
                  onClick={saveRates} disabled={!valid || saving}
                >
                  {saving ? "Сохраняю…" : `Записать ${rates.usdToRub} ₽/$ в Настройки`}
                </button>
              ) : (
                <button type="button" className={styles.ghostButton} style={{ width: "100%" }} disabled>
                  Совпадает с Настройками
                </button>
              )}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <strong>Наши цены</strong><span>маржа по пакам</span>
            </div>
            <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
              <table className={cn(styles.table, styles.compactTable, styles.responsiveTable)}>
                <thead>
                  <tr>
                    <th>Пак</th>
                    <th style={{ textAlign: "right" }}>Цена ₽</th>
                    <th style={{ textAlign: "right" }}>Прибыль</th>
                    <th style={{ textAlign: "right" }}>Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {valid && packs.map((pack) => {
                    const cost = costKopFor(grossFor(pack, rates), rates);
                    const price = (prices[pack] ?? 0) * 100;
                    const profit = price - cost;
                    return (
                      <tr key={pack}>
                        <td data-label="Пак" className={styles.tablePrimary}>{pack.toLocaleString("ru-RU")}</td>
                        <td data-label="Цена ₽" style={{ textAlign: "right" }}>
                          <input
                            className={styles.priceInput} type="number" step={10}
                            value={String(prices[pack] ?? 0)}
                            onChange={(e) => setPrice(pack, e.target.value)}
                          />
                        </td>
                        <td data-label="Прибыль" className={cn(styles.numeric, profit >= 0 ? styles.good : styles.bad)}>{rubKop(profit)}</td>
                        <td data-label="Маржа" className={cn(styles.numeric, styles.dim)}>
                          {price > 0 ? `${Math.round((profit / price) * 100)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {valid && totals.orders > 0 && (
              <div style={{ padding: "14px 19px 19px", color: "var(--admin-muted)", fontSize: 13, lineHeight: 1.6 }}>
                По вашему прайсу эти же {totals.orders} заказов дали бы {rubKop(totals.modelRevenueKop)} выручки
                и <b className={totals.modelProfitKop >= totals.profitKop ? styles.good : styles.bad}>
                  {rubKop(totals.modelProfitKop)}
                </b> прибыли. Правки цен живут только в этом экране — в боте и на сайте прайс не меняется.
              </div>
            )}
          </section>
        </div>
      </div>

      <p style={{ color: "#74747b", fontSize: 12.5, lineHeight: 1.55 }}>
        WB-коридор сюда не входит: там платит Wildberries, и выручки заказа в базе нет.
        {data.truncated && " Показаны последние 2000 заказов."}
      </p>
    </div>
  );
}
