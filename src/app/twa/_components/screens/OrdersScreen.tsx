"use client";
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { C, SHADOW, tabular, MONO } from "../theme";
import { ageColor, fmtAge } from "../age";
import { haptic } from "../haptics";
import BottomSheet from "../BottomSheet";
import { toast } from "../Toast";
import { copyText } from "../clipboard";
import OrderSheet, { type MatchedOrder, type RebindUser } from "../OrderSheet";
import NickGamepasses from "../NickGamepasses";
import { parseGamepassRef } from "@/lib/gamepass-id";
import { isUnpaidDirect } from "@/lib/buyout-queue";
import {
  orderBadge as sharedOrderBadge,
  orderFlag as sharedOrderFlag,
  primaryActionFor as sharedPrimaryAction,
  type Tone,
} from "@/lib/order-presentation";
import { HOLD_PRESETS, parseAdminNote } from "@/lib/order-hold";
import { MAX_SPLIT_PARTS } from "@/lib/order-gamepass-split";

/** ❄️ Цвет заморозки. Живёт в теме — здесь только короткий псевдоним. */
const ICE = C.ice;

/* Тон приходит из общего `order-presentation`: правило «какой бейдж, какое
   действие, что во флаге» одно на TWA и сайт, а красит его каждый экран своей
   палитрой. Здесь — тёмная палитра TWA. */
const TONE: Record<Tone, string> = {
  green: C.green, yellow: C.yellow, orange: C.orange, red: C.red,
  blue: C.blue, ice: ICE, accent: C.accent, muted: C.textTertiary,
};

type OrderStatus = "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "AWAITING_GAMEPASS" | "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "ERROR";
// ATTENTION — не чип, а серверная выборка «Требуют внимания» для вкладки «Все».
/* Список вкладок — из `@/lib/order-queue`, где живут их границы. Копия здесь
   уже один раз разошлась с сервером; `import type` стирается при компиляции,
   поэтому prisma в клиентский бандл не попадает (значение отсюда импортировать
   нельзя). */
import type { FilterTab } from "@/lib/order-queue";
import type { LaneId, OrderNarrow, OrderSlice, OrderSlicesPayload, SliceKey } from "@/lib/order-slices";

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

/** Живая часть поиска: Roblox отвечает медленнее БД, поэтому приходит отдельно. */
interface LiveGamepass {
  gamepassId: number;
  name: string;
  price: number;
  sellerName: string | null;
  isForSale: boolean;
  matchReason: string;
}
interface LiveDbsOrder {
  id: string;
  wbOrderId: string;
  buyerName: string | null;
  supplierStatus: string;
  denomination: number | null;
  code: string | null;
  closed: boolean;
}
interface LiveSearch {
  gamepasses: LiveGamepass[];
  dbs: LiveDbsOrder[];
  partialErrors: string[];
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
  /** ❄️ Заморозка: «не выкупать, но и не удалять». Признак ПОВЕРХ статуса. */
  heldAt: string | null;
  heldReason: string | null;
  heldBy: string | null;
  /** ⚡ Поднят руками наверх очереди («выкупать первым»). Тоже поверх статуса. */
  priorityAt?: string | null;
  priorityBy?: string | null;
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
  /** Сколько напоминаний «создай геймпасс» бот уже отправил (0…3, потолок). */
  remindersSent?: number | null;
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
  /** Шапка среза: деньги, полосы источников, препятствия, возраст, «сегодня». */
  slices?: OrderSlicesPayload | null;
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
  STALE_LINK:    { label: "Висяки",          color: C.orange },
  DONE:          { label: "Готово",          color: C.green },
  REJECTED:      { label: "Отменены",        color: C.red },
  FAVORITES:     { label: "Избранное",      color: "#ffd60a" },
  ATTENTION:     { label: "Требуют внимания", color: C.orange },
  HELD:          { label: "Заморожены",      color: ICE },
};

/* ── Срезы ───────────────────────────────────────────────────────────────────
   Срез — это не статус в базе, а работа: что вы собираетесь с этими заказами
   делать. Поэтому они названы глаголом и стоят одним рядом.

   Раньше здесь было три этажа навигации: сегмент «В работе / Все / История»,
   ряд из одиннадцати чипов и мини-дашборд с виджетами — вместе они занимали
   треть экрана и заставляли выбирать, ещё не начав работать. Всё, что не
   является ежедневной работой, уехало в шторку «Фильтры»; ни одна вкладка не
   исчезла, и новых статусов БД срезы не заводят.
   ────────────────────────────────────────────────────────────────────────── */
const SLICES: { id: SliceKey; label: string; till: string; color: string }[] = [
  { id: "BUYOUT",        label: "Выкупить", till: "К выкупу",    color: C.green },
  { id: "ERROR",         label: "Починить", till: "Ошибки",      color: C.red },
  { id: "AWAITING_LINK", label: "Дожать",   till: "Ждут ссылку", color: C.yellow },
  { id: "DONE",          label: "История",  till: "История",     color: C.accent },
];

const SLICE_IDS = new Set<string>(SLICES.map(s => s.id));

/* Что уехало в шторку «Фильтры»: всё, что не является ежедневной работой. */
/* «Требуют внимания» в списке нет: это не вкладка, а серверная подборка внутри
   «Все», и своей строкой она стояла бы в шторке дважды. Её строка — отдельная,
   ниже. */
const SHEET_FILTERS: FilterTab[] = [
  "ALL", "WORK", "NEW", "DIRECT", "AVITO", "FAVORITES", "REJECTED", "HELD", "STALE_LINK",
];

const LANE_META: Record<LaneId, { label: string; color: string }> = {
  WB:     { label: "ВБ",     color: C.green },
  WB_DBS: { label: "DBS",    color: C.blue },
  DIRECT: { label: "Прямые", color: C.accent },
};
/* Очереди, где выгрузка ID геймпассов имеет смысл: заказ уже с геймпассом и ждёт выкупа.
   Список синхронен `GAMEPASS_EXPORT_TABS` в `api/twa/orders`. */
const EXPORTABLE_TABS = new Set<FilterTab>(["BUYOUT", "DIRECT", "AVITO", "WORK", "ERROR", "ATTENTION"]);
const COUNTABLE_EXPORT_TABS = new Set<FilterTab>(["BUYOUT", "DIRECT", "AVITO"]);

function orderTabBadge(order: Order): { label: string; color: string } | null {
  const badge = sharedOrderBadge(order as never);
  return badge ? { label: badge.label, color: TONE[badge.tone] } : null;
}

/* ── Главное действие карточки ───────────────────────────────────────────────
   Одна цель на карточку, видимая прямо из ленты: цикл выкупа — «скопировал ID
   → купил в доноре → отметил Выкуплено», и второй шаг обязан быть в один тап.

   Функция чистая и одна на все срезы: подпись определяется СОСТОЯНИЕМ заказа,
   а не вкладкой, на которой он показан. Иначе один и тот же заказ предлагал бы
   в «Выкупить» и в «Все» разные кнопки — и однажды не ту.
   ────────────────────────────────────────────────────────────────────────── */
type CardActionTone = "green" | "blue" | "ice";
interface CardAction {
  /** `contact` открывает диалог с клиентом, остальное — POST в /api/twa/orders. */
  kind: "action" | "contact";
  action?: string;
  icon: string;
  label: string;
  tone: CardActionTone;
}

function primaryActionFor(order: Order): CardAction | null {
  const action = sharedPrimaryAction(order as never);
  return action ? { ...action, tone: action.tone as CardActionTone } : null;
}

/* ── Строка-флаг карточки ────────────────────────────────────────────────────
   Появляется только когда есть что сказать, и красится по смыслу: зелёная —
   пасс проверен и годен, оранжевая — цена разошлась с номиналом, красная —
   выкупать нельзя (пасс снят, рег. цена, клиент недостижим).

   Порядок веток = порядок срочности. Он важнее полноты: строка одна, и если
   пасс снят с продажи, а бот вдобавок не достучался в VK, менеджеру нужно
   узнать про пасс — второе он увидит в досье.
   ────────────────────────────────────────────────────────────────────────── */
function cardFlag(order: Order, live: GpLiveInfo | undefined, reminders: number): { text: string; color: string } | null {
  const flag = sharedOrderFlag(order as never, live, reminders);
  return flag ? { text: flag.text, color: TONE[flag.tone] } : null;
}

/* ───────────── Time formatting ───────────── */

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
  const [editing, setEditing] = useState(false);
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
  /* Заметка была одним жёлтым полем, где всё равнозначно: и «PENDING→ERROR»,
     и причина, по которой заказ нельзя трогать. Строки давно размечены
     маркерами ([РЕГ-ЦЕНА, [НИК?, [ПЕРЕНОС, [ЗАМОРОЗКА) — их просто не
     показывали отдельно. Новых полей в БД для этого не понадобилось. */
  const history = useMemo(() => parseAdminNote(order.adminNote), [order.adminNote]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary }}>
          Заметка
        </span>
        {flash && <span style={{ fontSize: 14, color: C.green, fontWeight: 600 }}>✓</span>}
      </div>

      {history.length > 0 && (
        <div style={{
          display: "flex", flexDirection: "column", borderRadius: 10, overflow: "hidden",
          background: `${C.yellow}14`, border: `1px solid ${C.yellow}40`,
        }}>
          {history.map((line, i) => {
            const frozen = line.kind === "hold";
            return (
              <div key={i} style={{
                padding: "9px 12px",
                borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.07)",
                ...(frozen ? { background: `${ICE}21`, borderLeft: `3px solid ${ICE}` } : {}),
              }}>
                {line.tag && (
                  <span style={{
                    display: "block", marginBottom: 2, fontFamily: MONO, fontSize: 11,
                    letterSpacing: ".03em",
                    color: frozen ? ICE : C.textTertiary,
                    fontWeight: frozen ? 600 : 400,
                  }}>
                    {line.tag}
                  </span>
                )}
                <span style={{
                  fontSize: 14, lineHeight: 1.45,
                  color: frozen ? C.textPrimary : C.textSecondary,
                  fontWeight: frozen ? 600 : 400,
                }}>
                  {line.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Текстовое поле правит заметку ЦЕЛИКОМ (семантика `set-note` не
          менялась), поэтому при непустой истории оно свёрнуто: иначе те же
          строки показывались бы дважды — разобранными и сырым текстом. */}
      {history.length > 0 && !editing && (
        <button
          className="twa-press-sm"
          onClick={e => { e.stopPropagation(); setEditing(true); }}
          style={{
            alignSelf: "flex-start", padding: "6px 12px", borderRadius: 8,
            border: `1px dashed ${C.border}`, background: "transparent",
            color: C.textTertiary, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          ✎ Править текстом
        </button>
      )}

      {(history.length === 0 || editing) && (
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={commit}
          onClick={e => e.stopPropagation()}
          placeholder="Заметка…"
          rows={history.length > 0 ? 5 : 2}
          style={{
            background: hasNote ? `${C.yellow}14` : "rgba(255,255,255,0.06)",
            border: hasNote ? `1px solid ${C.yellow}40` : "1px solid transparent",
            borderRadius: 10, color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
            padding: "10px 12px", resize: "vertical", outline: "none",
            width: "100%", boxSizing: "border-box", fontFamily: "inherit",
          }}
        />
      )}
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
    currentTab === "ERROR" ||
    // ❄️ В своём разделе панель нужна ради одной кнопки — «Разморозить».
    currentTab === "HELD";

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
  const splitAllDone = split.length > 0 && splitDone === split.length;
  // Все части закрыты — покупать больше нечего, остаётся «Выкуплено».
  // Кнопка «Выкупить часть 3/3» на этом месте предлагала бы купить уже
  // купленное; сервер такой вызов отвергает, но приглашать к нему не нужно.
  const hasGamepass = (!!order.gamepassUrl || split.length > 0) && !splitAllDone;

  /* ❄️ Замороженный заказ: кнопок выкупа НЕТ вовсе — не «серые и неактивные»,
     которые можно продавить двойным тапом, а физически отсутствующие. Сервер
     всё равно откажет (assertOrderNotHeld), но предлагать нажать то, что
     заведомо не сработает, — это те же грабли, только вежливые. */
  if (order.heldAt) {
    return (
      <div style={{ display: "flex", gap: 8, padding: "12px 16px 16px" }}>
        <button className="twa-press" onClick={() => doAction("unhold")} disabled={loading}
          style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: `${ICE}2e`, color: ICE, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          {loading ? "⏳…" : "❄ Разморозить"}
        </button>
        <button className="twa-press" onClick={() => doAction("reject")} disabled={loading}
          style={{ width: 44, flexShrink: 0, padding: "14px 0", border: `1px solid ${C.red}55`, borderRadius: 12, background: "transparent", color: C.red, fontSize: 18, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          ✕
        </button>
      </div>
    );
  }

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
      {splitAllDone && (
        <span style={{
          flex: 2, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "14px", borderRadius: 12, background: `${C.green}1f`, color: C.green,
          fontSize: 14, fontWeight: 700, textAlign: "center",
        }}>
          Все {split.length} части отмечены
        </span>
      )}
      {showError && (
        <button className="twa-press" onClick={() => doAction("set-error")} disabled={loading}
          style={{ flex: 1, padding: "14px", border: "none", borderRadius: 12, background: "rgba(255,149,0,0.12)", color: C.orange, fontSize: 15, fontWeight: 600, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>
          Ошибка
        </button>
      )}
      <button className="twa-press" onClick={() => doAction("complete")} disabled={loading}
        style={{
          flex: splitAllDone ? 2 : 1, padding: "14px", border: "none", borderRadius: 12,
          background: splitAllDone ? "rgba(48,209,88,0.22)" : "rgba(10,132,255,0.12)",
          color: splitAllDone ? C.green : C.blue,
          fontSize: 15, fontWeight: splitAllDone ? 700 : 600, cursor: "pointer", opacity: loading ? 0.5 : 1,
        }}>
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

/* ───────────── ❄️ HoldModal — заморозка заказа ─────────────
   Причина обязательна: через месяц «почему нельзя выкупать» не вспомнит никто,
   а заморозка без причины неотличима от забытого заказа. Четыре заготовки
   закрывают почти всё; текст можно дописать руками. */
function HoldModal({ order, onHold, onClose }: {
  order: Order;
  onHold: (reason: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const text = reason.trim();
    if (!text) { toast("Причина обязательна", "error"); return; }
    setLoading(true);
    const res = await onHold(text);
    setLoading(false);
    if (res.ok) onClose();
    else toast(res.error ?? "Ошибка", "error");
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px",
      borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: ICE }}>❄️ Заморозить заказ</div>
      <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: MONO }}>
        {order.wbCode} · {order.robloxUsername ?? order.probableNick ?? "ник не указан"} · {order.amount.toLocaleString("ru-RU")} R$
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {HOLD_PRESETS.map(preset => (
          <button key={preset} className="twa-press-sm" onClick={() => setReason(preset)}
            style={{
              padding: "8px 13px", borderRadius: 999, cursor: "pointer",
              border: reason === preset ? `1px solid ${ICE}66` : "1px solid transparent",
              background: reason === preset ? `${ICE}29` : "rgba(255,255,255,0.08)",
              color: reason === preset ? ICE : C.textSecondary,
              fontSize: 13, fontWeight: 600,
            }}>
            {preset}
          </button>
        ))}
      </div>

      <textarea
        placeholder="Причина (обязательно)…"
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={2}
        style={{
          background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 10,
          color: C.textPrimary, fontSize: 15, lineHeight: 1.4,
          padding: "10px 12px", resize: "none", outline: "none",
          width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />

      <div style={{
        display: "flex", gap: 9, padding: "11px 13px", borderRadius: 11,
        background: `${C.accent}1a`, border: `1px solid ${C.accent}42`,
        fontSize: 13, lineHeight: 1.45, color: C.textSecondary,
      }}>
        <span>💡</span>
        <span>
          Заказ останется на месте и никуда не пропадёт. Он выключается из{" "}
          <b style={{ color: C.accent }}>автовыкупа</b>,{" "}
          <b style={{ color: C.accent }}>очереди «К выкупу»</b> и{" "}
          <b style={{ color: C.accent }}>ручной покупки</b> — до разморозки.
        </span>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Отмена
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !reason.trim()}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: ICE, color: "#0b1620", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading || !reason.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Заморозить"}
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
// RebindUser — общий тип, живёт в OrderSheet (модалка тоже ищет клиентов).
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

/* ───────────── След покупателя ─────────────
   Разбор спора: клиент говорит «я такой ник не указывал». Здесь видно, что он
   вводил и присылал, с точным временем — плюс подтверждённый ник и владелец
   выкупленного пасса, которые пишет Roblox, а не покупатель. */
function AuditTrail({ order, token }: { order: Order; token: string }) {
  type AuditEvent = { id: string; type: string; payload: Record<string, unknown>; createdAt: string };
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ events: AuditEvent[]; confirmedNick: string | null } | null>(null);

  async function load() {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "order-audit", orderId: order.id }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { toast(d?.error ?? "Не удалось загрузить след", "error"); return; }
      setData({ events: d.events ?? [], confirmedNick: d.confirmedNick ?? null });
    } catch { toast("Ошибка сети", "error"); }
    finally { setLoading(false); }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Moscow",
  });

  if (!open) {
    return (
      <div style={{ padding: "0 14px 6px" }}>
        <button className="twa-press-sm" onClick={e => { e.stopPropagation(); haptic.select(); void load(); }}
          style={{
            width: "100%", padding: "10px", borderRadius: 10, border: `1px solid ${C.border}`,
            background: "transparent", color: C.textSecondary, fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>
          🧾 Что клиент вводил и присылал
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 14px 8px" }} onClick={e => e.stopPropagation()}>
      <div style={{ padding: "12px 13px", borderRadius: 12, background: C.elevated, border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e5e5ea" }}>🧾 След покупателя</span>
          <button className="twa-press-sm" onClick={() => setOpen(false)}
            style={{ marginLeft: "auto", border: "none", background: "transparent", color: C.textTertiary, fontSize: 13, cursor: "pointer" }}>
            свернуть
          </button>
        </div>

        {loading && <div style={{ fontSize: 13, color: C.textTertiary }}>Загружаю…</div>}

        {!loading && data && data.events.length === 0 && (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.textTertiary }}>
            Записей нет — заказ старше, чем сам механизм (введён 28.08.2026).
            Косвенные доказательства: подтверждённый ник и владелец выкупленного пасса ниже.
          </div>
        )}

        {!loading && data && data.events.map(e => {
          const p = e.payload ?? {};
          const isNick = e.type === "AUDIT_NICK_ENTERED";
          const subject = String(isNick ? p.nick ?? "" : p.gamepassId ?? "");
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 }}>
              <span style={{ flexShrink: 0 }}>{isNick ? "⌨️" : "🎮"}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b style={{ color: "#e5e5ea", wordBreak: "break-all" }}>{subject}</b>
                <span style={{ color: C.textTertiary }}>
                  {isNick ? " — ввёл ник" : " — прислал геймпасс"}
                  {p.creatorName ? <> · владелец по Roblox <b style={{ color: C.textSecondary }}>{String(p.creatorName)}</b></> : null}
                  {p.price ? ` · ${Number(p.price).toLocaleString("ru-RU")} R$` : ""}
                  {p.via ? ` · ${String(p.via)}` : ""}
                </span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 11.5, color: C.textTertiary, fontVariantNumeric: "tabular-nums" }}>
                {fmt(e.createdAt)}
              </span>
            </div>
          );
        })}

        {!loading && data && (
          <div style={{ paddingTop: 8, borderTop: `1px solid ${C.border}`, fontSize: 12.5, lineHeight: 1.5, color: C.textTertiary }}>
            {/* Вторая половина доказательства: эти два поля заполняет Roblox,
                а не покупатель — напечатать в них что-либо невозможно. */}
            Подтверждённый ник заказа: <b style={{ color: C.textSecondary }}>{data.confirmedNick ?? "—"}</b>.
            Он записан из ответа Roblox о владельце присланного геймпасса, и робуксы уходят именно ему.
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── Разбиение выкупа: выбор пассов ─────────────
   Админ набирает пассы покупателя, сумма номиналов должна сойтись с заказом.
   Номинал берётся из цены самого пасса (floor(price·0.7)), а не вводится
   руками: набранное число, разошедшееся с реальной ценой, сервер всё равно
   отвергнет прайс-гардом — лучше не давать его набрать.

   Это НЕ чекбоксы, а счётчики: один и тот же пасс берётся сколько нужно раз.
   Живой случай — заказ на 2000, а у покупателя выставлен один пасс на 1000:
   нужны две одинаковые части. Каждый повтор выкупается с ДРУГОГО донора (в
   очереди аккаунты по 2-3 тысячи, заказ и так растаскивается по ним) — иначе
   второй раз Roblox ответит AlreadyOwned. Об этом предупреждает плашка. */
function SplitModal({ order, token, onDone, onClose, preselect = null }: {
  order: Order; token: string; onDone: () => void; onClose: () => void;
  /** Пасс, выбранный ещё до открытия — из списка пассов ника в карточке.
   *  Добавляется к уже собранным частям, а не заменяет их. */
  preselect?: string | null;
}) {
  type Candidate = { gamepassId: string; name: string; price: number; amount: number; busyWith: string | null };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nick, setNick] = useState<string | null>(null);
  const [passes, setPasses] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<string[]>(() => [
    ...(order.splitGamepasses ?? []).map(p => p.gamepassId),
    ...(preselect ? [String(preselect)] : []),
  ]);

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
  /** Пассы, взятые больше одного раза: их нельзя выкупать одним донором. */
  const repeated = [...new Set(chosen)].filter(id => chosen.filter(x => x === id).length > 1);

  /** Тап по пассу добавляет ЕЩЁ одну часть на нём — повторы разрешены. */
  function add(id: string) {
    if (chosen.length >= MAX_SPLIT_PARTS) {
      toast(`Максимум ${MAX_SPLIT_PARTS} частей на заказ`, "error");
      return;
    }
    haptic.select();
    setChosen(prev => [...prev, id]);
  }

  /** Минус снимает ПОСЛЕДНЮЮ часть этого пасса, а не все сразу. */
  function removeOne(id: string) {
    haptic.select();
    setChosen(prev => {
      const last = prev.lastIndexOf(id);
      return last < 0 ? prev : [...prev.slice(0, last), ...prev.slice(last + 1)];
    });
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
      // Сервер мог записать разбиение, не сумев подтвердить пассы у Roblox
      // (лежит браузер выкупа и мост). Молчать об этом нельзя: цену и продавца
      // у таких частей проверит только сам выкуп.
      if (d?.warning) toast(`🧩 Разбит на ${picked.length}. ${d.warning}`, "error");
      else toast(`🧩 Разбит на ${picked.length} — выкупай по частям`, "success");
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
          {!hasPurchased && (
            <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 6, lineHeight: 1.35 }}>
              Тап по пассу добавляет часть. Один и тот же пасс можно взять
              несколько раз — «−» убирает одну.
            </div>
          )}
        </div>

        {hasPurchased && (
          <div style={{ margin: "0 20px 10px", padding: "10px 12px", borderRadius: 10, background: `${C.yellow}14`, color: C.yellow, fontSize: 13, fontWeight: 600 }}>
            Часть уже выкуплена — менять состав нельзя, только снять разбиение целиком.
          </div>
        )}

        {/* Повтор законен, но исполняется руками: тот же донор второй раз
            получит AlreadyOwned и спишет робуксы впустую. */}
        {repeated.length > 0 && !hasPurchased && (
          <div style={{ margin: "0 20px 10px", padding: "10px 12px", borderRadius: 10, background: `${C.orange}14`, color: C.orange, fontSize: 12.5, fontWeight: 600, lineHeight: 1.4 }}>
            Пасс взят несколько раз ({repeated.map(id => `${id} ×${chosen.filter(x => x === id).length}`).join(", ")}).
            Каждый повтор выкупай с <b>другого донора</b> — тому же аккаунту Roblox
            ответит AlreadyOwned.
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
            const count = chosen.filter(x => x === p.gamepassId).length;
            const on = count > 0;
            const blocked = !!p.busyWith || hasPurchased;
            const canAdd = !blocked && chosen.length < MAX_SPLIT_PARTS;
            return (
              <div key={p.gamepassId} style={{
                display: "flex", alignItems: "stretch", marginBottom: 6, borderRadius: 12,
                background: on ? `${C.accent}22` : C.elevated,
                border: `1px solid ${on ? C.accent : "transparent"}`,
                opacity: blocked ? 0.45 : 1,
              }}>
                {/* Тело строки = «плюс». Отдельной кнопки «+» нет намеренно:
                    палец на телефоне попадает в строку, а не в 30 px. */}
                <button className="twa-press"
                  onClick={() => canAdd && add(p.gamepassId)}
                  disabled={!canAdd}
                  aria-label={`Добавить часть на ${p.amount} R$ — ${p.name}`}
                  style={{
                    flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                    padding: on ? "10px 4px 10px 12px" : "10px 12px",
                    background: "transparent", border: "none", borderRadius: 12,
                    cursor: canAdd ? "pointer" : "not-allowed",
                  }}>
                  <span style={{
                    width: on ? undefined : 22, minWidth: on ? 28 : undefined, height: 22,
                    padding: on ? "0 6px" : 0, flexShrink: 0, borderRadius: 7,
                    display: "grid", placeItems: "center",
                    background: on ? C.accent : "transparent", border: on ? "none" : `1px solid ${C.border}`,
                    color: "#fff", fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                  }}>{on ? `×${count}` : ""}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#e5e5ea", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{
                      display: "block", fontSize: 12, color: C.textTertiary, fontVariantNumeric: "tabular-nums",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {/* Без слова «пасс»: в списке пассов оно лишнее, а места
                          не хватало ровно на ID — то, что отсюда копируют. */}
                      {p.price.toLocaleString("ru-RU")} R$ · {p.gamepassId}
                      {p.busyWith ? ` · занят ${p.busyWith}` : ""}
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: on ? C.accent : C.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                    {count > 1 ? `${(p.amount * count).toLocaleString("ru-RU")}` : p.amount.toLocaleString("ru-RU")}
                  </span>
                </button>
                {on && !hasPurchased && (
                  <span style={{ display: "grid", placeItems: "center", padding: "0 8px 0 2px", flexShrink: 0 }}>
                    <button className="twa-press-sm"
                      onClick={() => removeOne(p.gamepassId)}
                      aria-label={`Убрать одну часть — ${p.name}`}
                      style={{
                        width: 30, height: 30, display: "grid", placeItems: "center",
                        border: "none", borderRadius: 999, cursor: "pointer",
                        background: "rgba(255,255,255,0.08)",
                        color: "#e5e5ea", fontSize: 19, fontWeight: 700, lineHeight: 1, paddingBottom: 2,
                      }}>−</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Итог: сумма обязана сойтись точно — сервер допуска не даёт. */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* nowrap на каждой части: без него «не хватает» вытесняло строку в
              перенос ПОСРЕДИ фразы — «Выбрано» и «1:» оказывались на разных
              этажах. Переносится теперь целыми смысловыми кусками. */}
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 8px", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: C.textTertiary, whiteSpace: "nowrap" }}>Выбрано {picked.length}:</span>
            <b style={{ color: diff === 0 && picked.length >= 2 ? C.green : C.textSecondary, whiteSpace: "nowrap" }}>{sum.toLocaleString("ru-RU")} R$</b>
            <span style={{ color: C.textTertiary, whiteSpace: "nowrap" }}>из {order.amount.toLocaleString("ru-RU")} R$</span>
            {diff !== 0 && picked.length > 0 && (
              <span style={{ marginLeft: "auto", color: C.orange, fontWeight: 700, whiteSpace: "nowrap" }}>
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
function SplitPartsBlock({ parts, orderAmount, orderId, token, onChanged }: {
  parts: SplitPart[]; orderAmount: number; orderId: string; token: string; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const ordered = [...parts].sort((a, b) => a.position - b.position);

  // Ручная отметка: выкупили пасс руками, вне нашей кнопки. Клиенту НИЧЕГО не
  // уходит — он получил не весь заказ; уведомление шлёт только «Выкуплено».
  async function toggle(part: SplitPart) {
    if (busy) return;
    setBusy(part.id);
    haptic.select();
    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "mark-split-part", orderId, partId: part.id, purchased: !part.purchasedAt,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { haptic.notify("error"); toast(d?.error ?? "Ошибка", "error"); return; }
      toast(
        d.allDone
          ? `🧩 ${d.progress} — все части отмечены. Нажми «Выкуплено», чтобы закрыть заказ и уведомить клиента`
          : `🧩 ${d.progress}`,
        d.allDone ? "success" : "default",
      );
      onChanged();
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setBusy(null); }
  }
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
              {/* Хитбокс намеренно крупный: пальцем по списку на телефоне
                  попасть в 16 px нельзя, а цена промаха — отметка не той части. */}
              <button
                className="twa-press-sm"
                onClick={e => { e.stopPropagation(); toggle(p); }}
                disabled={busy !== null}
                aria-label={bought ? `Снять отметку выкупа с части ${i + 1}` : `Отметить часть ${i + 1} выкупленной`}
                style={{
                  width: 30, height: 30, flexShrink: 0, marginLeft: -4,
                  display: "grid", placeItems: "center",
                  borderRadius: 9, cursor: busy ? "wait" : "pointer",
                  border: bought ? "none" : `1.5px solid ${isNext ? C.blue : C.border}`,
                  background: bought ? C.green : "transparent",
                  color: "#fff", fontSize: 15, lineHeight: 1,
                  opacity: busy === p.id ? 0.5 : 1,
                }}
              >
                {bought ? "✓" : ""}
              </button>
              <span style={{
                fontSize: 13, fontWeight: 700, color: bought ? C.textTertiary : "#e5e5ea",
                fontVariantNumeric: "tabular-nums", minWidth: 66,
              }}>
                {p.amount.toLocaleString("ru-RU")} R$
              </span>
              {/* ID копируется по тапу, а не открывает Roblox: выкуп идёт
                  вставкой ID в донорский аккаунт, и это то действие, которое
                  здесь совершают каждый раз. Ссылка на пасс открывается из
                  общей строки заказа выше. */}
              <button
                className="twa-press-sm"
                onClick={e => {
                  e.stopPropagation();
                  copyText(p.gamepassId);
                  haptic.impact("light");
                  setCopiedId(p.gamepassId);
                  setTimeout(() => setCopiedId(c => (c === p.gamepassId ? null : c)), 1400);
                  toast(`ID ${p.gamepassId} скопирован`, "success");
                }}
                style={{
                  padding: "3px 7px", marginLeft: -3, borderRadius: 7, border: "none", cursor: "pointer",
                  background: copiedId === p.gamepassId ? `${C.green}26` : "transparent",
                  color: copiedId === p.gamepassId ? C.green : C.blue,
                  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {copiedId === p.gamepassId ? "✓ скопирован" : p.gamepassId}
              </button>
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

      {/* Разница между галочкой и «Выкуплено» — это разница между «мы видим» и
          «клиент знает». Её нужно назвать прямо, иначе её узнают методом проб. */}
      <div style={{ fontSize: 11.5, lineHeight: 1.45, color: C.textTertiary }}>
        {allDone
          ? "Все части отмечены. Клиент узнает только после «Выкуплено»."
          : "Галочка — отметка для нас, клиенту ничего не уходит. Уведомление шлёт «Выкуплено»."}
      </div>
    </div>
  );
}

/* ── ✕ RejectModal — отмена заказа с причиной ────────────────────────────────
   Причина не формальность: она уходит клиенту сообщением и остаётся в
   карточке. «Не указана» в переписке с покупателем читается как «нас
   отшили», поэтому поле обязательное, а заготовки закрывают частые случаи.
   ────────────────────────────────────────────────────────────────────────── */
const REJECT_PRESETS = [
  "Не прислал ссылку на геймпасс",
  "Клиент отказался",
  "Дубль заказа",
  "Оплата не подтвердилась",
];

function RejectModal({ order, onReject, onClose }: {
  order: Order;
  onReject: (reason: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    const text = reason.trim();
    if (!text) { toast("Причина обязательна", "error"); return; }
    setLoading(true);
    const res = await onReject(text);
    setLoading(false);
    if (res.ok) onClose();
    else toast(res.error ?? "Ошибка", "error");
  }

  return (
    <div onClick={e => e.stopPropagation()} style={{
      padding: "12px 14px 14px", borderTop: `1px solid ${C.hairline}`,
      background: "rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>✕ Отменить заказ</div>
      <div style={{ fontSize: 13, color: C.textSecondary, fontFamily: MONO }}>
        {order.wbCode} · {order.robloxUsername ?? order.probableNick ?? "ник не указан"} · {order.amount.toLocaleString("ru-RU")} R$
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {REJECT_PRESETS.map(preset => (
          <button key={preset} className="twa-press-sm" onClick={() => setReason(preset)}
            style={{
              padding: "8px 13px", borderRadius: 999, cursor: "pointer",
              border: reason === preset ? `1px solid ${C.red}66` : "1px solid transparent",
              background: reason === preset ? `${C.red}29` : "rgba(255,255,255,0.08)",
              color: reason === preset ? C.red : C.textSecondary, fontSize: 13, fontWeight: 600,
            }}>
            {preset}
          </button>
        ))}
      </div>
      <textarea
        placeholder="Причина (уйдёт клиенту)…"
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={2}
        style={{
          background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 10,
          color: C.textPrimary, fontSize: 15, lineHeight: 1.4, padding: "10px 12px",
          resize: "none", outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="twa-press" onClick={onClose}
          style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: C.elevated, color: C.textSecondary, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Назад
        </button>
        <button className="twa-press" onClick={submit} disabled={loading || !reason.trim()}
          style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: loading || !reason.trim() ? 0.5 : 1 }}>
          {loading ? "…" : "Отменить заказ"}
        </button>
      </div>
    </div>
  );
}

/* ── Меню «···» ──────────────────────────────────────────────────────────────
   Четыре группы, отсортированные по частоте. Меню не заменяет формы, а
   доводит до них: «Редактировать» открывает тот же лист заказа, что и
   создание, «Разбить» — то же разбиение. Автовыкуп донором понижен в «редко»
   осознанно: выкуп сейчас ручной, и кнопка, тратящая робуксы, не должна
   стоять рядом с копированием ID.
   ────────────────────────────────────────────────────────────────────────── */
type MenuAction =
  | "edit" | "split" | "rebind" | "move"
  | "error" | "hold" | "unhold" | "favorite" | "priority" | "reject"
  | "purchase" | "refund" | "trace";

function OrderMenuSheet({
  open, order, passId, splitIds, grossAmount, canEdit, canSplit, canRefund, canMove, canPurchase, canPrioritize, busy,
  onClose, onCopy, onPick,
}: {
  open: boolean;
  order: Order;
  passId: string | null;
  splitIds: string[];
  grossAmount: number;
  canEdit: boolean;
  canSplit: boolean;
  canRefund: boolean;
  canMove: boolean;
  canPurchase: boolean;
  canPrioritize: boolean;
  busy: boolean;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
  onPick: (id: MenuAction) => void;
}) {
  const nick = order.robloxUsername ?? order.probableNick ?? null;
  const gamepassLink = passId ? `https://www.roblox.com/game-pass/${passId}` : null;
  // «Всё одной строкой» — чтобы не делать три тапа подряд, когда выкупаешь пачкой.
  const oneLine = [passId, `${grossAmount} R$`, nick].filter(Boolean).join(" · ");
  const row = (id: MenuAction, icon: string, label: string, hint?: string, tone?: "red" | "dim") => (
    <button key={id} type="button" className={`twa-oc-menu-row twa-press-sm${tone === "red" ? " is-red" : tone === "dim" ? " is-dim" : ""}`}
      disabled={busy} onClick={() => { haptic.select(); onPick(id); }}>
      <span>{icon}</span><span>{label}</span>{hint && <em>{hint}</em>}
    </button>
  );
  const copyRow = (icon: string, label: string, text: string, hint?: string) => (
    <button type="button" className="twa-oc-menu-row twa-press-sm"
      onClick={() => { onCopy(text, `${label} скопирован${label.endsWith("а") ? "а" : ""}`); onClose(); }}>
      <span>{icon}</span><span>{label}</span>{hint && <em>{hint}</em>}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`Меню заказа ${order.wbCode}`} className="twa-filter-sheet">
      <div className="twa-oc-menu-head">
        <span>📦</span>
        <b>{order.wbCode}</b>
        <em>{[nick, `${grossAmount.toLocaleString("ru-RU")} R$`].filter(Boolean).join(" · ")}</em>
      </div>

      <div className="twa-oc-menu-group">Скопировать</div>
      {gamepassLink && copyRow("⧉", "Ссылку на геймпасс", gamepassLink, `game-pass/${passId}`)}
      {splitIds.length > 1 && copyRow("⧉", "ID всех частей", splitIds.join("\n"), `${splitIds.length} шт.`)}
      {nick && copyRow("⧉", "Ник Roblox", nick, nick)}
      {oneLine && copyRow("⧉", "Всё одной строкой", oneLine, "для донора")}

      <div className="twa-oc-menu-group">Правка</div>
      {canEdit && row("edit", "✏️", "Редактировать заказ")}
      {canSplit && row("split", "🧩", "Разбить на несколько пассов",
        splitIds.length > 0 ? `${order.splitGamepasses?.filter(p => p.purchasedAt).length ?? 0}/${splitIds.length}` : undefined)}
      {["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "REJECTED"].includes(order.status) && row("rebind", "🔄", "Перепривязать к клиенту")}
      {canMove && row("move", "↪", "Переместить в другой раздел")}

      <div className="twa-oc-menu-group">Статус</div>
      {order.status !== "ERROR" && !order.heldAt && !["COMPLETED", "REJECTED"].includes(order.status) && row("error", "⚠️", "Пометить ошибкой")}
      {order.heldAt
        ? row("unhold", "❄️", "Разморозить", order.heldReason ?? undefined)
        : !["COMPLETED", "REJECTED"].includes(order.status) && row("hold", "❄️", "Заморозить — не выкупать")}
      {row("favorite", order.isFavorite ? "★" : "☆", order.isFavorite ? "Убрать из избранного" : "В избранное")}
      {/* ⚡ Место в очереди — такой же признак поверх статуса, как заморозка:
          заказ никуда не переезжает, он просто выкупается первым. */}
      {canPrioritize && row("priority", "⚡", order.priorityAt ? "Убрать из первых" : "Вперёд очереди",
        order.priorityAt ? "сейчас первый" : "выкупать первым")}
      {["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"].includes(order.status)
        && row("reject", "✕", "Отменить заказ", undefined, "red")}

      <div className="twa-oc-menu-group">Редко</div>
      {canPurchase && row("purchase", "🛒", "Выкупить автоматом (донор)", undefined, "dim")}
      {canRefund && row("refund", "↩️", "Оформить возврат", "T-Bank", "dim")}
      {row("trace", "🕵", "След покупателя", undefined, "dim")}
    </BottomSheet>
  );
}

/* ───────────── OrderCard — compact layout ───────────── */
function OrderCard({
  order, token, currentTab, exiting, onRunAction, onSaveNote, onPurchaseDone, onToggleFavorite, onTogglePriority, onMoved, live,
}: {
  order: Order;
  token: string;
  currentTab: FilterTab;
  exiting: boolean;
  onRunAction: (action: string, reason?: string) => Promise<ActionResult>;
  onSaveNote: (note: string) => Promise<ActionResult>;
  onPurchaseDone?: () => void;
  onToggleFavorite: () => void;
  /** Нет у закрытых заказов: в «Готово» очереди нет и поднимать нечего. */
  onTogglePriority?: () => void;
  onMoved: () => void;
  /** Прайс-гард (Ш4): живая цена ГП — бейдж расхождения с номиналом. */
  live?: GpLiveInfo;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  /** Пасс, выбранный в списке пассов ника до открытия разбиения. */
  const [splitSeed, setSplitSeed] = useState<string | null>(null);
  const [rebindOpen, setRebindOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Какая из двух кнопок копирования только что сработала — для галочки. */
  const [copied, setCopied] = useState<"code" | "pass" | null>(null);
  const [primaryBusy, setPrimaryBusy] = useState(false);
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

  /* Автовыкуп донором. Живёт в меню, в группе «редко»: сейчас выкуп ручной,
     но сама механика рабочая, и прятать её насовсем — значит однажды искать
     её в git. Разбитый заказ покупается по одной части за нажатие, поэтому
     успех бывает промежуточным — тост обязан это различать, иначе «✅»
     читается как «заказ закрыт» и следующую часть никто не выкупит. */
  async function runPurchase() {
    if (primaryBusy) return;
    setPrimaryBusy(true);
    haptic.impact("light");
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
        toast(d.splitDone === false ? `🧩 ${d.msg}` : `✅ ${d.msg}`, "success");
        onPurchaseDone?.();
      } else {
        haptic.notify("error");
        toast(`❌ ${d.msg}`, "error");
      }
    } catch { haptic.notify("error"); toast("Ошибка сети", "error"); }
    finally { setPrimaryBusy(false); }
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
  // ⚡ Поднять можно то, что стоит в очереди. Замороженный заказ выключен из
  // очередей целиком — «подняли, но не выкупается» было бы враньём.
  const canPrioritize = !!onTogglePriority && !order.heldAt
    && ["PENDING", "IN_PROGRESS", "ERROR", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status);
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

  /* ── Четыре строки и три крупные цели ────────────────────────────────────
     Карточка обслуживает ручной цикл выкупа: скопировал ID → купил в доноре →
     отметил «Выкуплено». Всё, что в нём нужно, лежит на поверхности; всё
     остальное — на один тап глубже, в меню «···» и в досье.

     Ряд действий видим ВСЕГДА, а не раскрывается по тапу: очередь выкупа
     бывает на девяносто заказов, и «+1 тап на каждый» — это девяносто лишних
     жестов за проход. Цена решения — на экран влезает пять карточек вместо
     семи; она заплачена сознательно.

     Строки не переезжают между состояниями: меняются только главное действие и
     строка-флаг. Заказ, найденный глазом на одном месте, там же и остаётся.
     ────────────────────────────────────────────────────────────────────── */
  const splitIds = split.map(part => part.gamepassId);
  const isDoneState = order.status === "COMPLETED" || order.status === "REJECTED";
  const railColor = order.heldAt ? ICE : order.status === "ERROR" ? C.red : null;
  const primary = primaryActionFor(order);
  const reminders = order.remindersSent ?? 0;
  const showBell = order.status === "AWAITING_GAMEPASS" && reminders > 0;
  // Ник жёлтым, если он вероятный, а не подтверждённый: выкупать по нему —
  // это ставка, и цвет обязан сказать об этом до нажатия.
  const nick = order.robloxUsername ?? order.probableNick ?? null;
  const nickIsGuess = !order.robloxUsername && !!order.probableNick;
  const flag = cardFlag(order, live, reminders);

  /* Кнопка копирования показывает то, что вставляется в донора. Если пасса
     нет — вставлять нечего, и на её месте стоит вход в поиск пасса по нику. */
  const copySlot: { text: string; label: string; hint?: boolean } | null =
    splitIds.length > 0 ? { text: splitIds.join("\n"), label: `${splitIds.length} ID пассов` }
      : passId ? { text: passId, label: passId }
        : showGpWatch ? { text: "", label: "Найти ГП по нику", hint: true }
          : null;

  async function runPrimary() {
    if (!primary || primaryBusy) return;
    if (primary.kind === "contact") { haptic.impact("light"); openContact(order.user); return; }
    setPrimaryBusy(true);
    haptic.impact("light");
    try { await onRunAction(primary.action!); } finally { setPrimaryBusy(false); }
  }

  function copyAnd(text: string, mark: "code" | "pass", toastText: string) {
    copyText(text);
    haptic.impact("light");
    setCopied(mark);
    setTimeout(() => setCopied(c => (c === mark ? null : c)), 1400);
    toast(toastText, "success");
  }

  // Компактная сводка используется дважды: строкой в ленте и шапкой detail-sheet.
  // Сам sheet рендерится порталом в body: position:fixed внутри iOS-скролла ленты
  // глючит (containing block + layout shift), карточка «вылезала на весь экран».
  const compactSummary = (
    <>
      <span className="twa-oc-top">
        <b style={{ color: tabBadge?.color ?? SOURCE_BADGE_META[order.orderSource]?.color ?? C.accent }}>
          {tabBadge?.label ?? SOURCE_BADGE_META[order.orderSource]?.label ?? order.orderSource}
        </b>
        <small style={{ color: isDoneState ? C.textTertiary : ageColor(timeRef) }}>{fmtAge(timeRef)}</small>
        {showBell && <span className="twa-oc-bell">🔔 {reminders}/3</span>}
        {/* ⚡ виден прямо в ленте: иначе «подняли наверх» проверяется только
            тем, что заказ оказался сверху, — а это же место занимает и просто
            самый старый. */}
        {order.priorityAt && <span className="twa-oc-prio" title="Выкупать первым">⚡ первый</span>}
        {/* Код ВБ — якорь заказа: его называют в чате и по нему ищут. Крупный,
            всегда на одном месте, тап копирует. */}
        <button
          type="button"
          className={`twa-oc-code twa-press-sm${copied === "code" ? " is-done" : ""}`}
          aria-label={`Скопировать код ${order.wbCode}`}
          onClick={e => { e.stopPropagation(); copyAnd(order.wbCode, "code", `Код ${order.wbCode} скопирован`); }}
        >
          {order.wbCode}<i>{copied === "code" ? "✓" : "⧉"}</i>
        </button>
        <i className="twa-oc-chev">{expanded ? "⌃" : "⌄"}</i>
      </span>
      <span className="twa-oc-main">
        <strong style={nickIsGuess ? { color: C.yellow } : undefined}>{nick ?? "Ник не указан"}</strong>
        <b>{displayAmount.toLocaleString("ru-RU")}<small>R$</small></b>
      </span>
      <span className="twa-oc-meta">
        {showCleanHint && <span>{order.amount.toLocaleString("ru-RU")} чистыми</span>}
        {nickIsGuess && <span>вероятный ник</span>}
        {order.status === "COMPLETED" && <span>выкуп: {order.purchaserUsername ?? "вручную"}</span>}
        <span>{shortName}</span>
      </span>
      {flag && <span className="twa-oc-flag" style={{ color: flag.color }}>{flag.text}</span>}
    </>
  );

  return (
    <>
    <article
      className={`twa-glass-order${exiting ? " twa-card-exit" : ""}${railColor ? " has-rail" : ""}${isDoneState ? " is-done-state" : ""}`}
      style={{ background: C.card, borderRadius: 16, overflow: "hidden", boxShadow: SHADOW.card, position: "relative" }}
    >
      {railColor && <span className="twa-oc-rail" style={{ background: railColor }} />}
      {/* Тело карточки — не <button>: внутри живут свои кнопки (код, действия),
          а кнопка в кнопке — невалидная разметка, которую Safari разбирает
          по-своему. role+onKeyDown сохраняют клавиатуру. */}
      <div
        role="button"
        tabIndex={0}
        className="twa-oc-open twa-press-sm"
        aria-expanded={expanded}
        onClick={() => { haptic.select(); setExpanded(value => !value); }}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); haptic.select(); setExpanded(v => !v); }
        }}
      >
        {compactSummary}
      </div>

      {/* Три цели: главное действие · ID пасса · «···». Ни одной ниже 36 px. */}
      <div className="twa-oc-acts">
        {primary && (
          <button type="button" className={`twa-oc-prim twa-press-sm${primary.tone === "blue" ? " is-blue" : primary.tone === "ice" ? " is-ice" : ""}`}
            disabled={primaryBusy} onClick={e => { e.stopPropagation(); void runPrimary(); }}>
            <i>{primary.icon}</i>{primaryBusy ? "…" : primary.label}
          </button>
        )}
        {copySlot ? (
          <button
            type="button"
            className={`twa-oc-copy twa-press-sm${copySlot.hint ? " is-hint" : ""}${copied === "pass" ? " is-done" : ""}`}
            disabled={gpwLoading}
            onClick={e => {
              e.stopPropagation();
              if (copySlot.hint) { void gpwNotify(); return; }
              copyAnd(copySlot.text, "pass", splitIds.length > 0 ? `${splitIds.length} ID скопированы` : "ID пасса скопирован");
            }}
          >
            <i>{copySlot.hint ? "👁" : copied === "pass" ? "✓" : "⧉"}</i>
            <span>{copySlot.hint && gpwLoading ? "Ищу ГП…" : copySlot.label}</span>
          </button>
        ) : <span style={{ flex: 1 }} />}
        <button type="button" className="twa-oc-more twa-press-sm" aria-label="Меню заказа"
          onClick={e => { e.stopPropagation(); haptic.select(); setMenuOpen(true); }}>
          ···
        </button>
      </div>
    </article>

    {/* Меню «···» — всё, что делается с заказом и не входит в ежедневный цикл
        выкупа. Формы оно не дублирует, а ОТКРЫВАЕТ существующие: правка,
        разбиение, перепривязка и заморозка живут в досье, и меню доводит туда
        одним тапом — двух форм с одинаковыми полями в этом экране уже было
        достаточно. */}
    <OrderMenuSheet
      open={menuOpen}
      order={order}
      passId={passId}
      splitIds={splitIds}
      grossAmount={dirtyAmount}
      canEdit={isEditable}
      canSplit={isSplittable}
      canRefund={canRefund}
      canMove={showMoveBtn}
      canPurchase={!order.heldAt && ["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status) && (!!order.gamepassUrl || split.length > 0)}
      canPrioritize={canPrioritize}
      busy={primaryBusy}
      onClose={() => setMenuOpen(false)}
      onCopy={(text, label) => copyAnd(text, "pass", label)}
      onPick={id => {
        setMenuOpen(false);
        // Формы досье: открываем сам лист и нужную форму в нём.
        const inSheet = (fn: () => void) => { setExpanded(true); fn(); };
        switch (id) {
          case "edit":     inSheet(() => setEditOpen(true)); break;
          case "split":    inSheet(() => setSplitOpen(true)); break;
          case "rebind":   inSheet(() => setRebindOpen(true)); break;
          case "move":     inSheet(() => setMoveOpen(true)); break;
          case "hold":     inSheet(() => setHoldOpen(true)); break;
          case "refund":   inSheet(() => setRefundOpen(true)); break;
          case "reject":   inSheet(() => setRejectOpen(true)); break;
          case "trace":    setExpanded(true); break;
          case "favorite": onToggleFavorite(); break;
          case "priority": onTogglePriority?.(); break;
          case "error":    void onRunAction("set-error"); break;
          case "unhold":   void onRunAction("unhold"); break;
          case "purchase": void runPurchase(); break;
        }
      }}
    />

    <BottomSheet
      open={expanded}
      onClose={() => { setExpanded(false); setSheetExpanded(false); }}
      ariaLabel="Карточка заказа"
      className="twa-order-sheet"
      expandable
      expanded={sheetExpanded}
      onExpandedChange={setSheetExpanded}
    >
      <div
        role="button"
        tabIndex={0}
        className="twa-oc-open twa-press-sm"
        onClick={() => { haptic.select(); setExpanded(false); }}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(false); } }}
      >
        {compactSummary}
      </div>
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
          {/* ❄️ Вход в заморозку — рядом со звездой: оба «признака поверх
              статуса», и оба должны быть доступны из любой вкладки. */}
          {!order.heldAt && (
            <button
              className="twa-press-sm"
              aria-label="Заморозить заказ"
              onClick={e => { e.stopPropagation(); haptic.impact("light"); setHoldOpen(true); }}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: 19, padding: "4px 4px", flexShrink: 0, opacity: 0.35,
              }}
            >
              ❄️
            </button>
          )}
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
          {/* Бот шлёт три напоминания (3 ч / 24 ч / 72 ч) и замолкает навсегда.
              «3/3» значит, что автоматика своё отработала и дальше заказ либо
              дожимают руками, либо он висяк — раньше это было видно только в БД. */}
          {order.status === "AWAITING_GAMEPASS" && (order.remindersSent ?? 0) > 0 && (
            <span
              title="Напоминаний отправлено"
              style={{ fontSize: 14, fontWeight: 600, color: (order.remindersSent ?? 0) >= 3 ? C.orange : C.textTertiary, ...tabular }}>
              🔔 {order.remindersSent}/3
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

      {/* ❄️ Плашка заморозки — ПЕРЕД всеми полями.
          Раньше причину «почему нельзя трогать» приходилось вычитывать из
          заметки наравне со служебным логом; здесь она первое, что видно. */}
      {order.heldAt && (
        <div style={{
          display: "flex", gap: 11, margin: "4px 16px 2px", padding: "13px 14px",
          borderRadius: 14, background: `${ICE}1a`, border: `1px solid ${ICE}57`,
        }}>
          <span style={{ fontSize: 19, lineHeight: 1.2 }}>❄️</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <strong style={{ fontSize: 14, fontWeight: 700, color: ICE, letterSpacing: ".01em" }}>
              ЗАМОРОЖЕН — НЕ ВЫКУПАТЬ
            </strong>
            <span style={{ fontSize: 15, color: C.textPrimary, lineHeight: 1.4 }}>
              {order.heldReason || "причина не указана"}
            </span>
            <span style={{ fontSize: 11, color: C.textTertiary, fontFamily: MONO }}>
              {order.heldBy ?? "—"} · {fmtAge(order.heldAt)} назад
            </span>
          </div>
        </div>
      )}

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
          <SplitPartsBlock parts={split} orderAmount={order.amount} orderId={order.id} token={token} onChanged={onMoved} />
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

      {holdOpen && (
        <HoldModal
          order={order}
          onHold={(reason) => onRunAction("hold", reason)}
          onClose={() => setHoldOpen(false)}
        />
      )}

      {rejectOpen && (
        <RejectModal
          order={order}
          onReject={(reason) => onRunAction("reject", reason)}
          onClose={() => setRejectOpen(false)}
        />
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

      {/* Тот же лист заказа, что и при создании, только с целью «правлю этот».
          Две формы с одинаковыми полями разошлись бы снова: в правке не было
          ни поиска пассов, ни живой проверки цены, хотя в создании они есть. */}
      {editOpen && (
        <OrderSheet
          token={token}
          initialTarget={orderToTarget(order)}
          onDone={() => { setEditOpen(false); onMoved(); }}
          onClose={() => setEditOpen(false)}
        />
      )}

      <AuditTrail order={order} token={token} />

      {/* Чем ещё можно закрыть заказ: пассы того же ника. Вторичный блок —
          грузится по кнопке и свёрнут, пока его не позвали. */}
      {isEditable && !!(order.robloxUsername || order.probableNick) && !splitOpen && (
        <div style={{ padding: "0 14px 6px" }}>
          <NickGamepasses
            orderId={order.id}
            wbCode={order.wbCode}
            orderAmount={order.amount}
            currentId={parseGamepassRef(order.gamepassUrl)}
            parts={split}
            splittable={isSplittable}
            token={token}
            onChanged={onMoved}
            onSplitWith={(gamepassId) => { setSplitSeed(gamepassId); setSplitOpen(true); }}
          />
        </div>
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
          preselect={splitSeed}
          onDone={() => { setSplitOpen(false); setSplitSeed(null); onMoved(); }}
          onClose={() => { setSplitOpen(false); setSplitSeed(null); }}
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
  // ❄️ Замороженный ушёл из всех рабочих вкладок — счётчики двигаются отсюда.
  if (order.heldAt) return "HELD";
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
  token, onActionDone, initialQuery, initialTab, initialCreate, onInitialQueryConsumed, onOpenDelivery,
}: {
  token: string;
  onActionDone?: () => void;
  initialQuery?: string;
  /** Найденный заказ DBS открывается на своём экране — с тем же запросом. */
  onOpenDelivery?: (query: string) => void;
  /** Ф2: открыть сразу на вкладке (виджет «Ошибки» дашборда «Свои» → ERROR). */
  initialTab?: string;
  /** «Новый заказ» с главной: открыть форму создания сразу, а не вкладку NEW. */
  initialCreate?: "manual" | "direct" | null;
  onInitialQueryConsumed?: () => void;
}) {
  // Экран открывается на «Выкупить»: это очередь, ради которой сюда заходят.
  // Прежний дефолт «В работе» был мешком из трёх разных работ и первым делом
  // требовал выбрать, чем заняться, — сегмента, который это позволял, больше нет.
  const [filter, setFilter] = useState<FilterTab>(initialQuery ? "ALL" : (initialTab as FilterTab) || "BUYOUT");
  const [query, setQuery] = useState(initialQuery ?? "");
  // Вкладка «Все»: по умолчанию хронологическая лента (новые сверху),
  // подборка «Требуют внимания» — по кнопке «⚠ Внимание (N)» (решение 2026-07-06).
  const [allView, setAllView] = useState<"attention" | "list">("list");
  // П4: модалка «➕ Создать заказ» (ручной заказ целиком из TWA).
  const [exportOpen, setExportOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(!!initialCreate);
  const [createMode, setCreateMode] = useState<"manual" | "direct">(initialCreate === "direct" ? "direct" : "manual");
  // Предзаполнение формы создания из найденного геймпасса: «нашёл пасс ника —
  // сразу завёл на него заказ», без переписывания ссылки руками.
  const [createPrefill, setCreatePrefill] = useState<{ url?: string; nick?: string; amount?: number } | null>(null);
  // Живой поиск по Roblox и по заказам DBS. Раньше это жило на главной в
  // отдельной шторке-досье, где с результатом нельзя было ничего сделать;
  // теперь оно приходит в ту же ленту, где у заказа есть все кнопки.
  const [live, setLive] = useState<LiveSearch | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Сужение ленты по строке шапки среза: полоса источника, корзина возраста,
  // причина-препятствие, номинал. Живёт до смены среза — иначе тап по «DBS 4»
  // тихо переезжал бы в следующий срез и там показывал пустую ленту.
  const [narrow, setNarrow] = useState<OrderNarrow>({});
  // Шапка среза свёрнута? Помним по срезу: в «Выкупить» её открывают каждый
  // раз, в «Историю» заходят за лентой.
  const [tillCollapsed, setTillCollapsed] = useState<Record<string, boolean>>({});
  const [tillAt, setTillAt] = useState<number | null>(null);
  useEffect(() => {
    if (initialQuery || initialTab || initialCreate) onInitialQueryConsumed?.();
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
  const narrowRef = useRef<OrderNarrow>({});
  narrowRef.current = narrow;

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
      // Сужение уходит на сервер, а не фильтрует загруженную страницу: лента
      // приходит по 20 заказов, и «оставить в ленте DBS» по странице означало
      // бы «оставить в первых двадцати».
      const n = narrowRef.current;
      if (n.lane) params.set("lane", n.lane);
      if (n.age) params.set("age", n.age);
      if (n.amount) params.set("amount", String(n.amount));
      if (n.blocked) params.set("blocked", n.blocked);
      const res = await fetch(`/api/twa/orders?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok || reqId !== reqIdRef.current) return;
      const d: OrdersData = await res.json();
      if (reqId !== reqIdRef.current) return;
      // append-страницы идут с skipCounts=1 (counts/sums/oldest = null) — сохраняем прежние.
      setData(prev => append && prev ? { ...d, counts: prev.counts, sums: prev.sums, oldest: prev.oldest, slices: prev.slices } : d);
      setAllOrders(prev => append ? [...prev, ...applyCache(d.orders)] : applyCache(d.orders));
      if (!append) setTillAt(Date.now());
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [token, applyCache]);

  const isAttentionView = filter === "ALL" && !query && allView === "attention";
  const serverTab: FilterTab = isAttentionView ? "ATTENTION" : filter;
  const narrowKey = `${narrow.lane ?? ""}|${narrow.age ?? ""}|${narrow.amount ?? ""}|${narrow.blocked ?? ""}`;

  /* Срез, в котором мы стоим. Фильтр из шторки срезом не является: ряд тогда
     стоит без выделения, а активен чип «Фильтры» — так видно, что лента
     показывает не ежедневную работу. */
  const sliceId: SliceKey | null = SLICE_IDS.has(filter) && !isAttentionView ? (filter as SliceKey) : null;
  const sheetFilterOn = sliceId === null;
  const slicePayload = data?.slices ?? null;
  const activeSlice = sliceId && slicePayload ? slicePayload.slices[sliceId] : null;

  /* Снятие сужения. Подпись называет то, по чему сузили, а не «фильтр»: через
     минуту после тапа никто не помнит, какая именно строка шапки была нажата. */
  const narrowChips = useMemo(() => {
    const out: { key: keyof OrderNarrow; label: string }[] = [];
    if (narrow.lane) out.push({ key: "lane", label: LANE_META[narrow.lane].label });
    if (narrow.amount) out.push({ key: "amount", label: `${narrow.amount} R$` });
    if (narrow.blocked) out.push({
      key: "blocked",
      label: narrow.blocked === "regional" ? "рег. цена" : narrow.blocked === "split" ? "разбитые" : "без пасса",
    });
    if (narrow.age && activeSlice) {
      const bucket = activeSlice.age.buckets.find(b => b.id === narrow.age);
      if (bucket) out.push({ key: "age", label: bucket.label });
    }
    return out;
  }, [narrow, activeSlice]);

  const sliceRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const active = sliceRowRef.current?.querySelector<HTMLElement>(".twa-slice-tab.is-on");
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sliceId]);

  const selectSlice = useCallback((next: FilterTab) => {
    setFilter(next);
    setAllView("list");
    setNarrow({});
  }, []);

  useEffect(() => {
    setPage(1);
    setAllOrders([]);
    fetchOrders(serverTab, query, 1, false);
    // narrowKey — та же выборка другим предикатом: перезапрос обязателен, но
    // сам объект `narrow` в зависимости класть нельзя (новая ссылка каждый рендер).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverTab, query, narrowKey, fetchOrders]);

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

  // Живой поиск (Roblox + заказы DBS) идёт своим запросом и своим темпом:
  // Roblox отвечает секундами, а лента заказов обязана появиться сразу.
  useEffect(() => {
    const value = query.trim();
    if (value.length < 3) { setLive(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/twa/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        setLive({
          gamepasses: payload.gamepasses ?? [],
          dbs: payload.dbs ?? [],
          partialErrors: payload.partialErrors ?? [],
        });
      } catch { /* отменённый или упавший live-поиск ленту не ломает */ }
    }, 420);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, token]);

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
    /* ❄️ Заморозка идёт мимо оптимистичной машинки ниже: она не меняет статус,
       а ставит признак поверх него. Ветка отдельная, чтобы `shiftCounts` не
       двигал заказ между статусными вкладками, которых он не покидал. */
    if (action === "hold" || action === "unhold") {
      haptic.impact("light");
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action, orderId: order.id, ...(reason ? { reason } : {}) }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { haptic.notify("error"); return { ok: false, error: d.error ?? "Ошибка" }; }
        const held = action === "hold";
        setAllOrders(prev => prev.map(o => o.id === order.id
          ? {
              ...o,
              heldAt: held ? new Date().toISOString() : null,
              heldReason: held ? (reason ?? null) : null,
              heldBy: held ? (o.heldBy ?? "я") : null,
            }
          : o));
        haptic.notify("success");
        toast(held ? "❄️ Заморожен" : "Разморожен", "success");
        onActionDone?.();
        return { ok: true };
      } catch {
        haptic.notify("error");
        return { ok: false, error: "Ошибка сети" };
      }
    }

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

  /* ⚡ «Вперёд очереди». Признак поверх статуса, как заморозка: заказ никуда не
     переезжает, меняется только его место в сортировке. Поэтому счётчики вкладок
     не трогаем — двигаем саму карточку, чтобы поднятие было видно сразу, а не
     после следующей загрузки списка (сервер вернёт ровно этот же порядок). */
  const togglePriority = useCallback(async (order: Order) => {
    const on = !order.priorityAt;
    haptic.impact("medium");
    const stamp = new Date().toISOString();
    setAllOrders(prev => {
      const patched = prev.map(o => (o.id === order.id ? { ...o, priorityAt: on ? stamp : null } : o));
      if (!on) return patched;
      const target = patched.find(o => o.id === order.id);
      return target ? [target, ...patched.filter(o => o.id !== order.id)] : patched;
    });

    try {
      const r = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-priority", orderId: order.id, priority: on }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAllOrders(prev => prev.map(o => (o.id === order.id ? { ...o, priorityAt: order.priorityAt ?? null } : o)));
        haptic.notify("error");
        toast(d.error ?? "Ошибка", "error");
        return;
      }
      haptic.notify("success");
      toast(on ? `⚡ ${order.wbCode} — выкупать первым` : `${order.wbCode} вернулся в общую очередь`, "success");
      onActionDone?.();
    } catch {
      setAllOrders(prev => prev.map(o => (o.id === order.id ? { ...o, priorityAt: order.priorityAt ?? null } : o)));
      haptic.notify("error");
      toast("Ошибка сети", "error");
    }
  }, [token, onActionDone]);

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

        {/* Один ряд срезов вместо трёх этажей навигации. Срез назван глаголом:
            что вы собираетесь с этими заказами делать. Пустой срез из ряда
            уходит, но остаётся доступен из «Фильтров» — дочищенная очередь не
            должна делать старые заказы недостижимыми. Активный срез не прячем
            даже пустым: иначе экран прыгает под пальцем ровно в тот момент,
            когда работа закончена. */}
        {!query && (
          <div className="twa-slice-row">
            <div className="twa-slice-scroll twa-no-scrollbar" ref={sliceRowRef}>
            {SLICES.filter(s => s.id === sliceId || (data?.counts?.[s.id] ?? 0) > 0 || !data).map(s => {
              const isOn = sliceId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`twa-slice-tab twa-press-sm${isOn ? " is-on" : ""}`}
                  style={isOn ? { background: `${s.color}2a`, color: s.color } : undefined}
                  onClick={() => { haptic.select(); selectSlice(s.id as FilterTab); }}
                >
                  <i style={{ background: s.color }} />
                  {s.label}
                  <b>{data?.counts?.[s.id] ?? 0}</b>
                </button>
              );
            })}
            </div>
            <button
              type="button"
              className={`twa-slice-tab twa-slice-filters twa-press-sm${sheetFilterOn ? " is-on" : ""}`}
              onClick={() => { haptic.select(); setFiltersOpen(true); }}
            >
              Фильтры{sheetFilterOn && <b>1</b>}
            </button>
          </div>
        )}

        {/* Сужение из шапки среза — строкой под срезами: видно, что лента
            показывает не весь срез, и снимается одним тапом. */}
        {narrowChips.length > 0 && (
          <div className="twa-slice-narrow">
            {narrowChips.map(chip => (
              <button key={chip.key} type="button" className="twa-press-sm"
                onClick={() => { haptic.select(); setNarrow(n => ({ ...n, [chip.key]: null })); }}>
                {chip.label}<i>✕</i>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
        {/* Шапка среза: сводка того среза, в котором вы стоите. Скроллится
            вместе с лентой — высоту тулбара не отбирает; при поиске её нет
            вовсе: ищут конкретный заказ, а не разбирают очередь. */}
        {activeSlice && slicePayload && !query && !isAttentionView && (
          <div style={{ padding: "10px 0 2px" }}>
            <SliceTill
              slice={activeSlice}
              tab={filter}
              label={SLICES.find(s => s.id === activeSlice.key)?.till ?? ""}
              counts={data?.counts ?? {}}
              today={slicePayload.today}
              narrow={narrow}
              onNarrow={patch => setNarrow(n => ({ ...n, ...patch }))}
              onExport={EXPORTABLE_TABS.has(filter) ? () => setExportOpen(true) : undefined}
              exportable={EXPORTABLE_TABS.has(filter)}
              collapsed={!!tillCollapsed[activeSlice.key]}
              onToggleCollapsed={() => setTillCollapsed(v => ({ ...v, [activeSlice.key]: !v[activeSlice.key] }))}
              onRefresh={() => { setPage(1); void fetchOrders(serverTab, query, 1, false); }}
              refreshing={loading}
              updatedAt={tillAt}
              onFindOldest={() => { haptic.select(); setNarrow({ age: activeSlice.age.buckets[activeSlice.age.buckets.length - 1]?.id ?? null }); }}
            />
          </div>
        )}

        {/* Выкуп пока ручной: список ID геймпассов очереди нужен пачкой, а не по
            одному. У срезов кнопка живёт в подвале шапки; здесь она остаётся
            для вкладок из шторки фильтров, где шапки нет. */}
        {!query && !activeSlice && EXPORTABLE_TABS.has(filter) && (
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

            {/* S2: Spotlight — точное совпадение по WB-коду.
                Это ТА ЖЕ карточка, что в ленте, а не своя (03.09.2026). Своя
                была единственной карточкой приложения без меню «···»: найдя
                заказ по коду, его нельзя было ни поправить, ни разбить, ни
                заморозить, ни скопировать ID пасса — зато самая крупная кнопка
                тратила робуксы донора, а крестик рядом отменял заказ без
                причины. Вкладку берём по самому заказу, чтобы карточка
                выглядела ровно так же, как в своём разделе. */}
            {query && searchMode === "spotlight" && allOrders[0] && (
              <OrderCard
                order={allOrders[0]}
                token={token}
                currentTab={orderToTab(allOrders[0])}
                live={liveMap[allOrders[0].id]}
                exiting={exiting.has(allOrders[0].id)}
                onRunAction={(action, reason) => runAction(allOrders[0], action, reason)}
                onPurchaseDone={() => handlePurchaseDone(allOrders[0])}
                onSaveNote={(note) => saveNote(allOrders[0].id, note)}
                onToggleFavorite={() => toggleFavorite(allOrders[0])}
                onTogglePriority={() => togglePriority(allOrders[0])}
                onMoved={() => handleMoved(allOrders[0])}
              />
            )}

            {/* S1: Profile card — все заказы одного клиента */}
            {query && searchMode === "profile" && allOrders.length > 0 && (
              <SearchProfileCard user={allOrders[0].user} orders={allOrders} />
            )}

            {/* Заказы WB Доставки — из другой таблицы, поэтому отдельной секцией.
                Тап уводит на экран доставки с тем же запросом: действия DBS
                живут там и дублировать их здесь нельзя. */}
            {query && live && live.dbs.length > 0 && (
              <div className="twa-live-group">
                <span>WB Доставка · {live.dbs.length}</span>
                {live.dbs.map(order => (
                  <button
                    key={order.id}
                    type="button"
                    className="twa-live-row twa-press-sm"
                    onClick={() => { haptic.select(); onOpenDelivery?.(query); }}
                  >
                    <b>{order.buyerName ?? `WB #${order.wbOrderId}`}</b>
                    <small>
                      #{order.wbOrderId}
                      {order.denomination ? ` · ${order.denomination} R$` : ""}
                      {order.code ? ` · ${order.code}` : ""}
                      {order.closed ? " · закрыт" : ` · ${order.supplierStatus}`}
                    </small>
                    <span>›</span>
                  </button>
                ))}
              </div>
            )}

            {/* For-sale геймпассы ника прямо из Roblox. На главной этот же
                список был тупиком — тап уводил на экран Аккаунта и там ничего
                не делал. Здесь он открывает форму заказа уже заполненной. */}
            {query && live && live.gamepasses.length > 0 && (
              <div className="twa-live-group">
                <span>Геймпассы Roblox · {live.gamepasses.length}</span>
                {live.gamepasses.map(pass => (
                  <div key={pass.gamepassId} className="twa-live-row is-static">
                    <b>{pass.name}</b>
                    <small>ID {pass.gamepassId} · {pass.price.toLocaleString("ru-RU")} R$ · {pass.sellerName ?? "Roblox"}</small>
                    <button
                      type="button"
                      className="twa-live-cta twa-press-sm"
                      onClick={() => {
                        haptic.impact("light");
                        setCreatePrefill({
                          url: `https://www.roblox.com/game-pass/${pass.gamepassId}`,
                          nick: pass.sellerName ?? undefined,
                          // Клиенту уходит 70% цены пасса — та же формула, что в
                          // «Поиск и выкуп»; менеджер может поправить в форме.
                          amount: Math.floor(pass.price * 0.7),
                        });
                        setCreateMode("manual");
                        setCreateOpen(true);
                      }}
                    >
                      Создать заказ
                    </button>
                  </div>
                ))}
              </div>
            )}
            {query && live?.partialErrors.map(error => (
              <div key={error} className="twa-live-note">{error}</div>
            ))}

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
                    onTogglePriority={() => togglePriority(order)}
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

      {/* Шторка «Фильтры»: всё, что не является ежедневной работой. Ни одна
          вкладка из старого ряда чипов не исчезла — она переехала сюда. */}
      <FiltersSheet
        open={filtersOpen}
        active={sliceId === null ? filter : null}
        attention={isAttentionView}
        counts={data?.counts ?? {}}
        onPick={tab => { setFiltersOpen(false); selectSlice(tab); }}
        onAttention={() => { setFiltersOpen(false); setFilter("ALL"); setAllView("attention"); setNarrow({}); }}
        onClose={() => setFiltersOpen(false)}
      />

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
        <OrderSheet
          token={token}
          mode={createMode}
          initialGamepassUrl={createPrefill?.url}
          initialNick={createPrefill?.nick}
          initialAmount={createPrefill?.amount}
          onClose={() => { setCreateOpen(false); setCreatePrefill(null); }}
          onDone={() => {
            setCreateOpen(false);
            setCreatePrefill(null);
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

/** Карточка ленты → цель для `OrderSheet`. Форма получает ровно то же, что ей
    отдаёт `manual-validate` при совпадении, поэтому путь «открыл ✏️» и путь
    «ввёл код в форме создания» приводят к одному состоянию. */
function orderToTarget(order: Order): MatchedOrder {
  return {
    orderId: order.id,
    wbCode: order.wbCode,
    status: order.status,
    amount: order.amount,
    robloxUsername: order.robloxUsername,
    gamepassUrl: order.gamepassUrl,
    isDirectOrder: order.isDirectOrder,
    unpaidDirect: isUnpaidDirect(order),
    heldAt: order.heldAt,
    heldReason: order.heldReason,
    editable: ["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED"].includes(order.status),
    client: order.user.username ? `@${order.user.username}`
      : order.user.name ?? (order.user.tgId ? `TG ${order.user.tgId}` : order.user.vkId ? `VK ${order.user.vkId}` : null),
    createdAt: order.createdAt,
    pendingAt: order.pendingAt,
    adminNote: order.adminNote,
    orderSource: order.orderSource,
  };
}

/* ── Шторка «Фильтры» ────────────────────────────────────────────────────────
   Один ряд срезов покрывает ежедневную работу; всё остальное живёт здесь и
   доступно в один тап. Список намеренно полный: вкладка, у которой сегодня
   ноль заказов, из ряда уходит, но из приложения — нет.
   ────────────────────────────────────────────────────────────────────────── */
function FiltersSheet({ open, active, attention, counts, onPick, onAttention, onClose }: {
  open: boolean;
  /** Активный фильтр из шторки; null — мы стоим в срезе. */
  active: FilterTab | null;
  attention: boolean;
  counts: Record<string, number>;
  onPick: (tab: FilterTab) => void;
  onAttention: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Фильтры заказов" className="twa-filter-sheet">
      <div className="twa-oc-menu-group">Разделы</div>
      {SHEET_FILTERS.map(id => {
        const meta = TAB_META[id];
        const count = (counts[id] ?? 0) + (id === "DIRECT" ? (counts.INTENTS ?? 0) : 0);
        return (
          <button
            key={id}
            type="button"
            className={`twa-oc-menu-row twa-press-sm${active === id && !attention ? " is-on" : ""}`}
            style={active === id && !attention ? { background: `${meta.color}1f`, color: meta.color } : undefined}
            onClick={() => { haptic.select(); onPick(id); }}
          >
            <span><i style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: meta.color }} /></span>
            <span>{meta.label}</span>
            <em>{count}</em>
          </button>
        );
      })}
      {(counts.ATTENTION ?? 0) > 0 && (
        <button
          type="button"
          className="twa-oc-menu-row twa-press-sm"
          style={attention ? { background: `${C.orange}1f`, color: C.orange } : undefined}
          onClick={() => { haptic.select(); onAttention(); }}
        >
          <span>⚠</span>
          <span>Требуют внимания</span>
          <em>{counts.ATTENTION ?? 0}</em>
        </button>
      )}
    </BottomSheet>
  );
}

/* ── Шапка среза ─────────────────────────────────────────────────────────────
   Сводка того среза, в котором вы стоите, на языке кассы главной. Пять полок
   сверху вниз по убыванию срочности: деньги → откуда → что мешает → что горит
   → как идёт день. Каждая строка кликабельна и сужает ленту под собой.

   Числа приходят с сервера (`/api/twa/orders` → `slices`), а не считаются по
   загруженной странице: лента идёт по 20 заказов, и сумма по странице врала бы
   ровно на длинной очереди — там, где на неё и смотрят.
   ────────────────────────────────────────────────────────────────────────── */
function fmtRobux(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("ru-RU");
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const d = mod100 % 10;
  return d === 1 ? one : d >= 2 && d <= 4 ? few : many;
}

function pluralOrders(n: number): string {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "заказов";
  const d = n % 10;
  return d === 1 ? "заказ" : d >= 2 && d <= 4 ? "заказа" : "заказов";
}

const TILL_TONE: Record<SliceKey, string> = {
  BUYOUT: "",
  ERROR: " is-red",
  AWAITING_LINK: " is-amber",
  DONE: " is-quiet",
};

/** Цвет корзины возраста: первые две спокойные, последние две — тревожные. */
const AGE_BUCKET_COLOR = [C.green, C.green, C.orange, C.red];

function SliceTill({
  slice, tab, label, counts, today, narrow, onNarrow, onExport, exportable,
  collapsed, onToggleCollapsed, onRefresh, refreshing, updatedAt, onFindOldest,
}: {
  slice: OrderSlice;
  tab: FilterTab;
  label: string;
  counts: Record<string, number>;
  today: OrderSlicesPayload["today"];
  narrow: OrderNarrow;
  onNarrow: (patch: OrderNarrow) => void;
  onExport?: () => void;
  exportable: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  updatedAt: number | null;
  onFindOldest: () => void;
}) {
  const isLink = slice.key === "AWAITING_LINK";
  const isDone = slice.key === "DONE";
  const count = counts[tab] ?? slice.orders;

  const lanes = slice.lanes.filter(lane => lane.orders > 0);
  const blockers: { id: "regional" | "split" | "nogp"; tone: string; text: string }[] = [];
  if (slice.blocked.regional > 0)
    blockers.push({ id: "regional", tone: "is-red", text: `⛔ ${slice.blocked.regional} рег. цена на доноре` });
  if (slice.blocked.splitPartial > 0)
    blockers.push({ id: "split", tone: "is-mute", text: `🧩 ${slice.blocked.splitPartial} разбит — куплены не все части` });
  if (slice.blocked.noGamepass > 0)
    blockers.push({ id: "nogp", tone: "is-amber", text: `👁 ${slice.blocked.noGamepass} без геймпасса` });

  const ageMax = Math.max(1, ...slice.age.buckets.map(b => b.count));
  const queueDelta = today.done - today.arrived;

  return (
    <section className={`twa-slice-till${TILL_TONE[slice.key]}${collapsed ? " is-collapsed" : ""}`}>
      <header className="twa-slice-head">
        <button type="button" className="twa-slice-head-main twa-press-sm" onClick={onToggleCollapsed}>
          <span>{label}</span>
          <b>{count} {pluralOrders(count)}</b>
          {updatedAt && <em>обновлено {new Date(updatedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</em>}
        </button>
        <button
          type="button"
          className="twa-till-refresh twa-press-sm"
          aria-label="Обновить сводку"
          disabled={refreshing}
          onClick={e => { e.stopPropagation(); haptic.select(); onRefresh(); }}
        >
          <RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />
        </button>
      </header>

      {collapsed ? null : (
        <>
          {/* 1. Деньги. Крупно — грязные: столько спишется с донора. */}
          {isDone ? (
            <div className="twa-slice-figure">
              <strong>{today.done}<small>выкуплено</small></strong>
              <span>сегодня на <b>{today.doneSum.toLocaleString("ru-RU")} R$</b> чистыми</span>
            </div>
          ) : isLink ? (
            <div className="twa-slice-figure">
              <strong>{slice.stale}<small>{plural(slice.stale, "висяк", "висяка", "висяков")}</small></strong>
              <span>
                из <b>{slice.orders}</b> ждущих ссылку
                {slice.silent > 0 && <> · <b>{slice.silent}</b> бот отмолчал 3/3</>}
              </span>
            </div>
          ) : (
            <div className="twa-slice-figure">
              <strong>{slice.gross.toLocaleString("ru-RU")}<small>R$</small></strong>
              <span>грязными · <b>{slice.clean.toLocaleString("ru-RU")} R$</b> чистыми клиенту</span>
            </div>
          )}

          {/* 2. Откуда очередь. Ширина сегмента — доля робуксов, а не заказов. */}
          {lanes.length > 0 && (
            <>
              <div className="twa-lane-bar" aria-hidden="true">
                {lanes.map(lane => (
                  <i key={lane.id} style={{ flexGrow: Math.max(lane.gross, 1), background: LANE_META[lane.id].color, opacity: narrow.lane && narrow.lane !== lane.id ? 0.3 : 1 }} />
                ))}
              </div>
              <div className="twa-slice-legend">
                {lanes.map(lane => (
                  <button
                    key={lane.id}
                    type="button"
                    className={`twa-slice-chip twa-press-sm${narrow.lane === lane.id ? " is-on" : ""}`}
                    onClick={() => { haptic.select(); onNarrow({ lane: narrow.lane === lane.id ? null : lane.id }); }}
                  >
                    <i style={{ background: LANE_META[lane.id].color }} />
                    {LANE_META[lane.id].label}
                    <b>{lane.orders}</b>
                    <em>{lane.gross.toLocaleString("ru-RU")} R$</em>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* 3. Что мешает выкупить прямо сейчас. */}
          {!isDone && !isLink && slice.orders > 0 && (
            <div className="twa-slice-shelf">
              <div className="twa-slice-line">
                <span className="k">Готовы сейчас</span>
                <span className="v">{slice.ready}<small>из {slice.orders}</small></span>
                {blockers.length === 0 && <span className="tail">ничего не держит</span>}
              </div>
              {blockers.length > 0 && (
                <div className="twa-slice-flags">
                  {blockers.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      className={`twa-slice-flag ${b.tone} twa-press-sm${narrow.blocked === b.id ? " is-on" : ""}`}
                      onClick={() => { haptic.select(); onNarrow({ blocked: narrow.blocked === b.id ? null : b.id }); }}
                    >{b.text}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* «Починить» — вместо препятствий причины: почти всё чинится кнопкой. */}
          {slice.key === "ERROR" && slice.reasons.length > 0 && (
            <div className="twa-slice-shelf">
              <div className="twa-slice-line">
                <span className="k">Причины</span>
                <span className="v">{slice.exportable}<small>чинятся возвратом</small></span>
              </div>
              <div className="twa-slice-flags">
                {slice.reasons.map(reason => (
                  <span key={reason.id} className="twa-slice-flag is-mute">{reason.label} {reason.count}</span>
                ))}
              </div>
            </div>
          )}

          {/* 4. Что горит: четыре корзины возраста и старейший заказ. */}
          {!isDone && slice.age.buckets.some(b => b.count > 0) && (
            <div className="twa-slice-shelf">
              <div className="twa-slice-line">
                <span className="k">Возраст</span>
                <span className="v" style={{ color: slice.age.overdue > 0 ? C.orange : undefined }}>
                  {slice.age.overdue}<small>{isLink ? "ждут > недели" : "ждут > 12 ч"}</small>
                </span>
                {slice.age.oldestCode && (
                  // Код и возраст переносятся ОДНИМ куском: разорванные, они
                  // оставляли висящую точку-разделитель в конце строки.
                  <button type="button" className="tail twa-press-sm" onClick={() => { haptic.select(); onFindOldest(); }}>
                    старейший{" "}
                    <b style={{ whiteSpace: "nowrap", color: ageColor(slice.age.oldestAt) }}>
                      {slice.age.oldestCode} · {fmtAge(slice.age.oldestAt)}
                    </b>
                  </button>
                )}
              </div>
              <div className="twa-slice-hist">
                {slice.age.buckets.map((bucket, i) => (
                  <button
                    key={bucket.id}
                    type="button"
                    className={`twa-press-sm${narrow.age === bucket.id ? " is-on" : ""}`}
                    disabled={bucket.count === 0}
                    onClick={() => { haptic.select(); onNarrow({ age: narrow.age === bucket.id ? null : bucket.id }); }}
                  >
                    <b>{bucket.count}</b>
                    <i style={{ height: Math.max(3, Math.round((bucket.count / ageMax) * 26)), background: `${AGE_BUCKET_COLOR[i]}b3` }} />
                    <em>{bucket.label}</em>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 5. Как идёт день: выкуплено против пришедшего и знак очереди.
              Только у очереди выкупа: `today` считает выкупленное и пришедшее
              в ОЧЕРЕДЬ, и под «Дожать» эта полка отвечала бы на вопрос,
              которого там никто не задаёт. */}
          {slice.key === "BUYOUT" && (
            <div className="twa-slice-shelf">
              <div className="twa-slice-line">
                <span className="k">Сегодня</span>
                <span className="v">{today.done}<small>выкуплено на {today.doneSum.toLocaleString("ru-RU")} R$</small></span>
                <span className="tail" style={{ color: queueDelta >= 0 ? C.green : C.orange }}>
                  очередь {queueDelta > 0 ? `−${queueDelta}` : queueDelta === 0 ? "вровень" : `+${-queueDelta}`}
                </span>
              </div>
              <div className="twa-slice-foot"><span>пришло <b>{today.arrived}</b></span></div>
            </div>
          )}

          {/* Подвал: номиналы очереди и выгрузка ID пачкой — при ручном выкупе
              список ID нужен целиком, а не по одному из карточек. */}
          {(slice.nominals.length > 0 || exportable) && (
            <div className="twa-slice-foot is-bordered">
              {slice.nominals.length > 0 && (
                <span>
                  Номиналы:{" "}
                  {slice.nominals.map(n => (
                    <button
                      key={n.amount}
                      type="button"
                      className={`twa-slice-nominal twa-press-sm${narrow.amount === n.amount ? " is-on" : ""}`}
                      onClick={() => { haptic.select(); onNarrow({ amount: narrow.amount === n.amount ? null : n.amount }); }}
                    >{n.amount}×{n.count}</button>
                  ))}
                </span>
              )}
              {exportable && onExport && (
                <button type="button" className="twa-slice-export twa-press-sm" onClick={() => { haptic.impact("light"); onExport(); }}>
                  ⇩ Выгрузить ID <b>{slice.exportable}</b>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
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
    STALE_LINK: "Висяков нет — очередь ссылок живая",
    DONE: "Нет выкупленных заказов",
    REJECTED: "Нет отменённых заказов",
    FAVORITES: "Нет избранных",
    ATTENTION: "Ничего не требует внимания",
    HELD: "Замороженных заказов нет",
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
