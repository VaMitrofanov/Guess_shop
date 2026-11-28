"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import { copyText } from "./clipboard";
import { fitToBalance } from "@/lib/buyout-packing";

/* ─────────────────────────────────────────────────────────────────────────────
   🛒 Выкуп по одному (16.11.2026, редизайн v2, одобрено владельцем).

   Главная работа смены — скопировать ID, купить в аккаунте, отметить. В ленте
   это девяносто карточек и прицеливание пальцем; здесь — один заказ на весь
   экран: огромный ID (тап — скопировать и сразу сверить цену с Roblox),
   «Выкуплено → дальше», «Пропустить», «Проблема» (открыть карточку).

   Баланс аккаунта сверху: выбрал 2 000 — в работе только заказы, которые в
   него влезают (`fitToBalance`, тот же расчёт, что на сайте в «Выкупе»).

   «Выкуплено» шлёт клиенту уведомление, поэтому срабатывает через UNDO_MS с
   кнопкой «Отменить» — как в «Первым делом».
   ───────────────────────────────────────────────────────────────────────── */

interface Item {
  orderId: string;
  wbCode: string;
  gamepassId: string;
  amount: number;
  expectedPrice: number;
  orderSource: string;
  robloxUsername: string | null;
  waitingHours: number;
}

const UNDO_MS = 4_000;
const BALANCES = [0, 2000, 3000, 5000] as const;
const SOURCE: Record<string, string> = { WB: "Wildberries", WB_DBS: "WB DBS", DIRECT: "прямой", SITE: "сайт", MANUAL: "ручной" };

function waitLabel(hours: number): string {
  if (hours < 1) return "меньше часа";
  if (hours < 48) return `${Math.round(hours)} ч`;
  return `${Math.round(hours / 24)} д`;
}

type Check = { tone: "ok" | "bad" | "warn"; text: string } | null;

export default function BuyoutFocus({ token, open, onClose, onOpenOrder, onChanged }: {
  token: string;
  open: boolean;
  onClose: () => void;
  onOpenOrder: (wbCode: string) => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [check, setCheck] = useState<Check>(null);
  const [pending, setPending] = useState<{ id: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/buyout?tab=BUYOUT", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.export) { setError(data?.error ?? "Не удалось загрузить очередь"); return; }
      setItems(data.export.items as Item[]);
    } catch { setError("Ошибка сети"); }
  }, [token]);

  useEffect(() => {
    if (!open) return;
    setDone(new Set()); setSkipped(new Set()); setCheck(null); setItems(null);
    try {
      const saved = Number(localStorage.getItem("rb.twa.buyout.balance"));
      if (BALANCES.includes(saved as typeof BALANCES[number])) setBalance(saved);
    } catch { /* приватный режим */ }
    void load();
  }, [open, load]);

  const queue = useMemo(() => {
    if (!items) return [];
    const base = balance > 0 ? fitToBalance(items, balance).picked : items;
    return base.filter(item => !done.has(item.orderId));
  }, [items, balance, done]);
  const current = queue.find(item => !skipped.has(item.orderId)) ?? null;
  const next = current ? queue.filter(item => !skipped.has(item.orderId) && item.orderId !== current.orderId)[0] ?? null : null;
  const position = current ? done.size + 1 : done.size;
  const total = done.size + queue.length;
  const spent = items?.filter(item => done.has(item.orderId)).reduce((sum, item) => sum + item.expectedPrice, 0) ?? 0;

  useEffect(() => { setCheck(null); }, [current?.orderId]);
  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [pending]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function copyAndVerify(item: Item) {
    copyText(item.gamepassId);
    haptic.impact("light");
    setCheck({ tone: "warn", text: "Скопирован · сверяю цену с Roblox…" });
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "gp-live-check", orderIds: [item.orderId] }),
      });
      const data = await res.json().catch(() => null);
      const info = data?.results?.[item.orderId];
      if (!info) { setCheck({ tone: "warn", text: "Скопирован · Roblox не ответил, сверь цену сам" }); return; }
      if (info.isForSale === false) { haptic.notify("error"); setCheck({ tone: "bad", text: "СТОП: пасс снят с продажи" }); return; }
      if (info.priceMismatch && info.livePrice != null) {
        haptic.notify("error");
        setCheck({ tone: "bad", text: `СТОП: пасс ${info.livePrice} R$, нужен ${info.expected} R$` });
        return;
      }
      setCheck({ tone: "ok", text: info.reusedIn ? `Цена сходится · пасс уже покупали в ${info.reusedIn} — бери с другого аккаунта` : `Скопирован · цена сходится, ${info.livePrice} R$` });
    } catch { setCheck({ tone: "warn", text: "Скопирован · проверка цены не прошла" }); }
  }

  async function complete(item: Item) {
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "complete", orderId: item.orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok === false) {
        haptic.notify("error");
        toast(data?.error ?? "Не получилось отметить", "error");
        return;
      }
      haptic.notify("success");
      toast(`✓ ${item.wbCode} выкуплен`, "success");
      setDone(prev => new Set(prev).add(item.orderId));
      onChanged?.();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
  }

  function startComplete(item: Item) {
    if (pending) return;
    haptic.impact("medium");
    setPending({ id: item.orderId, until: Date.now() + UNDO_MS });
    timer.current = window.setTimeout(() => {
      setPending(null);
      void complete(item);
    }, UNDO_MS);
  }
  function undo() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setPending(null);
    haptic.select();
  }
  function pickBalance(value: number) {
    haptic.select();
    setBalance(value);
    setSkipped(new Set());
    try { localStorage.setItem("rb.twa.buyout.balance", String(value)); } catch { /* приватный режим */ }
  }

  if (!open) return null;
  const left = pending ? Math.max(1, Math.ceil((pending.until - now) / 1000)) : 0;
  const checkColor = check?.tone === "ok" ? C.green : check?.tone === "bad" ? C.red : C.textSecondary;

  // Портал в body: внутри экрана фиксированный слой попадал под шапку и таббар
  // (их стек выше), как шторки до 16.11 (`project_twa_sheet_portal_stacking`).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="twa-focus" role="dialog" aria-modal="true" aria-label="Выкуп по одному">
      <div className="twa-focus-bar">
        <button type="button" className="twa-focus-link" onClick={() => { if (pending) undo(); onClose(); }}>Готово</button>
        <b>{total > 0 ? `${Math.min(position, total)} из ${total}` : "Выкуп"}</b>
        <button type="button" className="twa-focus-link" disabled={!current || !!pending}
          onClick={() => { if (!current) return; haptic.select(); setSkipped(prev => new Set(prev).add(current.orderId)); }}>
          Пропустить
        </button>
      </div>

      <div className="twa-focus-balance" role="radiogroup" aria-label="Баланс аккаунта">
        {BALANCES.map(value => (
          <button key={value} type="button" role="radio" aria-checked={balance === value}
            className={balance === value ? "is-on" : ""} onClick={() => pickBalance(value)}>
            {value === 0 ? "Вся очередь" : `${value.toLocaleString("ru-RU")} R$`}
          </button>
        ))}
      </div>
      {total > 0 && (
        <>
          <div className="twa-focus-progress"><i style={{ width: `${Math.round((done.size / total) * 100)}%` }} /></div>
          <div className="twa-focus-sub">выкуплено {done.size} · списано {spent.toLocaleString("ru-RU")} R${balance > 0 ? ` из ${balance.toLocaleString("ru-RU")}` : ""}</div>
        </>
      )}

      {error && <div className="twa-focus-empty">{error}<button type="button" onClick={() => void load()}>Повторить</button></div>}
      {!error && !items && <div className="twa-focus-empty">Загружаю очередь…</div>}
      {!error && items && !current && (
        <div className="twa-focus-empty">
          {done.size > 0 ? `Готово: выкуплено ${done.size}.` : "В очереди нечего выкупать."}
          {balance > 0 && items.length > 0 && " Смени баланс, чтобы взять ещё."}
        </div>
      )}

      {current && (
        <div className="twa-focus-body">
          <div className="twa-focus-who">
            <strong>{current.robloxUsername ?? "ник не указан"}</strong>
            <span>{current.wbCode} · {SOURCE[current.orderSource] ?? current.orderSource} · ждёт {waitLabel(current.waitingHours)} · клиенту {current.amount.toLocaleString("ru-RU")}</span>
          </div>

          <button type="button" className="twa-focus-id" onClick={() => void copyAndVerify(current)} aria-label={`Скопировать ID пасса ${current.gamepassId}`}>
            <span className="twa-focus-id-l"><span>ID геймпасса</span><em>Тап — скопировать</em></span>
            <span className="twa-focus-id-v">{current.gamepassId}</span>
            <span className="twa-focus-id-price"><span style={{ color: checkColor }}>{check?.text ?? "цена пасса"}</span><b>{current.expectedPrice.toLocaleString("ru-RU")} <small>R$</small></b></span>
          </button>

          {next && (
            <div className="twa-focus-next">Дальше: <b>{next.robloxUsername ?? next.wbCode} · {next.expectedPrice.toLocaleString("ru-RU")}</b><span>{waitLabel(next.waitingHours)}</span></div>
          )}
        </div>
      )}

      {current && (
        <div className="twa-focus-foot">
          {pending ? (
            <>
              <span className="twa-focus-undo-text">Отмечаю {current.wbCode} через {left} с…</span>
              <button type="button" className="twa-focus-btn" onClick={undo}>Отменить</button>
            </>
          ) : (
            <>
              <button type="button" className="twa-focus-btn" onClick={() => { haptic.select(); onOpenOrder(current.wbCode); }}>Проблема</button>
              <button type="button" className="twa-focus-btn is-done" disabled={check?.tone === "bad"} onClick={() => startComplete(current)}>
                Выкуплено → дальше
              </button>
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
