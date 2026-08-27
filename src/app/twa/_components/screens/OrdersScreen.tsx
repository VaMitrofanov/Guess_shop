"use client";
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { haptic } from "../haptics";
import BottomSheet from "../BottomSheet";
import { toast } from "../Toast";
import CreateManualModal, { type RebindUser } from "../CreateManualModal";
import { isUnpaidDirect } from "@/lib/buyout-queue";

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ERROR";
// ATTENTION — не чип, а серверная выборка «Требуют внимания» для вкладки «Все».
type FilterTab = "WORK" | "ALL" | "BUYOUT" | "DIRECT" | "AVITO" | "NEW" | "ERROR" | "AWAITING_LINK" | "DONE" | "REJECTED" | "FAVORITES" | "ATTENTION";

// «Ждут ссылку»: сервер отдаёт первые N — самые свежие, дальше хвост от самых
// старых (см. fetchAwaitingLinkHybrid в api/twa/orders). Здесь — для разделителя.
const AWAITING_LINK_HEAD = 5;

/** Часть разбитого выкупа: заказ закрывается несколькими геймпассами. */
interface SplitPart {
  id: string;
  gamepassId: string;
  amount: number;
  position: number;
  chargedPrice: number | null;
  purchasedAt: string | null;
}

interface Order {
  id: string;
  amount: number;
  gamepassUrl: string | null;
  /** Пусто у обычного заказа — тогда работает единственный `gamepassUrl`. */
  splitGamepasses?: SplitPart[];
  status: OrderStatus;
  platform: string;
  wbCode: string;
  rejectionReason: string | null;
  adminNote: string | null;
  buyoutErrorCode: string | null;
  isDirectOrder: boolean;
  isFavorite: boolean;
  paymentDetails: string | null;
  purchaseRate: number | null;
  createdAt: string;
  updatedAt: string;
  pendingAt: string | null;
  /** Оплата прямого заказа подтверждена. null у прямого = вне очереди выкупа. */
  paidAt: string | null;
  takenAt: string | null;
  robloxUsername: string | null;
  probableNick: string | null;
  gpWatchNotifiedPassId: string | null;
  /** П3: клиент ответил «❌ Не мой ник» на GP-watch-пинг — дожимать вручную. */
  gpWatchDeclinedAt: string | null;
  purchaserUsername: string | null;
  orderSource: "WB" | "WB_DBS" | "DIRECT" | "AVITO" | "MANUAL" | "SITE";
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  /** true — сообщество не может написать VK-юзеру (VK 901); только личка менеджера. */
  vkUnreachable?: boolean | null;
  paymentAttempts?: Array<{
    status: "CREATED" | "INITIATED" | "AUTHORIZED" | "CONFIRMED" | "REJECTED" | "CANCELED" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED";
    amountKopecks: number;
    refundedAmountKopecks: number;
  }>;
  user: {
    tgId: string | null;
    vkId: string | null;
    name: string | null;
    username: string | null;
    balance: number | null;
    reviewBonusGrantedAt: string | null;
  };
}

/** Заявка прямого заказа (DirectIntent) — «⏳ Ожидаем реквизиты». */
interface Intent {
  id: string;
  amount: number;
  bonus: number;
  totalAmount: number;
  rublePrice: number;
  robloxUsername: string;
  gamepassId: string;
  gamepassUrl: string;
  platform: string;
  createdAt: string;
  prevOrders: number;
  user: Order["user"];
}

interface OrdersData {
  orders: Order[];
  total: number;
  counts: Record<string, number>;
  sums?: Record<string, number> | null;
  oldest?: Record<string, string | null> | null;
  page: number;
  pages: number;
}

interface EnrichValue {
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
  vkUnreachable?: boolean | null;
}

/** Живая проверка ГП (gp-live-check): фактическая цена vs ожидаемая по номиналу. */
interface GpLiveInfo {
  expected: number;
  livePrice: number | null;
  isForSale: boolean | null;
  priceMismatch: boolean;
  reusedIn: string | null;
}

const TAB_META: Record<FilterTab, { label: string; color: string }> = {
  WORK:          { label: "В работе",       color: C.accent },
  ALL:           { label: "Все",            color: C.textPrimary },
  BUYOUT:        { label: "К выкупу",       color: C.green },
  DIRECT:        { label: "Прямой",         color: C.blue },
  AVITO:         { label: "Авито",          color: C.orange },
  NEW:           { label: "Новые",          color: C.accent },
  ERROR:         { label: "Ошибка",         color: C.red },
  AWAITING_LINK: { label: "Ждут ссылку",    color: C.yellow },
  DONE:          { label: "Готово",          color: C.green },
  REJECTED:      { label: "Отменены",        color: C.red },
  FAVORITES:     { label: "Избранное",      color: "#ffd60a" },
  ATTENTION:     { label: "Требуют внимания", color: C.orange },
};

const FILTERS: { id: FilterTab }[] = [
  { id: "BUYOUT" },
  { id: "DIRECT" },
  { id: "AVITO" },
  { id: "NEW" },
  { id: "ERROR" },
  { id: "AWAITING_LINK" },
  { id: "DONE" },
  { id: "REJECTED" },
  { id: "FAVORITES" },
];

const ORDER_MODES: { id: "work" | "all" | "history"; label: string; filter: FilterTab; countKey: FilterTab }[] = [
  { id: "work", label: "В работе", filter: "WORK", countKey: "WORK" },
  { id: "all", label: "Все", filter: "ALL", countKey: "ALL" },
  { id: "history", label: "История", filter: "DONE", countKey: "DONE" },
];

const WORK_FILTERS = new Set<FilterTab>(["WORK", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "REJECTED", "FAVORITES", "ATTENTION"]);
/* Очереди, где выгрузка ID геймпассов имеет смысл: заказ уже с геймпассом и ждёт выкупа.
   Список синхронен `GAMEPASS_EXPORT_TABS` в `api/twa/orders`. */
const EXPORTABLE_TABS = new Set<FilterTab>(["BUYOUT", "DIRECT", "AVITO", "WORK", "ERROR", "ATTENTION"]);
const COUNTABLE_EXPORT_TABS = new Set<FilterTab>(["BUYOUT", "DIRECT", "AVITO"]);

function orderTabBadge(order: Order): { label: string; color: string } | null {
  const cutoff = Date.now() - 40 * 3600_000;
  const created = new Date(order.createdAt).getTime();

  if (order.isFavorite) return { label: "Избранное", color: "#ffd60a" };
  if (order.status === "COMPLETED") return { label: "Готово", color: C.green };
  if (order.status === "REJECTED") return { label: "Отменено", color: C.red };
  if (order.status === "ERROR") return { label: "Ошибка", color: C.red };
  if (order.orderSource === "AVITO" && ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
    return { label: "Авито", color: C.orange };
  if (order.isDirectOrder && ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status))
    return { label: "Прямой", color: C.blue };
  if (order.status === "AWAITING_GAMEPASS" && created > cutoff) return { label: "Новые", color: C.accent };
  if (order.status === "AWAITING_GAMEPASS" && created <= cutoff) return { label: "Ждут ссылку", color: C.yellow };
  if (["PENDING", "IN_PROGRESS"].includes(order.status)) return { label: "К выкупу", color: C.green };
  return null;
}

/* ───────────── Time formatting ───────────── */
function fmtAge(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return "< 1 мин";
  if (mins < 60) return `${Math.round(mins)} мин`;
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d === 0) return `${h}ч`;
  const rem = h % 24;
  return rem > 0 ? `${d}д ${rem}ч` : `${d}д`;
}
function ageColor(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 120) return C.green;
  if (mins < 720) return C.yellow;
  if (mins < 1440) return C.orange;
  return C.red;
}

function fallbackCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "-9999px";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(el);
}

function copyText(text: string) {
  if (typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
    fallbackCopy(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="twa-press-sm"
      onClick={e => {
        e.stopPropagation();
        copyText(text);
        haptic.impact("light");
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
        if (label) toast(`${label} скопирован`, "success");
      }}
      style={{
        background: copied ? `${C.green}26` : "transparent",
        border: "none",
        borderRadius: 8,
        color: copied ? C.green : C.textSecondary,
        fontSize: 14,
        fontWeight: 500,
        padding: "8px 14px",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {copied ? "✓" : "Скопировать"}
    </button>
  );
}

/* ───────────── Выгрузка ID геймпассов очереди ───────────── */

interface GamepassExportItem {
  wbCode: string; gamepassId: string; gamepassUrl: string; amount: number;
  status: string; orderSource: string; robloxUsername: string | null; waitingHours: number;
}
interface GamepassExportData {
  tab: string; total: number; totalRobux: number;
  skippedUnpaid: number; skippedNoGamepass: number; truncated: boolean;
  items: GamepassExportItem[];
}

type ExportFormat = "ids" | "table" | "urls";

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "ids",   label: "Только ID" },
  { id: "table", label: "ID · ник · R$" },
  { id: "urls",  label: "Ссылки" },
];

/* Выкупаем вручную, поэтому нужен весь список ID сразу: по одному из карточек — долго.
   Формат по умолчанию — чистые ID построчно, чтобы можно было вставить пачкой. */
function buildExportText(items: GamepassExportItem[], format: ExportFormat) {
  if (format === "urls") return items.map(i => `https://www.roblox.com/game-pass/${i.gamepassId}`).join("\n");
  if (format === "table") {
    return items.map(i => [i.gamepassId, i.robloxUsername ?? "—", `${i.amount} R$`, i.wbCode].join(" · ")).join("\n");
  }
  return items.map(i => i.gamepassId).join("\n");
}

function GamepassExportSheet({ token, tab, tabLabel, onClose }: {
  token: string; tab: FilterTab; tabLabel: string; onClose: () => void;
}) {
  const [data, setData] = useState<GamepassExportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<ExportFormat>("ids");

  useEffect(() => {
    let alive = true;
    fetch(`/api/twa/orders?export=gamepass-ids&status=${tab}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive) setData(d); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, tab]);

  const text = data ? buildExportText(data.items, format) : "";

  return (
    <BottomSheet open onClose={onClose} ariaLabel={`Выгрузка ID геймпассов — ${tabLabel}`}>
      <div style={{ padding: "4px 18px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>ID геймпассов · {tabLabel}</div>
          <div style={{ fontSize: 14, color: C.textSecondary, marginTop: 4 }}>
            {loading ? "Собираю очередь…" : data
              ? <>{data.total} шт · {data.totalRobux.toLocaleString("ru-RU")} R$ к выкупу</>
              : "Не удалось загрузить"}
          </div>
        </div>

        {!loading && data && data.total > 0 && (
          <>
            <div style={{ display: "flex", background: C.elevated, borderRadius: 10, padding: 3, gap: 2 }}>
              {EXPORT_FORMATS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  className="twa-press-sm"
                  onClick={() => { haptic.select(); setFormat(f.id); }}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer",
                    fontSize: 14, fontWeight: format === f.id ? 600 : 400, whiteSpace: "nowrap",
                    background: format === f.id ? C.card : "transparent",
                    color: format === f.id ? C.textPrimary : C.textSecondary,
                  }}
                >{f.label}</button>
              ))}
            </div>

            <textarea
              readOnly
              value={text}
              onFocus={e => e.currentTarget.select()}
              style={{
                width: "100%", minHeight: 190, maxHeight: 320, resize: "vertical",
                background: C.bgElevated, color: C.textPrimary, border: `1px solid ${C.border}`,
                borderRadius: 12, padding: 12, fontSize: 14, fontFamily: MONO, lineHeight: 1.5,
                ...tabular,
              }}
            />

            {(data.skippedUnpaid > 0 || data.skippedNoGamepass > 0 || data.truncated) && (
              <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5 }}>
                {data.skippedUnpaid > 0 && <div>· не вошли неоплаченные прямые: {data.skippedUnpaid}</div>}
                {data.skippedNoGamepass > 0 && <div>· без ссылки на геймпасс: {data.skippedNoGamepass}</div>}
                {data.truncated && <div>· показаны первые 500 заказов очереди</div>}
              </div>
            )}
          </>
        )}

        {!loading && data && data.total === 0 && (
          <div style={{ fontSize: 14, color: C.textSecondary }}>
            В очереди «{tabLabel}» нет заказов с геймпассом.
            {data.skippedUnpaid > 0 && <> Неоплаченных прямых: {data.skippedUnpaid}.</>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, padding: "0 18px" }}>
        <button
          type="button"
          className="twa-press-sm"
          disabled={!text}
          onClick={() => {
            copyText(text);
            haptic.impact("medium");
            toast(`${data?.total ?? 0} ID скопировано`, "success");
          }}
          style={{
            flex: 1, padding: "14px 0", borderRadius: 12, border: "none",
            background: text ? C.accent : C.elevated, color: text ? "#fff" : C.textTertiary,
            fontSize: 16, fontWeight: 600, cursor: text ? "pointer" : "default",
          }}
        >Скопировать всё</button>
        <button
          type="button"
          className="twa-press-sm"
          onClick={onClose}
          style={{
            padding: "14px 20px", borderRadius: 12, border: "none",
            background: C.elevated, color: C.textPrimary, fontSize: 16, cursor: "pointer",
          }}
        >Закрыть</button>
      </div>
    </BottomSheet>
  );
}

/* ───────────── Contact ───────────── */
function openContact(user: Order["user"]) {
  const tg = (typeof window !== "undefined" ? window.Telegram?.WebApp : undefined) as any;
  if (user.username) {
    const url = `https://t.me/${user.username}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank");
    return;
  }
  if (user.tgId) {
    const deepLink = `tg://user?id=${user.tgId}`;
    try { tg?.openLink?.(deepLink); } catch {}
    try { window.location.href = deepLink; } catch {}
    copyText(String(user.tgId));
    toast(`ID ${user.tgId} скопирован`, "success");
    return;
  }
  if (user.vkId) {
    const url = `https://vk.com/im?sel=${user.vkId}`;
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  }
}

function userShortName(u: Order["user"]): string {
  if (u.username) return `@${u.username}`;
  const realName = u.name && u.name !== "VK User" ? u.name : null;
  if (realName) {
    const parts = realName.split(" ");
    return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  }
  if (u.tgId) return `TG ${u.tgId}`;
  if (u.vkId) return `VK ${u.vkId}`;
  return "—";
}

function extractGamepassId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

type ActionResult = { ok: boolean; error?: string };

/* ───────────── DataRow ───────────── */
function DataRow({ icon, children, copyText: ct }: {
  icon: string; children: React.ReactNode; copyText?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "7px 0", minWidth: 0,
    }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </div>
      {ct && <CopyBtn text={ct} />}
    </div>
  );
}

/* ───────────── NotesEditor ───────────── */
function NotesEditor({ order, onSave }: { order: Order; onSave: (note: string) => Promise<ActionResult> }) {
  const [note, setNote] = useState(order.adminNote ?? "");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const lastSaved = useRef(order.adminNote ?? "");
  useEffect(() => {
    if ((order.adminNote ?? "") !== lastSaved.current) {
      lastSaved.current = order.adminNote ?? "";
      setNote(order.adminNote ?? "");
    }
  }, [order.adminNote]);

  const dirty = note.trim() !== lastSaved.current.trim();

  async function commit() {
    if (!dirty || saving) return;
    setSaving(true);
    const res = await onSave(note.trim());
    setSaving(false);
    if (res.ok) {
      lastSaved.current = note.trim();
      haptic.notify("success");
      setFlash(true); setTimeout(() => setFlash(false), 1600);
    }
  }

  const hasNote = !!(order.adminNote && order.adminNote.trim());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
          Заметка
        </span>
        {flash && <span style={{ fontSize: 14, color: C.green, fontWeight: 600 }}>✓</span>}
      </div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
        placeholder="Заметка…"
        rows={2}
        style={{
          background: hasNote ? `${C.yellow}14` : "rgba(255,255,255,0.06)",
          border: hasNote ? `1px solid ${C.yellow}40` : "1px solid transparent",
          borderRadius: 10, color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
          padding: "10px 12px", resize: "vertical", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      {dirty && (
        <button
          className="twa-press"
          onClick={e => { e.stopPropagation(); commit(); }}
          disabled={saving}
          style={{
            alignSelf: "flex-start", padding: "8px 16px", borderRadius: 8, border: "none",
            background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600,
            cursor: "pointer", opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "Сохранить"}
        </button>
      )}
    </div>
  );
}

/* ───────────── ActionPanel per tab ───────────── */
function ActionPanel({
  order, currentTab, token, onRunAction, onPurchaseDone,
}: {
  order: Order;
  currentTab: FilterTab;
  token: string;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onPurchaseDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  const showPanel =
    currentTab === "BUYOUT" ||
    currentTab === "DIRECT" ||
    currentTab === "AVITO" ||
    currentTab === "ERROR";

  if (!showPanel) return null;

  async function doAction(action: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    const res = await onRunAction(action);
    setLoading(false);
    busyRef.current = false;
  }

  async function doPurchase() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "purchase", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      if (d.success) {
        haptic.notify("success");
        // У разбитого заказа успех бывает промежуточным: часть куплена, заказ
        // ещё открыт. Тост обязан это различать, иначе «✅» читается как
        // «заказ закрыт», и следующую часть никто не выкупит.
        toast(d.splitDone === false ? `🧩 ${d.msg}` : `✅ ${d.msg}`, "success");
        onPurchaseDone?.();
      } else {
        haptic.notify("error");
        toast(`❌ ${d.msg}`, "error");
      }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { busyRef.current = false; setLoading(false); }
  }

  const showError = currentTab !== "ERROR";
  const split = order.splitGamepasses ?? [];
  const splitDone = split.filter(p => p.purchasedAt).length;
  const hasGamepass = !!order.gamepassUrl || split.length > 0;

  // Прямой заказ до подтверждения оплаты: выкупать/завершать нечего (сервер
  // отвергнет), оплату подтверждает скриншот в боте. Доступна только отмена.
  if (["AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "12px 16px 16px" }}>
        <span style={{
          flex: 1, padding: "12px 14px", borderRadius: 12,
          background: `${C.yellow}14`, color: C.yellow, fontSize: 14, fontWeight: 600,
        }}>
          💳 {order.status === "PAYMENT_PENDING" ? "Ждём оплату — скрин придёт в бота" : "Ожидает реквизиты"}
        </span>
        <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
          style={{ width: 44, flexShrink: 0, padding: "14px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          ✕
        </button>
      </div>
    );
  }

  const isError = currentTab === "ERROR" && order.status === "ERROR";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 16px 16px" }}>
      {isError && hasGamepass && (
        <button className="twa-press" onClick={() => doAction("restore-to-buyout")} disabled={loading}
          style={{ width: "100%", padding: "14px", border: "none", borderRadius: 12, background: "rgba(48,209,88,0.18)", color: C.green, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "⏳…" : "↩ Вернуть к выкупу"}
        </button>
      )}
      <div style={{ display: "flex", gap: 8 }}>
      {hasGamepass && (
        <button className="twa-press" onClick={doPurchase} disabled={loading}
          style={{ flex: 2, padding: "14px", border: "none", borderRadius: 12, background: "rgba(48,209,88,0.14)", color: "#30d158", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading
            ? "⏳…"
            : split.length > 0
              // Кнопка называет, что именно произойдёт по нажатию: покупается
              // одна часть, а не весь заказ.
              ? `Выкупить часть ${Math.min(splitDone + 1, split.length)}/${split.length}`
              : isError ? "Повторить выкуп" : "Выкупить"}
        </button>
      )}
      {showError && (
        <button className="twa-press" onClick={() => doAction("set-error")} disabled={loading}
          style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: "rgba(255,149,0,0.12)", color: C.orange, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          Ошибка
        </button>
      )}
      <button className="twa-press" onClick={() => doAction("complete")} disabled={loading}
        style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: "rgba(10,132,255,0.12)", color: C.blue, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
        Выкуплено
      </button>
      <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
        style={{ width: 44, flexShrink: 0, padding: "14px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
        ✕
      </button>
      </div>
    </div>
  );
}

/* ───────────── MoveToModal ───────────── */
// Все разделы, кроме текущего (перенаправляем ИЗ него — выбор себя бессмыслен,
// фильтруется по currentTab). «Все» намеренно не является целью: это общая куча.
const MOVE_TARGETS: { id: string; label: string; color: string }[] = [
  { id: "BUYOUT", label: "К выкупу", color: C.green },
  { id: "DIRECT", label: "Прямой выкуп", color: C.blue },
  { id: "AVITO", label: "Авито", color: C.orange },
  { id: "NEW", label: "Новые", color: C.accent },
  { id: "ERROR", label: "Ошибка", color: C.red },
  { id: "AWAITING_LINK", label: "Ждут ссылку", color: C.yellow },
  { id: "DONE", label: "Готово", color: C.green },
  { id: "REJECTED", label: "Отменены", color: C.red },
  { id: "FAVORITES", label: "Избранное", color: "#ffd60a" },
];

function MoveToModal({ order, token, currentTab, onDone, onClose }: {
  order: Order; token: string; currentTab: FilterTab; onDone: () => void; onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!target || !note.trim()) {
      toast("Выберите раздел и напишите заметку", "error");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "move-to", orderId: order.id, target, note: note.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast("Перенесено", "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px",
      borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Перевести в раздел:</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {MOVE_TARGETS.filter(t => t.id !== currentTab).map(t => (
          <button key={t.id} className="twa-press-sm"
            onClick={() => setTarget(t.id)}
            style={{
              padding: "8px 14px", borderRadius: 999, border: "none", cursor: "pointer",
              background: target === t.id ? `${t.color}33` : "rgba(255,255,255,0.08)",
              color: target === t.id ? t.color : C.textSecondary,
              fontSize: 14, fontWeight: 600,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <textarea
        placeholder="Заметка (обязательно)…"
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        style={{
          background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
          color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
          padding: "10px 12px", resize: "none", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !target || !note.trim()}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading || !target || !note.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Перевести"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── Edit Order Modal — правка номинала/ника/ГП за клиента ───────────── */
function EditOrderModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(order.amount));
  const [gpInput, setGpInput] = useState(order.gamepassUrl ?? "");
  const [nick, setNick] = useState(order.robloxUsername ?? "");
  // Дедуп ГП: сервер вернул 409 + existing — просим подтвердить force-сохранение.
  const [dup, setDup] = useState<{ wbCode: string; status: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const amt = parseInt(amount, 10) || 0;
  // Прайс-гард пропустит выкуп только по этой цене — показываем сразу.
  const expected = amt > 0 ? Math.ceil(amt / 0.7) : 0;
  const dirty =
    (!order.isDirectOrder && amt !== order.amount) ||
    gpInput.trim() !== (order.gamepassUrl ?? "") ||
    nick.trim() !== (order.robloxUsername ?? "");

  async function submit(force = false) {
    if (!order.isDirectOrder && (!amt || amt < 1)) { toast("Укажи номинал R$", "error"); return; }
    setLoading(true);
    try {
      const payload: any = {
        action: "edit-order", orderId: order.id,
        gamepassUrl: gpInput.trim(),
        robloxUsername: nick.trim(),
      };
      if (!order.isDirectOrder) payload.amount = amt;
      if (force) payload.force = true;
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (r.status === 409 && d.existing) { haptic.notify("warning"); setDup(d.existing); return; }
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast("Сохранено", "success");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
    color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
  };

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px",
      borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.orange }}>✏️ Редактировать заказ</div>
      {order.isDirectOrder ? (
        <div style={{ fontSize: 14, color: C.textTertiary }}>
          Номинал {order.amount.toLocaleString("ru-RU")} R$ привязан к оплате — правь ник/геймпасс
        </div>
      ) : (
        <>
          <input value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ""))} placeholder="Номинал R$" inputMode="numeric"
            style={inputStyle} />
          {expected > 0 && (
            <div style={{ fontSize: 14, color: C.textTertiary }}>
              → выкуп пройдёт только с пассом за <span style={{ color: C.textSecondary, fontWeight: 600 }}>{expected.toLocaleString("ru-RU")} R$</span>
            </div>
          )}
        </>
      )}
      <input value={gpInput} onChange={e => { setGpInput(e.target.value); setDup(null); }} placeholder="ID или URL геймпасса (пусто — снять)"
        style={inputStyle} />
      <input value={nick} onChange={e => setNick(e.target.value)} placeholder="Ник Roblox (продавец пасса)"
        style={inputStyle} />
      {dup && (
        <div style={{ fontSize: 14, fontWeight: 600, color: C.orange }}>
          ⚠️ Этот геймпасс уже в заказе {dup.wbCode} ({dup.status}) — сохранить всё равно?
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={() => submit(!!dup)} disabled={loading || !dirty}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: dup ? C.red : C.orange, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading || !dirty ? 0.5 : 1 }}>
          {loading ? "…" : dup ? "Сохранить всё равно" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function RefundModal({ order, token, onDone, onClose }: { order: Order; token: string; onDone: () => void; onClose: () => void }) {
  const payment = order.paymentAttempts?.[0];
  const remaining = payment ? payment.amountKopecks - payment.refundedAmountKopecks : 0;
  const [rubles, setRubles] = useState((remaining / 100).toFixed(2));
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit() {
    const amountKopecks = Math.round(Number(rubles.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0 || amountKopecks > remaining) {
      toast("Проверь сумму возврата", "error"); return;
    }
    if (!window.confirm(`Вернуть ${(amountKopecks / 100).toFixed(2)} ₽ по заказу ${order.wbCode}?`)) return;
    setLoading(true);
    try {
      const response = await fetch("/api/twa/payments/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orderId: order.id, amountKopecks, reason: reason.trim() || undefined, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { toast(data.error ?? "Возврат не отправлен", "error"); return; }
      haptic.notify("success"); toast("Возврат отправлен; ждём callback банка", "success"); onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }
  return (
    <div onClick={event => event.stopPropagation()} style={{ padding: "12px 14px", borderTop: `1px solid ${C.hairline}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <b style={{ color: C.red }}>↩️ Возврат · доступно {(remaining / 100).toFixed(2)} ₽</b>
      <input value={rubles} onChange={event => setRubles(event.target.value)} inputMode="decimal" placeholder="Сумма, ₽" style={{ background: C.elevated, color: C.textPrimary, border: 0, borderRadius: 10, padding: 12 }} />
      <input value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Причина (для аудита)" style={{ background: C.elevated, color: C.textPrimary, border: 0, borderRadius: 10, padding: 12 }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClose} style={{ flex: 1, padding: 12, border: 0, borderRadius: 10, background: C.elevated, color: C.textSecondary }}>Отмена</button>
        <button disabled={loading} onClick={submit} style={{ flex: 2, padding: 12, border: 0, borderRadius: 10, background: C.red, color: "#fff", fontWeight: 700 }}>{loading ? "…" : "Вернуть"}</button>
      </div>
    </div>
  );
}

/* ───────────── RebindModal ───────────── */
// RebindUser — общий тип, живёт в CreateManualModal (модалка тоже ищет клиентов).
function RebindModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RebindUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RebindUser | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "search-users", query: query.trim() }),
        });
        const d = await r.json();
        if (r.ok && d.users) setResults(d.users);
        else toast(d.error ?? "Ошибка поиска", "error");
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, token]);

  async function submit() {
    if (!selected) return;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "rebind-order", orderId: order.id, targetUserId: selected.id, note: note.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); setLoading(false); return; }
      haptic.notify("success");
      // Честный статус доставки — как у 📎-привязки (VK 901 теряется молча).
      if (d.notified) toast(`Перепривязан · клиент уведомлён (${String(d.notified).toUpperCase()})`, "success");
      else toast("Перепривязан, но уведомление клиенту НЕ доставлено", "error");
      onDone();
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  const currentOwner = userShortName(order.user);
  const currentPlatform = order.user.tgId ? "TG" : order.user.vkId ? "VK" : "—";

  function userLabel(u: RebindUser) {
    const platform = u.tgId ? "TG" : u.vkId ? "VK" : "—";
    const name = u.username ? `@${u.username}` : u.name || u.tgId || u.vkId || u.id.slice(-6);
    return { platform, name };
  }

  if (selected) {
    const tgt = userLabel(selected);
    return (
      <div onClick={e => e.stopPropagation()} style={{
        padding: "12px 14px 14px", borderTop: `1px solid ${C.hairline}`,
        background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Перепривязать заказ?</div>
        <div style={{
          background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 15, color: C.textPrimary }}>
            <span style={{ fontWeight: 700, fontFamily: MONO, color: C.accent }}>{order.wbCode}</span>
            <span style={{ color: C.textTertiary }}> · </span>
            <span style={{ fontWeight: 600 }}>{Math.ceil(order.amount / 0.7).toLocaleString("ru-RU")} R$</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, color: C.textSecondary }}>
            <span>{currentOwner} ({currentPlatform})</span>
            <span style={{ color: C.accent }}>→</span>
            <span style={{ color: C.textPrimary, fontWeight: 600 }}>{tgt.name} ({tgt.platform})</span>
          </div>
          {selected.robloxUsername && (
            <div style={{ fontSize: 14, color: C.textTertiary }}>🎮 {selected.robloxUsername}</div>
          )}
        </div>
        <input
          value={note} onChange={e => setNote(e.target.value)} placeholder="Заметка (опц.)…"
          style={{
            width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
            color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="twa-press" onClick={() => setSelected(null)}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            Назад
          </button>
          <button className="twa-press" onClick={submit} disabled={loading}
            style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
            {loading ? "…" : "Перепривязать"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px", borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
        🔄 Перепривязать {order.wbCode}
      </div>
      <div style={{ fontSize: 13, color: C.textTertiary }}>
        Сейчас: {currentOwner} ({currentPlatform})
      </div>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="@username, имя, ID или ник Roblox"
        autoFocus
        style={{
          width: "100%", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
          color: "#fff", fontSize: 15, padding: "10px 12px", outline: "none", fontFamily: "inherit", boxSizing: "border-box",
        }}
      />
      {searching && <div style={{ fontSize: 13, color: C.textTertiary }}>Поиск…</div>}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
          {results.map(u => {
            const lbl = userLabel(u);
            return (
              <button key={u.id} className="twa-press-sm" onClick={() => { haptic.impact("light"); setSelected(u); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "10px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: "rgba(255,255,255,0.06)", textAlign: "left",
                }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, color: "#fff",
                  background: lbl.platform === "TG" ? "#229ED9" : lbl.platform === "VK" ? "#0077FF" : C.elevated,
                  borderRadius: 4, padding: "3px 6px", flexShrink: 0,
                }}>{lbl.platform}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lbl.name}
                  </div>
                  {u.robloxUsername && (
                    <div style={{ fontSize: 13, color: C.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      🎮 {u.robloxUsername}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {query.trim().length >= 2 && !searching && results.length === 0 && (
        <div style={{ fontSize: 13, color: C.textTertiary }}>Никого не найдено</div>
      )}
      <button className="twa-press" onClick={onClose}
        style={{ padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
        Отмена
      </button>
    </div>
  );
}

/* ───────────── DONE tab: accordion grouped by purchaserUsername ───────────── */
type SourceFilter = "ALL" | "WB" | "WB_DBS" | "DIRECT" | "AVITO" | "MANUAL" | "SITE";
const SOURCE_CHIPS: { id: SourceFilter; label: string; color: string }[] = [
  { id: "ALL",    label: "Все",     color: C.textPrimary },
  { id: "WB",     label: "WB",      color: C.green },
  { id: "WB_DBS", label: "WB DBS",  color: C.accent },
  { id: "DIRECT", label: "Прямой",  color: C.blue },
  { id: "SITE",   label: "Сайт",    color: C.blue },
  { id: "AVITO",  label: "Авито",   color: C.orange },
  { id: "MANUAL", label: "Ручные",  color: C.textTertiary },
];

const SOURCE_BADGE_META: Record<string, { label: string; color: string }> = {
  WB:     { label: "WB",     color: C.green },
  WB_DBS: { label: "WB DBS", color: C.accent },
  DIRECT: { label: "Прямой", color: C.blue },
  SITE:   { label: "Сайт",   color: C.blue },
  AVITO:  { label: "Авито",  color: C.orange },
  MANUAL: { label: "Ручной", color: C.textTertiary },
};

interface DoneGroup {
  purchaser: string;
  orders: Order[];
  totalDirty: number;
  latestDate: string;
}

function buildDoneGroups(orders: Order[], sourceFilter: SourceFilter): DoneGroup[] {
  const filtered = sourceFilter === "ALL" ? orders : orders.filter(o => o.orderSource === sourceFilter);
  const map = new Map<string, Order[]>();
  for (const o of filtered) {
    const key = o.purchaserUsername ?? "Ручные";
    const arr = map.get(key);
    if (arr) arr.push(o); else map.set(key, [o]);
  }
  const groups: DoneGroup[] = [];
  for (const [purchaser, ords] of map) {
    ords.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    groups.push({
      purchaser,
      orders: ords,
      totalDirty: ords.reduce((s, o) => s + Math.ceil(o.amount / 0.7), 0),
      latestDate: ords[0].updatedAt,
    });
  }
  groups.sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  return groups;
}

function countBySource(orders: Order[]): Record<SourceFilter, number> {
  const c: Record<string, number> = { ALL: orders.length, WB: 0, WB_DBS: 0, DIRECT: 0, AVITO: 0, MANUAL: 0 };
  for (const o of orders) c[o.orderSource] = (c[o.orderSource] ?? 0) + 1;
  return c as Record<SourceFilter, number>;
}

function pluralPurchases(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n} покупка`;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return `${n} покупки`;
  return `${n} покупок`;
}

function fmtTxDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

function extractGpId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/game-pass(?:es)?\/(\d+)/i);
  return m ? m[1] : null;
}

function DoneAccordion({ group, token, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onMoved, exiting }: {
  group: DoneGroup;
  token: string;
  onRunAction: (order: Order, action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (orderId: string, note: string) => Promise<ActionResult>;
  onPurchaseDone: (order: Order) => void;
  onToggleFavorite: (order: Order) => void;
  onMoved: (order: Order) => void;
  exiting: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      <button
        className="twa-press"
        onClick={() => { haptic.impact("light"); setOpen(v => !v); }}
        style={{
          width: "100%", padding: "14px 16px", border: "none", background: "transparent",
          display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
          textAlign: "left", fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600, color: "#e5e5ea", flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          🎮 {group.purchaser}
        </span>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.orange, ...tabular }}>
            − {group.totalDirty.toLocaleString("ru-RU")} R$
          </span>
          <span style={{ fontSize: 13, color: C.textTertiary }}>
            {pluralPurchases(group.orders.length)}
          </span>
        </div>
        <span style={{
          fontSize: 13, color: C.textTertiary, flexShrink: 0,
          transform: open ? "rotate(90deg)" : "none",
          transition: "transform 0.2s",
        }}>▶</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 10px 10px" }}>
          <div style={{ height: 1, background: C.border }} />
          {group.orders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              token={token}
              currentTab={"DONE" as FilterTab}
              exiting={exiting.has(order.id)}
              onRunAction={(action, reason) => onRunAction(order, action, reason)}
              onSaveNote={(note) => onSaveNote(order.id, note)}
              onPurchaseDone={() => { onPurchaseDone(order); }}
              onToggleFavorite={() => { onToggleFavorite(order); }}
              onMoved={() => { onMoved(order); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Разбиение выкупа: выбор пассов ─────────────
   Админ отмечает пассы покупателя, сумма номиналов должна сойтись с заказом.
   Номинал берётся из цены самого пасса (floor(price·0.7)), а не вводится
   руками: набранное число, разошедшееся с реальной ценой, сервер всё равно
   отвергнет прайс-гардом — лучше не давать его набрать. */
function SplitModal({ order, token, onDone, onClose }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
}) {
  type Candidate = { gamepassId: string; name: string; price: number; amount: number; busyWith: string | null };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nick, setNick] = useState<string | null>(null);
  const [passes, setPasses] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<string[]>(() => (order.splitGamepasses ?? []).map(p => p.gamepassId));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "split-candidates", orderId: order.id }),
        });
        const d = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok) { toast(d?.error ?? "Не нашли геймпассы", "error"); return; }
        setNick(d.nick ?? null);
        setPasses(d.passes ?? []);
      } catch { if (alive) toast("Ошибка сети", "error"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [order.id, token]);

  const byId = new Map(passes.map(p => [p.gamepassId, p]));
  const picked = chosen.map(id => byId.get(id)).filter(Boolean) as Candidate[];
  const sum = picked.reduce((acc, p) => acc + p.amount, 0);
  const diff = sum - order.amount;
  const canSave = picked.length >= 2 && diff === 0 && !saving;

  function toggle(id: string) {
    haptic.select();
    setChosen(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "set-gamepass-split",
          orderId: order.id,
          parts: picked.map(p => ({ gamepassId: p.gamepassId, amount: p.amount })),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { haptic.notify("error"); toast(d?.error ?? "Ошибка", "error"); return; }
      haptic.notify("success");
      toast(`🧩 Разбит на ${picked.length} — выкупай по частям`, "success");
      onDone();
      onClose();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setSaving(false); }
  }

  async function clearSplit() {
    setSaving(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "clear-gamepass-split", orderId: order.id }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { haptic.notify("error"); toast(d?.error ?? "Ошибка", "error"); return; }
      toast("Разбиение снято", "success");
      onDone(); onClose();
    } catch { toast("Ошибка сети", "error"); }
    finally { setSaving(false); }
  }

  const hasPurchased = (order.splitGamepasses ?? []).some(p => p.purchasedAt);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div style={{ background: C.card, borderRadius: 18, width: "100%", maxWidth: 400, maxHeight: "84vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 20px 10px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#e5e5ea" }}>🧩 Разбить выкуп</div>
          <div style={{ fontSize: 13, color: C.textTertiary, marginTop: 4 }}>
            Заказ на <b style={{ color: C.textSecondary }}>{order.amount.toLocaleString("ru-RU")} R$</b>
            {nick ? <> · пассы <b style={{ color: C.textSecondary }}>{nick}</b></> : null}
          </div>
        </div>

        {hasPurchased && (
          <div style={{ margin: "0 20px 10px", padding: "10px 12px", borderRadius: 10, background: `${C.yellow}14`, color: C.yellow, fontSize: 13, fontWeight: 600 }}>
            Часть уже выкуплена — менять состав нельзя, только снять разбиение целиком.
          </div>
        )}

        <div style={{ overflowY: "auto", flex: 1, padding: "0 20px" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 15 }}>Ищу геймпассы…</div>
          ) : passes.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: C.textTertiary, fontSize: 14 }}>
              У этого ника не нашли пассов на продажу
            </div>
          ) : passes.map(p => {
            const on = chosen.includes(p.gamepassId);
            const order_ = chosen.indexOf(p.gamepassId);
            const blocked = !!p.busyWith || hasPurchased;
            return (
              <button key={p.gamepassId} className="twa-press"
                onClick={() => !blocked && toggle(p.gamepassId)}
                disabled={blocked}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                  padding: "10px 12px", marginBottom: 6, borderRadius: 12, cursor: blocked ? "not-allowed" : "pointer",
                  background: on ? `${C.accent}22` : C.elevated,
                  border: `1px solid ${on ? C.accent : "transparent"}`,
                  opacity: blocked ? 0.45 : 1,
                }}>
                <span style={{
                  width: 22, height: 22, flexShrink: 0, borderRadius: 7, display: "grid", placeItems: "center",
                  background: on ? C.accent : "transparent", border: on ? "none" : `1px solid ${C.border}`,
                  color: "#fff", fontSize: 12, fontWeight: 800,
                }}>{on ? order_ + 1 : ""}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: 12, color: C.textTertiary, fontVariantNumeric: "tabular-nums" }}>
                    пасс {p.price.toLocaleString("ru-RU")} R$ · {p.gamepassId}
                    {p.busyWith ? ` · занят ${p.busyWith}` : ""}
                  </span>
                </span>
                <span style={{ fontSize: 14, fontWeight: 800, color: on ? C.accent : C.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                  {p.amount.toLocaleString("ru-RU")}
                </span>
              </button>
            );
          })}
        </div>

        {/* Итог: сумма обязана сойтись точно — сервер допуска не даёт. */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: C.textTertiary }}>Выбрано {picked.length}:</span>
            <b style={{ color: diff === 0 && picked.length >= 2 ? C.green : C.textSecondary }}>{sum.toLocaleString("ru-RU")} R$</b>
            <span style={{ color: C.textTertiary }}>из {order.amount.toLocaleString("ru-RU")} R$</span>
            {diff !== 0 && picked.length > 0 && (
              <span style={{ marginLeft: "auto", color: C.orange, fontWeight: 700 }}>
                {diff > 0 ? `лишние ${diff}` : `не хватает ${-diff}`} R$
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(order.splitGamepasses ?? []).length > 0 && (
              <button className="twa-press" onClick={clearSplit} disabled={saving}
                style={{ padding: "13px 14px", borderRadius: 12, border: `1px solid ${C.red}55`, background: "transparent", color: C.red, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Снять
              </button>
            )}
            <button className="twa-press" onClick={save} disabled={!canSave}
              style={{ flex: 1, padding: "13px", borderRadius: 12, border: "none", background: canSave ? C.accent : C.elevated, color: canSave ? "#fff" : C.textTertiary, fontSize: 15, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed" }}>
              {saving ? "…" : picked.length < 2 ? "Выбери минимум 2" : diff !== 0 ? "Сумма не сходится" : `Разбить на ${picked.length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Разбитый выкуп: части и прогресс ─────────────
   Заказ закрывается несколькими геймпассами, и покупка идёт по одной части за
   нажатие. Карточка обязана отвечать на три вопроса сразу: сколько частей уже
   куплено, какая покупается следующей и сходится ли сумма частей с номиналом
   заказа — расхождение суммы сервер не пропустит, и узнать об этом лучше здесь,
   чем по красной ошибке после нажатия «Выкупить». */
function SplitPartsBlock({ parts, orderAmount }: { parts: SplitPart[]; orderAmount: number }) {
  const ordered = [...parts].sort((a, b) => a.position - b.position);
  const done = ordered.filter(p => p.purchasedAt);
  const nextIdx = ordered.findIndex(p => !p.purchasedAt);
  const sum = ordered.reduce((acc, p) => acc + p.amount, 0);
  const spent = done.reduce((acc, p) => acc + (p.chargedPrice ?? 0), 0);
  const mismatch = sum !== orderAmount;
  const allDone = done.length === ordered.length;

  return (
    <div style={{
      margin: "8px 0 2px", padding: "10px 12px", borderRadius: 12,
      background: C.elevated, border: `1px solid ${allDone ? `${C.green}44` : C.border}`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14 }}>🧩</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e5ea" }}>
          Разбит на {ordered.length} {ordered.length === 1 ? "пасс" : ordered.length < 5 ? "пасса" : "пассов"}
        </span>
        <span style={{
          marginLeft: "auto", padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800,
          background: allDone ? `${C.green}22` : `${C.blue}1f`,
          color: allDone ? C.green : C.blue,
          fontVariantNumeric: "tabular-nums",
        }}>
          {done.length}/{ordered.length} выкуплено
        </span>
      </div>

      {/* Полоса прогресса: сегмент на часть — видно с одного взгляда. */}
      <div style={{ display: "flex", gap: 3 }}>
        {ordered.map((p, i) => (
          <div key={p.id} style={{
            flex: p.amount, height: 4, borderRadius: 2,
            background: p.purchasedAt ? C.green : i === nextIdx ? `${C.blue}88` : C.border,
          }} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ordered.map((p, i) => {
          const isNext = i === nextIdx;
          const bought = !!p.purchasedAt;
          return (
            <div key={p.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 8px", borderRadius: 9,
              background: isNext ? `${C.blue}12` : "transparent",
              border: isNext ? `1px solid ${C.blue}44` : "1px solid transparent",
            }}>
              <span style={{ fontSize: 13, width: 16, flexShrink: 0 }}>{bought ? "✅" : isNext ? "▶️" : "⏳"}</span>
              <span style={{
                fontSize: 13, fontWeight: 700, color: bought ? C.textTertiary : "#e5e5ea",
                fontVariantNumeric: "tabular-nums", minWidth: 66,
              }}>
                {p.amount.toLocaleString("ru-RU")} R$
              </span>
              <a
                href={`https://www.roblox.com/game-pass/${p.gamepassId}`}
                target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ fontSize: 12, color: C.blue, textDecoration: "none", fontVariantNumeric: "tabular-nums" }}
              >
                {p.gamepassId}
              </a>
              <span style={{ marginLeft: "auto", fontSize: 12, color: bought ? C.green : C.textTertiary, fontVariantNumeric: "tabular-nums" }}>
                {bought ? `−${(p.chargedPrice ?? 0).toLocaleString("ru-RU")} R$` : `ждёт ${Math.ceil(p.amount / 0.7).toLocaleString("ru-RU")} R$`}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: C.textTertiary, fontVariantNumeric: "tabular-nums" }}>
        <span>Сумма частей: <b style={{ color: mismatch ? C.red : C.textSecondary }}>{sum.toLocaleString("ru-RU")} R$</b> из {orderAmount.toLocaleString("ru-RU")} R$</span>
        {spent > 0 && <span>Списано: <b style={{ color: C.textSecondary }}>{spent.toLocaleString("ru-RU")} R$</b></span>}
      </div>

      {mismatch && (
        <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>
          ⚠️ Сумма частей ≠ номиналу заказа — сервер заблокирует выкуп, поправь разбиение
        </div>
      )}
    </div>
  );
}

/* ───────────── OrderCard — compact layout ───────────── */
function OrderCard({
  order, token, currentTab, exiting, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onMoved, live,
}: {
  order: Order;
  token: string;
  currentTab: FilterTab;
  exiting: boolean;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (note: string) => Promise<ActionResult>;
  onPurchaseDone?: () => void;
  onToggleFavorite: () => void;
  onMoved: () => void;
  /** Прайс-гард (Ш4): живая цена ГП — бейдж расхождения с номиналом. */
  live?: GpLiveInfo;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [rebindOpen, setRebindOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  // GP-watch: локально трекаем «клиент оповещён об этом ГП» — сервер после
  // «Оповестить» отдаёт свежий passId, перезагрузка вкладки не нужна.
  const [gpwPassId, setGpwPassId] = useState<string | null>(order.gpWatchNotifiedPassId);
  const [gpwLoading, setGpwLoading] = useState(false);

  async function gpwNotify() {
    if (gpwLoading) return;
    setGpwLoading(true);
    haptic.impact("light");
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "gpwatch-notify", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error ?? "Ошибка", "error"); return; }
      if (d.notified) {
        haptic.notify("success");
        setGpwPassId(String(d.pass.gamepassId));
        toast(`Клиент оповещён (${String(d.notified).toUpperCase()}): «${d.pass.name}» · ${d.pass.price} R$`, "success");
      } else {
        toast(`ГП найден («${d.pass.name}» · ${d.pass.price} R$), но пинг НЕ доставлен`, "error");
      }
    } catch { toast("Ошибка сети", "error"); }
    finally { setGpwLoading(false); }
  }

  const showGpWatch = order.status === "AWAITING_GAMEPASS" && !!order.probableNick && !order.robloxUsername;

  const platform: "tg" | "vk" | "—" = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const shortName = userShortName(order.user);
  const passId = extractGamepassId(order.gamepassUrl);
  const split = order.splitGamepasses ?? [];

  // В «Требуют внимания» карточка ведёт себя как в родной вкладке заказа:
  // те же кнопки действий и формат суммы, что видел бы менеджер в BUYOUT/ERROR/….
  const viewTab = currentTab === "ATTENTION" ? orderToTab(order) : currentTab;

  const showDirty = viewTab === "BUYOUT" || viewTab === "DIRECT" || viewTab === "AVITO" || viewTab === "ERROR";
  const dirtyAmount = Math.ceil(order.amount / 0.7);
  const displayAmount = showDirty ? dirtyAmount : order.amount;
  const showCleanHint = viewTab === "BUYOUT";

  const tabBadge = currentTab === "ALL" || currentTab === "WORK" || currentTab === "ATTENTION" || currentTab === "REJECTED"
    ? orderTabBadge(order)
    // «К выкупу» стала общей очередью: помечаем прямые, чтобы менеджер сразу видел,
    // что деньги от клиента уже пришли и это не WB-карта.
    : currentTab === "BUYOUT" && order.isDirectOrder
      ? { label: "Прямой", color: C.blue }
      : null;
  const showMoveBtn = viewTab === "AWAITING_LINK" || viewTab === "FAVORITES" || viewTab === "ERROR" || viewTab === "REJECTED" || (currentTab === "ALL" && order.status === "REJECTED");
  // Редактирование за клиента (номинал/ник/ГП) — любой источник, не только Авито.
  const isEditable = ["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED"].includes(order.status);
  // Разбить можно всё, что ещё не закрыто и уже знает ник — именно ник даёт
  // список пассов покупателя, из которых собираются части.
  const isSplittable = ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"].includes(order.status)
    && !!(order.robloxUsername || order.probableNick);
  const payment = order.paymentAttempts?.[0];
  // Возврат — любому заказу с подтверждённым платежом T-Bank, а не только
  // SITE: с эквайрингом в ботах (orderSource=DIRECT) деньги приходят тем же
  // терминалом, и кнопки для них не было — возврат пришлось бы делать мимо
  // аудита. Условие = ровно предусловие POST /api/twa/payments/refund.
  const canRefund = !!payment &&
    ["CONFIRMED", "PARTIALLY_REFUNDED"].includes(payment.status) &&
    payment.refundedAmountKopecks < payment.amountKopecks;

  const timeRef = order.createdAt;
  // Second timer: how long the order has been sitting in the "К выкупу" queue
  // (since it entered PENDING). pendingAt is set when the gamepass link arrives.
  const inBuyoutQueue = !!order.pendingAt && ["PENDING", "IN_PROGRESS"].includes(order.status);

  // Компактная сводка используется дважды: строкой в ленте и шапкой detail-sheet.
  // Сам sheet рендерится порталом в body: position:fixed внутри iOS-скролла ленты
  // глючит (containing block + layout shift), карточка «вылезала на весь экран».
  const compactSummary = (
    <>
        <span className="twa-compact-order-top">
          <b style={{ color: tabBadge?.color ?? SOURCE_BADGE_META[order.orderSource]?.color ?? C.accent }}>
            {tabBadge?.label ?? SOURCE_BADGE_META[order.orderSource]?.label ?? order.orderSource}
          </b>
          <small>{fmtAge(timeRef)}</small>
          <i>{expanded ? "⌃" : "⌄"}</i>
        </span>
        <span className="twa-compact-order-main">
          <strong>{order.robloxUsername ?? order.probableNick ?? "Ник не указан"}</strong>
          <b>{displayAmount.toLocaleString("ru-RU")} <small>R$</small></b>
        </span>
        <span className="twa-compact-order-meta">
          <span>{shortName}</span>
          <code>{order.wbCode}</code>
          {showCleanHint && <span>{order.amount.toLocaleString("ru-RU")} чистыми</span>}
        </span>
        {(live?.priceMismatch || live?.isForSale === false || order.vkUnreachable || order.gpWatchDeclinedAt || order.status === "ERROR") && (
          <span className="twa-compact-warning">
            {order.buyoutErrorCode === "REGIONAL_PRICE" ? "Рег. цена — полная замена ГП не найдена" :
              live?.priceMismatch ? `Цена пасса ${live.livePrice} R$ ≠ ${live.expected} R$` :
              live?.isForSale === false ? "Геймпасс снят с продажи" :
                order.vkUnreachable ? "VK недоступен — написать вручную" :
                  order.gpWatchDeclinedAt ? "Клиент отклонил найденный ник" : "Заказ требует исправления"}
          </span>
        )}
    </>
  );

  return (
    <>
    <article className={`twa-glass-order${exiting ? " twa-card-exit" : ""}`} style={{
      background: C.card,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      position: "relative",
    }}>
      <button
        type="button"
        className="twa-compact-order twa-press-sm"
        aria-expanded={expanded}
        onClick={() => { haptic.select(); setExpanded(value => !value); }}
      >
        {compactSummary}
      </button>
    </article>

    <BottomSheet
      open={expanded}
      onClose={() => { setExpanded(false); setSheetExpanded(false); }}
      ariaLabel="Карточка заказа"
      className="twa-order-sheet"
      expandable
      expanded={sheetExpanded}
      onExpandedChange={setSheetExpanded}
    >
      <button
        type="button"
        className="twa-compact-order twa-press-sm"
        aria-expanded={expanded}
        onClick={() => { haptic.select(); setExpanded(false); }}
      >
        {compactSummary}
      </button>
      <>
      {/* Header: platform badge + nick + star */}
      <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <span style={{
              fontSize: 12, fontWeight: 800, color: "#fff",
              background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
              borderRadius: 5, padding: "4px 8px", flexShrink: 0,
            }}>
              {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
            </span>
            <span
              onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(order.user); }}
              style={{
                fontSize: 17, fontWeight: 600, color: "#7ec5ff", cursor: "pointer",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {shortName}
            </span>
            {tabBadge && (
              <span style={{
                fontSize: 12, fontWeight: 600, color: tabBadge.color,
                background: `${tabBadge.color}1c`, padding: "4px 9px",
                borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
              }}>
                {tabBadge.label}
              </span>
            )}
            {order.orderSource && order.orderSource !== "WB" && (() => {
              const sb = SOURCE_BADGE_META[order.orderSource];
              if (!sb) return null;
              return (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: sb.color,
                  background: `${sb.color}1c`, padding: "3px 8px",
                  borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
                }}>
                  {sb.label}
                </span>
              );
            })()}
          </div>
          <button
            className="twa-press-sm"
            onClick={e => { e.stopPropagation(); haptic.impact("light"); onToggleFavorite(); }}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontSize: 22, padding: "4px 6px", flexShrink: 0,
              opacity: order.isFavorite ? 1 : 0.35,
            }}
          >
            {order.isFavorite ? "★" : "☆"}
          </button>
        </div>

        {/* Time + amount row */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: ageColor(timeRef), ...tabular }}>
            ⏱ {fmtAge(timeRef)}
          </span>
          {inBuyoutQueue && (
            <span
              title="В очереди «К выкупу»"
              style={{ fontSize: 16, fontWeight: 500, color: ageColor(order.pendingAt!), ...tabular }}>
              🛒 {fmtAge(order.pendingAt!)}
            </span>
          )}
          <span style={{ fontSize: 14, color: C.textTertiary }}>—</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, ...tabular }}>
            {displayAmount.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
          {showCleanHint && (
            <span style={{ fontSize: 14, color: C.textTertiary, ...tabular }}>
              ({order.amount.toLocaleString("ru-RU")})
            </span>
          )}
        </div>
      </div>

      {/* Data rows */}
      <div style={{ padding: "6px 16px 12px" }}>
        {order.robloxUsername && (
          <DataRow icon="🎮" copyText={order.robloxUsername}>
            <span style={{ fontWeight: 600 }}>{order.robloxUsername}</span>
          </DataRow>
        )}
        {!order.robloxUsername && order.probableNick && (
          <DataRow icon="👁" copyText={order.probableNick}>
            <span style={{ fontWeight: 600, color: C.yellow }}>{order.probableNick}</span>
            <span style={{ fontSize: 13, color: C.textTertiary }}> · вероятный ник</span>
          </DataRow>
        )}
        {/* Разбитый выкуп: список частей вместо одной ссылки. Без него
            «выкуплено 1 из 3» выглядит как зависший заказ без объяснения. */}
        {split.length > 0 ? (
          <SplitPartsBlock parts={split} orderAmount={order.amount} />
        ) : order.gamepassUrl && (
          <DataRow icon="🔗" copyText={order.gamepassUrl}>
            <span style={{ color: C.blue }}>{order.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</span>
          </DataRow>
        )}
        {/* Прайс-гард (Ш4): расхождение живой цены пасса с номиналом видно до
            нажатия «Выкупить» — сервер такой выкуп всё равно заблокирует. */}
        {live?.priceMismatch && live.livePrice != null && (
          <DataRow icon="⚠️">
            <span style={{ color: C.orange, fontWeight: 600 }}>
              цена ≠ номиналу: пасс {live.livePrice.toLocaleString("ru-RU")} R$, ожид {live.expected.toLocaleString("ru-RU")} R$
            </span>
          </DataRow>
        )}
        {live?.isForSale === false && (
          <DataRow icon="⛔">
            <span style={{ color: C.red, fontWeight: 600 }}>геймпасс не на продаже</span>
          </DataRow>
        )}
        {order.buyoutErrorCode === "REGIONAL_PRICE" && (
          <DataRow icon="🌍">
            <span style={{ color: C.red, fontWeight: 600 }}>
              Рег. цена на доноре — автоматическая полная замена по нику не найдена
            </span>
          </DataRow>
        )}
        {!order.isDirectOrder && (
          <DataRow icon="📦" copyText={order.wbCode}>
            <span style={{ fontFamily: MONO, fontWeight: 700, color: C.accent, letterSpacing: 1.5, fontSize: 16 }}>
              {order.wbCode}
            </span>
          </DataRow>
        )}
        {order.status === "COMPLETED" && currentTab !== "DONE" && (
          <DataRow icon="💳" copyText={order.purchaserUsername ?? undefined}>
            <span style={{ color: C.textSecondary }}>
              Выкуп:{" "}
              <span style={{ fontWeight: 600, color: order.purchaserUsername ? "#e5e5ea" : C.textTertiary }}>
                {order.purchaserUsername ?? "Ручные"}
              </span>
            </span>
          </DataRow>
        )}
        {order.status === "COMPLETED" && order.reviewStatus && (() => {
          const granted = order.user.reviewBonusGrantedAt;
          if (order.reviewStatus === "PENDING") {
            return (
              <DataRow icon="📸">
                <span style={{ color: C.yellow, fontWeight: 600 }}>Ждёт отзыв</span>
                <span style={{ fontSize: 13, color: C.textTertiary }}> · скрин = +100 R$</span>
              </DataRow>
            );
          }
          const bal = order.user.balance ?? 0;
          if (bal > 0 && granted) {
            const expiry = new Date(new Date(granted).getTime() + 30 * 86_400_000);
            return (
              <DataRow icon="✅">
                <span style={{ color: C.green, fontWeight: 600 }}>+100 R$ начислен</span>
                <span style={{ fontSize: 13, color: C.textTertiary }}>
                  {" · "}баланс {bal} R$ до {expiry.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
                </span>
              </DataRow>
            );
          }
          return (
            <DataRow icon="💳">
              <span style={{ color: C.textTertiary, fontWeight: 600 }}>Бонус использован</span>
            </DataRow>
          );
        })()}

        {/* Notes */}
        <div style={{ marginTop: 8 }}>
          <NotesEditor order={order} onSave={onSaveNote} />
        </div>
      </div>

      {/* 👁 GP-watch: вероятный ник есть, подтверждённого нет — найти ГП и оповестить */}
      {showGpWatch && (
        <div style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {gpwPassId && (
            <div style={{
              padding: "8px 10px", background: `${C.green}14`, borderRadius: 8,
              fontSize: 14, color: C.green, display: "flex", alignItems: "center", gap: 6,
              flexWrap: "wrap",
            }}>
              <span style={{ fontWeight: 600 }}>👁 ГП найден по нику — клиент оповещён, ждём ✅</span>
              <a
                href={`https://www.roblox.com/game-pass/${gpwPassId}`}
                target="_blank" rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ color: C.blue, fontSize: 13 }}
              >
                game-pass/{gpwPassId}
              </a>
            </div>
          )}
          <button className="twa-press-sm" disabled={gpwLoading}
            onClick={e => { e.stopPropagation(); gpwNotify(); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10,
              border: `1px solid ${gpwPassId ? C.textTertiary + "44" : C.yellow + "55"}`,
              background: "transparent", color: gpwPassId ? C.textSecondary : C.yellow,
              fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: gpwLoading ? 0.5 : 1,
            }}>
            {gpwLoading ? "Ищу ГП на Roblox…" : gpwPassId ? "📣 Оповестить клиента ещё раз" : "👁 Найти ГП по нику и оповестить"}
          </button>
        </div>
      )}

      {/* ❌ П3: клиент отверг GP-watch-ник — вероятного ника больше нет, дожать вручную */}
      {order.gpWatchDeclinedAt && order.status === "AWAITING_GAMEPASS" && !order.robloxUsername && (
        <div style={{
          margin: "0 14px 10px", padding: "8px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 600 }}>❌ Клиент сказал: не его ник</span>
          <span style={{ fontSize: 13, color: C.textTertiary }}>
            {new Date(order.gpWatchDeclinedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
            {" · "}ждём правильный ник — дожать вручную
          </span>
        </div>
      )}

      {/* 🚫 VK-клиент недостижим для сообщества (VK 901) — писать только с личного акка */}
      {order.vkUnreachable === true && order.user.vkId && (
        <div style={{
          margin: "0 14px 10px", padding: "8px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ fontWeight: 600 }}>🚫 Бот не может написать (VK)</span>
          <a
            href={`https://vk.com/id${order.user.vkId}`}
            target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: C.blue, fontSize: 13, fontWeight: 600 }}
          >
            профиль VK — писать с личного
          </a>
        </div>
      )}

      {/* Rejection reason for ALL tab */}
      {(currentTab === "ALL" || currentTab === "REJECTED") && order.status === "REJECTED" && order.rejectionReason && (
        <div style={{
          margin: "0 14px 10px", padding: "6px 10px",
          background: `${C.red}14`, borderRadius: 8,
          fontSize: 14, color: C.red,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {order.rejectionReason}
        </div>
      )}

      {/* Ошибка тоже должна быть рабочей папкой: вернуть — быстрым действием,
          переместить в любой другой раздел — через эту форму с аудитом. */}
      {showMoveBtn && !moveOpen && (
        <div style={{ padding: "0 14px 10px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setMoveOpen(true); }}
            style={{
              width: "100%", padding: "12px", borderRadius: 10, border: `1px solid ${C.accent}44`,
              background: "transparent", color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            ↪ Переместить в другой раздел
          </button>
        </div>
      )}

      {moveOpen && (
        <MoveToModal
          order={order}
          token={token}
          currentTab={viewTab}
          onDone={() => { setMoveOpen(false); onMoved(); }}
          onClose={() => setMoveOpen(false)}
        />
      )}

      {/* Edit order button — правка номинала/ника/ГП за клиента */}
      {isEditable && !editOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setEditOpen(true); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.orange}44`,
              background: "transparent", color: C.orange, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            ✏️ Редактировать
          </button>
        </div>
      )}

      {editOpen && (
        <EditOrderModal
          order={order}
          token={token}
          onDone={() => { setEditOpen(false); onMoved(); }}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* Разбиение выкупа: три пасса по 1000 вместо одного на 3000 */}
      {isSplittable && !splitOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setSplitOpen(true); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.accent}55`,
              background: "transparent", color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            {split.length > 0 ? `🧩 Разбиение · ${split.filter(p => p.purchasedAt).length}/${split.length}` : "🧩 Разбить на несколько пассов"}
          </button>
        </div>
      )}

      {splitOpen && (
        <SplitModal
          order={order}
          token={token}
          onDone={() => { setSplitOpen(false); onMoved(); }}
          onClose={() => setSplitOpen(false)}
        />
      )}

      {canRefund && !refundOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={event => { event.stopPropagation(); setRefundOpen(true); }}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: `1px solid ${C.red}55`, background: "transparent", color: C.red, fontWeight: 600 }}>
            ↩️ Оформить возврат
          </button>
        </div>
      )}
      {refundOpen && <RefundModal order={order} token={token} onDone={() => { setRefundOpen(false); onMoved(); }} onClose={() => setRefundOpen(false)} />}

      {/* Rebind button */}
      {["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "REJECTED"].includes(order.status) && !rebindOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <button className="twa-press-sm" onClick={e => { e.stopPropagation(); setRebindOpen(true); }}
            style={{
              width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.textTertiary}44`,
              background: "transparent", color: C.textSecondary, fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>
            🔄 Перепривязать
          </button>
        </div>
      )}

      {rebindOpen && (
        <RebindModal
          order={order}
          token={token}
          onDone={() => { setRebindOpen(false); onMoved(); }}
          onClose={() => setRebindOpen(false)}
        />
      )}

      {/* Action panel */}
      <ActionPanel
        order={order}
        currentTab={viewTab}
        token={token}
        onRunAction={onRunAction}
        onPurchaseDone={onPurchaseDone}
      />
      </>
    </BottomSheet>
    </>
  );
}

/* ───────────── Search ───────────── */
function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => {
    const t = setTimeout(() => { if (local !== value) onChange(local); }, 250);
    return () => clearTimeout(t);
  }, [local]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(118,118,128,0.24)",
      borderRadius: 12, padding: "10px 14px",
    }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
           stroke={C.textSecondary} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
           style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder="Ник, @username, WB-код, ссылка, ID"
        style={{
          background: "transparent", border: "none", outline: "none",
          color: C.textPrimary, fontSize: 16, flex: 1, minWidth: 0,
          padding: 0, fontFamily: "inherit",
        }}
      />
      {local && (
        <button
          className="twa-press-sm"
          onClick={() => { haptic.impact("light"); setLocal(""); onChange(""); }}
          style={{
            background: "rgba(255,255,255,0.18)", border: "none",
            width: 22, height: 22, borderRadius: 11,
            color: C.bg, fontSize: 12, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ───────────── Counts helpers ───────────── */
function shiftCounts(counts: Record<string, number>, fromTab: string, toTab: string): Record<string, number> {
  const next = { ...counts };
  // ALL is the immutable union of every non-test order. Moving a card between
  // virtual folders must not change that total; only the source/target chips
  // change.
  if (fromTab !== "ALL" && fromTab in next) next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - 1);
  if (toTab !== "ALL" && toTab in next) next[toTab] = (next[toTab] ?? 0) + 1;
  return next;
}

function shiftSums(sums: Record<string, number>, fromTab: string, toTab: string, amount: number): Record<string, number> {
  const next = { ...sums };
  if (fromTab in next) next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - amount);
  if (toTab in next) next[toTab] = (next[toTab] ?? 0) + amount;
  return next;
}

function orderToTab(order: Order): FilterTab {
  const cutoff = Date.now() - 40 * 3600_000;
  const created = new Date(order.createdAt).getTime();
  if (order.isFavorite) return "FAVORITES";
  if (order.status === "COMPLETED") return "DONE";
  if (order.status === "REJECTED") return "REJECTED";
  if (order.status === "ERROR") return "ERROR";
  if (order.status === "AWAITING_GAMEPASS") return created > cutoff ? "NEW" : "AWAITING_LINK";
  // Оплаченный прямой заказ живёт в общей очереди «К выкупу» (выкуп ручной, без аккаунтов);
  // вкладка «Прямой» остаётся срезом по источнику и держит счётчик неоплаченных.
  if (isUnpaidDirect(order) && ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status)) return "DIRECT";
  if (["PENDING", "IN_PROGRESS"].includes(order.status)) return "BUYOUT";
  return "ALL";
}

function isWorkOrder(order: Order): boolean {
  if (order.isFavorite) return false;
  const cutoff = Date.now() - 40 * 3600_000;
  if (order.status === "ERROR") return true;
  if (["PENDING", "IN_PROGRESS"].includes(order.status) && !isUnpaidDirect(order) && order.orderSource !== "AVITO") return true;
  return order.status === "AWAITING_GAMEPASS" && new Date(order.createdAt).getTime() <= cutoff;
}

/* ───────────── Search S2: SpotlightCard — full order detail inline ───────────── */
function SpotlightCard({
  order, token, onRunAction, onPurchaseDone, onSaveNote, onToggleFavorite, onMoved,
}: {
  order: Order;
  token: string;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onPurchaseDone: () => void;
  onSaveNote: (note: string) => Promise<ActionResult>;
  onToggleFavorite: () => void;
  onMoved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const platform = order.user.tgId ? "tg" : order.user.vkId ? "vk" : "—";
  const shortName = userShortName(order.user);
  const dirtyAmount = Math.ceil(order.amount / 0.7);
  const tabBadge = orderTabBadge(order);
  const canBuyout = ["PENDING", "IN_PROGRESS"].includes(order.status) && !!order.gamepassUrl;
  const isError = order.status === "ERROR" && !!order.gamepassUrl;
  const showActions = canBuyout || isError;

  async function doPurchase() {
    if (loading) return;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "purchase", orderId: order.id }),
      });
      const d = await r.json();
      if (!r.ok) { haptic.notify("error"); toast(d.error ?? "Ошибка", "error"); return; }
      if (d.success) { haptic.notify("success"); toast(`✅ ${d.msg}`, "success"); onPurchaseDone(); }
      else { haptic.notify("error"); toast(`❌ ${d.msg}`, "error"); }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  const cellLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", letterSpacing: 0.5 };
  const cellVal: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: C.textPrimary, marginTop: 2 };

  return (
    <div style={{
      padding: 16, background: C.card, borderRadius: 16,
      border: `1px solid ${C.accent}22`, boxShadow: SHADOW.card,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: C.accent, letterSpacing: 1.5 }}>
          {order.wbCode}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {tabBadge && (
            <span style={{ fontSize: 13, fontWeight: 700, color: tabBadge.color, background: `${tabBadge.color}1c`, padding: "5px 12px", borderRadius: 8 }}>
              {tabBadge.label}
            </span>
          )}
          <button className="twa-press-sm" onClick={() => { haptic.impact("light"); onToggleFavorite(); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 20, padding: "2px 4px", opacity: order.isFavorite ? 1 : 0.35 }}>
            {order.isFavorite ? "★" : "☆"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={cellLabel}>Ник Roblox</div>
          <div style={cellVal}>{order.robloxUsername ?? order.probableNick ?? "—"}</div>
        </div>
        <div>
          <div style={cellLabel}>Сумма</div>
          <div style={{ ...cellVal, ...tabular }}>
            {dirtyAmount.toLocaleString("ru-RU")} R$
            <span style={{ fontSize: 13, color: C.textTertiary, marginLeft: 4 }}>({order.amount.toLocaleString("ru-RU")})</span>
          </div>
        </div>
        <div>
          <div style={cellLabel}>Клиент</div>
          <span onClick={() => { haptic.impact("light"); openContact(order.user); }}
            style={{ ...cellVal, color: "#7ec5ff", cursor: "pointer", display: "block" }}>
            <span style={{
              fontSize: 11, fontWeight: 800, color: "#fff",
              background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
              borderRadius: 4, padding: "2px 5px", marginRight: 6,
            }}>{platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}</span>
            {shortName}
          </span>
        </div>
        <div>
          <div style={cellLabel}>Возраст</div>
          <div style={{ ...cellVal, color: ageColor(order.createdAt), ...tabular }}>{fmtAge(order.createdAt)}</div>
        </div>
        {order.gamepassUrl && (
          <div style={{ gridColumn: "1 / 3" }}>
            <div style={cellLabel}>Геймпасс</div>
            <a href={order.gamepassUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ fontSize: 14, color: C.blue, fontWeight: 500, marginTop: 2, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {order.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 50)}
            </a>
          </div>
        )}
        <div>
          <div style={cellLabel}>Источник</div>
          <div style={{ ...cellVal, fontWeight: 500 }}>{SOURCE_BADGE_META[order.orderSource]?.label ?? order.orderSource}</div>
        </div>
        {order.pendingAt && ["PENDING", "IN_PROGRESS"].includes(order.status) && (
          <div>
            <div style={cellLabel}>В очереди</div>
            <div style={{ ...cellVal, color: ageColor(order.pendingAt), ...tabular }}>{fmtAge(order.pendingAt)}</div>
          </div>
        )}
      </div>

      <div style={{ paddingTop: 4 }}>
        <NotesEditor order={order} onSave={onSaveNote} />
      </div>

      {showActions && (
        <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${C.hairline}` }}>
          <button className="twa-press" onClick={doPurchase} disabled={loading}
            style={{ flex: 2, padding: 13, border: "none", borderRadius: 12, background: "rgba(48,209,88,0.14)", color: C.green, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
            {loading ? "⏳…" : isError ? "Повторить выкуп" : "Выкупить"}
          </button>
          <button className="twa-press" onClick={() => onRunAction("complete")} disabled={loading}
            style={{ flex: 1, padding: 13, border: "none", borderRadius: 12, background: "rgba(10,132,255,0.12)", color: C.blue, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
            Выкуплено
          </button>
          <button className="twa-press" onClick={() => onRunAction("reject")} disabled={loading}
            style={{ width: 44, flexShrink: 0, padding: "13px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── Search S1: ProfileCard — user info above their orders ───────────── */
function SearchProfileCard({ user, orders }: {
  user: Order["user"];
  orders: Order[];
}) {
  const platform = user.tgId ? "tg" : user.vkId ? "vk" : "—";
  const shortName = userShortName(user);
  const totalR = orders.reduce((s, o) => s + o.amount, 0);
  const oldest = orders.reduce((min, o) => {
    const t = new Date(o.createdAt).getTime();
    return t < min ? t : min;
  }, Date.now());

  return (
    <div style={{
      padding: 14, background: C.card, borderRadius: 14,
      boxShadow: SHADOW.card,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 42, height: 42, borderRadius: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0,
          background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
        }}>
          {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 17, fontWeight: 700, color: C.textPrimary,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {shortName}
          </div>
          <div style={{ fontSize: 13, color: C.textSecondary, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{platform === "tg" ? "Telegram" : platform === "vk" ? "VK" : "—"}</span>
            <span style={{ color: C.green }}>· {orders.length} {pluralOrders(orders.length).split(" ").pop()}</span>
          </div>
        </div>
        <button
          className="twa-press-sm"
          onClick={() => { haptic.impact("light"); openContact(user); }}
          style={{
            padding: "8px 14px", borderRadius: 10, border: "none",
            background: `${C.blue}22`, color: C.blue,
            fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}
        >
          Написать
        </button>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, color: C.textSecondary, paddingTop: 6, borderTop: `1px solid ${C.hairline}` }}>
        <span>Всего <span style={{ fontWeight: 700, color: C.textPrimary, ...tabular }}>{totalR.toLocaleString("ru-RU")} R$</span></span>
        <span>Клиент с <span style={{ fontWeight: 700, color: C.textPrimary }}>
          {new Date(oldest).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
        </span></span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Main screen
   ───────────────────────────────────────────────────────────────────────── */
export default function OrdersScreen({
  token, onActionDone, initialQuery, initialTab, onInitialQueryConsumed,
}: {
  token: string;
  onActionDone?: () => void;
  initialQuery?: string;
  /** Ф2: открыть сразу на вкладке (виджет «Ошибки» дашборда «Свои» → ERROR). */
  initialTab?: string;
  onInitialQueryConsumed?: () => void;
}) {
  const [filter, setFilter] = useState<FilterTab>(initialQuery ? "ALL" : (initialTab as FilterTab) || "WORK");
  const [query, setQuery] = useState(initialQuery ?? "");
  // Вкладка «Все»: по умолчанию хронологическая лента (новые сверху),
  // подборка «Требуют внимания» — по кнопке «⚠ Внимание (N)» (решение 2026-07-06).
  const [allView, setAllView] = useState<"attention" | "list">("list");
  // П4: модалка «➕ Создать заказ» (ручной заказ целиком из TWA).
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "direct">("manual");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dashExpanded, setDashExpanded] = useState(false);
  useEffect(() => {
    if (initialQuery || initialTab) onInitialQueryConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [data, setData] = useState<OrdersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [doneSourceFilter, setDoneSourceFilter] = useState<SourceFilter>("ALL");
  const reqIdRef = useRef(0);

  // Заявки прямых заказов (DirectIntent) — видны на вкладке «Прямой».
  const [intents, setIntents] = useState<Intent[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(false);
  const [qrConfigured, setQrConfigured] = useState(true);

  const enrichCache = useRef<Map<string, EnrichValue>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  // Прайс-гард (Ш4): живая цена ГП для карточек выкупных статусов —
  // бейдж «⚠️ цена ≠ номиналу» до нажатия «Выкупить», не блокируя список.
  const [liveMap, setLiveMap] = useState<Record<string, GpLiveInfo>>({});
  const liveRequestedRef = useRef<Set<string>>(new Set());

  const applyCache = useCallback((list: Order[]): Order[] =>
    list.map(o => {
      const e = enrichCache.current.get(o.id);
      return e ? { ...o, ...e } : o;
    }), []);

  const fetchOrders = useCallback(async (f: FilterTab, q: string, p: number, append = false) => {
    if (!append) setLoading(true); else setLoadingMore(true);
    const reqId = ++reqIdRef.current;
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20", status: f });
      if (q) params.set("q", q);
      if (append) params.set("skipCounts", "1");
      params.set("lite", "1");
      const res = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || reqId !== reqIdRef.current) return;
      const d: OrdersData = await res.json();
      if (reqId !== reqIdRef.current) return;
      // append-страницы идут с skipCounts=1 (counts/sums/oldest = null) — сохраняем прежние.
      setData(prev => append && prev ? { ...d, counts: prev.counts, sums: prev.sums, oldest: prev.oldest } : d);
      setAllOrders(prev => append ? [...prev, ...applyCache(d.orders)] : applyCache(d.orders));
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [token, applyCache]);

  const isAttentionView = filter === "ALL" && !query && allView === "attention";
  const serverTab: FilterTab = isAttentionView ? "ATTENTION" : filter;

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    fetchOrders(serverTab, query, 1, false);
  }, [serverTab, query, fetchOrders]);

  const fetchIntents = useCallback(async () => {
    setIntentsLoading(true);
    try {
      const r = await fetch("/api/twa/intents", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return;
      const d = await r.json();
      setIntents(d.intents ?? []);
      setQrConfigured(d.qrConfigured !== false);
    } catch { /* non-fatal */ }
    finally { setIntentsLoading(false); }
  }, [token]);

  useEffect(() => {
    if (filter === "DIRECT" && !query) fetchIntents();
  }, [filter, query, fetchIntents]);

  const handleIntentGone = useCallback((id: string, result: "consumed" | "rejected") => {
    setIntents(prev => prev.filter(i => i.id !== id));
    setData(prev => prev?.counts
      ? { ...prev, counts: { ...prev.counts, INTENTS: Math.max(0, (prev.counts["INTENTS"] ?? 0) - 1) } }
      : prev);
    // QR/реквизиты создают заказ DIR-… (PAYMENT_PENDING) — сразу дотягиваем список.
    if (result === "consumed") { setPage(1); fetchOrders(serverTab, query, 1, false); }
    onActionDone?.();
  }, [serverTab, query, fetchOrders, onActionDone]);

  useEffect(() => {
    const need = allOrders
      .filter(o => !enrichCache.current.has(o.id) && !requestedRef.current.has(o.id))
      .map(o => o.id)
      .slice(0, 60);
    if (need.length === 0) return;
    need.forEach(id => requestedRef.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/twa/orders/enrich?ids=${need.join(",")}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled || !d?.enrich) return;
        const map = d.enrich as Record<string, EnrichValue>;
        for (const [id, v] of Object.entries(map)) enrichCache.current.set(id, v);
        setAllOrders(prev => prev.map(o => (map[o.id] ? { ...o, ...map[o.id] } : o)));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [allOrders, token]);

  // gp-live-check для карточек с геймпассом в выкупных статусах (сервер отдаёт
  // expected/livePrice/priceMismatch, режет пачку до 30). Ошибки не критичны.
  useEffect(() => {
    const need = allOrders
      .filter(o => o.gamepassUrl
        && ["PENDING", "IN_PROGRESS", "ERROR"].includes(o.status)
        && !liveRequestedRef.current.has(o.id))
      .map(o => o.id)
      .slice(0, 30);
    if (need.length === 0) return;
    need.forEach(id => liveRequestedRef.current.add(id));
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "gp-live-check", orderIds: need }),
        });
        const d = await r.json().catch(() => null);
        if (cancelled || !r.ok || !d?.results) return;
        setLiveMap(prev => ({ ...prev, ...d.results }));
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [allOrders, token]);

  const loadMore = useCallback(() => {
    if (!data || page >= data.pages || loadingMore || loading) return;
    const next = page + 1;
    setPage(next);
    fetchOrders(serverTab, query, next, true);
  }, [data, page, loadingMore, loading, serverTab, query, fetchOrders]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && data && page < data.pages && !loadingMore && !loading) {
        loadMore();
      }
    }, { rootMargin: "320px" });
    io.observe(el);
    return () => io.disconnect();
  }, [data, page, loadingMore, loading, loadMore]);

  const runAction = useCallback(async (order: Order, action: string, reason?: string): Promise<ActionResult> => {
    const fromTab = orderToTab(order);
    let toTab: FilterTab | null = null;
    let newStatus: OrderStatus | null = null;

    if (action === "complete") { newStatus = "COMPLETED"; toTab = "DONE"; }
    else if (action === "reject") { newStatus = "REJECTED"; toTab = "REJECTED"; }
    else if (action === "set-error") { newStatus = "ERROR"; toTab = "ERROR"; }
    else if (action === "restore-to-buyout") {
      newStatus = "PENDING";
      toTab = order.orderSource === "AVITO" ? "AVITO" : isUnpaidDirect(order) ? "DIRECT" : "BUYOUT";
    }
    else return { ok: false, error: "Invalid action" };

    haptic.impact(action === "complete" ? "medium" : "light");

    // В «Требуют внимания» карточка уходит после выкупа/отклонения;
    // set-error оставляет её в подборке (ошибки — тоже «внимание»).
    const leaves = isAttentionView
      ? toTab !== "ERROR"
      : filter !== "ALL" && toTab !== filter;
    const attnDelta = isAttentionView && leaves ? 1 : 0;
    // WORK = видимый контракт strip (К выкупу + Ждут ссылку + Ошибка):
    // set-error из NEW добавляет заказ в работу, complete/reject — убирает.
    const workDelta = (isWorkOrder({ ...order, status: newStatus }) ? 1 : 0) - (isWorkOrder(order) ? 1 : 0);

    setAllOrders(prev => prev.map(o => o.id === order.id
      ? {
          ...o,
          status: newStatus!,
          rejectionReason: action === "reject" ? (reason || "не указана") : o.rejectionReason,
          buyoutErrorCode: ["complete", "reject", "restore-to-buyout"].includes(action) ? null : o.buyoutErrorCode,
          pendingAt: action === "restore-to-buyout" ? new Date().toISOString() : o.pendingAt,
        }
      : o));
    if (data?.counts && toTab) {
      setData(prev => {
        if (!prev) return prev;
        let counts = shiftCounts(prev.counts, fromTab, toTab!);
        if (workDelta) counts = { ...counts, WORK: Math.max(0, (counts.WORK ?? 0) + workDelta) };
        if (attnDelta) counts = { ...counts, ATTENTION: Math.max(0, (counts["ATTENTION"] ?? 0) - attnDelta) };
        return {
          ...prev,
          counts,
          sums: prev.sums ? shiftSums(prev.sums, fromTab, toTab!, order.amount) : prev.sums,
        };
      });
    }
    if (leaves) setExiting(prev => new Set(prev).add(order.id));

    const rollback = () => {
      setAllOrders(prev => prev.map(o => o.id === order.id
        ? {
            ...o,
            status: order.status,
            rejectionReason: order.rejectionReason,
            buyoutErrorCode: order.buyoutErrorCode,
            pendingAt: order.pendingAt,
          }
        : o));
      if (data?.counts && toTab) {
        setData(prev => {
          if (!prev) return prev;
          let counts = shiftCounts(prev.counts, toTab!, fromTab);
          if (workDelta) counts = { ...counts, WORK: Math.max(0, (counts.WORK ?? 0) - workDelta) };
          if (attnDelta) counts = { ...counts, ATTENTION: (counts["ATTENTION"] ?? 0) + attnDelta };
          return {
            ...prev,
            counts,
            sums: prev.sums ? shiftSums(prev.sums, toTab!, fromTab, order.amount) : prev.sums,
          };
        });
      }
      setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
    };

    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, orderId: order.id, ...(reason ? { reason } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { rollback(); haptic.notify("error"); return { ok: false, error: d.error ?? "Ошибка" }; }

      haptic.notify("success");
      onActionDone?.();
      if (leaves) {
        window.setTimeout(() => {
          setAllOrders(prev => prev.filter(o => o.id !== order.id));
          setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
          setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
        }, 260);
      }
      const msg = action === "complete"
        ? "Выкуплено ✓"
        : action === "set-error"
          ? "→ Ошибка"
          : action === "restore-to-buyout"
            ? "Возвращён к выкупу"
            : "Отклонён";
      toast(msg, action === "reject" ? "default" : "success");
      return { ok: true };
    } catch {
      rollback(); haptic.notify("error");
      return { ok: false, error: "Ошибка сети" };
    }
  }, [token, filter, data, onActionDone, isAttentionView]);

  const saveNote = useCallback(async (orderId: string, note: string): Promise<ActionResult> => {
    let prevNote: string | null = null;
    setAllOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      prevNote = o.adminNote;
      return { ...o, adminNote: note || null };
    }));
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-note", orderId, note }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, adminNote: prevNote } : o));
        haptic.notify("error");
        return { ok: false, error: d.error ?? "Ошибка" };
      }
      return { ok: true };
    } catch {
      setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, adminNote: prevNote } : o));
      haptic.notify("error");
      return { ok: false, error: "Ошибка сети" };
    }
  }, [token]);

  const toggleFavorite = useCallback(async (order: Order) => {
    haptic.impact("medium");
    const wasFav = order.isFavorite;
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, isFavorite: !wasFav } : o));
    setData(prev => {
      if (!prev?.counts) return prev;
      const next = { ...prev.counts };
      if (wasFav) {
        next["FAVORITES"] = Math.max(0, (next["FAVORITES"] ?? 0) - 1);
        if (isWorkOrder({ ...order, isFavorite: false })) next.WORK = (next.WORK ?? 0) + 1;
      } else {
        next["FAVORITES"] = (next["FAVORITES"] ?? 0) + 1;
        if (isWorkOrder(order)) next.WORK = Math.max(0, (next.WORK ?? 0) - 1);
        const fromTab = orderToTab(order);
        if (fromTab !== "ALL") next[fromTab] = Math.max(0, (next[fromTab] ?? 0) - 1);
        // Избранное исключается из «Требуют внимания» по определению выборки.
        if (isAttentionView) next["ATTENTION"] = Math.max(0, (next["ATTENTION"] ?? 0) - 1);
      }
      return { ...prev, counts: next };
    });

    if ((filter !== "ALL" || isAttentionView) && !wasFav) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }

    try {
      await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle-favorite", orderId: order.id }),
      });
      onActionDone?.();
    } catch {
      setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, isFavorite: wasFav } : o));
    }
  }, [token, filter, isAttentionView, onActionDone]);

  const handlePurchaseDone = useCallback((order: Order) => {
    const fromTab = orderToTab(order);
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: "COMPLETED" as any } : o));
    setData(prev => {
      if (!prev) return prev;
      let counts = shiftCounts(prev.counts, fromTab, "DONE");
      if (isWorkOrder(order)) counts = { ...counts, WORK: Math.max(0, (counts.WORK ?? 0) - 1) };
      if (isAttentionView) counts = { ...counts, ATTENTION: Math.max(0, (counts["ATTENTION"] ?? 0) - 1) };
      return {
        ...prev,
        counts,
        sums: prev.sums ? shiftSums(prev.sums, fromTab, "DONE", order.amount) : prev.sums,
      };
    });
    if (filter !== "ALL" || isAttentionView) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
      }, 260);
    }
    onActionDone?.();
  }, [filter, onActionDone, isAttentionView]);

  const handleMoved = useCallback((order: Order) => {
    if (filter !== "ALL" || isAttentionView) {
      setExiting(prev => new Set(prev).add(order.id));
      window.setTimeout(() => {
        setAllOrders(prev => prev.filter(o => o.id !== order.id));
        setExiting(prev => { const n = new Set(prev); n.delete(order.id); return n; });
        setData(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : prev);
        setPage(1);
        void fetchOrders(serverTab, query, 1, false);
      }, 260);
    } else {
      // «Все» must keep the order in the union, but its status/source can
      // change. Reload page 1 so the card and all virtual-folder counters stay
      // consistent after a move out of REJECTED.
      setPage(1);
      void fetchOrders(serverTab, query, 1, false);
    }
    onActionDone?.();
  }, [filter, onActionDone, isAttentionView, fetchOrders, serverTab, query]);

  const summaryText = useMemo(() => {
    if (!data) return "";
    if (query) return `По запросу «${query}» · ${data.total}`;
    if (isAttentionView) return `Требуют внимания · ${data.total}`;
    const meta = TAB_META[filter];
    return `${meta.label} · ${data.total}`;
  }, [data, query, filter, isAttentionView]);

  const activeMode = filter === "ALL" ? "all" : filter === "DONE" ? "history" : "work";

  const searchMode = useMemo<"spotlight" | "profile" | "list">(() => {
    if (!query || allOrders.length === 0) return "list";
    if (allOrders.length === 1 && allOrders[0].wbCode.toUpperCase() === query.toUpperCase()) return "spotlight";
    const uid = allOrders[0].user.tgId ?? allOrders[0].user.vkId;
    if (uid && allOrders.every(o => (o.user.tgId ?? o.user.vkId) === uid)) return "profile";
    return "list";
  }, [query, allOrders]);

  return (
    <div className="twa-orders-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "transparent" }}>

      {/* Premium Calm: three primary modes, compact status strip and secondary filters in a sheet. */}
      <div className="twa-orders-toolbar twa-orders-toolbar-calm">
        <div className="twa-orders-search-row">
          <div className="twa-orders-search-wrap">
            <SearchBar value={query} onChange={setQuery} />
          </div>
          <button
            className="twa-order-add twa-press-sm"
            type="button"
            aria-label="Создать заказ вручную"
            title="Создать заказ вручную"
            onClick={() => { haptic.impact("light"); setCreateMode(filter === "DIRECT" ? "direct" : "manual"); setCreateOpen(true); }}
          >
            +
          </button>
        </div>

        {/* Segmented control */}
        <div style={{
          display: "flex", background: "rgba(118,118,128,0.18)",
          borderRadius: 10, padding: 2, margin: "0 16px",
        }}>
          {ORDER_MODES.map(mode => {
            const isSel = activeMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                className="twa-press-sm"
                onClick={() => { haptic.select(); setFilter(mode.filter); setAllView("list"); }}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                  background: isSel ? C.card : "transparent",
                  color: isSel ? C.textPrimary : C.textSecondary,
                  fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                  textAlign: "center", cursor: "pointer",
                  boxShadow: isSel ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {mode.label} · {data?.counts?.[mode.countKey] ?? 0}
              </button>
            );
          })}
        </div>

        {/* Pill filters */}
        {filter !== "DONE" && !query && (() => {
          const modeDefault: FilterTab = activeMode === "all" ? "ALL" : "WORK";
          const pillDefs: { id: FilterTab; label: string; color: string }[] = [
            { id: modeDefault, label: "Всё", color: C.textPrimary },
            ...FILTERS
              .filter(f => activeMode === "work" ? f.id !== "DONE" && f.id !== "REJECTED" : f.id !== "DONE")
              .map(f => ({ id: f.id, label: TAB_META[f.id].label, color: TAB_META[f.id].color })),
          ];
          return (
            <div className="twa-no-scrollbar" style={{
              display: "flex", gap: 6, padding: "0 16px",
              overflowX: "auto",
            }}>
              {pillDefs.map(pill => {
                const count = (data?.counts?.[pill.id] ?? 0) + (pill.id === "DIRECT" ? (data?.counts?.INTENTS ?? 0) : 0);
                const isActive = !isAttentionView && filter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    className="twa-press-sm"
                    onClick={() => { haptic.select(); setFilter(pill.id); setAllView("list"); }}
                    style={{
                      flexShrink: 0, padding: "7px 13px", borderRadius: 999, border: "none",
                      background: isActive ? `${pill.color}2a` : "rgba(255,255,255,0.06)",
                      color: isActive ? pill.color : C.textSecondary,
                      fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                    }}
                  >
                    {pill.id !== modeDefault && (
                      <i style={{ width: 5, height: 5, borderRadius: "50%", background: pill.color, flexShrink: 0 }} />
                    )}
                    {pill.label}
                    {count > 0 && <span style={{ ...tabular, opacity: 0.7 }}>{count}</span>}
                  </button>
                );
              })}
              {(data?.counts?.["ATTENTION"] ?? 0) > 0 && (
                <button
                  type="button"
                  className="twa-press-sm"
                  onClick={() => { haptic.select(); setFilter("ALL"); setAllView("attention"); }}
                  style={{
                    flexShrink: 0, padding: "7px 13px", borderRadius: 999, border: "none",
                    background: isAttentionView ? `${C.orange}2a` : "rgba(255,255,255,0.06)",
                    color: isAttentionView ? C.orange : C.textSecondary,
                    fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                  }}
                >
                  ⚠ Внимание
                  <span style={{ ...tabular, opacity: 0.7 }}>{data?.counts?.["ATTENTION"] ?? 0}</span>
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
        {/* Mini-dashboard: суммы и возраст очередей. «В работе» — три рабочие
            категории (контракт WORK), «Все» — полная сетка, внутри категории —
            её карточка. Скроллится вместе с лентой, высоту тулбара не отбирает. */}
        {data?.sums && !query && (filter === "WORK" || filter === "ALL") && !isAttentionView && (() => {
          const groups = filter === "WORK" ? DASHBOARD_GROUPS.filter(g => WORK_DASHBOARD_KEYS.has(g.key)) : DASHBOARD_GROUPS;
          const visible = groups.filter(g => (data.counts[g.filter] ?? 0) > 0);
          if (visible.length === 0) return null;
          return (
            <div style={{ padding: "10px 16px 2px" }}>
              <div
                onClick={() => { haptic.impact("light"); setDashExpanded(v => !v); }}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", cursor: "pointer",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: dashExpanded ? "12px 12px 0 0" : 12,
                  transition: "border-radius 0.15s",
                }}
              >
                {visible.map(g => (
                  <span key={g.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, fontWeight: 600, color: g.color, ...tabular }}>
                    <i style={{ width: 7, height: 7, borderRadius: "50%", background: g.color, flexShrink: 0 }} />
                    {data.counts[g.filter] ?? 0}
                  </span>
                ))}
                <span style={{
                  marginLeft: "auto", color: C.accent, fontSize: 12, fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {dashExpanded ? "Свернуть ↑" : "Подробнее ↓"}
                </span>
              </div>
              {dashExpanded && (
                <MiniDashboard
                  counts={data.counts}
                  sums={data.sums}
                  oldest={data.oldest}
                  onTap={(f) => { setFilter(f); setDashExpanded(false); }}
                  groups={groups}
                />
              )}
            </div>
          );
        })()}
        {data?.sums && !query && (filter === "BUYOUT" || filter === "AWAITING_LINK") && (
          <div style={{ paddingTop: 10, paddingBottom: 2 }}>
            <MiniDashboard
              counts={data.counts}
              sums={data.sums}
              oldest={data.oldest}
              groups={DASHBOARD_GROUPS.filter(g => g.filter === filter)}
            />
          </div>
        )}

        {/* Выкуп пока ручной: список ID геймпассов очереди нужен пачкой, а не по одному. */}
        {!query && EXPORTABLE_TABS.has(filter) && (
          <div style={{ padding: "10px 16px 0" }}>
            <button
              type="button"
              className="twa-press-sm"
              onClick={() => { haptic.impact("light"); setExportOpen(true); }}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12, cursor: "pointer",
                background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary,
                fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              ⇩ Выгрузить ID геймпассов
              {/* Счётчик только там, где очередь = заказы с геймпассом. В WORK/ERROR/ATTENTION
                  есть заказы без ссылки, и число вкладки было бы больше выгрузки — точное
                  количество показывает сама шторка. */}
              {COUNTABLE_EXPORT_TABS.has(filter) && (
                <span style={{ color: C.textSecondary, fontWeight: 500 }}>
                  {data?.counts?.[filter] ?? 0}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Заявки прямых заказов — до отправки реквизитов (видны даже при пустом списке заказов) */}
        {filter === "DIRECT" && !query && (
          <IntentsSection
            token={token}
            intents={intents}
            qrConfigured={qrConfigured}
            loading={intentsLoading}
            onIntentGone={handleIntentGone}
          />
        )}

        {loading ? (
          <Skeleton />
        ) : allOrders.length === 0 ? (
          <EmptyState
            filter={filter}
            query={query}
            attention={isAttentionView}
            onShowAll={isAttentionView ? () => { haptic.select(); setAllView("list"); } : undefined}
          />
        ) : (
          <div className={`twa-fade-in${filter === "DONE" ? "" : " twa-orders-list-stack"}`} style={{ padding: "12px 16px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            {(query || isAttentionView || filter === "DONE") && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
              <span style={{ fontSize: 14, color: C.textSecondary, letterSpacing: 0.1 }}>
                {isAttentionView && "⚠ "}{summaryText}
                {query && searchMode === "spotlight" && (
                  <span style={{ color: C.textTertiary }}> · точное совпадение по коду WB</span>
                )}
                {query && searchMode === "profile" && (
                  <span style={{ color: C.textTertiary }}> · {allOrders.length} {pluralOrders(allOrders.length).split(" ").pop()} у 1 клиента</span>
                )}
              </span>
            </div>}

            {/* S2: Spotlight — точное совпадение по WB-коду */}
            {query && searchMode === "spotlight" && allOrders[0] && (
              <SpotlightCard
                order={allOrders[0]}
                token={token}
                onRunAction={(action, reason) => runAction(allOrders[0], action, reason)}
                onPurchaseDone={() => handlePurchaseDone(allOrders[0])}
                onSaveNote={(note) => saveNote(allOrders[0].id, note)}
                onToggleFavorite={() => toggleFavorite(allOrders[0])}
                onMoved={() => handleMoved(allOrders[0])}
              />
            )}

            {/* S1: Profile card — все заказы одного клиента */}
            {query && searchMode === "profile" && allOrders.length > 0 && (
              <SearchProfileCard user={allOrders[0].user} orders={allOrders} />
            )}

            {filter === "DONE" ? (
              <>
                {/* Source filter chips */}
                {(() => {
                  const sc = countBySource(allOrders);
                  const hasMultiple = (Object.keys(sc) as SourceFilter[]).filter(k => k !== "ALL" && sc[k] > 0).length > 1;
                  if (!hasMultiple) return null;
                  return (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      {SOURCE_CHIPS.map(chip => {
                        const cnt = sc[chip.id];
                        if (chip.id !== "ALL" && cnt === 0) return null;
                        const isActive = doneSourceFilter === chip.id;
                        return (
                          <button
                            key={chip.id}
                            className="twa-press-sm"
                            onClick={() => { haptic.select(); setDoneSourceFilter(chip.id); }}
                            style={{
                              padding: "7px 14px", border: "none", borderRadius: 999, cursor: "pointer",
                              fontSize: 14, fontWeight: 600, fontFamily: "inherit",
                              display: "flex", alignItems: "center", gap: 6,
                              background: isActive ? chip.color : C.elevated,
                              color: isActive ? "#fff" : chip.color,
                              opacity: isActive ? 1 : 0.7,
                              transition: "all 0.15s",
                            }}
                          >
                            {chip.label}
                            {cnt > 0 && (
                              <span style={{
                                fontSize: 12, fontWeight: 700,
                                background: isActive ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)",
                                color: "#fff", padding: "2px 7px", borderRadius: 999,
                                ...tabular,
                              }}>{cnt}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                {buildDoneGroups(allOrders, doneSourceFilter).map(g => (
                  <DoneAccordion
                    key={g.purchaser}
                    group={g}
                    token={token}
                    onRunAction={runAction}
                    onSaveNote={saveNote}
                    onPurchaseDone={handlePurchaseDone}
                    onToggleFavorite={toggleFavorite}
                    onMoved={handleMoved}
                    exiting={exiting}
                  />
                ))}
              </>

            ) : searchMode === "spotlight" ? null : (
              allOrders.map((order, idx) => (
                <Fragment key={order.id}>
                  {filter === "AWAITING_LINK" && !query && idx === AWAITING_LINK_HEAD && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px" }}>
                      <div style={{ flex: 1, height: 1, background: C.hairline }} />
                      <span style={{ fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap" }}>
                        ⬆ свежие · ниже — с самых старых
                      </span>
                      <div style={{ flex: 1, height: 1, background: C.hairline }} />
                    </div>
                  )}
                  <OrderCard
                    order={order}
                    token={token}
                    currentTab={isAttentionView ? "ATTENTION" : filter}
                    live={liveMap[order.id]}
                    exiting={exiting.has(order.id)}
                    onRunAction={(action, reason) => runAction(order, action, reason)}
                    onSaveNote={(note) => saveNote(order.id, note)}
                    onPurchaseDone={() => handlePurchaseDone(order)}
                    onToggleFavorite={() => toggleFavorite(order)}
                    onMoved={() => handleMoved(order)}
                  />
                </Fragment>
              ))
            )}

            {data && page < data.pages && (
              <div ref={sentinelRef} style={{ minHeight: 1 }}>
                <button
                  className="twa-press"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    width: "100%",
                    background: "rgba(118,118,128,0.18)", border: "none", borderRadius: 12,
                    color: loadingMore ? C.textTertiary : C.textPrimary,
                    fontSize: 15, fontWeight: 500, padding: "14px",
                    cursor: loadingMore ? "default" : "pointer",
                    marginTop: 4, opacity: loadingMore ? 0.6 : 1,
                    letterSpacing: 0.1,
                  }}
                >
                  {loadingMore ? "Загрузка…" : `Показать ещё (${Math.max(0, data.total - allOrders.length)})`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Выгрузка ID геймпассов текущей очереди (ручной выкуп) */}
      {exportOpen && (
        <GamepassExportSheet
          token={token}
          tab={filter}
          tabLabel={TAB_META[filter].label}
          onClose={() => setExportOpen(false)}
        />
      )}

      {/* П4: модалка ручного создания заказа */}
      {createOpen && (
        <CreateManualModal
          token={token}
          mode={createMode}
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false);
            setPage(1);
            fetchOrders(serverTab, query, 1, false);
            onActionDone?.();
          }}
        />
      )}
    </div>
  );
}

/* ───────────── Direct intents («⏳ Выбирают оплату») ─────────────
   Заявки прямых заказов из ботов. Клиент видит три кнопки: сайт / эквайринг /
   реквизиты. Пока он не выбрал, заявка висит здесь. Админ может проактивно
   отправить QR (СБП) или реквизиты текстом, либо отклонить. После выбора
   заявка превращается в заказ DIR-… (PAYMENT_PENDING/AWAITING_PAYMENT). */
function IntentCard({ intent, token, qrConfigured, onGone }: {
  intent: Intent;
  token: string;
  qrConfigured: boolean;
  onGone: (result: "consumed" | "rejected") => void;
}) {
  const [busy, setBusy] = useState<null | "qr" | "details" | "reject">(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsText, setDetailsText] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  const platform: "tg" | "vk" | "—" = intent.user.tgId ? "tg" : intent.user.vkId ? "vk" : "—";
  const expectedPass = Math.ceil(intent.totalAmount / 0.7);

  async function run(action: "send-qr" | "send-details" | "reject") {
    if (busy) return;
    setBusy(action === "send-qr" ? "qr" : action === "send-details" ? "details" : "reject");
    try {
      const r = await fetch("/api/twa/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action, intentId: intent.id,
          ...(action === "send-details" ? { details: detailsText.trim() } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        haptic.notify("error");
        toast(d.error ?? "Ошибка", "error");
        // 409/410 — заявку уже обработали из TG или она просрочена: убираем.
        if (r.status === 409 || r.status === 410) onGone("consumed");
        return;
      }
      haptic.notify("success");
      if (action === "reject") {
        toast(d.notified ? "Заявка отклонена, клиент уведомлён" : "Заявка отклонена (уведомление не доставлено)", "default");
        onGone("rejected");
      } else {
        const what = action === "send-qr" ? "QR отправлен" : "Реквизиты отправлены";
        toast(
          d.notified
            ? `✅ ${what} (${String(d.notified).toUpperCase()}) · заказ ${d.code}`
            : `⚠️ Заказ ${d.code} создан, но сообщение НЕ доставлено — напиши клиенту сам`,
          d.notified ? "success" : "error",
        );
        onGone("consumed");
      }
    } catch {
      haptic.notify("error");
      toast("Ошибка сети", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="twa-glass-order" style={{
      background: C.card,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: SHADOW.card,
      border: `1px solid ${C.blue}33`,
    }}>
      <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, color: "#fff",
            background: platform === "tg" ? "#229ED9" : platform === "vk" ? "#0077FF" : C.elevated,
            borderRadius: 5, padding: "4px 8px", flexShrink: 0,
          }}>
            {platform === "tg" ? "T" : platform === "vk" ? "V" : "—"}
          </span>
          <span
            onClick={e => { e.stopPropagation(); haptic.impact("light"); openContact(intent.user); }}
            style={{
              fontSize: 17, fontWeight: 600, color: "#7ec5ff", cursor: "pointer",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
            }}
          >
            {userShortName(intent.user)}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 600, color: C.blue,
            background: `${C.blue}1c`, padding: "4px 9px",
            borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
          }}>
            ⏳ заявка
          </span>
          {intent.prevOrders > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: C.green,
              background: `${C.green}1c`, padding: "3px 8px",
              borderRadius: 999, flexShrink: 0, whiteSpace: "nowrap",
            }}>
              🔄 ×{intent.prevOrders}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 500, color: ageColor(intent.createdAt), ...tabular }}>
            ⏱ {fmtAge(intent.createdAt)}
          </span>
          <span style={{ fontSize: 14, color: C.textTertiary }}>—</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, ...tabular }}>
            {intent.totalAmount.toLocaleString("ru-RU")}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.accent }}>R$</span>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.green, ...tabular }}>
            → {intent.rublePrice.toLocaleString("ru-RU")} ₽
          </span>
          {intent.bonus > 0 && (
            <span style={{ fontSize: 13, color: C.yellow }}>🎁 +{intent.bonus}</span>
          )}
        </div>
      </div>

      <div style={{ padding: "6px 16px 12px" }}>
        <DataRow icon="🎮" copyText={intent.robloxUsername}>
          <span style={{ fontWeight: 600 }}>{intent.robloxUsername}</span>
        </DataRow>
        <DataRow icon="🔗" copyText={intent.gamepassUrl}>
          <a
            href={intent.gamepassUrl}
            target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ color: C.blue }}
          >
            {intent.gamepassUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
          </a>
        </DataRow>
        <div style={{ fontSize: 13, color: C.textTertiary, padding: "2px 0 0 26px" }}>
          геймпасс ≈ {expectedPass.toLocaleString("ru-RU")} R$ · выдать {intent.totalAmount.toLocaleString("ru-RU")} R$
        </div>
      </div>

      {detailsOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          padding: "10px 14px 4px",
          borderTop: `1px solid ${C.hairline}`,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <textarea
            placeholder="Реквизиты (номер карты/телефона, банк)…"
            value={detailsText}
            onChange={e => setDetailsText(e.target.value)}
            rows={2}
            style={{
              background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 10,
              color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
              padding: "10px 12px", resize: "none", outline: "none",
              width: "100%", boxSizing: "border-box", fontFamily: "inherit",
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, padding: "10px 14px 14px" }}>
        {!detailsOpen ? (
          <>
            <button className="twa-press" disabled={!!busy || !qrConfigured}
              title={qrConfigured ? undefined : "QR не загружен в БД"}
              onClick={() => run("send-qr")}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: "rgba(10,132,255,0.14)", color: C.blue, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || !qrConfigured ? 0.5 : 1 }}>
              {busy === "qr" ? "⏳…" : "📷 QR (СБП)"}
            </button>
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setDetailsOpen(true); setConfirmReject(false); }}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: "rgba(48,209,88,0.12)", color: C.green, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              💳 Реквизиты
            </button>
          </>
        ) : (
          <>
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setDetailsOpen(false); setDetailsText(""); }}
              style={{ flex: 1, padding: "13px", border: "none", borderRadius: 12, background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              Отмена
            </button>
            <button className="twa-press" disabled={!!busy || !detailsText.trim()}
              onClick={() => run("send-details")}
              style={{ flex: 2, padding: "13px", border: "none", borderRadius: 12, background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: busy || !detailsText.trim() ? 0.5 : 1 }}>
              {busy === "details" ? "⏳…" : "Отправить клиенту"}
            </button>
          </>
        )}
        {!detailsOpen && (
          confirmReject ? (
            <button className="twa-press" disabled={!!busy}
              onClick={() => run("reject")}
              style={{ flexShrink: 0, padding: "13px 12px", border: "none", borderRadius: 12, background: C.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              {busy === "reject" ? "⏳…" : "Точно?"}
            </button>
          ) : (
            <button className="twa-press" disabled={!!busy}
              onClick={() => { setConfirmReject(true); window.setTimeout(() => setConfirmReject(false), 3500); }}
              style={{ width: 44, flexShrink: 0, padding: "13px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
              ✕
            </button>
          )
        )}
      </div>
    </article>
  );
}

function IntentsSection({ token, intents, qrConfigured, loading, onIntentGone }: {
  token: string;
  intents: Intent[];
  qrConfigured: boolean;
  loading: boolean;
  onIntentGone: (id: string, result: "consumed" | "rejected") => void;
}) {
  if (loading && intents.length === 0) return null;
  if (intents.length === 0) return null;
  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 2px" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.blue, whiteSpace: "nowrap" }}>
          ⏳ Заявки · выбирают оплату ({intents.length})
        </span>
        <div style={{ flex: 1, height: 1, background: C.hairline }} />
      </div>
      {intents.map(i => (
        <IntentCard
          key={i.id}
          intent={i}
          token={token}
          qrConfigured={qrConfigured}
          onGone={(result) => onIntentGone(i.id, result)}
        />
      ))}
    </div>
  );
}

/* ───────────── MiniDashboard — summary-карточки в Premium Calm стиле ───────────── */
function fmtRobux(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ru-RU");
}

function pluralOrders(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "заказов";
  const d = n % 10;
  return d === 1 ? "заказ" : d >= 2 && d <= 4 ? "заказа" : "заказов";
}

// Режим суммы: amount в БД — чистые R$ (клиенту), грязные = ceil(amount / 0.7)
// (цена геймпасса, что спишется с донора). Крупная цифра — то, чем оперирует
// менеджер в этой категории; в скобках — второе значение (grossOnly — без скобок).
type DashSumMode = "grossClean" | "cleanGross" | "grossOnly";

const DASHBOARD_GROUPS: { key: string; label: string; sumKey: string; filter: FilterTab; color: string; mode: DashSumMode; oldestKey?: string }[] = [
  { key: "buyout", label: "К выкупу",    sumKey: "BUYOUT",        filter: "BUYOUT",        color: C.green,  mode: "grossClean", oldestKey: "BUYOUT" },
  { key: "link",   label: "Ждут ссылку", sumKey: "AWAITING_LINK", filter: "AWAITING_LINK", color: C.yellow, mode: "cleanGross", oldestKey: "AWAITING_LINK" },
  { key: "direct", label: "Прямой",      sumKey: "DIRECT",        filter: "DIRECT",        color: C.blue,   mode: "grossOnly" },
  { key: "avito",  label: "Авито",       sumKey: "AVITO",         filter: "AVITO",         color: C.orange, mode: "grossOnly" },
  { key: "new",    label: "Новые",       sumKey: "NEW",           filter: "NEW",           color: C.accent, mode: "cleanGross" },
  { key: "error",  label: "Ошибка",      sumKey: "ERROR",         filter: "ERROR",         color: C.red,    mode: "grossClean" },
];
// «В работе» показывает ровно видимый контракт WORK: выкуп + старые ссылки + ошибки.
const WORK_DASHBOARD_KEYS = new Set(["buyout", "link", "error"]);

function MiniDashboard({ counts, sums, oldest, onTap, groups = DASHBOARD_GROUPS }: {
  counts: Record<string, number>;
  sums: Record<string, number>;
  oldest?: Record<string, string | null> | null;
  onTap?: (filter: FilterTab) => void;
  groups?: typeof DASHBOARD_GROUPS;
}) {
  const visible = groups.filter(g => (counts[g.filter] ?? 0) > 0);
  if (visible.length === 0) return null;

  return (
    <div className={`twa-dash-grid${visible.length === 1 ? " is-single" : ""}`}>
      {visible.map(g => {
        const count = counts[g.filter] ?? 0;
        const cleanRobux = sums[g.sumKey] ?? 0;
        const grossRobux = Math.ceil(cleanRobux / 0.7);
        const primary = g.mode === "cleanGross" ? cleanRobux : grossRobux;
        const secondary = g.mode === "grossClean" ? cleanRobux : g.mode === "cleanGross" ? grossRobux : null;
        const oldestIso = g.oldestKey ? (oldest?.[g.oldestKey] ?? null) : null;

        const body = (
          <>
            <span className="twa-dash-label"><i style={{ background: g.color }} />{g.label}</span>
            <span className="twa-dash-value">
              {fmtRobux(primary)}<small>R$</small>
              {secondary !== null && <em>({fmtRobux(secondary)})</em>}
            </span>
            <span className="twa-dash-meta">
              <span>{count} {pluralOrders(count)}</span>
              {oldestIso && <b title="Старейший в очереди" style={{ color: ageColor(oldestIso) }}>ждёт {fmtAge(oldestIso)}</b>}
            </span>
          </>
        );

        return onTap ? (
          <button key={g.key} type="button" className="twa-dash-card twa-press-sm"
            onClick={() => { haptic.impact("light"); onTap(g.filter); }}>
            {body}
          </button>
        ) : (
          <div key={g.key} className="twa-dash-card" style={{ cursor: "default" }}>{body}</div>
        );
      })}
    </div>
  );
}

function EmptyState({ filter, query, attention, onShowAll }: {
  filter: FilterTab;
  query: string;
  attention?: boolean;
  onShowAll?: () => void;
}) {
  if (query) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
        <div style={{ fontSize: 16, marginBottom: 4 }}>Ничего не нашлось</div>
        <div style={{ fontSize: 14, color: C.textTertiary }}>
          Попробуй ник Roblox, @username, WB-код или ID
        </div>
      </div>
    );
  }
  if (attention) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
        <div style={{ fontSize: 16, marginBottom: 4 }}>Всё под контролем</div>
        <div style={{ fontSize: 14, color: C.textTertiary, marginBottom: 18 }}>
          Ничего не требует внимания
        </div>
        {onShowAll && (
          <button
            className="twa-press-sm"
            onClick={onShowAll}
            style={{
              background: "rgba(118,118,128,0.18)", border: "none", borderRadius: 10,
              color: C.accent, fontSize: 15, fontWeight: 600,
              padding: "10px 18px", cursor: "pointer",
            }}
          >
            Все заказы →
          </button>
        )}
      </div>
    );
  }
  const labels: Record<FilterTab, string> = {
    WORK: "В работе пока ничего нет",
    ALL: "Заказов пока нет",
    BUYOUT: "Нет заказов к выкупу",
    DIRECT: "Нет прямых заказов",
    AVITO: "Нет заказов Авито",
    NEW: "Нет новых заказов",
    ERROR: "Нет ошибок",
    AWAITING_LINK: "Все оформили заказы",
    DONE: "Нет выкупленных заказов",
    REJECTED: "Нет отменённых заказов",
    FAVORITES: "Нет избранных",
    ATTENTION: "Ничего не требует внимания",
  };
  return (
    <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
      <div style={{ fontSize: 16 }}>{labels[filter]}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
      {[100, 100, 100, 100].map((h, i) => (
        <div key={i} style={{
          background: C.card, borderRadius: 16, height: h,
          animation: "pulse 1.5s ease-in-out infinite",
          boxShadow: SHADOW.card,
        }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}`}</style>
    </div>
  );
}
