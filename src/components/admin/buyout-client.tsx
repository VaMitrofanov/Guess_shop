"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Check, CheckCheck, ClipboardCheck, Copy, Download, ExternalLink, Loader2,
  RefreshCw, ShoppingBasket, SquareTerminal, TriangleAlert, Wallet, X,
} from "lucide-react";
import styles from "./admin-shell.module.css";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";
import { cn } from "@/lib/utils";
import { bulkPause, shouldStopBatch, sleep, type BatchItem } from "@/lib/buyout-batch";

/* ─────────────────────────────────────────────────────────────────────────────
   Рабочее место закупщика (docs/admin-console-plan.md §7 A4).

   Границы очереди и выгрузка приходят с сервера из общего `buildTabWhere` —
   того же, что рисует ленту заказов в TWA. Копии правил здесь нет намеренно:
   «К выкупу» на двух экранах обязано значить одно и то же.

   Как работаем на самом деле (владелец, 29.07): **выкуп ручной** — берём
   выгрузку ID и покупаем сами. Поэтому экран построен вокруг ручного пути:
   выгрузка → «Скрипт» (та же покупка, но в браузере донора, с зашитой
   ожидаемой ценой) → **«Куплено»**, которое закрывает заказ и уведомляет
   клиента. Автоматическая покупка («Купить») тоже есть, но она вторична.

   Обе покупки целиком серверные: `POST /api/twa/orders` → `purchase` /
   `purchase-script`, со всеми гардами ([ЦЕНА-СТОП], [ПРОДАВЕЦ-СТОП], замена
   при рег-цене). Отсюда уходит только «сделай вот с этим заказом» — обойти
   проверку из браузера нельзя.

   Чем шире TWA: заказы выбираются вручную (в TWA пачка считается сама), есть
   подбор «сколько влезает в баланс», массовое «отметить купленными» (в TWA
   заказы закрываются по одному), построчный результат с причиной отказа и
   остановка на ходу.
   ───────────────────────────────────────────────────────────────────────── */

const TAB_LABEL: Record<string, string> = {
  BUYOUT: "К выкупу",
  DIRECT: "Прямые",
  AVITO: "Авито",
  WORK: "В работе",
  ERROR: "Ошибки",
  ATTENTION: "Требуют внимания",
};
const TABS = ["BUYOUT", "DIRECT", "AVITO", "WORK", "ERROR", "ATTENTION"] as const;
type Tab = (typeof TABS)[number];

interface ExportItem {
  orderId: string;
  wbCode: string;
  gamepassId: string;
  gamepassUrl: string;
  amount: number;
  expectedPrice: number;
  status: string;
  orderSource: string;
  robloxUsername: string | null;
  waitingHours: number;
}

interface BuyoutData {
  export: {
    tab: Tab; generatedAt: string; total: number; totalRobux: number; totalGrossRobux: number;
    skippedUnpaid: number; skippedNoGamepass: number; truncated: boolean; items: ExportItem[];
  };
  batches: {
    id: string; accountName: string | null; startedAt: string; finishedAt: string | null;
    totalGross: number; okCount: number; failCount: number;
  }[];
  drains: { id: string; donorName: string | null; drainName: string | null; amount: number; source: string; createdAt: string }[];
  counts: Record<string, number>;
}

interface Donor {
  hasCookie: boolean; cookieValid: boolean; cookieUpdatedAt: string | null;
  accountName: string | null; accountId: number | null; balance: number | null;
  problem: string | null;
}

/** Состояние строки в текущем прогоне. */
type RowState =
  | { kind: "idle" }
  | { kind: "buying" }
  | { kind: "marking" }
  | { kind: "done"; gross: number }
  | { kind: "marked" }
  | { kind: "failed"; reason: string };

const rbx = (n: number) => n.toLocaleString("ru-RU") + " R$";
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: ADMIN_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

function waitLabel(hours: number) {
  if (hours < 1) return "только что";
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} д`;
}

/** Часы ожидания, после которых заказ подсвечивается как просроченный. */
const OVERDUE_HOURS = 12;
/** Выкуп идёт только с этих вкладок: остальные — не очередь на покупку. */
const BUYABLE_TABS: readonly Tab[] = ["BUYOUT", "DIRECT", "WORK", "ATTENTION"];

export default function AdminBuyoutClient({ initialData }: { initialData: BuyoutData }) {
  const [tab, setTab] = useState<Tab>("BUYOUT");
  const [data, setData] = useState<BuyoutData | null>(initialData);
  const [donor, setDonor] = useState<Donor | null>(null);
  const [donorLoading, setDonorLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState<null | "buy" | "mark">(null);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number } | null>(null);
  const [report, setReport] = useState<{ ok: number; fail: number; gross: number; stopped: boolean; mode: "buy" | "mark" } | null>(null);
  const stopRef = useRef(false);
  const loadRequestRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (nextTab: Tab) => {
    const requestId = ++loadRequestRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setError(null);
    try {
      const res = await fetch(`/api/admin/buyout?tab=${nextTab}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const nextData = await res.json();
      if (requestId !== loadRequestRef.current) return;
      setData(nextData);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      if (requestId === loadRequestRef.current) setError("Не удалось загрузить очередь");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
      if (loadAbortRef.current === controller) loadAbortRef.current = null;
    }
  }, []);

  const loadDonor = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/buyout/donor", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      setDonor(res.ok ? await res.json() : null);
    } catch {
      setDonor(null);
    } finally {
      setDonorLoading(false);
    }
  }, []);

  // Initial BUYOUT уже пришёл с server render. Донор проверяется только явно:
  // внешний Roblox/browser path не участвует в скорости открытия экрана.

  /**
   * Смена очереди. Сброс выбора живёт здесь, а не в эффекте на `tab`: галочки
   * с прошлой вкладки к новой не относятся, и это следствие действия админа, а
   * не синхронизация с внешним миром.
   */
  const changeTab = (next: Tab) => {
    if (next === tab || running || loading) return;
    setTab(next);
    setLoading(true);
    setSelected(new Set());
    setRowState({});
    setReport(null);
  };

  const items = useMemo(() => data?.export.items ?? [], [data]);
  const buyable = BUYABLE_TABS.includes(tab);

  const idList = useMemo(() => items.map((i) => i.gamepassId).join("\n"), [items]);
  const csv = useMemo(() => {
    const head = "wbCode;gamepassId;nick;amount;expectedPrice;status;source;waitingHours";
    const rows = items.map((i) => [
      i.wbCode, i.gamepassId, i.robloxUsername ?? "", i.amount, i.expectedPrice,
      i.status, i.orderSource, i.waitingHours,
    ].join(";"));
    return [head, ...rows].join("\n");
  }, [items]);

  const copy = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      setError("Буфер обмена недоступен — скопируй из поля ниже вручную");
    }
  };

  const downloadCsv = () => {
    // BOM: без него Excel открывает кириллицу в CSV кракозябрами.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gamepass-${tab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Выбор ───────────────────────────────────────────────────────────────────

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.orderId)),
    [items, selected],
  );
  const selectedGross = selectedItems.reduce((s, i) => s + i.expectedPrice, 0);
  const shortfall = donor?.balance != null ? selectedGross - donor.balance : null;

  const toggle = (orderId: string) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId); else next.add(orderId);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(items.map((i) => i.orderId)));
  const selectNone = () => setSelected(new Set());
  /** Набрать сверху вниз столько, сколько помещается в баланс донора. */
  const selectAffordable = () => {
    const budget = donor?.balance ?? 0;
    const next = new Set<string>();
    let spent = 0;
    for (const i of items) {
      if (spent + i.expectedPrice > budget) continue;
      next.add(i.orderId);
      spent += i.expectedPrice;
    }
    setSelected(next);
  };

  // ── Скрипт покупки ──────────────────────────────────────────────────────────

  const copyScript = async (item: ExportItem) => {
    setRowState((s) => ({ ...s, [item.orderId]: { kind: "buying" } }));
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchase-script", orderId: item.orderId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.script) {
        setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason: d?.error ?? `HTTP ${res.status}` } }));
        return;
      }
      await navigator.clipboard.writeText(d.script);
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "idle" } }));
      setCopied(`script:${item.orderId}`);
      setTimeout(() => setCopied((c) => (c === `script:${item.orderId}` ? null : c)), 2200);
    } catch {
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason: "ошибка сети" } }));
    }
  };

  // ── Покупка ─────────────────────────────────────────────────────────────────

  /** Одна покупка. Возвращает строку отчёта пачки. */
  const purchaseOne = async (item: ExportItem): Promise<BatchItem> => {
    const nick = item.robloxUsername ?? item.wbCode;
    setRowState((s) => ({ ...s, [item.orderId]: { kind: "buying" } }));
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchase", orderId: item.orderId }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.success) {
        const gross = Number(d.chargedPrice ?? item.expectedPrice);
        setRowState((s) => ({ ...s, [item.orderId]: { kind: "done", gross } }));
        setDonor((prev) => (prev?.balance != null ? { ...prev, balance: prev.balance - gross } : prev));
        return { orderId: item.orderId, nick, wbCode: item.wbCode, gross, ok: true };
      }
      const reason = String(d?.msg ?? d?.error ?? (res.ok ? "не куплено" : `HTTP ${res.status}`));
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason } }));
      return { orderId: item.orderId, nick, wbCode: item.wbCode, gross: item.expectedPrice, ok: false, reason };
    } catch {
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason: "ошибка сети" } }));
      return { orderId: item.orderId, nick, wbCode: item.wbCode, gross: item.expectedPrice, ok: false, reason: "ошибка сети" };
    }
  };

  /**
   * «Куплено» — заказ выкуплен руками, закрываем его. Серверный `complete`
   * ставит COMPLETED, пишет снапшот себестоимости по текущему курсу и
   * **уведомляет клиента**, что робуксы выданы. Поэтому отметка по ошибке —
   * это сообщение клиенту о несделанной работе; массовая отметка спрашивает
   * подтверждение.
   */
  const markBoughtOne = async (item: ExportItem): Promise<BatchItem> => {
    const nick = item.robloxUsername ?? item.wbCode;
    setRowState((s) => ({ ...s, [item.orderId]: { kind: "marking" } }));
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", orderId: item.orderId }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setRowState((s) => ({ ...s, [item.orderId]: { kind: "marked" } }));
        return { orderId: item.orderId, nick, wbCode: item.wbCode, gross: item.expectedPrice, ok: true };
      }
      const reason = String(d?.error ?? `HTTP ${res.status}`);
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason } }));
      return { orderId: item.orderId, nick, wbCode: item.wbCode, gross: item.expectedPrice, ok: false, reason };
    } catch {
      setRowState((s) => ({ ...s, [item.orderId]: { kind: "failed", reason: "ошибка сети" } }));
      return { orderId: item.orderId, nick, wbCode: item.wbCode, gross: item.expectedPrice, ok: false, reason: "ошибка сети" };
    }
  };

  const markOne = async (item: ExportItem) => {
    if (running) return;
    setRunning(true);
    const result = await markBoughtOne(item);
    setRunning(false);
    if (result.ok) await load(tab);
  };

  /**
   * Массовая отметка. Пауз между заказами нет — Roblox тут не участвует,
   * это только наша база и уведомления клиентам.
   */
  const markSelected = async () => {
    const queue = selectedItems;
    if (running || queue.length === 0) return;
    setConfirming(null);
    setRunning(true);
    setReport(null);
    stopRef.current = false;
    setProgress({ done: 0, total: queue.length, ok: 0 });

    let ok = 0;
    let stopped = false;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) { stopped = true; break; }
      const result = await markBoughtOne(queue[i]);
      if (result.ok) ok += 1;
      setProgress({ done: i + 1, total: queue.length, ok });
    }

    setRunning(false);
    setProgress(null);
    setReport({ ok, fail: queue.length - ok, gross: 0, stopped, mode: "mark" });
    setSelected(new Set());
    await load(tab);
  };

  const buyOne = async (item: ExportItem) => {
    if (running) return;
    setRunning(true);
    const result = await purchaseOne(item);
    setRunning(false);
    if (result.ok) { await load(tab); await loadDonor(); }
  };

  /**
   * Пачка. Батч пишется прогрессивно (start → item → finish), как в TWA:
   * закрытие вкладки посреди прогона не должно съедать отчёт — недофинишированные
   * батчи дошлёт свипер TG-бота.
   */
  const buySelected = async () => {
    const queue = selectedItems;
    if (running || queue.length === 0) return;
    setConfirming(null);
    setRunning(true);
    setReport(null);
    stopRef.current = false;
    setProgress({ done: 0, total: queue.length, ok: 0 });

    const collected: BatchItem[] = [];
    const startedAt = new Date().toISOString();
    let batchId: string | null = null;
    try {
      const r = await fetch("/api/twa/purchase-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", accountName: donor?.accountName ?? null, startedAt }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.batchId) batchId = d.batchId;
    } catch { /* трекинг батча не должен блокировать выкуп */ }

    const pushItem = async (item: BatchItem) => {
      if (!batchId) return;
      try {
        await fetch("/api/twa/purchase-batch", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "item", batchId, item }),
        });
      } catch { /* finish пришлёт полный список */ }
    };

    let ok = 0;
    let stopped = false;
    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) { stopped = true; break; }
      if (i > 0) await sleep(bulkPause());
      if (stopRef.current) { stopped = true; break; }

      const result = await purchaseOne(queue[i]);
      collected.push(result);
      await pushItem(result);
      if (result.ok) ok += 1;
      // Кончился баланс, протух cookie, занят браузер — дальше жать бессмысленно.
      if (!result.ok && shouldStopBatch(result.reason)) { stopped = true; stopRef.current = true; }
      setProgress({ done: i + 1, total: queue.length, ok });
    }

    try {
      await fetch("/api/twa/purchase-batch", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          batchId
            ? { action: "finish", batchId, items: collected, notify: true }
            : { action: "save", accountName: donor?.accountName ?? null, startedAt, items: collected, notify: true },
        ),
      });
    } catch { /* отчёт дошлёт свипер TG-бота */ }

    setRunning(false);
    setProgress(null);
    setReport({
      ok,
      fail: collected.length - ok,
      gross: collected.filter((c) => c.ok).reduce((s, c) => s + c.gross, 0),
      stopped,
      mode: "buy",
    });
    setSelected(new Set());
    await load(tab);
    await loadDonor();
  };

  return (
    <div className={styles.stack}>
      {error && (
        <div className={styles.noteWarn}><TriangleAlert /><div>{error}</div></div>
      )}

      {report && (
        <div className={report.fail === 0 ? styles.noteInfo : styles.noteWarn}>
          {report.fail === 0 ? <Check /> : <TriangleAlert />}
          <div>
            {report.mode === "mark" ? (
              <>
                <b>Закрыто заказов: {report.ok}</b>
                {report.fail > 0 && <>, не вышло {report.fail}</>}. Клиентам ушло уведомление
                о выдаче робуксов.
              </>
            ) : (
              <>
                <b>Пачка завершена:</b> куплено {report.ok}
                {report.fail > 0 && <>, не вышло {report.fail}</>} · списано {rbx(report.gross)}.
                {" "}Отчёт ушёл в Telegram.
              </>
            )}
            {report.stopped && <> Прогон остановлен досрочно — причина в строке заказа.</>}
          </div>
        </div>
      )}

      <div className={styles.splitGrid}>
        {/* ── Очередь ── */}
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <strong>Выгрузка ID геймпассов</strong>
            <span>
              {loading ? "загружаем…" : `${data?.export.total ?? 0} шт · ${rbx(data?.export.totalRobux ?? 0)} клиентам`}
            </span>
          </div>

          <div style={{ padding: "14px 19px 0" }}>
            <div className={styles.toolbar}>
              {TABS.map((t) => (
                <button
                  key={t} type="button" disabled={running || loading}
                  className={cn(styles.chip, tab === t && styles.chipActive)}
                  onClick={() => changeTab(t)}
                >
                  {TAB_LABEL[t]}
                  {data?.counts?.[t] !== undefined && <b>{data.counts[t]}</b>}
                </button>
              ))}
            </div>

            <div className={styles.toolbar}>
              <button type="button" className={styles.ghostButton} onClick={() => copy(idList, "ids")} disabled={!items.length}>
                {copied === "ids" ? <ClipboardCheck /> : <Copy />}
                {copied === "ids" ? "Скопировано" : "ID списком"}
              </button>
              <button type="button" className={styles.ghostButton} onClick={() => copy(csv, "csv")} disabled={!items.length}>
                {copied === "csv" ? <ClipboardCheck /> : <Copy />}
                {copied === "csv" ? "Скопировано" : "CSV"}
              </button>
              <button type="button" className={styles.ghostButton} onClick={downloadCsv} disabled={!items.length}>
                <Download /> Скачать
              </button>
              <div className={styles.toolbarSpacer} />
              <button type="button" className={styles.ghostButton} onClick={() => { setLoading(true); void load(tab); }} disabled={loading || running}>
                <RefreshCw /> Обновить
              </button>
            </div>

            {buyable && items.length > 0 && (
              <div className={styles.toolbar}>
                <button type="button" className={styles.ghostButton} onClick={selectAll} disabled={running}>Выбрать все</button>
                <button
                  type="button" className={styles.ghostButton} onClick={selectAffordable}
                  disabled={running || donor?.balance == null}
                  title={donor?.balance == null ? "Баланс донора неизвестен" : undefined}
                >Сколько влезает в баланс</button>
                <button type="button" className={styles.ghostButton} onClick={selectNone} disabled={running || selected.size === 0}>Снять выбор</button>
              </div>
            )}

            {data && (data.export.skippedNoGamepass > 0 || data.export.skippedUnpaid > 0 || data.export.truncated) && (
              <div className={styles.noteInfo} style={{ marginBottom: 14 }}>
                <TriangleAlert />
                <div>
                  Из очереди в выгрузку не попали:{" "}
                  {data.export.skippedNoGamepass > 0 && <><b>{data.export.skippedNoGamepass}</b> без ссылки на геймпасс</>}
                  {data.export.skippedNoGamepass > 0 && data.export.skippedUnpaid > 0 && " · "}
                  {data.export.skippedUnpaid > 0 && <><b>{data.export.skippedUnpaid}</b> неоплаченных прямых</>}
                  {data.export.truncated && <> · список обрезан на 500 позициях</>}.
                  {" "}Это не ошибка: такие заказы выключены из всех путей выкупа.
                </div>
              </div>
            )}
          </div>

          <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
            <table className={cn(styles.table, styles.compactTable, styles.responsiveTable)}>
              <thead>
                <tr>
                  {buyable && <th style={{ width: 30 }} />}
                  <th>Код</th><th>ID геймпасса</th><th>Ник</th>
                  <th style={{ textAlign: "right" }}>Цена пасса</th>
                  <th style={{ textAlign: "right" }}>Ждёт</th>
                  {buyable && <th style={{ textAlign: "right" }}>Действия</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const state = rowState[i.orderId] ?? { kind: "idle" as const };
                  const isSelected = selected.has(i.orderId);
                  return (
                    <tr key={i.orderId} className={cn(isSelected && styles.rowSelected)}>
                      {buyable && (
                        <td data-label="Выбрать">
                          <input
                            type="checkbox" className={styles.checkbox}
                            checked={isSelected} disabled={running}
                            onChange={() => toggle(i.orderId)}
                            aria-label={`Выбрать ${i.wbCode}`}
                          />
                        </td>
                      )}
                      <td data-label="Код">
                        <span className={cn(styles.tablePrimary, styles.nowrap)}>{i.wbCode}</span>
                        <small className={styles.tableSecondary}>{i.orderSource} · {i.status}</small>
                      </td>
                      <td data-label="ID геймпасса">
                        <a className={cn(styles.orderLink, styles.nowrap)} href={i.gamepassUrl || `https://www.roblox.com/game-pass/${i.gamepassId}`} target="_blank" rel="noreferrer">
                          {i.gamepassId} <ExternalLink size={12} style={{ display: "inline", verticalAlign: "-1px" }} />
                        </a>
                      </td>
                      <td data-label="Ник">{i.robloxUsername ?? <span className={styles.dim}>—</span>}</td>
                      <td data-label="Цена пасса" className={styles.numeric}>
                        <span className={styles.tablePrimary}>{i.expectedPrice.toLocaleString("ru-RU")}</span>
                        <small className={styles.tableSecondary}>номинал {i.amount.toLocaleString("ru-RU")}</small>
                      </td>
                      <td data-label="Ждёт" className={cn(styles.numeric, i.waitingHours >= OVERDUE_HOURS && styles.bad)}>
                        {waitLabel(i.waitingHours)}
                      </td>
                      {buyable && (
                        <td data-label="Действия" className={styles.rowActions}>
                          {state.kind === "buying" && <span className={styles.dim}><Loader2 className={styles.spin} /> покупаем…</span>}
                          {state.kind === "marking" && <span className={styles.dim}><Loader2 className={styles.spin} /> закрываем…</span>}
                          {state.kind === "done" && <span className={styles.good}><Check /> куплено, −{rbx(state.gross)}</span>}
                          {state.kind === "marked" && <span className={styles.good}><Check /> закрыт</span>}
                          {state.kind === "failed" && <span className={styles.bad} title={state.reason}>{state.reason}</span>}
                          {state.kind === "idle" && (
                            <>
                              <button
                                type="button" className={cn(styles.ghostButton, styles.iconButton)} disabled={running}
                                onClick={() => void copyScript(i)}
                                aria-label="Скопировать скрипт покупки"
                                title={copied === `script:${i.orderId}` ? "Скрипт скопирован" : "Скрипт покупки для браузера донора — с зашитой ожидаемой ценой"}
                              >
                                {copied === `script:${i.orderId}` ? <ClipboardCheck /> : <SquareTerminal />}
                              </button>
                              <button
                                type="button" className={cn(styles.ghostButton, styles.iconButton)} disabled={running}
                                onClick={() => void buyOne(i)}
                                aria-label="Купить автоматически"
                                title="Купить автоматически через серверный браузер"
                              >
                                <ShoppingBasket />
                              </button>
                              <button
                                type="button" className={styles.buyButton} disabled={running}
                                onClick={() => void markOne(i)}
                                title="Заказ выкуплен вручную — закрыть и уведомить клиента"
                              >
                                <Check /> Куплено
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={buyable ? 7 : 5} className={styles.empty}>В этой очереди пусто</td></tr>
                )}
                {loading && (
                  <tr><td colSpan={buyable ? 7 : 5} className={styles.empty}>Загружаем очередь…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {items.length > 0 && (
            <div style={{ padding: "0 19px 19px" }}>
              <div className={styles.detailRow} style={{ marginBottom: 12 }}>
                <span>Ожидаемое списание с донора (сумма цен пассов)</span>
                <strong className={styles.numeric}>{rbx(data?.export.totalGrossRobux ?? 0)}</strong>
              </div>
              <textarea className={styles.copyArea} readOnly value={idList} spellCheck={false} />
              <p style={{ margin: "8px 0 0", color: "var(--admin-muted)", fontSize: 12.5, lineHeight: 1.55 }}>
                «Цена пасса» — это ожидание прайс-гарда <code>ceil(номинал / 0.7)</code>. Если у пасса
                на Roblox другая цена, выкуп остановится с <b>[ЦЕНА-СТОП]</b>, а чужой продавец —
                с <b>[ПРОДАВЕЦ-СТОП]</b>. Эти проверки живут на сервере и отсюда не обходятся.
              </p>
            </div>
          )}
        </section>

        {/* ── Правая колонка ── */}
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.donorCard}>
              <div className={styles.donorHead}>
                <div>
                  <span>Донор</span>
                  <strong>{donorLoading ? "проверяем…" : donor?.accountName ?? "—"}</strong>
                </div>
                <button type="button" className={styles.ghostButton} onClick={() => { setDonorLoading(true); void loadDonor(); }} disabled={donorLoading || running}>
                  <RefreshCw /> {donorLoading ? "…" : "Обновить"}
                </button>
              </div>

              <div>
                <span style={{ color: "var(--admin-muted)", fontSize: 12 }}>Баланс</span>
                <div className={cn(styles.donorBalance, shortfall != null && shortfall > 0 && styles.bad)}>
                  {donor?.balance != null ? rbx(donor.balance) : donorLoading ? "…" : "—"}
                </div>
              </div>

              {donor?.balance != null && data && data.export.totalGrossRobux > 0 && (
                <div>
                  <div className={cn(styles.donorMeter, donor.balance < data.export.totalGrossRobux && styles.donorMeterShort)}>
                    <i style={{ width: `${Math.min(100, Math.round((donor.balance / data.export.totalGrossRobux) * 100))}%` }} />
                  </div>
                  <p style={{ margin: "8px 0 0", color: "var(--admin-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                    {donor.balance < data.export.totalGrossRobux
                      ? <>На всю очередь «{TAB_LABEL[tab]}» не хватает <b className={styles.bad}>{rbx(data.export.totalGrossRobux - donor.balance)}</b>.</>
                      : <>Баланса хватает на всю очередь «{TAB_LABEL[tab]}».</>}
                  </p>
                </div>
              )}

              {donor?.cookieUpdatedAt && (
                <div className={styles.detailRow}>
                  <span>Cookie обновлён</span>
                  <strong>{dateTime(donor.cookieUpdatedAt)}</strong>
                </div>
              )}

              {donor?.problem && (
                <div className={styles.noteWarn}><TriangleAlert /><div>{donor.problem}</div></div>
              )}
            </div>
          </section>

          {/* Пачка: основное действие — закрыть заказы, выкупленные вручную */}
          {buyable && (selected.size > 0 || running) && (
            <section className={cn(styles.panel, styles.buyPanel)}>
              <div className={styles.panelHeader}>
                <strong>Выбрано: {selected.size || progress?.total}</strong>
                <span>{running ? "идёт прогон" : rbx(selectedGross)}</span>
              </div>
              <div style={{ padding: 18, display: "grid", gap: 13 }}>
                {running && progress ? (
                  <>
                    <div>
                      <div className={styles.donorMeter}>
                        <i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                      </div>
                      <p style={{ margin: "9px 0 0", fontSize: 13.5 }}>
                        {progress.done} из {progress.total} · готово {progress.ok}
                      </p>
                    </div>
                    <button type="button" className={styles.ghostButton} onClick={() => { stopRef.current = true; }}>
                      <X /> Остановить после текущего
                    </button>
                    <p style={{ margin: 0, color: "var(--admin-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                      Не закрывай вкладку: прогон живёт здесь.
                    </p>
                  </>
                ) : confirming === "mark" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div className={styles.noteWarn}>
                      <TriangleAlert />
                      <div>
                        Закрыть <b>{selected.size}</b> заказов как выкупленные? Каждому клиенту
                        уйдёт сообщение, что робуксы выданы. Отменить рассылку нельзя.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className={styles.buyButton} style={{ flex: 1 }} onClick={() => void markSelected()}>
                        <CheckCheck /> Да, закрываем
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => setConfirming(null)}>Отмена</button>
                    </div>
                  </div>
                ) : confirming === "buy" ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div className={styles.noteWarn}>
                      <TriangleAlert />
                      <div>
                        Купить <b>{selected.size}</b> геймпассов автоматически на <b>{rbx(selectedGross)}</b>?
                        Отменить покупку нельзя.
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className={styles.buyButton} style={{ flex: 1 }} onClick={() => void buySelected()}>
                        <ShoppingBasket /> Да, выкупаем
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => setConfirming(null)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button type="button" className={styles.buyButton} onClick={() => setConfirming("mark")}>
                      <CheckCheck /> Отметить купленными ({selected.size})
                    </button>
                    <p style={{ margin: 0, color: "var(--admin-muted)", fontSize: 12.5, lineHeight: 1.5 }}>
                      Для заказов, которые уже выкуплены руками по выгрузке: закроет их и
                      уведомит клиентов.
                    </p>
                    <div className={styles.divider} />
                    <div className={styles.detailRow}>
                      <span>Спишется с донора при авто-выкупе</span>
                      <strong className={styles.numeric}>{rbx(selectedGross)}</strong>
                    </div>
                    {shortfall != null && shortfall > 0 && (
                      <div className={styles.noteWarn}>
                        <TriangleAlert />
                        <div>
                          Выбрано на <b>{rbx(shortfall)}</b> больше, чем есть на балансе донора.
                        </div>
                      </div>
                    )}
                    <button type="button" className={styles.ghostButton} onClick={() => setConfirming("buy")}>
                      <ShoppingBasket /> Выкупить автоматически ({selected.size})
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          <section className={styles.panel}>
            <div className={styles.panelHeader}><strong>История пачек</strong><span>последние {data?.batches.length ?? 0}</span></div>
            <div className={styles.logList}>
              {(data?.batches ?? []).map((b) => (
                <div key={b.id} className={styles.logItem}>
                  <div className={cn(styles.logIcon, b.failCount > 0 ? styles.logIconWarning : styles.logIconSuccess)}>
                    <Wallet />
                  </div>
                  <div className={styles.logCopy}>
                    <strong>{b.accountName ?? "—"}</strong>
                    <span>
                      {b.okCount} ок{b.failCount > 0 && ` · ${b.failCount} ошибок`}
                      {!b.finishedAt && " · не завершена"}
                    </span>
                  </div>
                  <div className={styles.logMeta}>
                    <time>{dateTime(b.startedAt)}</time>
                    <b>− {rbx(b.totalGross)}</b>
                  </div>
                </div>
              ))}
              {(data?.batches.length ?? 0) === 0 && <div className={styles.empty}>Пачек ещё не было</div>}
            </div>
          </section>

          {(data?.drains.length ?? 0) > 0 && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}><strong>Сливы остатка</strong></div>
              <div className={styles.logList}>
                {(data?.drains ?? []).map((d) => (
                  <div key={d.id} className={styles.logItem}>
                    <div className={styles.logIcon}><Wallet /></div>
                    <div className={styles.logCopy}>
                      <strong>{d.donorName ?? "—"} → {d.drainName ?? "—"}</strong>
                      <span>{d.source === "auto" ? "автослив" : "вручную"}</span>
                    </div>
                    <div className={styles.logMeta}>
                      <time>{dateTime(d.createdAt)}</time>
                      <b>− {rbx(d.amount)}</b>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
