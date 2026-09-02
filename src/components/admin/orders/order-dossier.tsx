"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Досье заказа — про факты. Действия живут сверху и в строке, а вкладки внизу
   отвечают на вопрос «почему заказ в таком виде»: события, платёж, след
   покупателя. На сайте для этого есть место, поэтому вместо пяти модалок
   подряд — три вкладки рядом с очередью.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import {
  ageBasis, ageTone, fmtAge, grossOf, laneOf, LANE_META, orderBadge, orderFlag, primaryActionFor,
} from "@/lib/order-presentation";
import { AdminOrder, LiveCheck, TONE_COLOR, clientLabel, contactHref, copyText, gamepassIdOf, gamepassIdsOf, num, rub } from "./types";
import styles from "./orders.module.css";

type Tab = "overview" | "events" | "payment" | "audit";

interface EventRow { id: string; type: string; payload: unknown; createdAt: string }

const EVENT_LABELS: Record<string, string> = {
  ORDER_CREATED: "Заказ создан",
  ORDER_PAID: "Оплата подтверждена",
  ORDER_COMPLETED: "Заказ закрыт — робуксы зачислены",
  ORDER_REJECTED: "Заказ отменён",
  GAMEPASS_ATTACHED: "Привязан геймпасс",
  AUDIT_NICK_ENTERED: "Покупатель ввёл ник",
  AUDIT_GAMEPASS_SUBMITTED: "Покупатель прислал ссылку на геймпасс",
  ADMIN_CARD_ROOT: "Карточка заказа в админке",
  WB_GATE_ISSUED: "Гейт выдан покупателю",
  REVIEW_BONUS_GRANTED: "Начислен бонус за отзыв",
};

export default function OrderDossier({
  order, live, onClose, onPrimary, onHold, onError, onFavorite, onCancel, onToast, onChanged,
}: {
  order: AdminOrder;
  live?: LiveCheck;
  onClose: () => void;
  onPrimary: () => void;
  onHold: () => void;
  onError: () => void;
  onFavorite: () => void;
  onCancel: () => void;
  onToast: (text: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [noteLines, setNoteLines] = useState<string[]>([]);
  const [audit, setAudit] = useState<any | null>(null);
  const [note, setNote] = useState(order.adminNote ?? "");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => { setTab("overview"); setEvents(null); setAudit(null); setNote(order.adminNote ?? ""); }, [order.id, order.adminNote]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/admin/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, orderId: order.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `Сервер ответил ${res.status}`);
    return data;
  }, [order.id]);

  useEffect(() => {
    if (tab !== "events" || events) return;
    void (async () => {
      try {
        const data = await post({ action: "order-events" });
        setEvents(data.events ?? []);
        setNoteLines(data.noteLines ?? []);
      } catch (error) { onToast((error as Error).message, true); }
    })();
  }, [tab, events, post, onToast]);

  useEffect(() => {
    if (tab !== "audit" || audit) return;
    void (async () => {
      try { setAudit(await post({ action: "order-audit" })); }
      catch (error) { onToast((error as Error).message, true); }
    })();
  }, [tab, audit, post, onToast]);

  const lane = laneOf(order);
  const badge = orderBadge(order);
  const flag = orderFlag(order, live, order.remindersSent ?? 0, { splitProgress: true });
  const action = primaryActionFor(order);
  const ids = gamepassIdsOf(order);
  const singleId = gamepassIdOf(order);
  const payment = order.paymentAttempts?.[0];
  const parts = order.splitGamepasses ?? [];
  const href = contactHref(order);

  async function saveNote() {
    setSavingNote(true);
    try {
      await post({ action: "set-note", note });
      onToast("Заметка сохранена");
      onChanged();
    } catch (error) { onToast((error as Error).message, true); }
    finally { setSavingNote(false); }
  }

  async function markPart(partId: string, purchased: boolean) {
    try {
      await post({ action: "mark-split-part", partId, purchased });
      onToast(purchased ? "Часть отмечена купленной" : "Отметка снята");
      onChanged();
    } catch (error) { onToast((error as Error).message, true); }
  }

  return (
    <aside className={styles.dossier} aria-label={`Досье заказа ${order.wbCode}`}>
      <div className={styles.dossierHead}>
        <div className={styles.dossierTitle}>
          <span className={styles.dossierCode}>{order.wbCode}</span>
          <span className={styles.badge} style={{ color: TONE_COLOR[LANE_META[lane].tone] }}>{LANE_META[lane].label}</span>
          {badge && <span className={styles.badge} style={{ color: TONE_COLOR[badge.tone] }}>{badge.label}</span>}
          <span className={styles.badge} style={{ color: TONE_COLOR[ageTone(ageBasis(order))] }}>{fmtAge(ageBasis(order))}</span>
          <button type="button" className={`${styles.btn} ${styles.dossierClose}`} onClick={onClose} aria-label="Закрыть досье">✕ Esc</button>
        </div>
        <div className={styles.dossierSub}>
          {order.robloxUsername ?? order.probableNick ?? "ник не указан"}
          {!order.robloxUsername && order.probableNick && " (вероятный)"} · {clientLabel(order)}
          {href && <> · <a href={href} target="_blank" rel="noreferrer">написать</a></>}
        </div>

        <div className={styles.actions}>
          {action && (
            <button type="button" className={`${styles.btn} ${action.tone === "green" ? styles.btnGreen : styles.btnPrimary}`} onClick={onPrimary}>
              {action.icon} {action.labelLong ?? action.label}
              {action.action === "complete" && <kbd>⌘↵</kbd>}
              {action.action === "restore-to-buyout" && <kbd>R</kbd>}
            </button>
          )}
          {ids.length > 0 && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnMono}`}
              onClick={() => { copyText(ids.join("\n")); onToast(ids.length > 1 ? `⧉ ${ids.length} ID пассов` : `⧉ ${ids[0]}`); }}
            >
              ⧉ {ids.length > 1 ? `${ids.length} ID пассов` : ids[0]} <kbd>C</kbd>
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onHold}>
            {order.heldAt ? "❄ Разморозить" : "❄ Заморозить"} <kbd>F</kbd>
          </button>
          <button type="button" className={styles.btn} onClick={onFavorite}>{order.isFavorite ? "★ Из избранного" : "★ В избранное"}</button>
          {["PENDING", "IN_PROGRESS"].includes(order.status) && (
            <button type="button" className={styles.btn} onClick={onError}>⚠ Пометить ошибкой <kbd>E</kbd></button>
          )}
          <button type="button" className={styles.btn} onClick={onCancel} style={{ color: "#ffc0ba" }}>✕ Отменить заказ</button>
          <a className={styles.btn} href={`/admin/orders/${order.id}`}>Полная карточка ↗</a>
        </div>
      </div>

      <nav className={styles.tabs} aria-label="Разделы досье">
        <button type="button" className={tab === "overview" ? styles.tabOn : ""} onClick={() => setTab("overview")}>Обзор</button>
        <button type="button" className={tab === "events" ? styles.tabOn : ""} onClick={() => setTab("events")}>События</button>
        <button type="button" className={tab === "payment" ? styles.tabOn : ""} onClick={() => setTab("payment")}>Платёж</button>
        <button type="button" className={tab === "audit" ? styles.tabOn : ""} onClick={() => setTab("audit")}>След покупателя</button>
      </nav>

      <div className={styles.dossierBody}>
        {tab === "overview" && (
          <>
            {order.heldAt && (
              <div className={`${styles.box} ${styles.boxIce}`}>
                <div className={styles.boxHead}>❄️ Заморожен<em>{order.heldBy ?? ""}</em></div>
                <div>{order.heldReason ?? "причина не указана"} · выключен из выкупа, очередей и пачки</div>
              </div>
            )}
            {order.buyoutErrorCode === "REGIONAL_PRICE" && (
              <div className={`${styles.box} ${styles.boxRed}`}>
                <div className={styles.boxHead}>Почему сорвался выкуп</div>
                <div>Донор видит региональную цену геймпасса. Прайс-гард заблокировал покупку: не по номиналу — это потерянные деньги. Ищите замену по нику или напишите покупателю.</div>
              </div>
            )}

            <div className={styles.kv}>
              <div><div className={styles.kvKey}>Грязные</div><div className={styles.kvValue}>{num(grossOf(order.amount))}<small>R$</small></div></div>
              <div><div className={styles.kvKey}>Чистые</div><div className={styles.kvValue}>{num(order.amount)}<small>R$</small></div></div>
              <div><div className={styles.kvKey}>Оплачено</div><div className={styles.kvValue}>{payment ? rub(payment.amountKopecks) : rub(order.saleAmountKopecks)}</div></div>
              <div><div className={styles.kvKey}>Создан</div><div className={styles.kvValue}>{fmtAge(order.createdAt)} назад</div></div>
              <div><div className={styles.kvKey}>В очереди</div><div className={styles.kvValue}>{order.pendingAt ? `${fmtAge(order.pendingAt)}` : "—"}</div></div>
              <div><div className={styles.kvKey}>Источник</div><div className={styles.kvValue}>{order.orderSource}</div></div>
            </div>

            <div className={styles.box}>
              <div className={styles.boxHead}>
                Геймпасс
                {live && <em style={{ color: live.isForSale === false ? "var(--o-red)" : live.priceMismatch ? "var(--o-orange)" : "var(--o-green)" }}>
                  {live.isForSale === false ? "снят с продажи" : live.priceMismatch ? `цена ${num(live.livePrice ?? 0)} R$` : "продаётся, цена сходится"}
                </em>}
              </div>
              {ids.length === 0 && <div style={{ color: "var(--o-muted)" }}>Пасса нет — выкупать нечего. Дожимайте покупателя или найдите пасс по нику.</div>}
              {parts.length > 0 ? (
                <div style={{ display: "grid", gap: 7 }}>
                  {parts.map(part => (
                    <div key={part.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                      <button
                        type="button"
                        className={`${styles.check} ${part.purchasedAt ? styles.checkOn : ""}`}
                        onClick={() => void markPart(part.id, !part.purchasedAt)}
                        aria-label={part.purchasedAt ? "Снять отметку" : "Отметить купленным"}
                      >✓</button>
                      <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{part.gamepassId}</span>
                      <span style={{ color: "var(--o-muted)" }}>{num(part.amount)} R$ чистыми · пасс {num(grossOf(part.amount))} R$</span>
                      <a style={{ marginLeft: "auto", color: "#b9aaff" }} href={`https://www.roblox.com/game-pass/${part.gamepassId}`} target="_blank" rel="noreferrer">открыть ↗</a>
                    </div>
                  ))}
                </div>
              ) : singleId ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 15 }}>{singleId}</span>
                  <span style={{ color: "var(--o-muted)" }}>ожидаемая цена {num(grossOf(order.amount))} R$</span>
                  {live?.sellerName && <span style={{ color: "var(--o-muted)" }}>продавец {live.sellerName}</span>}
                  <a style={{ marginLeft: "auto", color: "#b9aaff" }} href={`https://www.roblox.com/game-pass/${singleId}`} target="_blank" rel="noreferrer">открыть на Roblox ↗</a>
                </div>
              ) : null}
              {flag && <div style={{ marginTop: 9, color: TONE_COLOR[flag.tone], fontSize: 13.5 }}>{flag.text}</div>}
            </div>

            <div className={styles.box}>
              <div className={styles.boxHead}>Заметка</div>
              <textarea className={styles.note} value={note} onChange={event => setNote(event.target.value)} placeholder="Что нужно помнить про этот заказ" />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9 }}>
                <button type="button" className={styles.btn} onClick={() => void saveNote()} disabled={savingNote || note === (order.adminNote ?? "")}>
                  {savingNote ? "Сохраняем…" : "Сохранить"}
                </button>
              </div>
            </div>
          </>
        )}

        {tab === "events" && (
          <div className={styles.box}>
            <div className={styles.boxHead}>Лента событий<em style={{ color: "var(--o-muted)" }}>автоматика и люди</em></div>
            {!events && <div className={styles.loading}>Загружаем…</div>}
            {events && events.length === 0 && noteLines.length === 0 && <div style={{ color: "var(--o-muted)" }}>Событий пока нет.</div>}
            <div className={styles.events}>
              {events?.map((event, index) => (
                <div key={event.id} className={`${styles.event} ${index === 0 ? styles.eventAccent : ""}`}>
                  <span className={styles.eventTime}>{new Date(event.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={styles.eventDot}><i /></span>
                  <span className={styles.eventText}>{EVENT_LABELS[event.type] ?? event.type}</span>
                </div>
              ))}
              {noteLines.map(line => (
                <div key={line} className={styles.event}>
                  <span className={styles.eventTime}>заметка</span>
                  <span className={styles.eventDot}><i /></span>
                  <span className={styles.eventText}><em>{line}</em></span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "payment" && (
          <>
            <div className={styles.kv}>
              <div><div className={styles.kvKey}>Статус платежа</div><div className={styles.kvValue}>{payment?.status ?? "без эквайринга"}</div></div>
              <div><div className={styles.kvKey}>Сумма</div><div className={styles.kvValue}>{payment ? rub(payment.amountKopecks) : rub(order.saleAmountKopecks)}</div></div>
              <div><div className={styles.kvKey}>Возвращено</div><div className={styles.kvValue}>{payment ? rub(payment.refundedAmountKopecks) : "—"}</div></div>
              <div><div className={styles.kvKey}>Оплата подтверждена</div><div className={styles.kvValue}>{order.paidAt ? new Date(order.paidAt).toLocaleString("ru-RU") : "—"}</div></div>
            </div>
            <p className={styles.hint}>
              Возврат оформляется в полной карточке заказа — там видно, сколько ещё можно вернуть,
              и подтверждение суммы обязательно.
            </p>
          </>
        )}

        {tab === "audit" && (
          <div className={styles.box}>
            <div className={styles.boxHead}>Что клиент вводил сам<em style={{ color: "var(--o-muted)" }}>этим закрываются споры</em></div>
            {!audit && <div className={styles.loading}>Загружаем…</div>}
            {audit && (
              <>
                <div className={styles.kv} style={{ marginBottom: 12 }}>
                  <div><div className={styles.kvKey}>Подтверждённый ник</div><div className={styles.kvValue}>{audit.confirmedNick ?? "—"}</div></div>
                  <div><div className={styles.kvKey}>Выкупленный пасс</div><div className={styles.kvValue}>{audit.gamepassId ?? "—"}</div></div>
                </div>
                <div className={styles.events}>
                  {(audit.events ?? []).map((event: EventRow) => (
                    <div key={event.id} className={styles.event}>
                      <span className={styles.eventTime}>{new Date(event.createdAt).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      <span className={styles.eventDot}><i /></span>
                      <span className={styles.eventText}>
                        {EVENT_LABELS[event.type] ?? event.type}
                        {typeof event.payload === "object" && event.payload
                          ? <em> · {Object.entries(event.payload as Record<string, unknown>).slice(0, 4).map(([key, value]) => `${key}: ${String(value)}`).join(", ")}</em>
                          : null}
                      </span>
                    </div>
                  ))}
                  {(audit.events ?? []).length === 0 && <div style={{ color: "var(--o-muted)" }}>Следа нет: заказ заведён вручную или до появления аудита.</div>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
