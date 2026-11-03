"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   «Настройка геймпассов» заказа на сайте — один блок на все разделы.

   Замечание владельца 19.10.2026: «наше меню настройки геймпассов должно быть
   удобным и одинаковым, что в ТВА, что на сайте, что в разных разделах».

   Раньше инструменты были размазаны: привязка жила внутри «✎ Правки», пассы
   ника — кнопкой в досье, разбивка — кнопкой в шапке действий, а ключ
   покупателя появился только в досье. Названия у всех были свои.

   Теперь список, порядок, значки и предусловия берутся из
   `@/lib/gamepass-tools` — того же модуля, который рисует это меню в TWA, —
   а поверхность (досье, правка, полная карточка) передаёт только обработчики
   тех инструментов, которые она умеет открыть.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from "react";
import {
  GAMEPASS_TOOLS,
  gamepassToolsFor,
  gamepassToolsRefusal,
  type GamepassToolId,
  type GamepassToolOrder,
} from "@/lib/gamepass-tools";
import { BUYER_STEP_OPTIONS, type BuyerStepKind, type BuyerStepOrder } from "../../../../bots/shared/buyer-step";
import { BuyerMessagePreview } from "@/components/buyer-message-preview";
import { num } from "./types";
import styles from "./orders.module.css";

/**
 * Меню инструментов. Инструмент без обработчика не рисуется: поверхность не
 * должна обещать то, что из неё не открывается.
 */
export function GamepassToolRows({
  order, active, handlers, hints, onPick,
}: {
  order: GamepassToolOrder;
  active?: GamepassToolId | null;
  handlers: Partial<Record<GamepassToolId, boolean>>;
  /** Подсказка по факту заказа вместо общей (прогресс разбивки и т.п.). */
  hints?: Partial<Record<GamepassToolId, string>>;
  onPick: (id: GamepassToolId) => void;
}) {
  const allowed = gamepassToolsFor(order);
  const rows = GAMEPASS_TOOLS.filter(
    tool => handlers[tool.id] && allowed.some(item => item.id === tool.id),
  );
  const refusal = gamepassToolsRefusal(order);

  if (rows.length === 0) {
    return refusal ? <div className={styles.hint}>{refusal}</div> : null;
  }

  return (
    <div className={styles.gpTools}>
      {rows.map(tool => (
        <button
          key={tool.id}
          type="button"
          className={`${styles.gpTool}${active === tool.id ? ` ${styles.gpToolOn}` : ""}`}
          onClick={() => onPick(tool.id)}
        >
          <span className={styles.gpToolIcon}>{tool.icon}</span>
          <span>
            <b>{tool.label}</b>
            <em>{hints?.[tool.id] ?? tool.hint}</em>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Что форме ключа нужно о заказе. Намеренно минимум: её ставят и в досье, и в
 * правке, и на полной карточке, где полного `AdminOrder` нет.
 */
export interface KeyBoxOrder {
  id: string;
  wbCode: string;
  robloxUsername: string | null;
  probableNick?: string | null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   🔑 «Ключ покупателя» — админ вставляет Open Cloud ключ за него.

   Владелец, 18.10.2026: «очень часто они кидают ключ нам, а не боту, проще
   самим его вставить в заказ и сделать все за них».

   Два шага, а не одна кнопка: сначала ключ проверяется мостом и экран
   показывает, НА КАКОМ аккаунте и КАКИЕ пассы будут созданы, и только потом
   создание. Подтверждать такое вслепую нельзя: пассы ложатся на чужой аккаунт
   и стоят живых робуксов при выкупе.

   Ключ живёт только в этом поле: `type=password`, без автозаполнения, в ответах
   сервера его нет ни при каком исходе, после создания поле очищается.
   ───────────────────────────────────────────────────────────────────────── */
export function KeyCreateBox({
  order, post, onToast, onChanged,
}: {
  order: KeyBoxOrder;
  post: (payload: Record<string, unknown>) => Promise<any>;
  onToast: (text: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [nick, setNick] = useState(order.robloxUsername ?? order.probableNick ?? "");
  const [gameRef, setGameRef] = useState("");
  const [needsGameLink, setNeedsGameLink] = useState(false);
  const [busy, setBusy] = useState<"verify" | "create" | "save" | null>(null);
  const [plan, setPlan] = useState<{ nick: string; targets: { price: number; amount: number }[]; hasGamepass: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: { gamepassId: string; price: number; live: { price: number | null; isForSale: boolean } | null }[]; complete: boolean; notified: string | null; needsHands: boolean } | null>(null);

  useEffect(() => {
    // Ключ принадлежит ОДНОМУ заказу: при переходе на соседний поле обязано
    // очиститься, иначе ключ одного покупателя уедет в заказ другого.
    setOpen(false); setKey(""); setGameRef(""); setPlan(null); setError(null); setDone(null);
    setNeedsGameLink(false);
    setNick(order.robloxUsername ?? order.probableNick ?? "");
  }, [order.id, order.robloxUsername, order.probableNick]);

  const call = async (payload: Record<string, unknown>, mode: "verify" | "create" | "save") => {
    setBusy(mode); setError(null);
    try {
      return await post({ action: "create-gamepass-by-key", key, nick, gameRef: gameRef || undefined, ...payload });
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      // «Не видим твою игру» / «это не ссылка на игру» — чинится ссылкой, а не
      // новым ключом: показываем поле, ключ вводить заново не нужно.
      if (/игр[уы]/i.test(message)) setNeedsGameLink(true);
      return null;
    } finally {
      setBusy(null);
    }
  };

  async function verify() {
    const data = await call({ dryRun: true }, "verify");
    if (!data) return;
    setPlan({ nick: data.nick, targets: data.targets ?? [], hasGamepass: Boolean(data.hasGamepass) });
  }

  async function create() {
    const data = await call({ replace: plan?.hasGamepass === true }, "create");
    if (!data) return;
    setKey("");
    setDone({ created: data.created ?? [], complete: Boolean(data.complete), notified: data.notified ?? null, needsHands: Boolean(data.needsHands) });
    onToast(data.complete
      ? `Пасс${(data.created ?? []).length > 1 ? "ы" : ""} созданы — заказ ${order.wbCode} в очереди выкупа`
      : `Создано ${(data.created ?? []).length} из набора — заказ ещё не полный`, !data.complete);
    onChanged();
  }

  async function saveOnly() {
    const data = await call({ saveOnly: true }, "save");
    if (!data) return;
    setKey("");
    onToast(`Ключ сохранён за покупателем (${data.nick}) — сработает на следующем заказе`);
  }

  return (
    <div className={styles.box}>
      <div className={styles.boxHead}>
        🔑 Ключ покупателя
        <em style={{ color: "var(--o-muted)" }}>когда ключ прислали нам, а не боту</em>
      </div>

      {!open && !done && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--o-muted)", fontSize: 13.5 }}>
          Создадим геймпассы сами — покупателю ничего делать не нужно.
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setOpen(true)}>
            Вставить ключ
          </button>
        </div>
      )}

      {open && !done && (
        <div className={styles.keyForm}>
          <label>
            <span className={styles.kvKey}>Ключ Open Cloud</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={event => { setKey(event.target.value); setPlan(null); }}
              placeholder="одна длинная строка из Creator Hub"
            />
          </label>
          <label>
            <span className={styles.kvKey}>Ник Roblox покупателя</span>
            <input value={nick} onChange={event => { setNick(event.target.value); setPlan(null); }} placeholder="Anastasia_M" />
          </label>
          {needsGameLink && (
            <label>
              <span className={styles.kvKey}>Ссылка на игру — Roblox не видит игры этого аккаунта</span>
              <input value={gameRef} onChange={event => setGameRef(event.target.value)} placeholder="roblox.com/.../experiences/123456" />
            </label>
          )}

          {plan && (
            <div className={styles.keyPlan}>
              <div className={styles.keyPlanRow}>✅ Ключ рабочий · аккаунт <b>{plan.nick}</b></div>
              {plan.targets.map((target, index) => (
                <div key={`${target.price}-${index}`} className={styles.keyPlanRow}>
                  Создадим пасс <b>{num(target.price)} R$</b>
                  <span style={{ color: "var(--o-muted)" }}>→ {num(target.amount)} R$ чистыми</span>
                </div>
              ))}
              {plan.hasGamepass && (
                <div className={styles.keyPlanRow} style={{ color: "#ffd60a" }}>
                  ⚠️ У заказа уже есть геймпасс — он будет заменён созданным.
                </div>
              )}
            </div>
          )}

          {error && <div style={{ color: "#ffc0ba", fontSize: 13.5 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className={styles.btn} onClick={() => { setOpen(false); setKey(""); setPlan(null); setError(null); }}>
              Отмена
            </button>
            <button type="button" className={styles.btn} onClick={() => void saveOnly()} disabled={!key || busy !== null}>
              {busy === "save" ? "Сохраняем…" : "Только сохранить ключ"}
            </button>
            {!plan ? (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void verify()} disabled={!key || !nick || busy !== null}>
                {busy === "verify" ? "Проверяем ключ…" : "Проверить ключ"}
              </button>
            ) : (
              <button type="button" className={`${styles.btn} ${styles.btnGreen}`} onClick={() => void create()} disabled={busy !== null}>
                {busy === "create" ? "Создаём пассы…" : "Создать и привязать"}
              </button>
            )}
          </div>

          <p className={styles.hint}>
            Ключ сохраняется за покупателем в зашифрованном виде: следующий его заказ закроется сам.
            В ответах, логах и карточках ключа нет.
          </p>
        </div>
      )}

      {done && (
        <div className={styles.keyPlan}>
          {done.created.map(pass => (
            <div key={pass.gamepassId} className={styles.keyPlanRow}>
              <b>{pass.gamepassId}</b>
              <span>{num(pass.price)} R$</span>
              <span style={{ color: !pass.live ? "var(--o-muted)" : pass.live.isForSale === false ? "var(--o-red)" : "var(--o-green)" }}>
                {!pass.live
                  ? "Roblox не ответил — проверь руками"
                  : pass.live.isForSale === false
                    ? "НЕ в продаже"
                    : pass.live.price != null && Math.abs(pass.live.price - pass.price) > 2
                      ? `цена ${num(pass.live.price)} R$ вместо ${num(pass.price)} R$`
                      : "в продаже, цена сходится"}
              </span>
              <a style={{ marginLeft: "auto", color: "#b9aaff" }} href={`https://www.roblox.com/game-pass/${pass.gamepassId}`} target="_blank" rel="noreferrer">открыть ↗</a>
            </div>
          ))}
          <div className={styles.keyPlanRow} style={{ color: done.complete ? "var(--o-green)" : "#ffd60a" }}>
            {done.complete ? "📎 Привязано, заказ в очереди выкупа" : "📎 Набор неполный — дособери заказ руками"}
          </div>
          <div className={styles.keyPlanRow} style={{ color: "var(--o-muted)" }}>
            {done.notified
              ? `Покупателю написали (${done.notified.toUpperCase()})`
              : done.complete
                ? "Покупателю НЕ дошло — напиши ему сам"
                : "Покупателю не писали: заказ ещё не готов"}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className={styles.btnSm} onClick={() => { setDone(null); setPlan(null); setOpen(false); }}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  );
}
/* ─────────────────────────────────────────────────────────────────────────────
   📨 «Инструкция покупателю» — бот присылает ему всю инструкцию или её часть.

   Жалоба поддержки 20.10.2026: покупатель ткнул не туда или пропустил шаг, и
   теперь не может вставить ссылку или ключ. Поддержка всё объяснила словами, а
   где в боте нужная кнопка — он не находит. Отсюда бот пишет ему НОВОЕ
   сообщение ровно с этим шагом. Тексты и кнопки — `bots/shared/buyer-step`,
   общие с ботами; ответ бот примет и без кнопки.

   28.10.2026: сначала выбор, потом превью того, что придёт, потом отправка.
   Под формой — след: что уже отправляли и где бот покупателя не понял.
   ───────────────────────────────────────────────────────────────────────── */
type StepTrailRow = { at: string; type: string; text: string };
type StepTrailResponse = {
  trail?: StepTrailRow[];
  channel?: "tg" | "vk" | null;
  stepOrder?: BuyerStepOrder | null;
  blocked?: string | null;
};

export function AskBuyerBox({
  orderId, post, onToast, initialKind,
}: {
  orderId: string;
  /** Пункт, выбранный сразу («Следующий шаг» пути покупателя). */
  initialKind?: BuyerStepKind;
  post: (payload: Record<string, unknown>) => Promise<StepTrailResponse & { channel?: string | null }>;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [data, setData] = useState<StepTrailResponse | null>(null);
  const [kind, setKind] = useState<BuyerStepKind>(initialKind ?? "create");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await post({ action: "buyer-step-trail" })); }
    catch { setData({ trail: [] }); }
  }, [post]);

  // Форма живёт ключом `orderId` у родителя: на соседнем заказе она
  // монтируется заново, и сбрасывать поля руками не нужно.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await post({ action: "buyer-step-trail" });
        if (alive) setData(next);
      } catch { if (alive) setData({ trail: [] }); }
    })();
    return () => { alive = false; };
  }, [orderId, post]);

  const channel = data?.channel === "vk" ? "vk" : data?.channel === "tg" ? "tg" : null;
  const where = channel === "vk" ? "VK" : "Telegram";
  const blocked = data?.blocked ?? null;
  const cannotSend = busy || !!blocked || (kind === "custom" && !text.trim());

  async function send() {
    if (cannotSend) return;
    setBusy(true);
    try {
      const result = await post({ action: "send-step", kind, text: kind === "custom" ? text : undefined });
      onToast(`📨 Отправлено покупателю (${result.channel === "vk" ? "VK" : "Telegram"})`);
      setText("");
      // Досье перечитает путь покупателя.
      window.dispatchEvent(new CustomEvent("admin:journey-stale", { detail: orderId }));
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Не отправилось", true);
    } finally {
      setBusy(false);
      void load();
    }
  }

  const option = (o: (typeof BUYER_STEP_OPTIONS)[number]) => (
    <button
      key={o.kind}
      type="button"
      className={`${styles.gpTool}${kind === o.kind ? ` ${styles.gpToolOn}` : ""}`}
      onClick={() => setKind(o.kind)}
      aria-pressed={kind === o.kind}
    >
      <span className={styles.gpToolIcon}>{o.icon}</span>
      <span><b>{o.label}</b><em>{o.hint}</em></span>
    </button>
  );

  return (
    <div className={styles.keyForm}>
      {blocked && <div style={{ color: "var(--o-orange)", fontSize: 13.5 }}>{blocked}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span className={styles.kvKey}>Целиком</span>
          <div className={styles.gpTools}>{BUYER_STEP_OPTIONS.filter(o => o.group === "whole").map(option)}</div>
          <span className={styles.kvKey}>Часть инструкции</span>
          <div className={styles.gpTools}>{BUYER_STEP_OPTIONS.filter(o => o.group !== "whole").map(option)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {kind === "custom" && (
            <label>
              <span className={styles.kvKey}>Текст покупателю — к нему добавятся кнопки инструкции и ссылки</span>
              <textarea
                value={text}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
                rows={3}
                maxLength={1000}
                autoFocus
                placeholder="Например: пасс стоит 1100, а нужно 1143 — поправь цену, пожалуйста"
              />
            </label>
          )}
          {data?.stepOrder
            ? <BuyerMessagePreview kind={kind} order={data.stepOrder} customText={text} channel={channel} />
            : <p className={styles.hint}>Загружаем превью…</p>}
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void send()} disabled={cannotSend}>
            {busy ? "Отправляем…" : `📨 Отправить в ${where}`}
          </button>
          {data?.trail && data.trail.length > 0 && (
            <div className={styles.keyPlan}>
              {data.trail.slice(0, 5).map((row, index) => (
                <div key={`${row.at}-${index}`} className={styles.keyPlanRow}>
                  <span style={{ color: "var(--o-muted)", minWidth: 92 }}>
                    {new Date(row.at).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", "")}
                  </span>
                  <span style={{ color: row.type === "BOT_DEAD_END" ? "#ffd60a" : undefined }}>{row.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className={styles.hint}>Бот напишет покупателю новым сообщением. Ник, ссылку, Pass ID или ключ он примет и без кнопки.</p>
    </div>
  );
}
