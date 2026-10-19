"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Инструменты геймпасса заказа — ОДИН набор на все экраны TWA.

   Замечание владельца 19.10.2026: ключ покупателя можно было вставить только из
   меню карточки в «Заказах». Остальные поверхности (лист заказа, который
   открывается из «Заказов», из поиска, из Bossrobux и из «WB Доставки») про
   ключ не знали вовсе, хотя заказ правят именно оттуда.

   Поэтому формы живут здесь, а не внутри одного экрана, а список инструментов,
   их имена и предусловия берутся из `@/lib/gamepass-tools` — того же модуля,
   который рисует это меню на сайте. Разъехаться им больше негде.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from "react";
import { C, MONO } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import { parseGamepassRef } from "@/lib/gamepass-id";
import {
  GAMEPASS_TOOLS,
  gamepassToolsFor,
  gamepassToolsRefusal,
  type GamepassToolId,
  type GamepassToolOrder,
} from "@/lib/gamepass-tools";

/** Что формам нужно о заказе. `Order` экрана «Заказы» и цель листа подходят обе. */
export interface ToolOrder extends GamepassToolOrder {
  id: string;
  wbCode: string;
  amount: number;
  robloxUsername: string | null;
}

/* ── 🔗 Ссылка на геймпасс руками ─────────────────────────────────────────────
   Второй выход из «ждём ссылку». Первый — поиск пасса по нику (👁), но он
   находит не всегда: пасс может быть в скрытом плейсе, назван иначе или просто
   не отдаться Roblox. Тогда клиент присылает ссылку сам, и её нужно вставить.

   До 05.09.2026 такого поля на поверхности не было вовсе: вставить ссылку можно
   было только через «···» → «Редактировать» → лист заказа, и на телефоне лист
   открывался ПОД карточкой (см. `.twa-form-sheet` в globals.css). Форма нарочно
   маленькая: одно поле и одна кнопка.

   Цена проверяется ДО привязки тем же `manual-validate`, что и лист заказа:
   пасс не за тот номинал упирается в прайс-гард уже при выкупе, и узнавать об
   этом лучше здесь. Расхождение не запрещает привязку — оно её называет.
   ────────────────────────────────────────────────────────────────────────── */
export function AttachGamepassForm({ order, token, onDone, onClose }: {
  order: ToolOrder;
  token: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{
    error?: string; gamepassId?: string; livePrice?: number | null;
    isForSale?: boolean | null; expected?: number | null; priceMismatch?: boolean;
    sellerMatch?: boolean | null;
  } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const passId = parseGamepassRef(value.trim());

  useEffect(() => {
    const raw = value.trim();
    setCheck(null);
    if (!raw) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "manual-validate", gamepassUrl: raw, amount: order.amount }),
        });
        const d = await r.json();
        if (r.ok) setCheck(d.gamepass ?? null);
      } catch { /* проверка не обязана мешать привязке */ }
      finally { setChecking(false); }
    }, 500);
    return () => clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, token, order.amount]);

  async function submit() {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "attach-gamepass", orderId: order.id, gamepassId: raw }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Не удалось привязать", "error"); return; }
      haptic.notify("success");
      toast(d.notified
        ? `Геймпасс привязан — заказ к выкупу, клиент оповещён`
        : `Геймпасс привязан — заказ к выкупу (клиент НЕ оповещён)`, "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setBusy(false); }
  }

  const hint = check?.error ? { text: `⛔ ${check.error}`, color: C.red }
    : check?.isForSale === false ? { text: "⛔ пасс снят с продажи", color: C.red }
      : check?.priceMismatch && check.livePrice != null
        ? { text: `⚠️ ${check.livePrice} R$ вместо ${check.expected} R$`, color: C.orange }
        : check?.livePrice != null ? { text: `✓ ${check.livePrice} R$ — цена сходится`, color: C.green }
          : checking ? { text: "Проверяю цену…", color: C.textTertiary } : null;

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 13px 13px", borderRadius: 12,
      border: `1px solid ${C.blue}44`, background: `${C.blue}0f`,
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.blue }}>🔗 Ссылка на геймпасс</div>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="roblox.com/game-pass/… или ID"
        inputMode="url"
        autoComplete="off"
        style={{
          width: "100%", background: C.elevated, border: "none", borderRadius: 10,
          color: "#fff", fontSize: 16, padding: "12px", outline: "none",
          fontFamily: "inherit", boxSizing: "border-box",
        }}
      />
      {(hint || passId) && (
        <div style={{ fontSize: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {passId && <span style={{ color: C.textSecondary, fontFamily: MONO }}>{passId}</span>}
          {hint && <span style={{ color: hint.color, fontWeight: 600 }}>{hint.text}</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose} disabled={busy}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={busy || !passId}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.blue, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy || !passId ? 0.5 : 1 }}>
          {busy ? "…" : "Привязать — заказ к выкупу"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   🔑 Ключ покупателя — админ вставляет его за человека.

   Владелец, 18.10.2026: «очень часто они кидают ключ нам, а не боту, проще
   самим его вставить в заказ и сделать все за них».

   Два шага намеренно: сначала ключ проверяется мостом и форма показывает, НА
   КАКОМ аккаунте и КАКИЕ пассы будут созданы, и только потом создание. Пассы
   ложатся на чужой аккаунт и стоят живых робуксов при выкупе — подтверждать
   такое вслепую нельзя.

   Ключ живёт только в этом поле: `type=password`, без автозаполнения, в ответе
   сервера его нет ни при каком исходе.
   ───────────────────────────────────────────────────────────────────────── */
export function KeyCreateForm({ order, token, onDone, onClose }: {
  order: ToolOrder;
  token: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState("");
  const [nick, setNick] = useState(order.robloxUsername ?? order.probableNick ?? "");
  const [gameRef, setGameRef] = useState("");
  const [needsGameLink, setNeedsGameLink] = useState(false);
  const [busy, setBusy] = useState<"verify" | "create" | "save" | null>(null);
  const [plan, setPlan] = useState<{ nick: string; targets: { price: number; amount: number }[]; hasGamepass: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (payload: Record<string, unknown>, mode: "verify" | "create" | "save") => {
    setBusy(mode); setError(null);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create-gamepass-by-key", orderId: order.id,
          key, nick, ...(gameRef ? { gameRef } : {}), ...payload,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        haptic.notify("error");
        setError(d?.error ?? `Сервер ответил ${r.status}`);
        if (d?.needsGameLink) setNeedsGameLink(true);
        return null;
      }
      return d;
    } catch {
      setError("Ошибка сети");
      return null;
    } finally {
      setBusy(null);
    }
  };

  async function verify() {
    const d = await call({ dryRun: true }, "verify");
    if (!d) return;
    haptic.notify("success");
    setPlan({ nick: d.nick, targets: d.targets ?? [], hasGamepass: Boolean(d.hasGamepass) });
  }

  async function create() {
    const d = await call({ replace: plan?.hasGamepass === true }, "create");
    if (!d) return;
    haptic.notify("success");
    const made = (d.created ?? []).length;
    toast(
      d.complete
        ? d.notified
          ? `🔑 Создано ${made} — заказ к выкупу, клиент оповещён`
          : `🔑 Создано ${made} — заказ к выкупу (клиент НЕ оповещён)`
        : `🔑 Создано ${made} из набора — набор НЕ полный, дособери заказ`,
      d.complete && !d.needsHands ? "success" : "error",
    );
    setKey("");
    onDone();
  }

  async function saveOnly() {
    const d = await call({ saveOnly: true }, "save");
    if (!d) return;
    haptic.notify("success");
    toast(`🔑 Ключ сохранён за покупателем (${d.nick}) — сработает на следующем заказе`, "success");
    setKey("");
    onClose();
  }

  const field = {
    width: "100%", background: C.elevated, border: "none", borderRadius: 10,
    color: "#fff", fontSize: 16, padding: "12px", outline: "none",
    fontFamily: "inherit", boxSizing: "border-box" as const,
  };

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 13px 13px", borderRadius: 12,
      border: `1px solid ${C.green}44`, background: `${C.green}0f`,
      display: "flex", flexDirection: "column", gap: 9,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.green }}>🔑 Ключ покупателя</div>
      <div style={{ fontSize: 14, color: C.textSecondary }}>
        Создадим геймпассы сами — покупателю делать ничего не нужно.
      </div>
      <input
        type="password"
        value={key}
        onChange={e => { setKey(e.target.value); setPlan(null); }}
        placeholder="ключ Open Cloud — одна длинная строка"
        autoComplete="off"
        spellCheck={false}
        style={field}
      />
      <input
        value={nick}
        onChange={e => { setNick(e.target.value); setPlan(null); }}
        placeholder="ник Roblox покупателя"
        autoComplete="off"
        style={field}
      />
      {needsGameLink && (
        <input
          value={gameRef}
          onChange={e => setGameRef(e.target.value)}
          placeholder="ссылка на игру — её не видно по нику"
          inputMode="url"
          autoComplete="off"
          style={field}
        />
      )}

      {plan && (
        <div style={{ fontSize: 14, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ color: C.green, fontWeight: 600 }}>✅ Ключ рабочий · аккаунт {plan.nick}</span>
          {plan.targets.map((t, i) => (
            <span key={`${t.price}-${i}`} style={{ color: C.textSecondary }}>
              Создадим пасс <b style={{ fontFamily: MONO, color: "#fff" }}>{t.price} R$</b> → {t.amount} R$ чистыми
            </span>
          ))}
          {plan.hasGamepass && (
            <span style={{ color: C.orange }}>⚠️ У заказа уже есть геймпасс — он будет заменён</span>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: 14, color: C.red, fontWeight: 600 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose} disabled={busy !== null}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        {!plan ? (
          <button className="twa-press" onClick={verify} disabled={busy !== null || !key || !nick}
            style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.blue, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy !== null || !key || !nick ? 0.5 : 1 }}>
            {busy === "verify" ? "Проверяю ключ…" : "Проверить ключ"}
          </button>
        ) : (
          <button className="twa-press" onClick={create} disabled={busy !== null}
            style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.green, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy !== null ? 0.5 : 1 }}>
            {busy === "create" ? "Создаю пассы…" : "Создать и привязать"}
          </button>
        )}
      </div>
      <button className="twa-press-sm" onClick={saveOnly} disabled={busy !== null || !key || !nick}
        style={{ padding: "10px", borderRadius: 10, border: `1px solid ${C.hairline}`, background: "transparent", color: C.textSecondary, fontSize: 14, cursor: "pointer" }}>
        {busy === "save" ? "Сохраняю…" : "Только сохранить ключ — сработает на следующем заказе"}
      </button>
    </div>
  );
}
/* ─────────────────────────────────────────────────────────────────────────────
   Меню инструментов — строки одинаковые на всех экранах.

   Рисуется из `GAMEPASS_TOOLS`: значок, имя и подсказка приходят из общего
   модуля, поверхность отвечает только за то, что делает нажатие. Инструмент,
   для которого обработчик не передан, не рисуется — так лист заказа не обещает
   разбивку там, откуда её негде открыть.
   ───────────────────────────────────────────────────────────────────────── */
export function GamepassToolRows({
  order, active, onPick, handlers, hints, compact = false,
}: {
  order: ToolOrder;
  /** Открытый инструмент — его строка подсвечена. */
  active?: GamepassToolId | null;
  onPick: (id: GamepassToolId) => void;
  /** Какие инструменты эта поверхность умеет открыть. */
  handlers: Partial<Record<GamepassToolId, boolean>>;
  /** Подсказка вместо общей — там, где у заказа есть что сказать по факту
   *  (например «2/3 частей выкуплено» вместо описания разбивки). */
  hints?: Partial<Record<GamepassToolId, string>>;
  compact?: boolean;
}) {
  const allowed = gamepassToolsFor(order);
  const rows = GAMEPASS_TOOLS.filter(
    (tool) => handlers[tool.id] && allowed.some((item) => item.id === tool.id),
  );
  const refusal = gamepassToolsRefusal(order);

  if (rows.length === 0) {
    return refusal ? (
      <div style={{ fontSize: 14, color: C.textTertiary, padding: compact ? "2px 0" : "6px 0" }}>{refusal}</div>
    ) : null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="twa-press-sm"
          onClick={(event) => { event.stopPropagation(); haptic.select(); onPick(tool.id); }}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
            padding: compact ? "9px 11px" : "11px 13px", borderRadius: 11, cursor: "pointer",
            border: `1px solid ${active === tool.id ? `${C.accent}66` : C.hairline}`,
            background: active === tool.id ? `${C.accent}14` : "transparent",
          }}
        >
          <span style={{ fontSize: 17 }}>{tool.icon}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, color: C.textPrimary }}>{tool.label}</span>
            <span style={{ display: "block", fontSize: 14, color: C.textTertiary }}>{hints?.[tool.id] ?? tool.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
