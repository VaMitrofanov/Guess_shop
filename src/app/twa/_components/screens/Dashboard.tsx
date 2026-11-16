"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  ExternalLink,
  RefreshCw,
  Ticket,
  Zap,
} from "lucide-react";
import { C } from "../theme";
import { ageColor, fmtAge } from "../age";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import { copyText } from "../clipboard";
import type { PendingCodeOrders } from "@/lib/code-orders-pending";
import type { FirstInLine } from "@/types/first-in-line";
import type { VkNeedsHuman } from "@/types/vk-needs-human";
import FirstInLineBlock from "../FirstInLineBlock";
import BuyoutFocus from "../BuyoutFocus";
import type { OverviewDiff, OverviewFeedRow } from "@/types/admin-overview";
import type { WbDeliveryQueueSnapshot } from "@/types/wb-delivery";
import type { WbDeliveryFocus } from "./WbDeliveryScreen";

/* ─────────────────────────────────────────────────────────────────────────────
   Главная = касса выкупа.

   Прежний экран открывался числом «Требует действия: 47» — суммой выкупа,
   ссылок, ошибок и неотвеченных отзывов WB. Сложить их можно, решить по ним
   нельзя: это четыре разные работы. Ниже шёл список, где «Запросить N ссылок»
   выглядел кнопкой, хотя ссылку присылает покупатель и обычно не присылает.

   Теперь экран отвечает на один вопрос — что выкупать сейчас и сколько это
   стоит, — и делит очередь по происхождению: ВБ, DBS, прямые. Всё, что не
   ведёт к решению, стало тихой строкой или уехало в свой экран.

   Поиск отсюда уехал в «Заказы» целиком: досье в шторке не умело выкупить
   заказ, а карточка в ленте умеет всё. Здесь осталась строка ввода, которая
   открывает тот самый поиск.
   ───────────────────────────────────────────────────────────────────────── */

type OrdersTab = "BUYOUT" | "AWAITING_LINK" | "STALE_LINK" | "ERROR" | "HELD" | "NEW";

interface Lane {
  id: "WB" | "WB_DBS" | "DIRECT";
  orders: number;
  clean: number;
  gross: number;
  overdue: number;
  oldestAt: string | null;
}

/* Срез доставки — общий тип с сервером и с сайтом: своя копия интерфейса уже
   один раз разошлась с сервером и показывала на главной не то, что в консоли. */
type DbsSnapshot = WbDeliveryQueueSnapshot;

interface DashData {
  today: { orders: number; sum: number; sales: number };
  week: { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes: { denom: number; count: number }[];
  buyout: { orders: number; clean: number; gross: number; overdue: number; oldestAt: string | null; lanes: Lane[] };
  errors: { count: number; oldestAt: string | null; first: string | null };
  awaitingLink: { total: number; stale: number; remindersDone: number; oldestAt: string | null; staleOldestAt: string | null };
  held: { count: number; codes: string[] };
  /** ⚡ Первым делом: поднятые руками и прямые заказы. */
  firstInLine: FirstInLine | null;
  /** 🎟 Коды к выдаче (16.11.2026). `null` — не успело прочитаться. */
  codeOrders?: PendingCodeOrders | null;
  inbox: { available: boolean; feedbacks: number; questions: number; total: number };
  /** «Ждут ответа в ВК» — обращения, где нужен человек, без ответа менеджера. `null` — ВК не успел. */
  vkNeedsHuman?: VkNeedsHuman | null;
  /** Смена: что случилось с прошлого захода этого админа. `null` — окно не собралось. */
  shift: { since: string; firstVisit: boolean; diff: OverviewDiff; feed: OverviewFeedRow[] } | null;
  dbs: DbsSnapshot | null;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

/** Как часто главная обновляется сама, пока экран на виду (решение О4). */
const LIVE_POLL_MS = 30_000;

function robux(value: number) {
  return value.toLocaleString("ru-RU");
}

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

/** Внешняя ссылка из ТВА: внутри Telegram — его браузером, иначе новой вкладкой. */
function openExternal(url: string) {
  const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, "_blank", "noopener");
}

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export default function Dashboard({
  token,
  onOpenOrders,
  onOpenInbox,
  onOpenDelivery,
}: {
  token: string;
  onOpenOrders?: (query?: string, tab?: OrdersTab) => void;
  onOpenInbox?: () => void;
  onOpenDelivery?: (focus?: WbDeliveryFocus | null) => void;
  onCreateOrder?: (mode: "manual" | "direct") => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  // «Ждут ответа в ВК» свёрнуто по умолчанию: одна строка среди дел, список — по тапу.
  const [vkOpen, setVkOpen] = useState(false);
  /** 🛒 Режим «Выкуп по одному» поверх главной. */
  const [focusOpen, setFocusOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Когда данные последний раз пришли с сервера — из этого «живая · N с». */
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [liveAge, setLiveAge] = useState(0);
  /* Окно смены держит клиент: сервер ставит отметку присутствия только на
     первой загрузке, а живой опрос присылает окно обратно. Иначе обновление
     раз в 30 секунд схлопывало бы «Пока вас не было» в ноль. */
  const shiftSince = useRef<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const url = shiftSince.current
        ? `/api/twa/dashboard?shiftSince=${encodeURIComponent(shiftSince.current)}`
        : "/api/twa/dashboard";
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) {
        const next = await response.json() as DashData;
        if (next.shift?.since) shiftSince.current = next.shift.since;
        setData(next);
        setSyncedAt(Date.now());
        setLiveAge(0);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  /* Живое обновление — раз в 30 секунд и только пока экран на виду (решение О4
     от 03.09.2026). Свёрнутое приложение сервер не дёргает. */
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const tick = window.setInterval(() => {
      setLiveAge(Math.round((Date.now() - syncedAt) / 1000));
      if (document.visibilityState !== "visible") return;
      if (Date.now() - syncedAt < LIVE_POLL_MS) return;
      void loadRef.current(false);
    }, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - syncedAt >= LIVE_POLL_MS) void loadRef.current(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [syncedAt]);

  /* ⚡ «Первым делом» — общий компонент (`FirstInLineBlock`): тот же блок стоит
     на экране «Выкупы», и копия здесь неизбежно разошлась бы с ним. */

  if (loading) return <Skeleton />;
  if (!data) return <ErrorState onRetry={() => void load(true)} />;

  const { buyout, errors, awaitingLink, held, inbox, dbs } = data;
  const totalCodes = data.codes.reduce((sum, code) => sum + code.count, 0);
  // «В боте» — не задача: покупатель уже с кодом идёт по нашей воронке, а
  // доставка WB к этому моменту закрыта (иначе гейт бы не ушёл). Решения
  // требует только незакрытая доставка или ход за нами.
  const dbsNeedsDecision = Boolean(dbs && (dbs.unclosed > 0 || dbs.needsUs > 0));
  const vkHuman = data.vkNeedsHuman && data.vkNeedsHuman.total > 0 ? data.vkNeedsHuman : null;
  const dbsOldest = dbs?.unclosed ? dbs.unclosedOldestAt : dbs?.needsUsOldestAt ?? null;

  /* 🔵 Прямые — свой блок наверху (16.11.2026, владелец: «коды и прямые
     отдельно в красивых блоках, чтобы не спутать с обычными заказами»). Из
     «Первым делом» они поэтому убраны: там остаются торопящие, поднятые и
     «не дошло». */
  const fil = data.firstInLine;
  const directRows = fil?.rows.filter(row => row.reason === "direct") ?? [];
  const firstNoDirect: FirstInLine | null = fil ? {
    ...fil,
    rows: fil.rows.filter(row => row.reason !== "direct"),
    total: Math.max(0, fil.total - fil.direct),
    direct: 0,
    gross: Math.max(0, fil.gross - directRows.reduce((sum, row) => sum + row.gross, 0)),
  } : null;
  const codeOrders = data.codeOrders;

  function openOrders(tab: OrdersTab) {
    haptic.select();
    onOpenOrders?.(undefined, tab);
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      {/* Поиск переехал в 🔍 шапки — он один на все экраны (21.10). */}
      {!data.apiAvailable && (
        <div className="twa-liquid-alert">
          <CircleAlert size={19} />
          <div><strong>WB API недоступен</strong><span>Очереди из БД работают{data.tokenPresent === false ? " · токен WB не задан" : ""}</span></div>
        </div>
      )}

      {/* ── 1. Коды и Прямые: всегда наверху, своими цветами ──────────────── */}
      <section className="twa-prio is-codes" aria-label="Коды">
        <header>
          <span className="twa-prio-ic"><Ticket size={17} /></span>
          <b>Коды</b>
          <em>
            {codeOrders && codeOrders.toIssueTotal > 0
              ? `${codeOrders.toIssueTotal} выдать`
              : "выдавать нечего"}
            {codeOrders && codeOrders.awaitingPayment > 0 ? ` · ${codeOrders.awaitingPayment} ждут оплату` : ""}
          </em>
        </header>
        {codeOrders?.toIssue.map(code => (
          <div key={code.publicId} className="twa-prio-row">
            <span>
              <strong>{code.publicId} · {robux(code.denomination)} R$</strong>
              <small>оплачен {code.paidAt ? `${fmtAge(code.paidAt)} назад` : "—"} · {code.channel === "SITE" ? "сайт" : code.channel}{code.gift ? " · подарок" : ""}</small>
            </span>
            <button type="button" className="twa-press-sm" onClick={() => { copyText(code.publicId); haptic.impact("light"); toast(`${code.publicId} скопирован`, "success"); }}>
              Скопировать
            </button>
          </div>
        ))}
      </section>

      <section className="twa-prio is-direct" aria-label="Прямые заказы">
        <header>
          <span className="twa-prio-ic"><Zap size={17} /></span>
          <b>Прямые</b>
          <em>{fil && fil.direct > 0 ? `${fil.direct} к выкупу` : "прямых нет"}</em>
        </header>
        {directRows.map(row => (
          <button key={row.id} type="button" className="twa-prio-row twa-press-sm" onClick={() => { haptic.select(); onOpenOrders?.(row.wbCode); }}>
            <span>
              <strong>{row.robloxUsername ?? "ник не указан"} · {robux(row.amount)} R$</strong>
              <small>{row.wbCode} · ждёт {fmtAge(row.since)}{row.gamepassIds.length === 0 ? " · пасса нет" : ""}</small>
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
      </section>

      {/* ── 2. ⚡ Первым делом — наше избранное ──────────────────────────── */}
      <FirstInLineBlock
        token={token}
        initial={firstNoDirect}
        onOpenOrder={code => onOpenOrders?.(code)}
        onOpenQueue={() => onOpenOrders?.(undefined, "BUYOUT")}
        onChanged={() => void load()}
      />

      {/* ── 3. Ориентир: всё открытое — числами ─────────────────────────── */}
      <div className="twa-section-label twa-ori-label">
        <span>Ориентир</span>
        <button type="button" className="twa-till-refresh twa-press-sm" aria-label="Обновить" disabled={refreshing}
          onClick={() => { haptic.select(); void load(true); }}>
          <RefreshCw size={15} className={refreshing ? "is-spinning" : ""} />
        </button>
      </div>
      <div className="twa-ori">
        <div className="twa-ori-till">
          <button type="button" className="twa-ori-till-main twa-press-sm" onClick={() => openOrders("BUYOUT")}>
            <span className="twa-ori-l">К выкупу{buyout.orders > 0 && <> · старейший <b style={{ color: ageColor(buyout.oldestAt) }}>{fmtAge(buyout.oldestAt)}</b></>}</span>
            <strong>{robux(buyout.gross)}<small> R$</small> <em>· {buyout.orders} {plural(buyout.orders, "заказ", "заказа", "заказов")}</em></strong>
            <span className="twa-ori-s">
              клиентам {robux(buyout.clean)}
              {buyout.lanes.filter(lane => lane.orders > 0).map(lane => ` · ${lane.id === "WB" ? "WB" : lane.id === "WB_DBS" ? "DBS" : "прямых"} ${lane.orders}`).join("")}
            </span>
          </button>
          {buyout.orders > 0 && (
            /* 16.11.2026: «Начать выкуп» открывает режим «по одному»; лента
               «Выкупить» — по тапу на сумму выше. */
            <button type="button" className="twa-till-start twa-press" onClick={() => { haptic.impact("light"); setFocusOpen(true); }}>
              Начать выкуп <span aria-hidden="true">→</span>
            </button>
          )}
        </div>

        {dbs && dbsNeedsDecision && (
          <button type="button" className="twa-ori-tile is-loud twa-press-sm"
            onClick={() => { haptic.select(); onOpenDelivery?.(dbs.needsUs > 0 ? "readyReceive" : "waitingCode"); }}>
            <span className="twa-ori-l">WB Доставка</span>
            <strong>{dbs.needsUs > 0 ? dbs.needsUs : dbs.unclosed}</strong>
            <span className="twa-ori-s">{dbs.needsUs > 0 ? "ждут нашего хода" : "ждут покупателя"}{dbs.overdue > 0 ? ` · ${dbs.overdue} просрочено` : dbsOldest ? ` · ${fmtAge(dbsOldest)}` : ""}</span>
          </button>
        )}
        {errors.count > 0 && (
          <button type="button" className="twa-ori-tile is-red twa-press-sm" onClick={() => openOrders("ERROR")}>
            <span className="twa-ori-l">Ошибки выкупа</span>
            <strong>{errors.count}</strong>
            <span className="twa-ori-s">{errors.first ?? "разобрать вручную"}</span>
          </button>
        )}
        {vkHuman && (
          <button type="button" className="twa-ori-tile is-blue twa-press-sm" aria-expanded={vkOpen}
            onClick={() => { haptic.select(); setVkOpen(open => !open); }}>
            <span className="twa-ori-l">Ответить в ВК</span>
            <strong>{vkHuman.total}</strong>
            <span className="twa-ori-s">{vkHuman.oldestAt ? `дольше всех ${fmtAge(vkHuman.oldestAt)}` : "нужен человек"}</span>
          </button>
        )}
        {inbox.total > 0 && (
          <button type="button" className="twa-ori-tile twa-press-sm" onClick={() => { haptic.select(); onOpenInbox?.(); }}>
            <span className="twa-ori-l">Без ответа на WB</span>
            <strong>{inbox.total}</strong>
            <span className="twa-ori-s">{inbox.feedbacks} отз. · {inbox.questions} вопр.</span>
          </button>
        )}
        <button type="button" className="twa-ori-tile twa-press-sm" onClick={() => openOrders(awaitingLink.stale > 0 ? "STALE_LINK" : "AWAITING_LINK")}>
          <span className="twa-ori-l">Ждут пасс</span>
          <strong>{awaitingLink.total}</strong>
          <span className="twa-ori-s">{awaitingLink.stale > 0 ? `молчат ${awaitingLink.stale} · пишет ${awaitingLink.total - awaitingLink.stale}` : `старейший ${fmtAge(awaitingLink.oldestAt)}`}</span>
        </button>
        {dbs && dbs.inBot > 0 && (
          <button type="button" className="twa-ori-tile twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("inBot"); }}>
            <span className="twa-ori-l">В боте доставки</span>
            <strong>{dbs.inBot}</strong>
            <span className="twa-ori-s">код выдан{dbs.funnel.readyBuyout > 0 ? ` · ${dbs.funnel.readyBuyout} в очереди` : ""}</span>
          </button>
        )}
        {dbs && dbs.funnel.notActivated > 0 && (
          <button type="button" className="twa-ori-tile is-orange twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("notActivated"); }}>
            <span className="twa-ori-l">Коды не открыты</span>
            <strong>{dbs.funnel.notActivated}</strong>
            <span className="twa-ori-s">{dbs.funnel.notActivatedOldestAt ? `старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}` : "напоминания кончились"}</span>
          </button>
        )}
        {held.count > 0 && (
          <button type="button" className="twa-ori-tile is-ice twa-press-sm" onClick={() => openOrders("HELD")}>
            <span className="twa-ori-l">Заморожены</span>
            <strong>{held.count}</strong>
            <span className="twa-ori-s">не выкупать</span>
          </button>
        )}
      </div>

      {/* «Нужен человек» из ВК: список — по тапу на плитку, ответ — сразу в
          диалоге СООБЩЕСТВА. Уходит сам, когда менеджер ответил. */}
      {vkHuman && vkOpen && (
        <div className="twa-inset-group twa-action-list">
          {vkHuman.items.map(item => (
            <button key={item.vkId} type="button" className="twa-inset-row twa-vk-human twa-press-sm"
              onClick={() => { haptic.select(); openExternal(item.dialogUrl); }}>
              <div>
                <strong>{item.name ?? `VK ${item.vkId}`} · {item.wbCode}</strong>
                <small>
                  {item.quote ? `«${item.quote}»` : "без текста"} · <b style={{ color: ageColor(item.at) }}>{fmtAge(item.at)}</b>
                </small>
              </div>
              <ExternalLink size={17} />
            </button>
          ))}
          {vkHuman.total > vkHuman.items.length && (
            <div className="twa-inset-row twa-vk-human"><div><small>
              ещё {vkHuman.total - vkHuman.items.length} — в «Сообщениях» сообщества, метка «Нужен человек»
            </small></div></div>
          )}
        </div>
      )}

      {/* ── 4. Пока вас не было — только важное ───────────────────────────── */}
      {data.shift && <ShiftBlock shift={data.shift} liveAge={liveAge} />}

      {/* ── 5. Статистика — ниже скролла ─────────────────────────────────── */}
      {data.shift && (
        <section className="twa-shift twa-stats">
          <div className="twa-shift-head"><span>За смену</span></div>
          <div className="twa-shift-tiles">
            <div>
              <span>Очередь</span>
              <strong>{robux(data.shift.diff.queueBefore)} → {robux(data.shift.diff.queueNow)}</strong>
            </div>
            <div>
              <span>Ушло на выкуп</span>
              <strong>{robux(data.shift.diff.doneGross)}<small>R$</small></strong>
            </div>
            <div>
              <span>Пришло</span>
              <strong>{robux(data.shift.diff.paymentsRubles)}<small>₽</small></strong>
            </div>
          </div>
        </section>
      )}
      <BuyoutFocus
        token={token}
        open={focusOpen}
        onClose={() => { setFocusOpen(false); void load(); }}
        onOpenOrder={code => { setFocusOpen(false); onOpenOrders?.(code); }}
        onChanged={() => void load()}
      />
      <div className="twa-home-footer">
        Неделя · {rub(data.week.sum)} · {data.week.orders} {plural(data.week.orders, "заказ", "заказа", "заказов")} · {totalCodes} WB-{plural(totalCodes, "код", "кода", "кодов")} на складе
      </div>
    </div>
  );
}

/** «13 ч 51 мин» — сколько админа не было. */
function awayLabel(sinceIso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(sinceIso).getTime()) / 60_000));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 === 0 ? `${hours} ч` : `${hours} ч ${mins % 60} мин`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

function hhmm(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Кто сделал ход: значок и цвет те же, что в ленте на сайте. */
const ACTOR: Record<OverviewFeedRow["actor"], { mark: string; color: string }> = {
  us:    { mark: "М",  color: C.green },
  buyer: { mark: "П",  color: C.blue },
  bot:   { mark: "Б",  color: C.accent },
  wb:    { mark: "WB", color: C.yellow },
};

/* Рутина воронки: покупатель сам довёл заказ до очереди — смотреть не на что.
   Важное — слова покупателя, события WB (отмены, отзывы) и прямые заказы. */
const ROUTINE_FEED_RE = /(прислал геймпасс|назвал ник|ввёл ник|ввёл код|signed in|^заказ создан|выкуплен|выкуплено|статус →)/i;
function isImportantFeedRow(row: OverviewFeedRow): boolean {
  if (row.group) return false;
  if (/прямой заказ/i.test(row.text)) return true;
  if (row.actor !== "buyer" && row.actor !== "wb" && row.actor !== "bot") return false;
  return !ROUTINE_FEED_RE.test(row.text);
}

/* ── «Пока вас не было» на телефоне ───────────────────────────────────────
   Главная TWA отвечала только на «что выкупать сейчас». Второй вопрос смены —
   «что случилось, пока меня не было» — жил только на сайте, и админ с телефона
   его не видел вовсе. Здесь тот же диф и та же лента, но в формате телефона:
   итог тремя числами, очаги застрявшего строками и лента с временем. */
function ShiftBlock({
  shift, liveAge,
}: {
  shift: NonNullable<DashData["shift"]>;
  liveAge: number;
}) {
  const [all, setAll] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const { diff, feed } = shift;
  /* 16.11.2026 (владелец: «сократить мусорную инфу, оставить важное»): в ленте
     по умолчанию — только ходы покупателей и WB. Наши выкупы, ники и пассы,
     которые воронка собрала сама, — одной строкой-итогом; вся лента — по тапу. */
  const important = feed.filter(isImportantFeedRow);
  const shown = all ? feed : important.slice(0, 6);
  const routine = [
    diff.done > 0 ? `выкуплено ${diff.done}` : null,
    diff.arrived > 0 ? `пришло ${diff.arrived}` : null,
    diff.funnelNicks > 0 ? `${diff.funnelNicks} ${plural(diff.funnelNicks, "ник", "ника", "ников")}` : null,
    diff.funnelPasses > 0 ? `${diff.funnelPasses} ${plural(diff.funnelPasses, "пасс", "пасса", "пассов")}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className="twa-shift">
      <div className="twa-shift-head">
        <span>Пока вас не было</span>
        <em>{shift.firstVisit ? "первый заход · сутки" : awayLabel(diff.since)}</em>
        <b className="twa-shift-live">● {liveAge < 60 ? `${liveAge} с` : `${Math.floor(liveAge / 60)} мин`}</b>
      </div>

      {(diff.errors > 0 || diff.wbCancelled > 0) && (
        <div className="twa-shift-row">
          <i style={{ color: C.red }}>!</i>
          <span><b>{[diff.errors > 0 ? `${diff.errors} ${plural(diff.errors, "ошибка", "ошибки", "ошибок")} выкупа` : null, diff.wbCancelled > 0 ? `${diff.wbCancelled} ${plural(diff.wbCancelled, "отмена", "отмены", "отмен")} WB` : null].filter(Boolean).join(" · ")}</b></span>
        </div>
      )}

      <div className="twa-shift-feed">
        {shown.length === 0 && <div className="twa-shift-empty">{all ? "За окно не случилось ничего" : "Покупатели и WB ничего не писали"}</div>}
        {shown.map(row => {
          const actor = ACTOR[row.actor];
          if (row.group) {
            const open = openGroup === row.id;
            return (
              <div key={row.id}>
                <button type="button" className="twa-shift-fold twa-press-sm" onClick={() => { haptic.select(); setOpenGroup(open ? null : row.id); }}>
                  <span>{open ? "▾" : "▸"}</span>
                  <b>{row.text}</b>
                  <time>{hhmm(row.group.items[row.group.items.length - 1].at)}→{hhmm(row.group.items[0].at)}</time>
                </button>
                {open && (
                  <div className="twa-shift-group">
                    {row.group.items.map(item => (
                      <span key={`${row.id}:${item.code}:${item.at}`}><b>{hhmm(item.at)}</b> {item.code}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <div className="twa-shift-event" key={row.id}>
              <time>{hhmm(row.at)}</time>
              <i style={{ background: `${actor.color}26`, color: actor.color }}>{actor.mark}</i>
              <span>
                {row.code && <b>{row.code}</b>} {row.text}
                {row.sub && <small>{row.sub}</small>}
              </span>
            </div>
          );
        })}
      </div>

      {routine && <div className="twa-shift-routine">Само, без вас: {routine}{diff.errors === 0 && diff.wbCancelled === 0 ? " · ошибок и отмен нет" : ""}</div>}
      {feed.length > shown.length || all ? (
        <button type="button" className="twa-shift-all twa-press-sm" onClick={() => { haptic.select(); setAll(v => !v); }}>
          {all ? "Только важное" : `Вся лента · ${feed.length}`}
        </button>
      ) : null}
    </section>
  );
}

function Skeleton() {
  // Подпись в заглушке: без неё пустые серые блоки читались как «сломалось».
  return (
    <div className="twa-liquid-dashboard" aria-busy="true">
      <div style={{ color: C.textTertiary, fontSize: 14, padding: "2px 4px" }}>Считаем очередь и смену…</div>
      {[49, 210, 150, 96].map((height, index) => <div key={index} className="twa-liquid-skeleton" style={{ height, opacity: 0.82 - index * 0.1 }} />)}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="twa-liquid-error">
      <CircleAlert size={30} />
      <strong>Не удалось загрузить главную</strong>
      <span>Проверьте соединение и попробуйте снова</span>
      <button type="button" className="twa-primary-row" onClick={onRetry}>Повторить</button>
    </div>
  );
}
