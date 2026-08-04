"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, LoaderCircle,
  FileUp, Play, Plus, RefreshCw, Save, WalletCards, XCircle,
} from "lucide-react";

import { computePartnerSettlement, partnerOrderRateUsdtPer1000, type PartnerTaskEconomicSnapshot } from "@/lib/partner-economics";
import { cn } from "@/lib/utils";
import styles from "./admin-shell.module.css";

type PartnerTask = {
  id: string;
  status: "NEW" | "READY" | "PURCHASING" | "DONE" | "FAILED" | "CANCELLED";
  robloxUsername: string | null;
  gamepassId: string | null;
  priceRobux: number | null;
  purchasePriceRobux: number | null;
  externalSource: string;
  purchaseAccountName: string | null;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
  sheetRaw?: {
    sheetTitle?: string;
    rowNumber?: number;
    priceMismatch?: boolean;
    conflict?: string;
    sheetRateUsdtPer1000?: number | null;
  } | null;
  economicSnapshot?: PartnerTaskEconomicSnapshot | null;
};

type LedgerEntry = {
  id: string;
  type: "TOPUP" | "BUYOUT" | "REFUND" | "ADJUSTMENT";
  amount: number;
  rateUsdtPer1000: number | null;
  purchaseRateUsdtPer1000: number | null;
  rateBasis: "DIRTY" | "NET" | null;
  costBasis: string | null;
  grossRobuxAmount: number | null;
  netRobuxAmount: number | null;
  revenueUsdt: number | null;
  costUsdt: number | null;
  profitUsdt: number | null;
  itemCount: number;
  purchaseAccountName: string | null;
  comment: string | null;
  createdAt: string;
};

type AntonState = {
  ok: boolean;
  partner: {
    id: string;
    name: string;
    robuxRateUsdtPer1000: number;
    purchaseRateUsdtPer1000: number;
    rateBasis: "DIRTY" | "NET";
    robloxFeePct: number;
    googleSheetUrl: string | null;
  };
  summary: {
    balanceUsdt: number;
    spentUsdt: number;
    revenueUsdt: number;
    costUsdt: number | null;
    profitUsdt: number | null;
    grossRobux: number;
    netRobux: number;
    reservedUsdt: number;
    total: number;
    ready: number;
    purchasing: number;
    done: number;
    failed: number;
    mismatches: number;
    conflicts: number;
  };
  tasks: PartnerTask[];
  ledgerEntries: LedgerEntry[];
  rateChanges: Array<{
    id: string;
    rate: number;
    previousRate: number | null;
    purchaseRate: number | null;
    previousPurchaseRate: number | null;
    rateBasis: "DIRTY" | "NET" | null;
    createdAt: string;
    createdBy: string | null;
  }>;
  rateReport: Array<{
    rate: number | null;
    purchaseRate: number | null;
    rateBasis: "DIRTY" | "NET" | null;
    buyouts: number;
    totalRobux: number;
    totalNetRobux: number;
    totalUsdt: number;
    revenueUsdt: number;
    costUsdt: number | null;
    profitUsdt: number | null;
  }>;
  googleSync: {
    configured: boolean;
    serviceAccountConfigured: boolean;
    lastSyncAt: string | null;
    latestRun: { status: string; createdCount: number; updatedCount: number; failedCount: number; skippedCount: number; error: string | null } | null;
  };
};

const API = "/api/admin/partners/anton/tasks";
const money = (value: number | null | undefined) => value == null
  ? "—"
  : `${value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
const robux = (value: number | null | undefined) => `${(value ?? 0).toLocaleString("ru-RU")} R$`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
const taskPrice = (task: PartnerTask) => task.purchasePriceRobux ?? task.priceRobux ?? 0;

function margin(profit: number | null, revenue: number) {
  if (profit == null || revenue === 0) return "—";
  return `${Math.round((profit / revenue) * 10_000) / 100}%`;
}

function statusTone(status: PartnerTask["status"]) {
  if (status === "DONE") return styles.statusSuccess;
  if (status === "FAILED" || status === "CANCELLED") return styles.statusDanger;
  if (status === "PURCHASING") return styles.statusWarning;
  return "";
}

export default function AdminAntonClient() {
  const [state, setState] = useState<AntonState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saleRate, setSaleRate] = useState("5.3");
  const [purchaseRate, setPurchaseRate] = useState("4.7");
  const [topup, setTopup] = useState("");
  const [manualNick, setManualNick] = useState("");
  const [manualGp, setManualGp] = useState("");
  const [bulkConfirming, setBulkConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Не удалось загрузить Антона");
      setState(body);
      setSaleRate(String(body.partner.robuxRateUsdtPer1000));
      setPurchaseRate(String(body.partner.purchaseRateUsdtPer1000));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial authenticated resource load after hydration
    void load();
  }, [load]);

  const post = async (action: string, body: Record<string, unknown> = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Операция не выполнена");
      if (result.partner && result.summary) setState(result);
      setToast("Готово");
      setTimeout(() => setToast(null), 2500);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Операция не выполнена");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const uploadXlsx = async (file: File | null) => {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("action", "import-xlsx");
      form.append("file", file);
      const response = await fetch(API, { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Не удалось импортировать XLSX");
      setState(result);
      const imported = result.importResult;
      setToast(imported ? `XLSX: добавлено ${imported.created}, пропущено ${imported.skipped}, ошибок ${imported.failed}` : "XLSX импортирован");
      setTimeout(() => setToast(null), 3500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось импортировать XLSX");
    } finally {
      setLoading(false);
    }
  };

  const policy = state?.partner ?? {
    robuxRateUsdtPer1000: Number(saleRate) || 5.3,
    purchaseRateUsdtPer1000: Number(purchaseRate) || 4.7,
    rateBasis: "DIRTY" as const,
    robloxFeePct: 30,
  };
  const preview = useMemo(() => computePartnerSettlement({
    grossRobux: 1000,
    saleRateUsdtPer1000: Number(saleRate) || policy.robuxRateUsdtPer1000,
    purchaseRateUsdtPer1000: Number(purchaseRate) || policy.purchaseRateUsdtPer1000,
    rateBasis: "DIRTY",
    robloxFeePct: policy.robloxFeePct,
  }), [policy.robloxFeePct, policy.purchaseRateUsdtPer1000, policy.robuxRateUsdtPer1000, purchaseRate, saleRate]);

  const activeTasks = (state?.tasks ?? []).filter((task) => !["DONE", "CANCELLED"].includes(task.status));
  const visibleTasks = activeTasks.length > 0 ? activeTasks : (state?.tasks ?? []).slice(0, 40);
  const selectedTasks = visibleTasks.filter((task) => selected.has(task.id));
  const taskSettlement = (task: PartnerTask) => task.economicSnapshot ?? computePartnerSettlement({
    grossRobux: taskPrice(task),
    saleRateUsdtPer1000: partnerOrderRateUsdtPer1000(task.sheetRaw, policy.robuxRateUsdtPer1000),
    purchaseRateUsdtPer1000: policy.purchaseRateUsdtPer1000,
    rateBasis: "DIRTY",
    robloxFeePct: policy.robloxFeePct,
  });
  const selectedUsdt = selectedTasks.reduce((sum, task) => {
    return taskPrice(task) > 0 ? sum + taskSettlement(task).revenueUsdt : sum;
  }, 0);

  if (!state && loading) return <div className={styles.empty}><LoaderCircle className={styles.spin} /> Загружаем партнёрский контур…</div>;
  if (!state) return <div className={styles.noteDanger}><AlertTriangle /><div><strong>Антон недоступен</strong><span>{error}</span><button onClick={load}>Повторить</button></div></div>;

  const s = state.summary;
  return (
    <div className={styles.stack}>
      {toast && <div className={styles.noteInfo}><CheckCircle2 /><div>{toast}</div></div>}
      {error && <div className={styles.noteDanger}><AlertTriangle /><div><strong>Операция остановлена</strong><span>{error}</span></div></div>}
      {preview.profitUsdt < 0 && (
        <div className={styles.noteDanger}>
          <AlertTriangle />
          <div><strong>Новая партия убыточна по заданной формуле</strong><span>На 1000 R$ из таблицы: выручка {money(preview.revenueUsdt)}, закупка {money(preview.costUsdt)}, результат {money(preview.profitUsdt)} ({preview.marginPct}%).</span></div>
        </div>
      )}

      <div className={styles.partnerHeroGrid}>
        <section className={cn(styles.panel, styles.partnerBalance)}>
          <span>Баланс партнёра</span><strong>{money(s.balanceUsdt)}</strong>
          <small>Это остаток денег Антона, не наша прибыль</small>
          <div>
            <input value={topup} onChange={(event) => setTopup(event.target.value)} inputMode="decimal" placeholder="Сумма USDT" />
            <button disabled={loading || Number(topup) <= 0} onClick={async () => { if (await post("ledger-topup", { amount: Number(topup), comment: "Веб-админка" })) setTopup(""); }}><Plus size={15} /> Пополнить</button>
          </div>
        </section>
        <section className={cn(styles.panel, styles.partnerPolicy)}>
          <div><span>Закупка / 1000 грязных</span><input value={purchaseRate} onChange={(event) => setPurchaseRate(event.target.value)} inputMode="decimal" /></div>
          <div><span>Антон / 1000 R$ из таблицы</span><input value={saleRate} onChange={(event) => setSaleRate(event.target.value)} inputMode="decimal" /></div>
          <button disabled={loading} onClick={() => post("set-rate", { purchaseRateUsdtPer1000: Number(purchaseRate), robuxRateUsdtPer1000: Number(saleRate), rateBasis: "DIRTY", robloxFeePct: 30 })}><Save size={15} /> Сохранить для будущих партий</button>
          <small>Смена ставки не переписывает завершённые ledger-записи.</small>
        </section>
      </div>

      <div className={styles.metricGrid}>
        {[
          { label: "Списано с Антона", value: money(s.revenueUsdt), note: `${s.done} выполнено` },
          { label: "Себестоимость", value: money(s.costUsdt), note: "история 4.3 — ASSUMED" },
          { label: "Валовая прибыль", value: money(s.profitUsdt), note: `маржа ${margin(s.profitUsdt, s.revenueUsdt)}` },
          { label: "Объём", value: robux(s.netRobux), note: `${robux(s.grossRobux)} грязных` },
        ].map((metric) => <article key={metric.label} className={styles.metricCard}><WalletCards className={styles.metricIcon} /><strong>{metric.value}</strong><span>{metric.label}</span><small>{metric.note}</small></article>)}
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><strong>История курсов</strong><span>ledger-снимки, без пересчёта завершённых заказов</span></div>
        </div>
        <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
          <table className={cn(styles.table, styles.responsiveTable)}>
            <thead><tr><th>Курс Антона</th><th>Закупка</th><th>Формула</th><th>Выкуплено</th><th>Объём</th><th>Выручка</th><th>Себестоимость</th><th>Прибыль</th></tr></thead>
            <tbody>{state.rateReport.length === 0 ? (
              <tr><td colSpan={8}>История списаний пока пуста.</td></tr>
            ) : state.rateReport.map((row) => (
              <tr key={`${row.rate ?? "unknown"}:${row.purchaseRate ?? "unknown"}:${row.rateBasis ?? "unknown"}`}>
                <td data-label="Курс Антона">{row.rate == null ? "не записан" : `${row.rate} USDT`}</td>
                <td data-label="Закупка">{row.purchaseRate == null ? "—" : `${row.purchaseRate} USDT`}</td>
                <td data-label="Формула">{row.rateBasis === "NET" ? "чистые R$" : row.rateBasis === "DIRTY" ? "грязные R$" : "—"}</td>
                <td data-label="Выкуплено">{row.buyouts}</td>
                <td data-label="Объём">{robux(row.totalRobux)}</td>
                <td data-label="Выручка">{money(row.revenueUsdt)}</td>
                <td data-label="Себестоимость">{money(row.costUsdt)}</td>
                <td data-label="Прибыль">{money(row.profitUsdt)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {state.rateChanges.length > 0 && (
          <div className={styles.panelNote}>
            <strong>Изменения:</strong> {state.rateChanges.map((change, index) => (
              <span key={change.id}>{index > 0 ? " · " : " "}{change.previousRate == null ? "—" : change.previousRate} → {change.rate} USDT / 1000 ({date(change.createdAt)})</span>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><strong>Google Sheets</strong><span>{state.googleSync.lastSyncAt ? `Последняя синхронизация ${date(state.googleSync.lastSyncAt)}` : "Ещё не синхронизировалась"}</span></div>
          <div className={styles.headerActions}>
            {state.partner.googleSheetUrl && <a className={styles.secondaryButton} href={state.partner.googleSheetUrl} target="_blank" rel="noreferrer"><FileSpreadsheet size={15} /> Таблица <ExternalLink size={13} /></a>}
            <label className={cn(styles.secondaryButton, styles.fileButton)} aria-disabled={loading}><FileUp size={15} /> Импорт XLSX<input type="file" accept=".xlsx,.xls" disabled={loading} onChange={(event) => { void uploadXlsx(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} /></label>
            <button className={styles.primaryButton} disabled={loading} onClick={() => post("sync-google-sheets")}><RefreshCw size={15} /> Синхронизировать</button>
          </div>
        </div>
        <p className={styles.panelNote}>Таблица — источник заказов. Ledger БД — источник денег; исправления делаются видимым сторно.</p>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><strong>Задачи</strong><span>{activeTasks.length > 0 ? `${activeTasks.length} активных` : `Активных нет · последние ${visibleTasks.length}`}</span></div>
          <div className={styles.headerActions}>
            <button className={styles.secondaryButton} onClick={() => setSelected(new Set(visibleTasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).map((task) => task.id)))}>Выбрать активные</button>
            <button className={styles.primaryButton} disabled={loading || selectedTasks.length === 0} onClick={() => setBulkConfirming(true)}>Куплено ({selectedTasks.length})</button>
          </div>
        </div>
        {bulkConfirming && (
          <div className={styles.confirmBar} role="alert">
            <AlertTriangle />
            <div><strong>Подтвердите списание</strong><span>Отметить купленными {selectedTasks.length} задач и списать примерно {money(selectedUsdt)} с баланса Антона?</span></div>
            <div className={styles.confirmBarActions}>
              <button className={styles.secondaryButton} onClick={() => setBulkConfirming(false)}>Отмена</button>
              <button className={styles.primaryButton} onClick={async () => {
                if (await post("mark-done-bulk", { taskIds: selectedTasks.map((task) => task.id), purchaseAccountName: "Веб-админка / вручную" })) {
                  setSelected(new Set());
                  setBulkConfirming(false);
                }
              }}>Да, списать</button>
            </div>
          </div>
        )}
        <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
          <table className={cn(styles.table, styles.responsiveTable)}>
            <thead><tr><th></th><th>Задача</th><th>Грязные → чистые</th><th>Списание / результат</th><th>Статус</th><th>Действия</th></tr></thead>
            <tbody>{visibleTasks.map((task) => {
              const gross = taskPrice(task);
              const row = gross > 0 ? taskSettlement(task) : null;
              const actionable = !["DONE", "CANCELLED", "PURCHASING"].includes(task.status);
              return <tr key={task.id}>
                <td data-label="Выбрать"><input type="checkbox" checked={selected.has(task.id)} disabled={!actionable} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(task.id); else next.delete(task.id); return next; })} /></td>
                <td data-label="Задача"><span className={styles.tablePrimary}>{task.robloxUsername ?? `GP ${task.gamepassId ?? "—"}`}</span><span className={styles.tableSecondary}>{task.externalSource}{task.sheetRaw?.sheetTitle ? ` · ${task.sheetRaw.sheetTitle}:${task.sheetRaw.rowNumber}` : ""}{task.error ? ` · ${task.error}` : ""}</span></td>
                <td data-label="Грязные → чистые"><span className={styles.tablePrimary}>{robux(row?.grossRobux)}</span><span className={styles.tableSecondary}>→ {robux(row?.netRobux)} чистых</span></td>
                <td data-label="Списание"><span className={styles.tablePrimary}>{money(row?.revenueUsdt)}</span><span className={styles.tableSecondary} style={{ color: row && row.profitUsdt < 0 ? "#ff7780" : undefined }}>{row ? `курс ${row.saleRateUsdtPer1000} · прибыль ${money(row.profitUsdt)}` : "нет цены"}</span></td>
                <td data-label="Статус"><span className={cn(styles.status, statusTone(task.status))}>{task.status}</span></td>
                <td data-label="Действия"><div className={styles.rowActions}>
                  <button title="Купить" disabled={loading || !["READY", "FAILED"].includes(task.status)} onClick={() => post("purchase-task", { taskId: task.id, purchaseBatchId: `web:${Date.now()}` })}><Play size={14} /></button>
                  <button title="Отметить купленным" disabled={loading || !actionable} onClick={() => post("mark-done", { taskId: task.id, purchaseAccountName: "Веб-админка / вручную" })}><CheckCircle2 size={14} /></button>
                  <button title="Отменить" disabled={loading || !actionable} onClick={() => post("cancel-task", { taskId: task.id })}><XCircle size={14} /></button>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <div className={styles.partnerBottomGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Добавить вручную</strong></div>
          <div className={styles.partnerForm}>
            <label>Ник<input value={manualNick} onChange={(event) => setManualNick(event.target.value)} /></label>
            <label>ID или URL геймпасса<input value={manualGp} onChange={(event) => setManualGp(event.target.value)} /></label>
            <button className={styles.primaryButton} disabled={loading || !manualGp.trim()} onClick={async () => { if (await post("create-task", { robloxUsername: manualNick, gamepass: manualGp })) { setManualNick(""); setManualGp(""); } }}><Plus size={15} /> Добавить</button>
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Последние операции ledger</strong><span>append-only</span></div>
          <div className={styles.partnerLedgerList}>{state.ledgerEntries.slice(0, 10).map((entry) => <div key={entry.id}>
            <span className={cn(styles.status, entry.type === "BUYOUT" ? styles.statusWarning : entry.type === "REFUND" ? styles.statusSuccess : "")}>{entry.type}</span>
            <div><strong>{entry.comment ?? entry.purchaseAccountName ?? "Операция"}</strong><small>{date(entry.createdAt)} · {entry.rateBasis ?? "—"} · закуп {entry.purchaseRateUsdtPer1000 ?? "—"}</small></div>
            <b style={{ color: entry.amount >= 0 ? "#63dda0" : "#f5f5f7" }}>{entry.amount > 0 ? "+" : ""}{money(entry.amount)}</b>
          </div>)}</div>
        </section>
      </div>
    </div>
  );
}
