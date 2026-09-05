"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   «Другие пассы на аккаунте» в карточке заказа TWA.

   Зеркало блока из досье сайта: та же раскладка по пригодности
   (`src/lib/gamepass-fit.ts`), те же действия и те же слова. Отличается только
   форма — на 390 px строка не помещается в одну линию, поэтому имя и ID стоят
   слева столбиком, а цена с кнопкой — справа.

   Список грузится по кнопке, а не вместе с карточкой: поиск ходит в Roblox
   через мост, а карточку открывают в основном не за пассами.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useState } from "react";
import { classifyGamepasses, type FitPass, type PickerPass, type SplitPartLike } from "@/lib/gamepass-fit";
import { expectedGamepassPrice } from "@/lib/purchase-guard";
import { haptic } from "./haptics";
import { toast } from "./Toast";

const robux = (value: number) => value.toLocaleString("ru-RU");

export default function NickGamepasses({
  orderId, wbCode, orderAmount, currentId, parts, splittable, token, onChanged, onSplitWith,
}: {
  orderId: string;
  wbCode: string;
  orderAmount: number;
  currentId: string | null;
  parts: SplitPartLike[];
  /** Можно ли вообще разбивать этот заказ — от статуса. */
  splittable: boolean;
  token: string;
  onChanged: () => void;
  /** Открыть разбиение с этим пассом уже выбранным. */
  onSplitWith: (gamepassId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nick, setNick] = useState("");
  const [passes, setPasses] = useState<PickerPass[] | null>(null);
  const [emptyNote, setEmptyNote] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/twa/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...payload, orderId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error ?? `Сервер ответил ${response.status}`);
    return body;
  }, [orderId, token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await post({ action: "split-candidates" });
      setNick(data.resolvedName ?? data.nick ?? "");
      setPasses(data.passes ?? []);
      setEmptyNote(
        (data.passes ?? []).length > 0
          ? null
          : data.reason === "user_not_found"
            ? "Roblox не знает такого ника — проверьте написание в правке заказа."
            // Треть застрявших заказов — скрытый плейс: аккаунт есть, пассов не
            // видно никакому поиску. Повторять поиск бесполезно, лечит ссылка.
            : "Аккаунт есть, а публичных пассов не видно — обычно это скрытый плейс. Вставьте ссылку на пасс через правку, она работает и по скрытому.",
      );
      setOpen(true);
    } catch (error) { haptic.notify("error"); toast((error as Error).message, "error"); }
    finally { setLoading(false); }
  }, [post]);

  /**
   * Поставить пасс на заказ — тем же `edit-order`, что и правка карточки:
   * значит те же гарды (заморозка, статус, чужой активный заказ на этом пассе).
   * `priceAck` уходит только при осознанной постановке не по номиналу и
   * оставляет след в заметке; гард выкупа при этом никуда не девается.
   */
  async function attach(pass: FitPass) {
    const expected = expectedGamepassPrice(orderAmount);
    if (pass.kind !== "order") {
      const ok = window.confirm(
        `${pass.name} стоит ${robux(pass.price)} R$, а заказу нужен пасс за ${robux(expected)} R$.\n\n`
        + "Поставить всё равно? Гард выкупа остановит покупку — заказ встанет уже на выкупе, "
        + "а в заметке останется след «ЦЕНА-СТОП ОБОЙДЁН».",
      );
      if (!ok) return;
    }
    setBusyId(pass.gamepassId);
    haptic.impact("medium");
    try {
      await post({
        action: "edit-order",
        gamepassUrl: pass.gamepassId,
        ...(pass.kind === "order" ? {} : { priceAck: pass.price }),
      });
      haptic.notify("success");
      toast(`Пасс ${pass.gamepassId} на заказе ${wbCode}`, "success");
      onChanged();
    } catch (error) { haptic.notify("error"); toast((error as Error).message, "error"); }
    finally { setBusyId(null); }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="twa-gp-more-open twa-press-sm"
        disabled={loading}
        onClick={() => { haptic.select(); void load(); }}
      >
        {loading ? "Ищем пассы ника…" : "🎮 Ещё пассы ника"}
      </button>
    );
  }

  const groups = classifyGamepasses({ passes: passes ?? [], orderAmount, currentId, parts });
  const listed = groups.order.length + groups.part.length + groups.rest.length;
  const restCount = groups.rest.length + (splittable ? 0 : groups.part.length);

  const row = (pass: FitPass, action: React.ReactNode) => (
    <div className={`twa-gp-row${pass.kind === "order" || pass.kind === "part" ? "" : " is-off"}`} key={pass.gamepassId}>
      <div className="twa-gp-name">
        <b>{pass.name}</b>
        <small>
          {pass.gamepassId}
          {pass.busyWith && <em> · занят заказом {pass.busyWith}</em>}
        </small>
      </div>
      <div className="twa-gp-right">
        <b>{robux(pass.price)} R$</b>
        {action}
      </div>
    </div>
  );

  return (
    <div className="twa-gp-more">
      <div className="twa-gp-more-head">
        <span>Другие пассы на аккаунте {nick || "—"}{listed > 0 ? ` · ${listed}` : ""}</span>
        <button type="button" onClick={() => { haptic.select(); void load(); }} disabled={loading}>⟳</button>
        <button type="button" onClick={() => { haptic.select(); setOpen(false); }}>Скрыть</button>
      </div>

      {listed === 0 && <div className="twa-gp-note">{emptyNote ?? "Других пассов на аккаунте нет."}</div>}

      {groups.order.length > 0 && (
        <>
          <div className="twa-gp-group">подходят под номинал · {robux(expectedGamepassPrice(orderAmount))} R$</div>
          {groups.order.map(pass => row(pass, (
            <button
              type="button"
              className="twa-gp-btn is-go twa-press-sm"
              disabled={busyId === pass.gamepassId}
              onClick={() => void attach(pass)}
            >{busyId === pass.gamepassId ? "…" : "Поставить"}</button>
          )))}
        </>
      )}

      {splittable && groups.part.length > 0 && (
        <>
          <div className="twa-gp-group">
            {groups.part.some(pass => pass.partAmount) ? "закрывают незакрытую часть" : "закрывают часть — если разбивать"}
          </div>
          {groups.part.map(pass => row(pass, (
            <button
              type="button"
              className="twa-gp-btn twa-press-sm"
              onClick={() => { haptic.select(); onSplitWith(pass.gamepassId); }}
            >В разбивку{pass.partAmount ? ` · ${robux(pass.partAmount)}` : ""}</button>
          )))}
        </>
      )}

      {restCount > 0 && (
        <>
          <button type="button" className="twa-gp-fold" onClick={() => { haptic.select(); setShowRest(value => !value); }}>
            {showRest ? "цена не сходится · ⌃ свернуть" : `⌄ ещё ${restCount} — цена не сходится`}
          </button>
          {showRest && (
            <>
              {/* Разбивать нельзя (заказ закрыт, часть уже выкуплена) — тогда
                  «часть» не действие, а справка, и строки живут здесь. */}
              {!splittable && groups.part.map(pass => row(pass, (
                <button type="button" className="twa-gp-btn twa-press-sm" disabled={busyId === pass.gamepassId} onClick={() => void attach(pass)}>Поставить…</button>
              )))}
              {groups.rest.map(pass => row(pass, pass.busyWith ? null : (
                <button
                  type="button"
                  className="twa-gp-btn twa-press-sm"
                  disabled={busyId === pass.gamepassId}
                  onClick={() => void attach(pass)}
                >{busyId === pass.gamepassId ? "…" : "Поставить…"}</button>
              )))}
              <div className="twa-gp-note">
                «Поставить…» спросит подтверждение: цена не сходится с номиналом. Гард выкупа всё равно остановит покупку.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
