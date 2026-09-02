"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   «Заказы» на сайте — рабочее место, а не витрина (этапы В1–В5).

   Экран стоит на том же сервере, что и TWA: срезы, суммы и правила считает
   `/api/admin/orders` (он же `/api/twa/orders` под своим именем), а как заказ
   выглядит — решает общий `order-presentation`. Разными остаются только форма
   и способ работы: на сайте есть ширина, клавиатура и мультивыбор.

   Три вещи, которые здесь важнее красоты:

   1. Адрес — это состояние. Срез, сужение, режим и открытый заказ лежат в URL,
      поэтому ссылку на разбираемый заказ можно кинуть второму админу.
   2. Действие применяется сразу, а строка уезжает с анимацией. Отмена (⌘Z)
      предлагается только там, где у действия есть обратное: «Выкуплено»
      необратимо — клиенту уже ушло сообщение, и врать про отмену нельзя.
   3. Заморозка бьёт всё. У замороженного заказа кнопок выкупа нет вовсе,
      и в пачку он не попадает даже через «выделить все».
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ageBasis, ageTone, canComplete, fmtAge, grossOf, isHeld, laneOf,
  LANE_META, orderBadge, orderFlag, primaryActionFor,
} from "@/lib/order-presentation";
import type { LaneId } from "@/lib/order-presentation";
import type { OrderSlice, OrderSlicesPayload, SliceKey } from "@/lib/order-slices";
import OrderDossier from "./order-dossier";
import CommandPalette from "./command-palette";
import NewOrderDialog from "./new-order-dialog";
import {
  AdminOrder, EXTRA_TABS, LiveCheck, Narrow, num, OrdersResponse,
  SLICE_META, TONE_COLOR, clientLabel, contactHref, copyText, gamepassIdOf, gamepassIdsOf,
} from "./types";
import styles from "./orders.module.css";

const PAGE_SIZE = 50;
/** Живая проверка пасса идёт пачками по 30 — столько принимает роут. */
const LIVE_CHECK_BATCH = 30;

export interface WorkspaceProps {
  initialSlice: string;
  initialMode: "table" | "split";
  initialOrderId: string | null;
  initialQuery: string;
}

type Mode = "table" | "split";

interface Ask {
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  input: boolean;
  resolve: (value: string | null) => void;
}

interface Toast {
  text: string;
  error?: boolean;
  undo?: () => void;
}

export default function OrdersWorkspace({
  initialSlice, initialMode, initialOrderId, initialQuery,
}: WorkspaceProps) {
  const router = useRouter();

  const [slice, setSlice] = useState<string>(initialSlice);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [density, setDensity] = useState<"cozy" | "compact">("cozy");
  const [query, setQuery] = useState(initialQuery);
  const [narrow, setNarrow] = useState<Narrow>({});

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [slices, setSlices] = useState<OrderSlicesPayload | null>(null);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const [live, setLive] = useState<Record<string, LiveCheck>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(initialOrderId);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askValue, setAskValue] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const undoRef = useRef<null | (() => void)>(null);
  const lastClickedIndex = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  const openOrder = useMemo(() => orders.find(o => o.id === openId) ?? null, [orders, openId]);
  const cursorOrder = orders[cursor] ?? null;
  const currentSlice: OrderSlice | null =
    slices && (slices.slices as Record<string, OrderSlice>)[slice] ? (slices.slices as Record<string, OrderSlice>)[slice] : null;

  /** Счётчики и суммы среза считает сервер: после действия перечитываем их
      отдельным лёгким запросом, чтобы шапка не разошлась с лентой. */
  const refreshCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: slice, page: "1", limit: "1" });
      const res = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as OrdersResponse;
      if (data.counts) setCounts(data.counts);
      if (data.slices) setSlices(data.slices);
      setLoadedAt(Date.now());
    } catch { /* счётчики подтянутся при следующем действии */ }
  }, [slice]);

  /* ── Тосты и отмена ───────────────────────────────────────────────────── */

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    undoRef.current = next.undo ?? null;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      undoRef.current = null;
    }, next.error ? 7000 : 8000);
  }, []);

  const askFor = useCallback((options: Omit<Ask, "resolve">): Promise<string | null> => {
    setAskValue("");
    return new Promise(resolve => setAsk({ ...options, resolve }));
  }, []);

  const closeAsk = useCallback((value: string | null) => {
    setAsk(current => {
      current?.resolve(value);
      return null;
    });
  }, []);

  /* ── Загрузка ─────────────────────────────────────────────────────────── */

  const buildParams = useCallback((nextPage: number) => {
    const params = new URLSearchParams({ status: slice, page: String(nextPage), limit: String(PAGE_SIZE) });
    if (query.trim().length >= 2) params.set("q", query.trim());
    if (narrow.lane) params.set("lane", narrow.lane);
    if (narrow.age) params.set("age", narrow.age);
    if (narrow.amount) params.set("amount", String(narrow.amount));
    if (narrow.blocked) params.set("blocked", narrow.blocked);
    return params;
  }, [slice, query, narrow]);

  const load = useCallback(async (nextPage = 1, append = false) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/orders?${buildParams(nextPage)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Сессия истекла — войдите заново" : `Сервер ответил ${res.status}`);
      const data = (await res.json()) as OrdersResponse;
      if (seq !== requestSeq.current) return; // ответ на устаревший запрос
      setOrders(prev => (append ? [...prev, ...data.orders] : data.orders));
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
      setPage(data.page ?? nextPage);
      if (data.counts) setCounts(data.counts);
      if (data.slices) setSlices(data.slices);
      setLoadedAt(Date.now());
      if (!append) setCursor(0);
    } catch (error) {
      if (seq === requestSeq.current) showToast({ text: (error as Error).message, error: true });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void load(1, false);
    // Перечитываем на смену среза и сужения. `load` в зависимости не идёт: он
    // пересобирается от тех же значений, и эффект зациклился бы на себе.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice, narrow]);

  // Поиск набирается, а не отправляется: запрос уходит через паузу, чтобы
  // очередь не дёргалась на каждой букве.
  useEffect(() => {
    const id = setTimeout(() => { void load(1, false); }, 320);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /* ── Адрес как состояние ──────────────────────────────────────────────── */

  useEffect(() => {
    const params = new URLSearchParams();
    if (slice !== "BUYOUT") params.set("slice", slice);
    if (mode !== "split") params.set("mode", mode);
    if (openId) params.set("order", openId);
    if (query.trim()) params.set("q", query.trim());
    if (narrow.lane) params.set("lane", narrow.lane);
    if (narrow.age) params.set("age", narrow.age);
    if (narrow.amount) params.set("amount", String(narrow.amount));
    if (narrow.blocked) params.set("blocked", narrow.blocked);
    const suffix = params.toString();
    window.history.replaceState(null, "", suffix ? `/admin/orders?${suffix}` : "/admin/orders");
  }, [slice, mode, openId, query, narrow]);

  /* ── Живая проверка пассов ────────────────────────────────────────────── */

  useEffect(() => {
    const need = orders
      .filter(o => ["PENDING", "IN_PROGRESS", "ERROR"].includes(o.status) && (o.gamepassUrl || (o.splitGamepasses?.length ?? 0) > 0))
      .filter(o => !live[o.id])
      .slice(0, LIVE_CHECK_BATCH)
      .map(o => o.id);
    if (need.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "gp-live-check", orderIds: need }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.results) return;
        setLive(prev => ({ ...prev, ...data.results }));
      } catch { /* живая проверка необязательна: строка просто останется без флага */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  /* ── Действия ─────────────────────────────────────────────────────────── */

  const post = useCallback(async (payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> => {
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error ?? `Сервер ответил ${res.status}` };
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }, []);

  const markBusy = useCallback((id: string, value: boolean) => {
    setBusy(prev => {
      const next = new Set(prev);
      if (value) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  /** Убрать карточку из ленты с анимацией и поправить счётчики на месте. */
  const dropFromList = useCallback((id: string) => {
    setLeaving(prev => new Set(prev).add(id));
    setTimeout(() => {
      setOrders(prev => prev.filter(o => o.id !== id));
      setLeaving(prev => { const next = new Set(prev); next.delete(id); return next; });
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
      setOpenId(current => (current === id ? null : current));
      setCounts(prev => (prev[slice] ? { ...prev, [slice]: Math.max(0, prev[slice] - 1) } : prev));
      setTotal(prev => Math.max(0, prev - 1));
    }, 190);
  }, [slice]);

  interface RunOptions {
    /** Заказ уходит из среза — карточка уезжает, счётчики уменьшаются. */
    leaves?: boolean;
    /** Текст тоста. */
    label: string;
    /** Обратное действие, если оно существует. */
    inverse?: Record<string, unknown> | null;
    /** Патч, который применяется к заказу на месте (когда он остаётся в срезе). */
    patch?: Partial<AdminOrder>;
  }

  const run = useCallback(async (order: AdminOrder, payload: Record<string, unknown>, options: RunOptions) => {
    markBusy(order.id, true);
    const result = await post({ ...payload, orderId: order.id });
    markBusy(order.id, false);
    if (!result.ok) {
      showToast({ text: result.error ?? "Не получилось", error: true });
      return false;
    }
    if (options.patch) {
      setOrders(prev => prev.map(o => (o.id === order.id ? { ...o, ...options.patch } as AdminOrder : o)));
    }
    if (options.leaves) dropFromList(order.id);
    showToast({
      text: options.label,
      undo: options.inverse
        ? () => {
            void (async () => {
              const undone = await post({ ...options.inverse, orderId: order.id });
              if (!undone.ok) { showToast({ text: undone.error ?? "Отменить не вышло", error: true }); return; }
              setToast(null);
              void load(1, false);
            })();
          }
        : undefined,
    });
    // Счётчики и суммы среза считает сервер — после действия перечитываем их
    // в фоне, чтобы шапка не разошлась с лентой.
    void refreshCounts();
    return true;
  }, [post, showToast, dropFromList, markBusy, refreshCounts]);

  const complete = useCallback(async (order: AdminOrder) => {
    if (!canComplete(order)) return;
    await run(order, { action: "complete" }, {
      leaves: true,
      // Обратного действия нет намеренно: клиенту уже ушло «зачислено».
      label: `✓ ${order.wbCode} выкуплен · клиенту ушло сообщение`,
    });
  }, [run]);

  const restore = useCallback(async (order: AdminOrder) => {
    await run(order, { action: "restore-to-buyout" }, {
      leaves: slice === "ERROR",
      label: `↩ ${order.wbCode} вернулся в очередь выкупа`,
      inverse: { action: "set-error" },
    });
  }, [run, slice]);

  const toggleHold = useCallback(async (order: AdminOrder) => {
    if (order.heldAt) {
      await run(order, { action: "unhold" }, {
        leaves: slice === "HELD",
        label: `❄ ${order.wbCode} разморожен`,
        inverse: { action: "hold", reason: order.heldReason ?? "заморожен повторно" },
        patch: { heldAt: null, heldReason: null },
      });
      return;
    }
    const reason = await askFor({
      title: `Заморозить ${order.wbCode}`,
      message: "Заказ останется на месте, но выключится из выкупа, очередей и пачки. Причина видна оператору поддержки.",
      placeholder: "Например: спор по заказу на WB",
      confirmLabel: "Заморозить",
      input: true,
    });
    if (reason === null) return;
    await run(order, { action: "hold", reason }, {
      label: `❄ ${order.wbCode} заморожен`,
      inverse: { action: "unhold" },
      patch: { heldAt: new Date().toISOString(), heldReason: reason || "не указана" },
    });
  }, [run, slice, askFor]);

  const setError = useCallback(async (order: AdminOrder) => {
    await run(order, { action: "set-error" }, {
      leaves: slice === "BUYOUT",
      label: `⚠ ${order.wbCode} уехал в «Починить»`,
      inverse: { action: "restore-to-buyout" },
    });
  }, [run, slice]);

  const toggleFavorite = useCallback(async (order: AdminOrder) => {
    await run(order, { action: "toggle-favorite" }, {
      label: order.isFavorite ? `★ ${order.wbCode} убран из избранного` : `★ ${order.wbCode} в избранном`,
      inverse: { action: "toggle-favorite" },
      patch: { isFavorite: !order.isFavorite },
    });
  }, [run]);

  const cancelOrder = useCallback(async (order: AdminOrder) => {
    const reason = await askFor({
      title: `Отменить заказ ${order.wbCode}`,
      message: "Причина уйдёт клиенту и останется в карточке. Отменить это действие нельзя.",
      placeholder: "Причина отмены",
      confirmLabel: "Отменить заказ",
      danger: true,
      input: true,
    });
    if (reason === null) return;
    await run(order, { action: "reject", reason: reason || "не указана" }, {
      leaves: true,
      label: `✕ ${order.wbCode} отменён · клиенту ушло сообщение`,
    });
  }, [run, askFor]);

  /** Главное действие строки — одно на состояние заказа. */
  const runPrimary = useCallback(async (order: AdminOrder) => {
    const action = primaryActionFor(order);
    if (!action) return;
    if (action.kind === "contact") {
      const href = contactHref(order);
      if (href) window.open(href, "_blank", "noopener");
      else showToast({ text: "У клиента нет ни @username, ни VK — писать некуда", error: true });
      return;
    }
    if (action.action === "complete") { await complete(order); return; }
    if (action.action === "restore-to-buyout") { await restore(order); return; }
    if (action.action === "unhold") { await toggleHold(order); return; }
  }, [complete, restore, toggleHold, showToast]);

  /* ── Выделение ────────────────────────────────────────────────────────── */

  const toggleSelect = useCallback((order: AdminOrder, index: number, range: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (range && lastClickedIndex.current !== null) {
        const [from, to] = [lastClickedIndex.current, index].sort((a, b) => a - b);
        for (let i = from; i <= to; i += 1) {
          const candidate = orders[i];
          // ❄️ Замороженный заказ не попадает в пачку даже диапазоном.
          if (candidate && !isHeld(candidate)) next.add(candidate.id);
        }
      } else if (next.has(order.id)) {
        next.delete(order.id);
      } else if (!isHeld(order)) {
        next.add(order.id);
      }
      return next;
    });
    lastClickedIndex.current = index;
  }, [orders]);

  const selectedOrders = useMemo(
    () => orders.filter(o => selected.has(o.id)),
    [orders, selected],
  );
  const selectedGross = useMemo(
    () => selectedOrders.reduce((sum, o) => sum + grossOf(o.amount), 0),
    [selectedOrders],
  );
  const completableSelected = useMemo(
    () => selectedOrders.filter(canComplete),
    [selectedOrders],
  );

  const bulkComplete = useCallback(async () => {
    if (completableSelected.length === 0) return;
    const gross = completableSelected.reduce((sum, o) => sum + grossOf(o.amount), 0);
    const confirmed = await askFor({
      title: `Отметить выкупленными: ${completableSelected.length}`,
      message: `На ${num(gross)} R$ грязными. Каждому клиенту уйдёт сообщение о зачислении — отменить это нельзя.`,
      confirmLabel: `Отметить ${completableSelected.length}`,
      input: false,
    });
    if (confirmed === null) return;
    let done = 0;
    for (const order of completableSelected) {
      markBusy(order.id, true);
      const result = await post({ action: "complete", orderId: order.id });
      markBusy(order.id, false);
      if (result.ok) { done += 1; dropFromList(order.id); }
      else showToast({ text: `${order.wbCode}: ${result.error}`, error: true });
    }
    if (done > 0) showToast({ text: `✓ Выкуплено ${done} · клиентам ушли сообщения` });
    setSelected(new Set());
    void refreshCounts();
  }, [completableSelected, askFor, post, markBusy, dropFromList, showToast, refreshCounts]);

  const bulkHold = useCallback(async () => {
    const reason = await askFor({
      title: `Заморозить заказов: ${selectedOrders.length}`,
      message: "Одна причина на всю пачку. Заказы выключатся из выкупа, но останутся на месте.",
      placeholder: "Причина заморозки",
      confirmLabel: "Заморозить",
      input: true,
    });
    if (reason === null) return;
    let done = 0;
    for (const order of selectedOrders) {
      const result = await post({ action: "hold", orderId: order.id, reason });
      if (result.ok) done += 1;
    }
    showToast({ text: `❄ Заморожено ${done}` });
    setSelected(new Set());
    void load(1, false);
  }, [selectedOrders, askFor, post, showToast, load]);

  const bulkError = useCallback(async () => {
    let done = 0;
    for (const order of selectedOrders) {
      const result = await post({ action: "set-error", orderId: order.id });
      if (result.ok) { done += 1; if (slice === "BUYOUT") dropFromList(order.id); }
    }
    showToast({ text: `⚠ В «Починить» отправлено ${done}` });
    setSelected(new Set());
    void refreshCounts();
  }, [selectedOrders, post, showToast, slice, dropFromList, refreshCounts]);

  /** ID выделенных заказов — списком для донора. */
  const copySelectedIds = useCallback(() => {
    const ids = selectedOrders.flatMap(gamepassIdsOf);
    if (ids.length === 0) { showToast({ text: "У выделенных заказов нет геймпассов", error: true }); return; }
    copyText(ids.join("\n"));
    showToast({ text: `⧉ Скопировано ID: ${ids.length}` });
  }, [selectedOrders, showToast]);

  /** Выгрузка ID всего среза — считает сервер, не загруженная страница. */
  const exportSliceIds = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/orders?status=${slice}&export=gamepass-ids`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      const data = await res.json();
      const items: { gamepassId: string; wbCode: string; expectedPrice: number; robloxUsername: string | null }[] = data.items ?? [];
      if (items.length === 0) { showToast({ text: "В этом срезе нечего выгружать", error: true }); return; }
      const text = items.map(item => `${item.gamepassId} · ${item.expectedPrice} R$ · ${item.wbCode}${item.robloxUsername ? ` · ${item.robloxUsername}` : ""}`).join("\n");
      copyText(text);
      showToast({ text: `↓ ${items.length} ID в буфере · ${num(data.totalGrossRobux ?? 0)} R$ грязными` });
    } catch (error) {
      showToast({ text: (error as Error).message, error: true });
    }
  }, [slice, showToast]);

  const selectFitDonor = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/buyout/donor", { cache: "no-store" });
      if (!res.ok) throw new Error("Баланс донора недоступен");
      const data = await res.json();
      const balance = Number(data?.balance ?? data?.robux ?? 0);
      if (!Number.isFinite(balance) || balance <= 0) throw new Error("Баланс донора не прочитался");
      const next = new Set<string>();
      let spent = 0;
      for (const order of orders) {
        if (!canComplete(order)) continue;
        const price = grossOf(order.amount);
        if (spent + price > balance) continue;
        next.add(order.id);
        spent += price;
      }
      setSelected(next);
      showToast({ text: `Набрано ${next.size} на ${num(spent)} R$ · баланс ${num(balance)} R$` });
    } catch (error) {
      showToast({ text: (error as Error).message, error: true });
    }
  }, [orders, showToast]);

  /* ── Клавиатура ───────────────────────────────────────────────────────── */

  const chord = useRef<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(open => !open);
        return;
      }
      if (typing || ask || paletteOpen) return;

      if (meta && event.key.toLowerCase() === "z") {
        if (undoRef.current) { event.preventDefault(); undoRef.current(); }
        return;
      }
      if (meta && event.key === "Enter") {
        if (cursorOrder) { event.preventDefault(); void complete(cursorOrder); }
        return;
      }
      if (meta) return;

      // Аккорды перехода: G + буква раздела.
      if (chord.current === "g") {
        chord.current = null;
        const routes: Record<string, string> = {
          o: "/admin/orders", b: "/admin/buyout", d: "/admin/wildberries/delivery",
          h: "/admin", u: "/admin/users", a: "/admin/activity",
        };
        const href = routes[event.key.toLowerCase()];
        if (href) { event.preventDefault(); router.push(href); return; }
      }

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setCursor(index => Math.min(orders.length - 1, index + 1));
          return;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setCursor(index => Math.max(0, index - 1));
          return;
        case "Enter":
          if (cursorOrder) { event.preventDefault(); setOpenId(cursorOrder.id); setMode("split"); }
          return;
        case " ":
          if (cursorOrder) { event.preventDefault(); toggleSelect(cursorOrder, cursor, false); }
          return;
        case "Escape":
          event.preventDefault();
          if (createOpen) setCreateOpen(false);
          else if (helpOpen) setHelpOpen(false);
          else if (filtersOpen) setFiltersOpen(false);
          else if (openId) setOpenId(null);
          else if (selected.size > 0) setSelected(new Set());
          return;
        case "?":
          event.preventDefault();
          setHelpOpen(open => !open);
          return;
        case "g":
          chord.current = "g";
          setTimeout(() => { chord.current = null; }, 1200);
          return;
        default:
          break;
      }

      const key = event.key.toLowerCase();
      if (key === "r" && cursorOrder?.status === "ERROR") { event.preventDefault(); void restore(cursorOrder); return; }
      if (key === "f" && cursorOrder) { event.preventDefault(); void toggleHold(cursorOrder); return; }
      if (key === "e" && cursorOrder) { event.preventDefault(); void setError(cursorOrder); return; }
      if (key === "c" && cursorOrder) {
        event.preventDefault();
        if (event.shiftKey) { copyText(cursorOrder.wbCode); showToast({ text: `⧉ ${cursorOrder.wbCode}` }); return; }
        const ids = gamepassIdsOf(cursorOrder);
        if (ids.length === 0) { showToast({ text: "У заказа нет геймпасса", error: true }); return; }
        copyText(ids.join("\n"));
        showToast({ text: ids.length > 1 ? `⧉ ${ids.length} ID пассов` : `⧉ ${ids[0]}` });
        return;
      }
      const sliceIndex = ["1", "2", "3", "4"].indexOf(event.key);
      if (sliceIndex >= 0) {
        event.preventDefault();
        setSlice(SLICE_META[sliceIndex].key);
        setNarrow({});
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [orders, cursor, cursorOrder, openId, selected, ask, paletteOpen, filtersOpen, helpOpen, createOpen,
      complete, restore, toggleHold, setError, toggleSelect, showToast, router]);

  // Курсор клавиатуры не должен уезжать за экран.
  useEffect(() => {
    const node = document.querySelector<HTMLElement>(`[data-order-index="${cursor}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  /* ── Сужение из полосы среза ──────────────────────────────────────────── */

  const toggleNarrow = useCallback((patch: Narrow) => {
    setNarrow(prev => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(patch) as [keyof Narrow, string | number | null][]) {
        next[key] = prev[key] === value ? null : (value as never);
      }
      return next;
    });
  }, []);

  const narrowChips = useMemo(() => {
    const chips: { label: string; clear: () => void }[] = [];
    // Поиск живёт в палитре, но заказ мог быть открыт по старой ссылке `?q=` —
    // тогда запрос обязан быть виден и сниматься одним нажатием.
    if (query.trim()) chips.push({ label: `поиск «${query.trim()}»`, clear: () => setQuery("") });
    if (narrow.lane) chips.push({ label: LANE_META[narrow.lane as LaneId]?.label ?? narrow.lane, clear: () => setNarrow(n => ({ ...n, lane: null })) });
    if (narrow.age) {
      const bucket = currentSlice?.age.buckets.find(b => b.id === narrow.age);
      chips.push({ label: bucket ? `возраст ${bucket.label}` : "возраст", clear: () => setNarrow(n => ({ ...n, age: null })) });
    }
    if (narrow.amount) chips.push({ label: `${num(narrow.amount)} R$`, clear: () => setNarrow(n => ({ ...n, amount: null })) });
    if (narrow.blocked) {
      const labels: Record<string, string> = { regional: "рег. цена", split: "разбитые", nogp: "без геймпасса" };
      chips.push({ label: labels[narrow.blocked] ?? narrow.blocked, clear: () => setNarrow(n => ({ ...n, blocked: null })) });
    }
    return chips;
  }, [narrow, currentSlice, query]);

  /* ── Рендер ───────────────────────────────────────────────────────────── */

  // Две панели — только там, где для них есть ширина. На телефоне досье
  // открывается поверх ленты, а «Таблицы» просто нет.
  const twoPane = mode === "split" && !isPhone;
  const showDossier = !!openOrder && (mode === "split" || isPhone);
  const split = twoPane || showDossier;
  const asCards = isPhone || mode === "split";

  return (
    <div className={styles.workspace} data-density={density}>
      <header className={styles.bar}>
        <div className={styles.slices} role="tablist" aria-label="Срезы заказов">
          {SLICE_META.map(item => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={slice === item.key}
              title={item.hint}
              className={`${styles.slice} ${slice === item.key ? styles.sliceOn : ""}`}
              onClick={() => { setSlice(item.key); setNarrow({}); }}
            >
              {item.key !== "BUYOUT" && <i style={{ background: TONE_COLOR[item.tone] }} />}
              {item.label}
              {counts[item.key] != null && <b>{num(counts[item.key])}</b>}
            </button>
          ))}
        </div>

        <span className={styles.spacer} />

        <button type="button" className={styles.chip} onClick={() => setPaletteOpen(true)}>
          🔍 Поиск и команды <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className={`${styles.chip} ${EXTRA_TABS.some(t => t.key === slice) ? styles.chipOn : ""}`}
          onClick={() => setFiltersOpen(true)}
        >
          Фильтры
        </button>
        <div className={`${styles.seg} ${styles.barDesktopOnly}`} role="group" aria-label="Режим списка">
          <button type="button" className={mode === "table" ? styles.segOn : ""} onClick={() => setMode("table")}>Таблица</button>
          <button type="button" className={mode === "split" ? styles.segOn : ""} onClick={() => setMode("split")}>Список + досье</button>
        </div>
        <button
          type="button"
          className={`${styles.chip} ${styles.barDesktopOnly}`}
          onClick={() => setDensity(d => (d === "cozy" ? "compact" : "cozy"))}
        >
          {density === "cozy" ? "Просторно" : "Плотно"}
        </button>
        <button type="button" className={`${styles.chip} ${styles.chipPrimary}`} onClick={() => setCreateOpen(true)}>
          + Заказ
        </button>
      </header>

      {currentSlice && (
        <SliceStrip
          slice={currentSlice}
          sliceKey={slice as SliceKey}
          today={slices?.today ?? { done: 0, doneSum: 0, arrived: 0 }}
          narrow={narrow}
          loadedAt={loadedAt}
          onNarrow={toggleNarrow}
          onExport={exportSliceIds}
          onRefresh={() => void load(1, false)}
        />
      )}

      {narrowChips.length > 0 && (
        <div className={styles.narrowRow}>
          <span>Сужено:</span>
          {narrowChips.map(chip => (
            <button key={chip.label} type="button" className={styles.narrowChip} onClick={chip.clear}>
              {chip.label} ✕
            </button>
          ))}
          <button type="button" className={styles.chip} onClick={() => setNarrow({})}>Снять всё</button>
        </div>
      )}

      <div className={styles.panes} data-split={split ? "1" : "0"}>
        <div className={styles.listPane}>
          {!asCards && (
            <div className={styles.thead} aria-hidden="true">
              <span />
              <span>Ист.</span>
              <span>Код ВБ</span>
              <span>Ник Roblox</span>
              <span>Клиент</span>
              <span style={{ textAlign: "right" }}>Грязные</span>
              <span style={{ textAlign: "right" }}>Чистые</span>
              <span>Возр.</span>
              <span>Проверка пасса</span>
              <span>ID пасса</span>
              <span />
            </div>
          )}

          {loading && orders.length === 0 && <div className={styles.loading}>Загружаем очередь…</div>}

          {!loading && orders.length === 0 && (
            <div className={styles.empty}>
              <strong>{slice === "BUYOUT" ? "Очередь выкупа пуста" : "В этом срезе пусто"}</strong>
              {slices?.today ? `Сегодня выкуплено ${slices.today.done} на ${num(slices.today.doneSum)} R$` : "Ничего не ждёт разбора"}
            </div>
          )}

          {!asCards
            ? orders.map((order, index) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  index={index}
                  live={live[order.id]}
                  selected={selected.has(order.id)}
                  cursor={cursor === index}
                  open={openId === order.id}
                  busy={busy.has(order.id)}
                  leaving={leaving.has(order.id)}
                  onSelect={toggleSelect}
                  onOpen={() => { setCursor(index); setOpenId(order.id); setMode("split"); }}
                  onPrimary={() => void runPrimary(order)}
                  onCopyIds={() => {
                    const ids = gamepassIdsOf(order);
                    if (ids.length === 0) { showToast({ text: "У заказа нет геймпасса", error: true }); return; }
                    copyText(ids.join("\n"));
                    showToast({ text: ids.length > 1 ? `⧉ ${ids.length} ID пассов` : `⧉ ${ids[0]}` });
                  }}
                />
              ))
            : (
              <div className={styles.cards}>
                {orders.map((order, index) => (
                  <QueueCard
                    key={order.id}
                    order={order}
                    index={index}
                    live={live[order.id]}
                    selected={selected.has(order.id)}
                    cursor={cursor === index}
                    open={openId === order.id}
                    busy={busy.has(order.id)}
                    leaving={leaving.has(order.id)}
                    onOpen={() => { setCursor(index); setOpenId(order.id); setMode("split"); }}
                    onPrimary={() => void runPrimary(order)}
                  />
                ))}
              </div>
            )}

          {page < pages && (
            <div className={styles.more}>
              <button type="button" className={styles.chip} onClick={() => void load(page + 1, true)} disabled={loading}>
                {loading ? "Грузим…" : `Показать ещё · всего ${num(total)}`}
              </button>
            </div>
          )}
        </div>

        {showDossier && openOrder && (
          <OrderDossier
            order={openOrder}
            live={live[openOrder.id]}
            onClose={() => setOpenId(null)}
            onPrimary={() => void runPrimary(openOrder)}
            onHold={() => void toggleHold(openOrder)}
            onError={() => void setError(openOrder)}
            onFavorite={() => void toggleFavorite(openOrder)}
            onCancel={() => void cancelOrder(openOrder)}
            onToast={(text, error) => showToast({ text, error })}
            onChanged={() => void load(1, false)}
          />
        )}

        {twoPane && !openOrder && (
          <div className={styles.dossier}>
            <div className={styles.dossierEmpty}>
              <strong>Выберите заказ</strong>
              <span>Клик по строке или <b>↵</b> откроет досье рядом с очередью — список останется на месте.</span>
              <span>Разбирать очередь удобнее с клавиатуры: <b>J</b> и <b>K</b> ходят по заказам, <b>?</b> покажет остальное.</span>
            </div>
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className={styles.bulk} role="region" aria-label="Действия над выделенными заказами">
          <span className={styles.bulkCount}>Выбрано {selected.size}</span>
          <span className={styles.bulkSum}>{num(selectedGross)} R$ грязными · готовы к выкупу {completableSelected.length}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.mini} onClick={copySelectedIds}>⧉ ID пассов</button>
          <button type="button" className={styles.mini} onClick={() => void selectFitDonor()}>Набрать под баланс</button>
          <button type="button" className={styles.mini} onClick={() => void bulkHold()}>❄ Заморозить</button>
          <button type="button" className={styles.mini} onClick={() => void bulkError()}>⚠ В «Починить»</button>
          <button
            type="button"
            className={`${styles.mini} ${styles.miniPrimary}`}
            onClick={() => void bulkComplete()}
            disabled={completableSelected.length === 0}
          >
            ✓ Выкуплено ×{completableSelected.length}
          </button>
          <button type="button" className={styles.miniQuiet + " " + styles.mini} onClick={() => setSelected(new Set())} aria-label="Снять выделение">✕</button>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.error ? styles.toastError : ""}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" className={styles.toastUndo} onClick={toast.undo}>Отменить ⌘Z</button>
          )}
        </div>
      )}

      {ask && (
        <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && closeAsk(null)}>
          <div className={styles.ask} role="dialog" aria-modal="true">
            <h3>{ask.title}</h3>
            {ask.message && <p>{ask.message}</p>}
            {ask.input && (
              <input
                autoFocus
                value={askValue}
                placeholder={ask.placeholder}
                onChange={event => setAskValue(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter") closeAsk(askValue); if (event.key === "Escape") closeAsk(null); }}
              />
            )}
            <div className={styles.askActions}>
              <button type="button" className={styles.btn} onClick={() => closeAsk(null)}>Отмена</button>
              <button
                type="button"
                className={`${styles.btn} ${ask.danger ? "" : styles.btnPrimary}`}
                style={ask.danger ? { color: "#ffc0ba", borderColor: "rgba(255,107,96,.45)" } : undefined}
                autoFocus={!ask.input}
                onClick={() => closeAsk(ask.input ? askValue : "")}
              >
                {ask.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {filtersOpen && (
        <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && setFiltersOpen(false)}>
          <div className={styles.ask} role="dialog" aria-modal="true" aria-label="Фильтры">
            <h3>Фильтры</h3>
            <p>Всё, что не является ежедневной работой. Выбор заменяет срез.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {EXTRA_TABS.map(tab => (
                <button
                  key={tab.key}
                  type="button"
                  className={`${styles.chip} ${slice === tab.key ? styles.chipOn : ""}`}
                  onClick={() => { setSlice(tab.key); setNarrow({}); setFiltersOpen(false); }}
                >
                  {tab.label}
                  {counts[tab.key] != null && <b style={{ opacity: .6 }}>{num(counts[tab.key])}</b>}
                </button>
              ))}
            </div>
            <div className={styles.askActions}>
              <button type="button" className={styles.btn} onClick={() => setFiltersOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && setHelpOpen(false)}>
          <div className={styles.ask} role="dialog" aria-modal="true" aria-label="Клавиатура">
            <h3>Клавиатура</h3>
            <p>Безопасное — одной клавишей, необратимое — с модификатором.</p>
            <div style={{ display: "grid", gap: 7, fontSize: 13.5 }}>
              {[
                ["J / K", "следующий и предыдущий заказ"],
                ["↵", "открыть досье рядом со списком"],
                ["Space", "выделить для пачки"],
                ["⌘ ↵", "отметить выкупленным"],
                ["R", "вернуть к выкупу"],
                ["E", "пометить ошибкой"],
                ["F", "заморозить / разморозить"],
                ["C", "скопировать ID геймпасса"],
                ["⇧ C", "скопировать код ВБ"],
                ["⌘ Z", "отменить последнее действие"],
                ["1…4", "переключить срез"],
                ["⌘ K", "поиск и команды"],
                ["G затем O / B / D", "перейти в Заказы / Выкуп / Доставку"],
                ["?", "эта шпаргалка"],
              ].map(([keys, what]) => (
                <div key={keys} style={{ display: "flex", gap: 12 }}>
                  <b style={{ minWidth: 132, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>{keys}</b>
                  <span style={{ color: "var(--o-muted)" }}>{what}</span>
                </div>
              ))}
            </div>
            <div className={styles.askActions}>
              <button type="button" className={styles.btn} onClick={() => setHelpOpen(false)}>Понятно</button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <NewOrderDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void load(1, false); }}
          onToast={(text, error) => showToast({ text, error })}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          slice={slice}
          cursorOrder={cursorOrder}
          onClose={() => setPaletteOpen(false)}
          onOpenOrder={id => { setOpenId(id); setMode("split"); setPaletteOpen(false); }}
          onSlice={next => { setSlice(next); setNarrow({}); setPaletteOpen(false); }}
          onCommand={async command => {
            setPaletteOpen(false);
            if (command === "export") await exportSliceIds();
            if (command === "complete" && cursorOrder) await complete(cursorOrder);
            if (command === "hold" && cursorOrder) await toggleHold(cursorOrder);
            if (command === "copy-id" && cursorOrder) {
              const ids = gamepassIdsOf(cursorOrder);
              if (ids.length > 0) { copyText(ids.join("\n")); showToast({ text: `⧉ ${ids.join(", ")}` }); }
            }
            if (command === "help") setHelpOpen(true);
          }}
        />
      )}
    </div>
  );
}

/* ── Полоса среза ─────────────────────────────────────────────────────────── */

function SliceStrip({
  slice, sliceKey, today, narrow, loadedAt, onNarrow, onExport, onRefresh,
}: {
  slice: OrderSlice;
  sliceKey: SliceKey;
  today: { done: number; doneSum: number; arrived: number };
  narrow: Narrow;
  loadedAt: number | null;
  onNarrow: (patch: Narrow) => void;
  onExport: () => void;
  onRefresh: () => void;
}) {
  const laneTotal = Math.max(1, slice.lanes.reduce((sum, lane) => sum + lane.gross, 0));
  const maxBucket = Math.max(1, ...slice.age.buckets.map(bucket => bucket.count));
  const queueDelta = today.arrived - today.done;

  return (
    <div className={styles.strip}>
      <div className={styles.cell}>
        <div className={styles.cellKey}>
          Деньги среза
          <button type="button" className={styles.refresh} onClick={onRefresh}>
            {loadedAt ? `обновлено ${new Date(loadedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} ⟳` : "⟳"}
          </button>
        </div>
        <div className={styles.cellBig}>{num(slice.gross)}<small>R$ грязными</small></div>
        <div className={styles.cellSub}><b>{num(slice.clean)} R$</b> чистыми клиенту · {num(slice.orders)} заказов</div>
      </div>

      <div className={styles.cell}>
        <div className={styles.cellKey}>Откуда</div>
        <div className={styles.lanes}>
          {slice.lanes.map(lane => (
            <i
              key={lane.id}
              style={{ flex: Math.max(1, Math.round((lane.gross / laneTotal) * 100)), background: TONE_COLOR[LANE_META[lane.id].tone] }}
            />
          ))}
        </div>
        <div className={styles.laneLegend}>
          {slice.lanes.map(lane => (
            <button
              key={lane.id}
              type="button"
              onClick={() => onNarrow({ lane: lane.id })}
              style={narrow.lane === lane.id ? { color: "#fff" } : undefined}
            >
              <i style={{ background: TONE_COLOR[LANE_META[lane.id].tone] }} />
              {LANE_META[lane.id].label} <b>{lane.orders}</b>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.cellKey}>Что мешает</div>
        <div className={styles.cellBig}>{num(slice.ready)}<small>готовы из {num(slice.orders)}</small></div>
        <div className={styles.tags}>
          {slice.blocked.regional > 0 && (
            <button type="button" className={`${styles.tag} ${styles.tagRed} ${narrow.blocked === "regional" ? styles.tagOn : ""}`} onClick={() => onNarrow({ blocked: "regional" })}>
              🌍 {slice.blocked.regional} рег. цена
            </button>
          )}
          {slice.blocked.splitPartial > 0 && (
            <button type="button" className={`${styles.tag} ${narrow.blocked === "split" ? styles.tagOn : ""}`} onClick={() => onNarrow({ blocked: "split" })}>
              🧩 {slice.blocked.splitPartial} разбит
            </button>
          )}
          {slice.blocked.noGamepass > 0 && (
            <button type="button" className={`${styles.tag} ${styles.tagAmber} ${narrow.blocked === "nogp" ? styles.tagOn : ""}`} onClick={() => onNarrow({ blocked: "nogp" })}>
              ⚠ {slice.blocked.noGamepass} без пасса
            </button>
          )}
          {slice.blocked.regional + slice.blocked.splitPartial + slice.blocked.noGamepass === 0 && (
            <span className={styles.tag}>ничего не держит</span>
          )}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.cellKey}>Что горит</div>
        <div className={styles.hist}>
          {slice.age.buckets.map((bucket, index) => (
            <button key={bucket.id} type="button" onClick={() => onNarrow({ age: bucket.id })} title={`${bucket.label}: ${bucket.count}`}>
              <b>{bucket.count}</b>
              <i
                style={{
                  height: `${Math.max(3, Math.round((bucket.count / maxBucket) * 26))}px`,
                  background: index >= 2 ? (index === 3 ? "var(--o-red)" : "var(--o-orange)") : "var(--o-green)",
                  opacity: narrow.age && narrow.age !== bucket.id ? .4 : 1,
                }}
              />
              <span>{bucket.label}</span>
            </button>
          ))}
        </div>
        <div className={styles.cellSub}>
          {slice.age.oldestCode ? <>старейший <b>{slice.age.oldestCode}</b> · {fmtAge(slice.age.oldestAt)}</> : "очередь ровная"}
        </div>
      </div>

      <div className={styles.cell}>
        <div className={styles.cellKey}>День</div>
        <div className={styles.cellBig}>{num(today.done)}<small>выкуплено на {num(today.doneSum)} R$</small></div>
        <div className={styles.cellSub}>
          пришло <b>{num(today.arrived)}</b> · очередь{" "}
          <b style={{ color: queueDelta <= 0 ? "var(--o-green)" : "var(--o-orange)" }}>
            {queueDelta > 0 ? `+${queueDelta}` : queueDelta}
          </b>
        </div>
        {(sliceKey === "BUYOUT" || sliceKey === "ERROR") && (
          <button type="button" className={styles.tag} style={{ marginTop: 8 }} onClick={onExport}>
            ↓ Выгрузить ID · {num(slice.exportable)}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Строка таблицы ───────────────────────────────────────────────────────── */

function OrderRow({
  order, index, live, selected, cursor, open, busy, leaving, onSelect, onOpen, onPrimary, onCopyIds,
}: {
  order: AdminOrder;
  index: number;
  live?: LiveCheck;
  selected: boolean;
  cursor: boolean;
  open: boolean;
  busy: boolean;
  leaving: boolean;
  onSelect: (order: AdminOrder, index: number, range: boolean) => void;
  onOpen: () => void;
  onPrimary: () => void;
  onCopyIds: () => void;
}) {
  const lane = laneOf(order);
  const flag = orderFlag(order, live, order.remindersSent ?? 0, { splitProgress: true });
  const action = primaryActionFor(order);
  const basis = ageBasis(order);
  const ids = gamepassIdOf(order);
  const parts = order.splitGamepasses ?? [];

  return (
    <div
      data-order-index={index}
      className={[
        styles.row,
        selected ? styles.rowSelected : "",
        cursor ? styles.rowCursor : "",
        open ? styles.rowOpen : "",
        busy ? styles.rowBusy : "",
        leaving ? styles.rowLeaving : "",
      ].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        aria-label={selected ? "Убрать из пачки" : "Добавить в пачку"}
        className={`${styles.check} ${selected ? styles.checkOn : ""}`}
        onClick={event => onSelect(order, index, event.shiftKey)}
        disabled={isHeld(order)}
        title={isHeld(order) ? "Замороженный заказ в пачку не попадает" : undefined}
      >
        ✓
      </button>
      <span className={styles.lane} style={{ color: TONE_COLOR[LANE_META[lane].tone] }}>{LANE_META[lane].label}</span>
      <button type="button" className={styles.code} onClick={onOpen}>{order.wbCode}</button>
      <button type="button" className={`${styles.nick} ${!order.robloxUsername && order.probableNick ? styles.nickProbable : ""}`} onClick={onOpen}>
        {order.robloxUsername ?? order.probableNick ?? "ник не указан"}
      </button>
      <span className={styles.client}>{clientLabel(order)}</span>
      <span className={styles.money}>{num(grossOf(order.amount))}<small>R$</small></span>
      <span className={styles.moneyDim}>{num(order.amount)}</span>
      <span className={styles.age} style={{ color: TONE_COLOR[ageTone(basis)] }}>{fmtAge(basis)}</span>
      <span className={styles.flag} style={{ color: flag ? TONE_COLOR[flag.tone] : "var(--o-muted)" }} title={flag?.text}>
        {flag?.text ?? "—"}
      </span>
      <span className={styles.gpid}>{parts.length > 0 ? `${parts.length} ID пассов` : ids ?? "—"}</span>
      <span className={styles.rowActions}>
        {action && (
          <button
            type="button"
            className={`${styles.mini} ${action.tone === "green" ? styles.miniPrimary : action.tone === "ice" ? styles.miniIce : styles.miniBlue}`}
            onClick={onPrimary}
          >
            {action.icon} {action.label}
          </button>
        )}
        {(ids || parts.length > 0) && (
          <button type="button" className={`${styles.mini} ${styles.miniQuiet}`} onClick={onCopyIds} aria-label="Скопировать ID геймпасса">⧉</button>
        )}
        <button type="button" className={`${styles.mini} ${styles.miniQuiet}`} onClick={onOpen} aria-label="Открыть досье">›</button>
      </span>
    </div>
  );
}

/* ── Карточка очереди ─────────────────────────────────────────────────────── */

function QueueCard({
  order, index, live, selected, cursor, open, busy, leaving, onOpen, onPrimary,
}: {
  order: AdminOrder;
  index: number;
  live?: LiveCheck;
  selected: boolean;
  cursor: boolean;
  open: boolean;
  busy: boolean;
  leaving: boolean;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  const lane = laneOf(order);
  const badge = orderBadge(order);
  const flag = orderFlag(order, live, order.remindersSent ?? 0, { splitProgress: true });
  const action = primaryActionFor(order);
  const basis = ageBasis(order);

  return (
    <div
      data-order-index={index}
      className={[
        styles.card,
        selected ? styles.cardSelected : "",
        cursor ? styles.cardCursor : "",
        open ? styles.cardOpen : "",
        busy ? styles.rowBusy : "",
        leaving ? styles.rowLeaving : "",
      ].filter(Boolean).join(" ")}
    >
      <button type="button" className={styles.cardTop} onClick={onOpen} style={{ width: "100%" }}>
        <span style={{ color: TONE_COLOR[LANE_META[lane].tone] }}>{LANE_META[lane].label}</span>
        <span className={styles.age} style={{ color: TONE_COLOR[ageTone(basis)] }}>{fmtAge(basis)}</span>
        {badge && <span style={{ color: TONE_COLOR[badge.tone] }}>{badge.label}</span>}
        <span className={styles.code} style={{ marginLeft: "auto" }}>{order.wbCode}</span>
      </button>
      <button type="button" className={styles.cardMain} onClick={onOpen} style={{ width: "100%" }}>
        <strong className={!order.robloxUsername && order.probableNick ? styles.nickProbable : ""}>
          {order.robloxUsername ?? order.probableNick ?? "ник не указан"}
        </strong>
        <b>{num(grossOf(order.amount))}<small>R$</small></b>
      </button>
      <div className={styles.cardMeta}>
        <span>{num(order.amount)} чистыми</span>
        <span>{clientLabel(order)}</span>
        {flag && <span className={styles.flag} style={{ color: TONE_COLOR[flag.tone] }}>{flag.text}</span>}
      </div>
      {action && (
        <div className={styles.cardActions}>
          <button
            type="button"
            className={`${styles.mini} ${action.tone === "green" ? styles.miniPrimary : action.tone === "ice" ? styles.miniIce : styles.miniBlue}`}
            onClick={onPrimary}
          >
            {action.icon} {action.label}
          </button>
          <button type="button" className={styles.mini} onClick={onOpen}>Досье</button>
        </div>
      )}
    </div>
  );
}
