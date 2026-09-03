"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  MessageCircleQuestion,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  TriangleAlert,
  Truck,
  Clock3,
} from "lucide-react";
import { C } from "../theme";
import { ageColor, fmtAge } from "../age";
import { haptic } from "../haptics";
import type { FirstInLine } from "@/types/first-in-line";
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
  inbox: { available: boolean; feedbacks: number; questions: number; total: number };
  dbs: DbsSnapshot | null;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

/** Полосы очереди: цвет делится с бейджем заказа, чтобы «синий» значил одно и то же. */
const LANE_META: Record<Lane["id"], { label: string; color: string }> = {
  WB:     { label: "Wildberries", color: C.green },
  WB_DBS: { label: "WB DBS",      color: C.blue },
  DIRECT: { label: "Прямые",      color: C.accent },
};

/** Этап DBS → вкладка очереди доставки, которую открывает тап по нему. */
const STAGE_FOCUS: Record<string, WbDeliveryFocus> = {
  attention: "attention",
  waiting_code: "waitingCode",
  ready_receive: "readyReceive",
  in_bot: "inBot",
};

function robux(value: number) {
  return value.toLocaleString("ru-RU");
}

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
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
  onCreateOrder,
}: {
  token: string;
  onOpenOrders?: (query?: string, tab?: OrdersTab) => void;
  onOpenInbox?: () => void;
  onOpenDelivery?: (focus?: WbDeliveryFocus | null) => void;
  onCreateOrder?: (mode: "manual" | "direct") => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) setData(await response.json() as DashData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton />;
  if (!data) return <ErrorState onRetry={() => void load(true)} />;

  const { buyout, errors, awaitingLink, held, inbox, dbs } = data;
  const totalCodes = data.codes.reduce((sum, code) => sum + code.count, 0);
  const activeLanes = buyout.lanes.filter(lane => lane.orders > 0);
  const firstInLine = data.firstInLine?.rows ?? [];
  // «В боте» — не задача: покупатель уже с кодом идёт по нашей воронке, а
  // доставка WB к этому моменту закрыта (иначе гейт бы не ушёл). Решения
  // требует только незакрытая доставка или ход за нами.
  const dbsNeedsDecision = Boolean(dbs && (dbs.unclosed > 0 || dbs.needsUs > 0));
  const dbsOldest = dbs?.unclosed ? dbs.unclosedOldestAt : dbs?.needsUsOldestAt ?? null;

  function openOrders(tab: OrdersTab) {
    haptic.select();
    onOpenOrders?.(undefined, tab);
  }

  function submitSearch() {
    const value = query.trim();
    if (value.length < 2) return;
    haptic.select();
    onOpenOrders?.(value);
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      {/* Поиск — вход в единственный поиск приложения, а не второй его движок. */}
      <div className="twa-search-field twa-home-search">
        <Search size={20} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") submitSearch(); }}
          enterKeyHint="search"
          placeholder="Код, ник, @username, ID геймпасса"
          aria-label="Поиск по заказам"
        />
        {query.trim().length >= 2 && (
          <button type="button" className="twa-home-search-go" onClick={submitSearch}>Найти</button>
        )}
      </div>

      {!data.apiAvailable && (
        <div className="twa-liquid-alert">
          <CircleAlert size={19} />
          <div><strong>WB API недоступен</strong><span>Очереди из БД работают{data.tokenPresent === false ? " · токен WB не задан" : ""}</span></div>
        </div>
      )}

      {/* ── Касса выкупа ─────────────────────────────────────────────────── */}
      <section className="twa-till">
        <header className="twa-till-head">
          <span>К выкупу</span>
          <div>
            <b>{buyout.orders} {plural(buyout.orders, "заказ", "заказа", "заказов")}</b>
            <button
              type="button"
              className="twa-till-refresh twa-press-sm"
              aria-label="Обновить очереди"
              disabled={refreshing}
              onClick={() => { haptic.select(); void load(true); }}
            >
              <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} />
            </button>
          </div>
        </header>

        <button type="button" className="twa-till-figure twa-press-sm" onClick={() => openOrders("BUYOUT")}>
          <strong>{robux(buyout.gross)}<small>R$</small></strong>
          <span>грязными · <b>{robux(buyout.clean)} R$</b> чистыми клиенту</span>
        </button>

        {buyout.orders > 0 && (
          <div className="twa-till-age" style={{ color: ageColor(buyout.oldestAt) }}>
            <Clock3 size={15} />
            <b>старейший {fmtAge(buyout.oldestAt)}</b>
            {buyout.overdue > 0 && <span>· {buyout.overdue} {plural(buyout.overdue, "ждёт", "ждут", "ждут")} дольше 12 ч</span>}
          </div>
        )}

        {activeLanes.length > 0 && (
          <>
            {/* Ширина сегмента — доля робуксов, а не заказов: шесть DBS-заказов
                могут стоить дороже четырнадцати ВБ-шных, и полоса обязана это
                показывать, иначе она врёт ровно там, где на неё смотрят. */}
            <div className="twa-lane-bar" aria-hidden="true">
              {activeLanes.map(lane => (
                <i key={lane.id} style={{ flexGrow: Math.max(lane.gross, 1), background: LANE_META[lane.id].color }} />
              ))}
            </div>

            <div className="twa-lane-rows">
              {activeLanes.map(lane => (
                <button
                  key={lane.id}
                  type="button"
                  className="twa-lane-row twa-press-sm"
                  onClick={() => { haptic.select(); onOpenOrders?.(undefined, "BUYOUT"); }}
                >
                  <i style={{ background: LANE_META[lane.id].color }} />
                  <span className="twa-lane-name">{LANE_META[lane.id].label}</span>
                  <span className="twa-lane-count">{lane.orders}</span>
                  <span className="twa-lane-age" style={{ color: ageColor(lane.oldestAt) }}>{fmtAge(lane.oldestAt)}</span>
                  <b className="twa-lane-sum">{robux(lane.gross)}</b>
                </button>
              ))}
            </div>
          </>
        )}

        {buyout.orders === 0 && <div className="twa-till-empty">Очередь выкупа пуста</div>}
      </section>

      {/* ── ⚡ Первым делом ───────────────────────────────────────────────
          Поднятые кнопкой заказы и прямые. В очереди они и так наверху, но
          наверху же стоит просто самый старый — без отдельного блока «подняли»
          и «прямой» на главной не видно вовсе. Пусто — блока нет. */}
      {firstInLine.length > 0 && (
        <section className="twa-first">
          <div className="twa-first-head">
            <span>⚡ Первым делом</span>
            <em>{robux(data.firstInLine!.gross)} R$ грязными</em>
          </div>
          {firstInLine.map(order => (
            <button
              key={order.id}
              type="button"
              className="twa-first-row twa-press-sm"
              onClick={() => { haptic.select(); onOpenOrders?.(order.wbCode); }}
            >
              <span className={`twa-first-why ${order.reason === "pinned" ? "is-pinned" : "is-direct"}`}>
                {order.reason === "pinned" ? "⚡" : "Прямой"}
              </span>
              <span className="twa-first-main">
                <strong>{order.wbCode}</strong>
                <small>{order.robloxUsername ?? "ник не указан"}</small>
              </span>
              <b className="twa-first-sum">{robux(order.gross)}</b>
              <span className="twa-first-age" style={{ color: ageColor(order.since) }}>{fmtAge(order.since)}</span>
            </button>
          ))}
        </section>
      )}

      {/* ── Требует решения ──────────────────────────────────────────────── */}
      {(dbsNeedsDecision || errors.count > 0 || inbox.total > 0) ? (
        <>
          <div className="twa-section-label">Требует решения</div>
          <div className="twa-inset-group twa-action-list">
            {/* Незакрытая доставка бьёт всё остальное: там висят деньги WB.
                Если доставка закрыта, но ход за нами (проверка, полученный код,
                готовый гейт) — говорим об этом, а не о доставке. */}
            {dbs && dbsNeedsDecision && (
              <button type="button" className="twa-inset-row twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.(null); }}>
                <span className="twa-result-icon is-delivery"><Truck size={21} /></span>
                <div>
                  {/* Заголовок называет того, за кем ход: «закрыть на WB» в
                      момент, когда заказ ждёт код от покупателя, звало нас на
                      работу, которой нет. */}
                  <strong>
                    {dbs.needsUs > 0
                      ? `WB Доставка · ${dbs.needsUs} ${plural(dbs.needsUs, "ждёт", "ждут", "ждут")} нашего хода`
                      : dbs.unclosed > 0
                        ? `WB Доставка · ${dbs.unclosed} ${plural(dbs.unclosed, "ждёт", "ждут", "ждут")} покупателя`
                        : "WB Доставка"}
                  </strong>
                  <small>
                    {dbs.stages
                      .filter(stage => stage.stage !== "in_bot" && stage.stage !== "link_sent")
                      .map(stage => `${stage.label} ${stage.count}`).join(" · ") || "в работе"}
                    {/* Срок WB — не возраст заказа: по нему заказ отменяют. */}
                    {dbs.overdue > 0 && <> · <b style={{ color: C.red }}>{dbs.overdue} просрочено по сроку WB</b></>}
                    {dbs.overdue === 0 && dbs.dueSoon > 0 && <> · <b style={{ color: C.orange }}>{dbs.dueSoon} истекает за 4 ч</b></>}
                    {dbsOldest && <> · старейший <b style={{ color: ageColor(dbsOldest) }}>{fmtAge(dbsOldest)}</b></>}
                  </small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}

            {errors.count > 0 && (
              <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders("ERROR")}>
                <span className="twa-result-icon is-error"><TriangleAlert size={21} /></span>
                <div>
                  <strong>{errors.count} {plural(errors.count, "ошибка выкупа", "ошибки выкупа", "ошибок выкупа")}</strong>
                  <small>{errors.first ?? "разобрать вручную"}{errors.oldestAt && ` · ${fmtAge(errors.oldestAt)}`}</small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}

            {inbox.total > 0 && (
              <button type="button" className="twa-inset-row twa-press-sm" onClick={() => { haptic.select(); onOpenInbox?.(); }}>
                <span className="twa-result-icon is-inbox"><MessageCircleQuestion size={21} /></span>
                <div>
                  <strong>{inbox.total} без ответа</strong>
                  <small>{inbox.feedbacks} {plural(inbox.feedbacks, "отзыв", "отзыва", "отзывов")} · {inbox.questions} {plural(inbox.questions, "вопрос", "вопроса", "вопросов")}</small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          {/* Этапы DBS отдельной лентой: каждый открывает ровно свою очередь. */}
          {dbs && dbs.stages.length > 0 && (
            <div className="twa-stage-strip twa-no-scrollbar">
              {dbs.stages.map(stage => (
                <button
                  key={stage.stage}
                  type="button"
                  className="twa-stage-chip twa-press-sm"
                  onClick={() => { haptic.select(); onOpenDelivery?.(STAGE_FOCUS[stage.stage] ?? null); }}
                >
                  {stage.label}
                  <b>{stage.count}</b>
                  {stage.oldestAt && <em style={{ color: ageColor(stage.oldestAt) }}>{fmtAge(stage.oldestAt)}</em>}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── Тихие строки: видно, что есть, но это не невыполненная задача ─── */}
      <div className="twa-quiet-rows">
        {/* Код у покупателя, доставка закрыта, он идёт по нашей воронке.
            Это ход покупателя, а не наш — в «Требует решения» ему не место. */}
        {dbs && dbs.inBot > 0 && (
          <button type="button" className="twa-quiet-row twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("inBot"); }}>
            <Truck size={16} />
            <span>
              {dbs.inBot} в боте · код выдан, доставка закрыта
              {dbs.funnel.readyBuyout > 0 && ` · ${dbs.funnel.readyBuyout} уже в очереди выкупа`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {/* Гейт ушёл, код не открыт: сам такой заказ не сдвинется никогда —
            напоминания бота кончились. Внутри «в боте» это было незаметно. */}
        {dbs && dbs.funnel.notActivated > 0 && (
          <button type="button" className="twa-quiet-row is-loud twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("notActivated"); }}>
            <CircleAlert size={16} />
            <span>
              <b>{dbs.funnel.notActivated} {plural(dbs.funnel.notActivated, "код не открыт", "кода не открыты", "кодов не открыты")}</b> покупателями
              <small>
                {dbs.funnel.notActivatedNudged > 0 && `напоминания кончились у ${dbs.funnel.notActivatedNudged}`}
                {dbs.funnel.notActivatedOldestAt && ` · старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}`}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {awaitingLink.stale > 0 && (
          <button type="button" className="twa-quiet-row is-loud twa-press-sm" onClick={() => openOrders("STALE_LINK")}>
            <Clock3 size={16} />
            <span>
              <b>{awaitingLink.stale} {plural(awaitingLink.stale, "висяк", "висяка", "висяков")}</b> без ссылки дольше двух недель
              <small>напоминания бота кончились · старейшему {fmtAge(awaitingLink.staleOldestAt)}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {/* Когда висяки вынесены наверх, здесь остаётся живая часть очереди:
            повторять «из них N висяков» второй строкой подряд незачем. */}
        {awaitingLink.total > 0 && (
          <button type="button" className="twa-quiet-row twa-press-sm" onClick={() => openOrders("AWAITING_LINK")}>
            <Clock3 size={16} />
            <span>
              {awaitingLink.stale > 0
                ? `Ещё ${awaitingLink.total - awaitingLink.stale} ждут ссылку · вся очередь ${awaitingLink.total}`
                : `${awaitingLink.total} ждут ссылку · старейшая ${fmtAge(awaitingLink.oldestAt)}`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {held.count > 0 && (
          <button type="button" className="twa-quiet-row is-ice twa-press-sm" onClick={() => openOrders("HELD")}>
            <Snowflake size={16} />
            {/* Кодов приходит не больше четырёх — строка на телефоне всё равно
                не покажет больше. Хвост называем числом, а не молча режем. */}
            <span>
              {held.count} {plural(held.count, "заказ заморожен", "заказа заморожены", "заказов заморожены")} · {held.codes.join(", ")}
              {held.count > held.codes.length && ` и ещё ${held.count - held.codes.length}`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}
      </div>

      <button type="button" className="twa-primary-row twa-press" onClick={() => { haptic.select(); onCreateOrder?.("manual"); }}>
        <Plus size={19} /> Новый заказ
      </button>

      <div className="twa-home-footer">
        Неделя · {rub(data.week.sum)} · {data.week.orders} {plural(data.week.orders, "заказ", "заказа", "заказов")} · {totalCodes} WB-{plural(totalCodes, "код", "кода", "кодов")} на складе
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="twa-liquid-dashboard">{[49, 210, 150, 96].map((height, index) => <div key={index} className="twa-liquid-skeleton" style={{ height, opacity: 0.82 - index * 0.1 }} />)}</div>;
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
