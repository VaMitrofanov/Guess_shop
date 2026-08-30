"use client";
import { useEffect, useRef, useState } from "react";
import { C, MONO } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";

/* ─────────────────────────────────────────────────────────────────────────────
   OrderSheet — один лист заказа: и создание, и правка.

   Раньше это были две модалки с одинаковыми полями и разными правами. Правка —
   строгое подмножество создания (номинал, ник, геймпасс), но жила отдельно и
   без поиска пассов и живой проверки цены, которые в создании уже работали.
   Хуже другое: введённый код, который уже занят живым заказом, был ТУПИКОМ —
   красная строка «по коду уже есть заказ», и дальше закрывай форму, ищи заказ
   в списке, открывай правку.

   Теперь у формы есть ЦЕЛЬ (`target`): «новый заказ» или конкретный заказ. Когда
   введённое совпадает с живым заказом, лист показывает найденное и предлагает
   выходы — но **не переключается сам**: второй заказ на тот же код или пасс
   иногда заводят осознанно, и молчаливый увод в правку однажды сломал бы именно
   такой случай (решение владельца 31.08: «переключаться по кнопке, лишний клик
   нам на руку»).

   Сервер все совпадения уже возвращает (`manual-validate`) — их просто выбрасывали
   в текст ошибки.
   ───────────────────────────────────────────────────────────────────────── */

export interface RebindUser {
  id: string;
  tgId: string | null;
  vkId: string | null;
  username: string | null;
  name: string | null;
  robloxUsername: string | null;
}

/** Живой заказ, на который наткнулась форма. Ровно то, что нужно шапке-цели. */
export interface MatchedOrder {
  orderId: string;
  wbCode: string;
  status: string;
  amount: number;
  robloxUsername: string | null;
  gamepassUrl: string | null;
  isDirectOrder: boolean;
  unpaidDirect: boolean;
  heldAt: string | null;
  heldReason: string | null;
  /** `edit-order` живёт только в PENDING / AWAITING_GAMEPASS / ERROR / REJECTED. */
  editable: boolean;
  client: string | null;
  createdAt: string | null;
  pendingAt: string | null;
}

interface ManualValidation {
  code?: { ok: boolean; error?: string; denomination?: number; claimedBy?: RebindUser | null; existing?: MatchedOrder | null; frozen?: boolean };
  gamepass?: {
    error?: string;
    gamepassId?: string;
    livePrice?: number | null;
    isForSale?: boolean | null;
    expected?: number | null;
    priceMismatch?: boolean;
    sellerMatch?: boolean | null;
    existing?: MatchedOrder | null;
  };
  nick?: { matches?: MatchedOrder[] };
  wbOrder?: {
    wbOrderId?: string;
    buyerName?: string | null;
    denomination?: number | null;
    priceKopecks?: number | null;
    supplierStatus?: string;
    gateCode?: string | null;
    cancelled?: boolean;
    error?: string;
    existing?: MatchedOrder | null;
  };
}

/** Результат поиска геймпассов по нику внутри листа. */
interface FoundPass {
  gamepassId: number;
  name: string;
  price: number;
  existingOrder?: { wbCode: string; status: string } | null;
}

export type CreateOrderMode = "manual" | "direct";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING:          { label: "К выкупу",     color: C.green },
  IN_PROGRESS:      { label: "Выкупается",   color: C.green },
  AWAITING_GAMEPASS:{ label: "Ждёт ссылку",  color: C.yellow },
  ERROR:            { label: "Ошибка",       color: C.red },
  REJECTED:         { label: "Отменён",      color: C.red },
  COMPLETED:        { label: "Готово",       color: C.green },
  AWAITING_PAYMENT: { label: "Ждёт оплату",  color: C.blue },
  PAYMENT_PENDING:  { label: "Ждёт оплату",  color: C.blue },
};

function statusMeta(status: string) {
  return STATUS_LABEL[status] ?? { label: status, color: C.textSecondary };
}

const inputStyle: React.CSSProperties = {
  width: "100%", background: C.elevated, border: "none", borderRadius: 10,
  color: "#fff", fontSize: 15, padding: "11px 12px", outline: "none",
  fontFamily: "inherit", boxSizing: "border-box",
};

const lockedStyle: React.CSSProperties = {
  ...inputStyle, background: "rgba(255,255,255,0.04)", color: C.textTertiary,
  display: "flex", alignItems: "center", gap: 8,
};

/** Строка-выход из карточки найденного заказа. Визуал из варианта 2 «Найден
    заказ»: не кнопки в ряд, а список действий — читается сверху вниз и не
    заставляет выбирать между двумя одинаковыми на вид прямоугольниками. */
function ActionRow({ icon, label, hint, tone = "plain", onClick, disabled }: {
  icon: string; label: string; hint?: string;
  tone?: "plain" | "primary" | "ice"; onClick: () => void; disabled?: boolean;
}) {
  const color = tone === "primary" ? C.blue : tone === "ice" ? C.ice : C.textPrimary;
  return (
    <button
      type="button"
      className="twa-press-sm"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%",
        padding: "10px 11px", borderRadius: 10, border: "none", textAlign: "left",
        background: tone === "primary" ? "rgba(10,132,255,0.16)"
          : tone === "ice" ? "rgba(100,210,255,0.14)" : "rgba(255,255,255,0.06)",
        color, fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 11.5, color: C.textTertiary, marginTop: 1 }}>{hint}</span>}
      </span>
      <span style={{ color: C.textTertiary, fontSize: 16, flexShrink: 0 }}>›</span>
    </button>
  );
}

/** Карточка найденного заказа + выходы из неё. */
function MatchCard({ found, title, tone, children }: {
  found: MatchedOrder; title: string; tone: "warn" | "info"; children: React.ReactNode;
}) {
  const meta = statusMeta(found.status);
  const border = tone === "warn" ? "rgba(255,159,10,0.3)" : "rgba(10,132,255,0.3)";
  const bg = tone === "warn" ? "rgba(255,159,10,0.09)" : "rgba(10,132,255,0.09)";
  return (
    <div style={{ border: `1px solid ${border}`, background: bg, borderRadius: 13, padding: "10px 11px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tone === "warn" ? C.orange : C.blue }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{found.wbCode}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
          background: `${meta.color}2a`, color: meta.color,
        }}>{meta.label}</span>
        <span style={{ fontSize: 12, color: C.textSecondary }}>{found.amount.toLocaleString("ru-RU")} R$</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 3 }}>
        {[found.robloxUsername, found.client].filter(Boolean).join(" · ") || "клиент не привязан"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}>{children}</div>
    </div>
  );
}

export default function OrderSheet({
  token, onDone, onClose, initialGamepassUrl, initialNick, initialAmount, mode = "manual", initialTarget, initialWbOrderId,
}: {
  token: string;
  onDone: () => void;
  onClose: () => void;
  initialGamepassUrl?: string;
  initialNick?: string;
  initialAmount?: number;
  mode?: CreateOrderMode;
  /** Открыть сразу в правке — из ✏️ на карточке заказа. */
  initialTarget?: MatchedOrder | null;
  /** Открыть с подставленным номером заказа WB — из консоли доставки. */
  initialWbOrderId?: string;
}) {
  const isDirect = mode === "direct";

  /** Цель листа: `null` — новый заказ, иначе правим этот. */
  const [target, setTarget] = useState<MatchedOrder | null>(initialTarget ?? null);
  const editing = target !== null;

  const [wbCode, setWbCode] = useState("");
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [nick, setNick] = useState(initialNick ?? "");
  const [gpInput, setGpInput] = useState(initialGamepassUrl ?? "");
  const [note, setNote] = useState("");
  /** Номер заказа WB/DBS: четвёртый способ назвать тот же заказ. */
  const [wbOrderId, setWbOrderId] = useState(initialWbOrderId ?? "");
  /** Форма заведения клиента, которого нет в базе. */
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newTg, setNewTg] = useState("");
  const [newVk, setNewVk] = useState("");
  const [newName, setNewName] = useState("");
  const [notify, setNotify] = useState(true);
  const [client, setClient] = useState<RebindUser | null>(null);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<RebindUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [valid, setValid] = useState<ManualValidation>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gpFound, setGpFound] = useState<FoundPass[]>([]);
  const [selectedDirectPass, setSelectedDirectPass] = useState<FoundPass | null>(null);
  const [gpSearching, setGpSearching] = useState(false);
  const [gpSearchMsg, setGpSearchMsg] = useState("");
  const [dup, setDup] = useState<{ wbCode: string; status: string } | null>(null);
  /** Совпадения, которые менеджер осознанно проигнорировал: «всё равно создать». */
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  const validateDebounce = useRef<ReturnType<typeof setTimeout>>(undefined);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  /** Переключиться на найденный заказ, подставив его поля. */
  function switchToOrder(found: MatchedOrder) {
    haptic.impact("light");
    setTarget(found);
    setWbCode("");
    setAmount(String(found.amount));
    setNick(found.robloxUsername ?? "");
    setGpInput(found.gamepassUrl ?? "");
    setGpFound([]);
    setGpSearchMsg("");
    setDup(null);
  }

  function backToCreate() {
    haptic.select();
    setTarget(null);
    setDup(null);
  }

  function ignoreMatch(key: string) {
    haptic.select();
    setIgnored(prev => new Set(prev).add(key));
  }

  // Поиск клиента — только при создании: смена клиента у существующего заказа
  // это `rebind` со своими проверками, а не поле формы.
  useEffect(() => {
    if (editing || clientQuery.trim().length < 2) { setClientResults([]); return; }
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST", headers,
          body: JSON.stringify({ action: "search-users", query: clientQuery.trim() }),
        });
        const d = await r.json();
        if (r.ok && d.users) setClientResults(d.users);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(searchDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientQuery, token, editing]);

  // Живая валидация. В режиме правки она нужна ровно так же: цена геймпасса и
  // его занятость проверяются теми же правилами — раньше правка их не звала и
  // молча принимала пасс не той цены, а всплывало это прайс-гардом при выкупе.
  useEffect(() => {
    const codeTrim = wbCode.trim();
    const gpTrim = gpInput.trim();
    const nickTrim = nick.trim();
    setDup(null);
    const wbTrim = wbOrderId.replace(/\D/g, "");
    if (!codeTrim && !gpTrim && !wbTrim && nickTrim.length < 3) { setValid({}); return; }
    clearTimeout(validateDebounce.current);
    validateDebounce.current = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST", headers,
          body: JSON.stringify({
            action: "manual-validate",
            wbCode: codeTrim, gamepassUrl: gpTrim, wbOrderId: wbTrim,
            robloxUsername: nickTrim, amount: Number(amount) || undefined,
          }),
        });
        const d = await r.json();
        if (r.ok) setValid(d);
      } catch {}
      setChecking(false);
    }, 500);
    return () => clearTimeout(validateDebounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbCode, gpInput, nick, amount, wbOrderId, token]);

  const codeState = wbCode.trim() ? valid.code : undefined;
  const gpState = gpInput.trim() ? valid.gamepass : undefined;
  const wbState = wbOrderId.replace(/\D/g, "") ? valid.wbOrder : undefined;
  // Номинал знает тот, кто назвал заказ: карточка доставки, код с карты или
  // менеджер руками — в таком порядке, потому что именно так его знает сервер.
  const effAmount = wbState?.denomination ?? (codeState?.ok && codeState.denomination ? codeState.denomination : (Number(amount) || null));
  const expectedPrice = effAmount ? Math.ceil(effAmount / 0.7) : null;

  /* ── Совпадения, которые показываем как развилку ───────────────────────── */
  const codeMatch = !editing && codeState?.existing && !ignored.has(`code:${codeState.existing.orderId}`)
    ? codeState.existing : null;
  const gpMatch = gpState?.existing
    && gpState.existing.orderId !== target?.orderId
    && !ignored.has(`gp:${gpState.existing.orderId}`)
    ? gpState.existing : null;
  const wbOrderMatch = !editing && valid.wbOrder?.existing && !ignored.has(`wb:${valid.wbOrder.existing.orderId}`)
    ? valid.wbOrder.existing : null;
  const nickMatches = !editing && !codeMatch && !gpMatch && !wbOrderMatch
    ? (valid.nick?.matches ?? []).filter(m => !ignored.has(`nick:${m.orderId}`))
    : [];

  /* ── Что можно нажать ──────────────────────────────────────────────────── */
  const frozen = editing && !!target?.heldAt;
  const dirtyEdit = editing && !!target && (
    (!target.isDirectOrder && (Number(amount) || 0) !== target.amount) ||
    gpInput.trim() !== (target.gamepassUrl ?? "") ||
    nick.trim() !== (target.robloxUsername ?? "")
  );
  const editChanges = editing && target ? [
    !target.isDirectOrder && (Number(amount) || 0) !== target.amount ? "номинал" : null,
    nick.trim() !== (target.robloxUsername ?? "") ? "ник" : null,
    gpInput.trim() !== (target.gamepassUrl ?? "") ? "геймпасс" : null,
  ].filter(Boolean) as string[] : [];

  const missing: string[] = [];
  if (!editing) {
    if (isDirect) {
      if (!client) missing.push("клиент");
      if (!nick.trim()) missing.push("ник");
      if (!selectedDirectPass) missing.push("геймпасс");
    } else {
      if (!effAmount) missing.push("номинал, код или номер заказа WB");
      if (wbCode.trim() && codeState?.ok !== true && !codeState?.existing) missing.push("рабочий код");
      if (wbState?.error) missing.push("рабочий номер заказа WB");
    }
    if (gpInput.trim() && gpState?.error) missing.push("верная ссылка на геймпасс");
  }

  const canSubmit = busy ? false
    : editing ? (!frozen && dirtyEdit && !gpState?.error)
      : missing.length === 0;

  function userLabel(u: RebindUser) {
    const platform = u.tgId ? "TG" : u.vkId ? "VK" : "—";
    const name = u.username ? `@${u.username}` : u.name || u.tgId || u.vkId || u.id.slice(-6);
    return { platform, name };
  }

  /** Завести клиента, которого нет в базе. Без этого заказ вешался на служебного
      `admin`, и уведомления такому «клиенту» уже не уходили никогда. */
  async function createClient() {
    const tg = newTg.replace(/\D/g, "");
    const vk = newVk.replace(/\D/g, "");
    if (!tg && !vk) { toast("Нужен Telegram ID или VK ID", "error"); return; }
    setBusy(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({ action: "create-client", tgId: tg || undefined, vkId: vk || undefined, name: newName.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Не удалось создать клиента", "error"); return; }
      haptic.notify("success");
      setClient(d.user);
      setNewClientOpen(false);
      setNewTg(""); setNewVk(""); setNewName("");
      toast(d.existed ? "Клиент уже был в базе — привязал" : "Клиент заведён", "success");
    } catch { toast("Ошибка сети", "error"); }
    finally { setBusy(false); }
  }

  async function searchPassesByNick() {
    const q = nick.trim();
    if (!q || gpSearching) return;
    setGpSearching(true); setGpSearchMsg(""); setGpFound([]);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/roblox-account/purchase", {
        method: "POST", headers,
        body: JSON.stringify({ action: "search-by-username", username: q }),
      });
      const d = await r.json();
      if (!r.ok) { setGpSearchMsg(d.error ?? "Ошибка поиска"); return; }
      if (d.username && d.username !== q) setNick(d.username);
      const passes: FoundPass[] = d.gamepasses ?? [];
      setGpFound(passes);
      if (passes.length === 0) setGpSearchMsg(d.msg ?? "For-sale геймпассы не найдены");
    } catch { setGpSearchMsg("Ошибка сети"); }
    finally { setGpSearching(false); }
  }

  /** Привязать введённый геймпасс к найденному заказу (не создавая нового). */
  async function attachToOrder(found: MatchedOrder) {
    const raw = gpInput.trim();
    if (!raw || busy) return;
    if (!window.confirm(`Привязать этот геймпасс к заказу ${found.wbCode}? Заказ уйдёт в очередь выкупа.`)) return;
    setBusy(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({ action: "attach-gamepass", orderId: found.orderId, gamepassId: raw }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Не удалось привязать", "error"); return; }
      haptic.notify("success");
      toast(`Геймпасс привязан к ${found.wbCode} — заказ к выкупу`, "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setBusy(false); }
  }

  async function saveEdit(force = false) {
    if (!target || !canSubmit) return;
    setBusy(true);
    haptic.impact("light");
    try {
      const payload: Record<string, unknown> = {
        action: "edit-order", orderId: target.orderId,
        gamepassUrl: gpInput.trim(),
        robloxUsername: nick.trim(),
      };
      if (!target.isDirectOrder) payload.amount = Number(amount) || 0;
      if (force) payload.force = true;
      const r = await fetch("/api/twa/orders", { method: "POST", headers, body: JSON.stringify(payload) });
      const d = await r.json();
      if (r.status === 409 && d.existing) { haptic.notify("warning"); setDup(d.existing); return; }
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast(`${target.wbCode} — сохранено (${editChanges.join(", ")})`, "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setBusy(false); }
  }

  async function create(force = false) {
    if (!canSubmit) return;
    setBusy(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST", headers,
        body: JSON.stringify({
          action: "create-manual",
          direct: isDirect,
          wbCode: wbCode.trim() || undefined,
          wbOrderId: wbOrderId.replace(/\D/g, "") || undefined,
          amount: Number(amount) || undefined,
          clientUserId: client?.id ?? undefined,
          robloxUsername: nick.trim() || undefined,
          gamepassUrl: gpInput.trim() || undefined,
          note: note.trim() || undefined,
          notify: !isDirect && notify && !!client,
          force,
        }),
      });
      const d = await r.json();
      if (r.status === 409 && d.existing) { haptic.notify("warning"); setDup(d.existing); return; }
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      const created = d.order;
      let msg = `${isDirect ? "Прямой заказ" : "Заказ"} ${created.wbCode} создан · ${created.status === "PENDING" ? "К выкупу" : "Ждёт геймпасс"}`;
      if (!isDirect && notify && client) {
        msg += d.notified ? ` · клиент уведомлён (${String(d.notified).toUpperCase()})` : " · увед НЕ доставлен";
      }
      toast(msg, d.notified === null && !isDirect && notify && client ? "error" : "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setBusy(false); }
  }

  const warn = (text: string, color: string = C.orange) => (
    <div style={{ fontSize: 13, color, lineHeight: 1.35 }}>{text}</div>
  );

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{
        background: C.card, borderRadius: 18, width: "100%", maxWidth: 400, maxHeight: "88vh",
        display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ padding: "16px 20px 4px", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>
            {editing ? "Заказ" : isDirect ? "🔷 Прямой заказ" : "➕ Новый заказ"}
          </div>

          {/* Шапка-цель: что именно делает лист прямо сейчас. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginTop: 8,
            padding: "8px 11px", borderRadius: 11, fontSize: 12.5,
            background: frozen ? "rgba(100,210,255,0.12)" : editing ? "rgba(10,132,255,0.14)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${frozen ? "rgba(100,210,255,0.3)" : editing ? "rgba(10,132,255,0.32)" : "transparent"}`,
            color: frozen ? C.ice : editing ? "#8ac4ff" : C.textSecondary,
          }}>
            {editing && target ? (
              <>
                <span>{frozen ? "❄️" : "✎"}</span>
                <span>{frozen ? "Заморожен" : "Правлю"} <b style={{ fontFamily: MONO }}>{target.wbCode}</b> · {statusMeta(target.status).label}</span>
                {!initialTarget && (
                  <button type="button" onClick={backToCreate}
                    style={{ marginLeft: "auto", background: "transparent", border: "none", color: C.textTertiary, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
                    ✕ к новому
                  </button>
                )}
              </>
            ) : (
              <>
                <span>＋</span>
                <span>Новый заказ</span>
                <span style={{ marginLeft: "auto", color: C.textTertiary, fontSize: 11 }}>цель</span>
              </>
            )}
          </div>

          {!editing && (
            <div style={{ fontSize: 12.5, color: C.textTertiary, marginTop: 7, lineHeight: 1.35 }}>
              {isDirect
                ? "Найди геймпасс по нику и выбери юзера, с которым общался."
                : "Введи код, ник или ссылку. Если это уже существующий заказ — предложу открыть его."}
            </div>
          )}
        </div>

        <div style={{ padding: "12px 20px 8px", display: "flex", flexDirection: "column", gap: 11, overflowY: "auto" }}>

          {/* ❄️ Заморозка бьёт всё: правка выключена целиком. Иначе форма стала
              бы чёрным ходом мимо заморозки — поправил ник, и заказ снова
              выглядит рабочим. Разморозка — отдельный осознанный шаг. */}
          {frozen && target && (
            <div style={{
              border: `1px solid ${C.ice}55`, background: `${C.ice}14`,
              borderRadius: 13, padding: "10px 11px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ice }}>Заморожен — правка выключена</div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4, lineHeight: 1.35 }}>
                {target.heldReason ?? "причина не указана"}
              </div>
              <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 6 }}>
                Снять заморозку можно в карточке заказа — там же видно, кто и когда её поставил.
              </div>
            </div>
          )}

          {/* Совпадение по коду — развилка, а не ошибка. */}
          {codeMatch && (
            <MatchCard found={codeMatch} tone="warn" title={`Код ${wbCode.trim()} уже занят`}>
              <ActionRow
                icon="✎" tone="primary"
                label={codeMatch.editable ? "Править этот заказ" : "Правка недоступна в этом статусе"}
                hint={codeMatch.editable ? "поля подставятся сами" : "открой карточку заказа в списке"}
                disabled={!codeMatch.editable}
                onClick={() => switchToOrder(codeMatch)}
              />
              <ActionRow
                icon="＋" label="Всё равно создать новый"
                hint="осознанный второй заказ на тот же код"
                onClick={() => ignoreMatch(`code:${codeMatch.orderId}`)}
              />
            </MatchCard>
          )}

          {/* Совпадение по геймпассу — три выхода, включая привязку. */}
          {gpMatch && (
            <MatchCard found={gpMatch} tone="warn" title="Этот геймпасс уже в заказе">
              <ActionRow
                icon="✎" tone="primary"
                label={gpMatch.editable ? "Править тот заказ" : "Правка недоступна в этом статусе"}
                disabled={!gpMatch.editable}
                onClick={() => switchToOrder(gpMatch)}
              />
              {!editing && (
                <ActionRow
                  icon="📎" tone="ice" label="Привязать пасс к тому заказу"
                  hint="заказ уйдёт в очередь выкупа"
                  disabled={busy}
                  onClick={() => void attachToOrder(gpMatch)}
                />
              )}
              <ActionRow
                icon="＋" label={editing ? "Оставить пасс здесь" : "Всё равно создать новый"}
                onClick={() => ignoreMatch(`gp:${gpMatch.orderId}`)}
              />
            </MatchCard>
          )}

          {/* Ник — не ключ: совпадений может быть несколько, поэтому список. */}
          {nickMatches.length > 0 && (
            <div style={{ border: "1px solid rgba(10,132,255,0.3)", background: "rgba(10,132,255,0.09)", borderRadius: 13, padding: "10px 11px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue }}>
                У ника {nickMatches.length === 1 ? "есть заказ" : `${nickMatches.length} заказа`}
              </div>
              <div style={{ fontSize: 11.5, color: C.textTertiary, marginTop: 3 }}>Выбери, если правишь один из них</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                {nickMatches.map(match => {
                  const meta = statusMeta(match.status);
                  return (
                    <button key={match.orderId} type="button" className="twa-press-sm"
                      disabled={!match.editable}
                      onClick={() => switchToOrder(match)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "8px 10px", borderRadius: 10, border: "none", cursor: match.editable ? "pointer" : "default",
                        background: "rgba(255,255,255,0.06)", textAlign: "left", fontFamily: "inherit",
                        opacity: match.editable ? 1 : 0.5,
                      }}>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{match.wbCode}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 999, background: `${meta.color}2a`, color: meta.color }}>{meta.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12, color: C.textSecondary }}>{match.amount.toLocaleString("ru-RU")}</span>
                    </button>
                  );
                })}
                <ActionRow icon="＋" label="Это новый заказ — продолжить"
                  onClick={() => nickMatches.forEach(m => ignoreMatch(`nick:${m.orderId}`))} />
              </div>
            </div>
          )}

          {/* Номер заказа WB / DBS — четвёртый вход в тот же заказ. Связь идёт
              через код гейта, поэтому номер просто разворачивается в него. */}
          {!editing && !isDirect && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={wbOrderId}
                onChange={e => setWbOrderId(e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="Номер заказа WB / DBS (опц.)"
                inputMode="numeric"
                style={{ ...inputStyle, fontFamily: MONO }}
              />
              {valid.wbOrder?.error && !valid.wbOrder.existing && warn(`✖ ${valid.wbOrder.error}`, C.red)}
              {valid.wbOrder && !valid.wbOrder.error && valid.wbOrder.gateCode && (
                <div style={{ fontSize: 13, color: C.green, lineHeight: 1.35 }}>
                  ✓ {valid.wbOrder.buyerName ?? "покупатель без имени"} · номинал <b>{valid.wbOrder.denomination} R$</b>
                  <span style={{ color: C.textTertiary }}> · код <b style={{ fontFamily: MONO }}>{valid.wbOrder.gateCode}</b></span>
                </div>
              )}
            </div>
          )}

          {/* По номеру заказа WB нашёлся уже созданный заказ на выкуп. */}
          {wbOrderMatch && (
            <MatchCard found={wbOrderMatch} tone="warn" title={`По заказу WB #${wbOrderId} выкуп уже открыт`}>
              <ActionRow
                icon="✎" tone="primary"
                label={wbOrderMatch.editable ? "Править этот заказ" : "Правка недоступна в этом статусе"}
                disabled={!wbOrderMatch.editable}
                onClick={() => switchToOrder(wbOrderMatch)}
              />
              <ActionRow icon="＋" label="Всё равно создать новый"
                onClick={() => ignoreMatch(`wb:${wbOrderMatch.orderId}`)} />
            </MatchCard>
          )}

          {/* Код ВБ. В правке — ключ заказа, менять нечем. */}
          {editing && target ? (
            <div style={lockedStyle}>
              <span style={{ fontFamily: MONO, letterSpacing: 2 }}>{target.wbCode}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5 }}>🔒 ключ заказа</span>
            </div>
          ) : !isDirect && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={wbCode}
                onChange={e => setWbCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7))}
                placeholder="Код ВБ (опц., 7 символов)"
                autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                style={{ ...inputStyle, fontFamily: MONO, letterSpacing: 2 }}
              />
              {codeState && !codeState.ok && !codeState.existing && warn(`✖ ${codeState.error}`, codeState.frozen ? C.ice : C.red)}
              {codeState?.ok && (
                <div style={{ fontSize: 13, color: C.green }}>
                  ✓ Номинал <b>{codeState.denomination} R$</b>
                  {codeState.claimedBy && (
                    <span style={{ color: C.textTertiary }}>{" · активирован: "}{userLabel(codeState.claimedBy).name}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Клиент. В правке — под замком: смена клиента это rebind. */}
          {editing && target ? (
            <div style={lockedStyle}>
              <span>{target.client ?? "клиент не привязан"}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5 }}>🔒 смена — «Перепривязать»</span>
            </div>
          ) : client ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "9px 12px" }}>
              <span style={{
                fontSize: 11, fontWeight: 800, color: "#fff",
                background: userLabel(client).platform === "TG" ? "#229ED9" : "#0077FF",
                borderRadius: 4, padding: "3px 6px", flexShrink: 0,
              }}>{userLabel(client).platform}</span>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {userLabel(client).name}
              </span>
              <button onClick={() => setClient(null)} style={{ background: "transparent", border: "none", color: C.textTertiary, fontSize: 17, cursor: "pointer", padding: 2 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input
                value={clientQuery}
                onChange={e => setClientQuery(e.target.value)}
                placeholder={isDirect ? "Юзер: @username, имя или ID" : "Клиент (опц.): @username, имя, ID"}
                style={inputStyle}
              />
              {searching && <div style={{ fontSize: 13, color: C.textTertiary }}>Поиск…</div>}
              {!newClientOpen && (
                <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); setNewClientOpen(true); }}
                  style={{
                    alignSelf: "flex-start", background: "transparent", border: "none", padding: "2px 0",
                    color: C.accent, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  }}>
                  ＋ Клиента нет в базе — завести по TG / VK ID
                </button>
              )}
              {newClientOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 11px", borderRadius: 12, background: "rgba(167,139,250,0.09)", border: `1px solid ${C.accent}44` }}>
                  <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.35 }}>
                    Заказ без клиента вешается на служебного юзера — уведомления такому «клиенту» не уйдут.
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={newTg} onChange={e => setNewTg(e.target.value.replace(/\D/g, ""))}
                      placeholder="Telegram ID" inputMode="numeric" style={{ ...inputStyle, fontFamily: MONO }} />
                    <input value={newVk} onChange={e => setNewVk(e.target.value.replace(/\D/g, ""))}
                      placeholder="VK ID" inputMode="numeric" style={{ ...inputStyle, fontFamily: MONO }} />
                  </div>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Имя (опц.)" style={inputStyle} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" className="twa-press-sm" onClick={() => { setNewClientOpen(false); }}
                      style={{ flex: 1, padding: "9px", borderRadius: 9, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Отмена
                    </button>
                    <button type="button" className="twa-press-sm" onClick={() => void createClient()}
                      disabled={busy || (!newTg && !newVk)}
                      style={{
                        flex: 2, padding: "9px", borderRadius: 9, border: "none", background: C.accent, color: "#fff",
                        fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                        opacity: busy || (!newTg && !newVk) ? 0.45 : 1,
                      }}>
                      Завести клиента
                    </button>
                  </div>
                </div>
              )}
              {clientResults.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
                  {clientResults.map(u => {
                    const lbl = userLabel(u);
                    return (
                      <button key={u.id} className="twa-press-sm"
                        onClick={() => { haptic.impact("light"); setClient(u); setClientQuery(""); setClientResults([]); if (u.robloxUsername && !nick) setNick(u.robloxUsername); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, width: "100%",
                          padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                          background: "rgba(255,255,255,0.06)", textAlign: "left",
                        }}>
                        <span style={{
                          fontSize: 11, fontWeight: 800, color: "#fff",
                          background: lbl.platform === "TG" ? "#229ED9" : lbl.platform === "VK" ? "#0077FF" : C.elevated,
                          borderRadius: 4, padding: "3px 6px", flexShrink: 0,
                        }}>{lbl.platform}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lbl.name}</div>
                          {u.robloxUsername && <div style={{ fontSize: 12, color: C.textTertiary }}>🎮 {u.robloxUsername}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Номинал. У прямого привязан к оплате — сервер откажет, поэтому замок. */}
          {(editing ? !target?.isDirectOrder : !isDirect && !codeState?.ok && !wbState?.denomination) ? (
            <input
              value={amount}
              onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="Номинал R$"
              inputMode="numeric"
              disabled={frozen}
              style={{ ...inputStyle, opacity: frozen ? 0.5 : 1 }}
            />
          ) : editing && target?.isDirectOrder ? (
            <div style={lockedStyle}>
              <span>{target.amount.toLocaleString("ru-RU")} R$</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5 }}>🔒 привязан к оплате</span>
            </div>
          ) : null}

          {/* Ник + поиск его for-sale пассов. В правке он теперь тоже есть —
              раньше поиск жил только в создании, и при снятом пассе новую ссылку
              приходилось искать где-то ещё и приносить руками. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                value={nick}
                onChange={e => { setNick(e.target.value); setGpFound([]); setGpSearchMsg(""); setSelectedDirectPass(null); }}
                placeholder={isDirect ? "Ник Roblox — сначала найди геймпасс" : "Ник Roblox или ссылка на профиль"}
                autoCapitalize="off" autoCorrect="off" spellCheck={false}
                disabled={frozen}
                style={{ ...inputStyle, flex: 1, width: "auto", minWidth: 0, opacity: frozen ? 0.5 : 1 }}
              />
              <button
                className="twa-press-sm"
                onClick={searchPassesByNick}
                disabled={gpSearching || frozen || nick.trim().length < 2}
                title="Найти for-sale геймпассы этого ника"
                style={{
                  flexShrink: 0, padding: "0 14px", border: "none", borderRadius: 10,
                  background: nick.trim().length >= 2 && !frozen ? C.accent : C.elevated, color: "#fff",
                  fontSize: 15, fontWeight: 600, cursor: gpSearching ? "default" : "pointer",
                  opacity: gpSearching || frozen || nick.trim().length < 2 ? 0.5 : 1,
                  fontFamily: "inherit", transition: "all 0.2s",
                }}
              >
                {gpSearching ? "…" : "🔍"}
              </button>
            </div>
            {gpSearchMsg && <div style={{ fontSize: 13, color: C.textTertiary }}>{gpSearchMsg}</div>}
            {gpFound.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 170, overflowY: "auto" }}>
                {gpFound.map(gp => {
                  const priceOk = expectedPrice != null && Math.abs(gp.price - expectedPrice) <= 2;
                  return (
                    <button key={gp.gamepassId} className="twa-press-sm"
                      onClick={() => {
                        haptic.impact("light");
                        setGpInput(`https://www.roblox.com/game-pass/${gp.gamepassId}`);
                        setSelectedDirectPass(gp);
                        if (!editing) setAmount(String(Math.floor(gp.price * 0.7)));
                        setGpFound([]); setGpSearchMsg("");
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "9px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: "rgba(255,255,255,0.06)", textAlign: "left",
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gp.name}</div>
                        {gp.existingOrder && (
                          <div style={{ fontSize: 12, color: C.orange }}>📦 уже в заказе {gp.existingOrder.wbCode}</div>
                        )}
                      </div>
                      <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 600, color: priceOk ? C.green : C.textSecondary }}>
                        {priceOk && "✓ "}{gp.price.toLocaleString("ru-RU")} R$
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Геймпасс */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={gpInput}
              onChange={e => { setGpInput(e.target.value); if (isDirect) setSelectedDirectPass(null); }}
              readOnly={isDirect && !editing}
              disabled={frozen}
              placeholder={isDirect && !editing ? "Выбери геймпасс из результатов поиска" : "Геймпасс: ссылка или ID"}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ ...inputStyle, opacity: frozen ? 0.5 : 1 }}
            />
            {gpState?.error && warn(`✖ ${gpState.error}`, C.red)}
            {gpState && !gpState.error && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {gpState.livePrice != null && (
                  <div style={{ fontSize: 13, color: gpState.priceMismatch ? C.orange : C.green }}>
                    {gpState.priceMismatch
                      ? `⚠️ Цена ГП ${gpState.livePrice} R$ ≠ расчётной ${gpState.expected} R$`
                      : `✓ Цена ГП ${gpState.livePrice} R$${gpState.expected ? ` (ожидается ${gpState.expected})` : ""}`}
                  </div>
                )}
                {gpState.isForSale === false && warn("⚠️ Геймпасс сейчас не в продаже")}
                {gpState.sellerMatch === false && warn("⚠️ Пасс не найден среди for-sale пассов этого ника")}
              </div>
            )}
            {checking && <div style={{ fontSize: 12, color: C.textTertiary }}>Проверяю…</div>}
            {isDirect && !editing && selectedDirectPass && (
              <div style={{ fontSize: 13, color: C.green }}>
                ✓ Клиенту: <b>{amount} R$</b> · цена пасса {selectedDirectPass.price.toLocaleString("ru-RU")} R$
              </div>
            )}
          </div>

          {/* Заметка и уведомление — только при создании. */}
          {!editing && (
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (опц.)" style={inputStyle} />
          )}
          {!editing && !isDirect && client && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />
              <span style={{ fontSize: 14, color: C.textSecondary }}>
                Уведомить клиента («код активирован → заказ в очереди»)
              </span>
            </label>
          )}

          {dup && (
            <div style={{ padding: "9px 12px", background: `${C.orange}18`, borderRadius: 10, fontSize: 13, color: C.orange, lineHeight: 1.4 }}>
              ⚠️ На этот геймпасс уже есть активный заказ <b style={{ fontFamily: MONO }}>{dup.wbCode}</b> ({dup.status}).
              Нажми «{editing ? "Сохранить всё равно" : "Создать всё равно"}», если это осознанный повтор.
            </div>
          )}
        </div>

        <div style={{ padding: "10px 20px 18px", display: "flex", flexDirection: "column", gap: 7, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="twa-press" onClick={onClose} disabled={busy}
              style={{ flex: 1, padding: "13px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              Отмена
            </button>
            <button className="twa-press"
              onClick={() => editing ? void saveEdit(!!dup) : void create(!!dup)}
              disabled={!canSubmit}
              style={{
                flex: 2, padding: "13px", borderRadius: 10, border: "none",
                background: dup ? C.orange : editing ? C.blue : C.accent, color: "#fff",
                fontSize: 15, fontWeight: 600, cursor: "pointer",
                opacity: canSubmit ? 1 : 0.45,
              }}>
              {busy ? "…"
                : dup ? (editing ? "Сохранить всё равно" : "Создать всё равно")
                  : editing
                    ? (editChanges.length ? `Сохранить · ${editChanges.join(", ")}` : "Сохранить")
                    : isDirect ? "Создать и поставить на выкуп" : "Создать заказ"}
            </button>
          </div>
          {/* Кнопка объясняет, почему она серая: раньше она просто гасла. */}
          {!canSubmit && !busy && (
            <div style={{ fontSize: 11.5, color: C.textTertiary, textAlign: "center" }}>
              {frozen ? "заказ заморожен — сначала сними заморозку"
                : editing ? "измени номинал, ник или геймпасс"
                  : `не хватает: ${missing.join(", ")}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
