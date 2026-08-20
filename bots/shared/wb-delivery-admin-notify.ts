import { tgSend, tgEdit, tgDelete, tgMessageId, escapeHtml } from "./notify";
import {
  denomLine,
  formatAdminNotice,
  mskTime,
  wbOrderRef,
  type AdminNotice,
} from "./notify-format";
import type { AutoReceiveSkip } from "./wb-delivery-sync";

const ADMIN_IDS: string[] = [...new Set(
  (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)];

function broadcast(notice: AdminNotice) {
  if (!ADMIN_IDS.length) return;
  const text = formatAdminNotice(notice);
  void Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, text, { parse_mode: "HTML" })));
}

// Отдельных сообщений на «заказ принят», «ушёл автозапрос», «доставка закрыта»
// и «гейт отправлен» больше нет: это ровно те четыре шага, которые складывались
// в кашу из пяти сообщений на заказ. Все они видны в живой карточке
// (`pushDbsCard`), которая переписывает саму себя. Отдельным сообщением уходит
// только то, что требует человека — редактирование в Telegram не даёт звука.

export function notifyDbsBuyerMessage(wbOrderId: string, buyerName: string | null, textPreview: string) {
  const preview = textPreview.length > 120 ? textPreview.slice(0, 117) + "…" : textPreview;
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "сообщение покупателя",
    lines: [
      wbOrderRef(wbOrderId, [buyerName ? escapeHtml(buyerName) : null]),
      `<i>${escapeHtml(preview)}</i>`,
    ],
    next: "ответить из консоли DBS или из кабинета WB",
  });
}

/** A WB cancellation is never routine: the buyer's money went back, and
 * whatever we opened on the back of that order has to stop. */
export function notifyDbsOrderCancelled(
  wbOrderId: string,
  wbStatus: string,
  activationCode: string | null,
  internalStatus: string | null,
  outcome: "rejected" | "needs_human" | "no_internal_order",
) {
  const code = activationCode ? `<code>${escapeHtml(activationCode)}</code>` : "—";
  const next = outcome === "rejected"
    ? `выкуп ${code} закрыт автоматически (был ${escapeHtml(internalStatus ?? "—")}) — делать ничего не нужно`
    : outcome === "needs_human"
      ? `<b>разобрать вручную во вкладке «Заказы»</b>: выкуп ${code} в статусе <b>${escapeHtml(internalStatus ?? "—")}</b>, робуксы могли уйти`
      : activationCode
        ? `гейт ${code} выдан, но не активирован — заказ остаётся в DBS как «Нужна проверка»`
        : "гейт не выпускался — делать ничего не нужно";
  broadcast({
    marker: outcome === "needs_human" ? "urgent" : "cancelled",
    zone: "DBS",
    title: "заказ отменён на WB",
    lines: [wbOrderRef(wbOrderId, [`<i>${escapeHtml(wbStatus)}</i>`])],
    next,
  });
}

/** Почему закрытие доставки не состоялось — человеческим языком.
 *
 * Раньше пропуск был молчаливым `return`, и отличить его от недошедшего
 * уведомления было невозможно. Теперь каждая причина названа и к каждой
 * приложено действие. */
const SKIP_REASON: Record<Exclude<AutoReceiveSkip, null>, { marker: "action" | "urgent"; text: string }> = {
  flag_off: {
    marker: "action",
    text: "автозакрытие выключено флагом — включить <code>WB_DBS_AUTO_RECEIVE</code> и <code>WB_DBS_MUTATIONS_ENABLED</code> на TG",
  },
  test_order: { marker: "action", text: "тестовый заказ — закрытие не выполняется" },
  no_secret: { marker: "urgent", text: "код доставки не сохранился — ввести его вручную в консоли DBS" },
  already_closed: { marker: "action", text: "заказ уже закрыт на WB — проверить кабинет" },
  too_many_attempts: {
    marker: "urgent",
    text: "WB отклонил код на всех попытках — <b>закрыть доставку вручную в кабинете WB</b>, гейт покупателю ещё не ушёл",
  },
  wb_not_in_delivery: {
    marker: "action",
    text: "WB ещё не перевёл заказ в доставку — закрытие повторится само на следующем цикле",
  },
  wb_rejected: {
    marker: "urgent",
    text: "WB отклонил код — повторим ещё несколько раз с паузой; гейт покупателю не уйдёт, пока доставка не закрыта",
  },
  wb_unknown: {
    marker: "urgent",
    text: "<b>исход неизвестен — сверить кабинет WB</b>, повторять вслепую нельзя",
  },
};

export function notifyDbsCodeCaptured(wbOrderId: string, skip: AutoReceiveSkip = null) {
  if (!skip) {
    broadcast({
      marker: "progress",
      zone: "DBS",
      title: "код доставки получен",
      lines: [wbOrderRef(wbOrderId)],
      next: "закрываю доставку на WB и отправляю гейт",
    });
    return;
  }
  const reason = SKIP_REASON[skip];
  broadcast({
    marker: reason.marker,
    zone: "DBS",
    title: "код получен, но доставка не закрыта",
    lines: [wbOrderRef(wbOrderId)],
    next: reason.text,
  });
}

export function notifyDbsAutoReceiveFailed(wbOrderId: string, outcomeUnknown: boolean, providerCode?: string) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "WB не принял код доставки",
    lines: [wbOrderRef(wbOrderId, [providerCode ? `ответ WB: <code>${escapeHtml(providerCode)}</code>` : null])],
    next: outcomeUnknown
      ? "<b>сверить кабинет WB перед повтором</b> — исход неизвестен, повторять вслепую нельзя"
      // Гейт больше не уходит вперёд закрытия: покупателю ничего не обещано, и
      // он получит свой код сам, как только доставка закроется.
      : "повторим с паузой; если не пройдёт — <b>закрыть доставку вручную в кабинете WB</b>. Гейт покупателю не отправлен",
  });
}

/** Код отклонён на всех попытках: дальше без покупателя или без человека не
 * обойтись. Отдельным сообщением, потому что живая карточка не звенит. */
export function notifyDbsCodeRejected(wbOrderId: string, askedBuyer: boolean) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "код доставки не подошёл",
    lines: [wbOrderRef(wbOrderId)],
    next: askedBuyer
      ? "покупателя попросили прислать код заново — гейт придержан до закрытия доставки"
      : "<b>разобраться вручную</b>: просить код заново больше не будем, покупатель без выдачи",
  });
}

/** WB даёт около часа на закрытие доставки с момента прихода кода. Пропущенное
 * окно не отыгрывается, поэтому это единственное сообщение, которое кричит. */
export function notifyDbsDeliveryStuck(wbOrderId: string, supplierStatus: string, codeReceivedAt: Date) {
  const deadline = new Date(codeReceivedAt.getTime() + 60 * 60_000);
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "доставка не закрыта, окно WB истекает",
    lines: [
      wbOrderRef(wbOrderId, [`WB держит статус «${escapeHtml(supplierStatus)}»`]),
      `Код у нас с ${mskTime(codeReceivedAt)} МСК, окно примерно до <b>${mskTime(deadline)}</b> МСК`,
    ],
    next: "<b>кабинет WB → «Передать в доставку»</b>, затем закрыть заказ — или сделать это из консоли DBS",
  });
}

/** Э7: покупатель получил ссылку и не открыл её даже через сутки. Деньги
 * приняты, товар не выдан — дальше это работа человека, а не бота. */
export function notifyDbsGateNotOpened(wbOrderId: string, activationCode: string, denomination: number | null) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель не открыл свой код",
    lines: [
      wbOrderRef(wbOrderId, [`код <code>${escapeHtml(activationCode)}</code>`, denomLine(denomination)]),
      "Два напоминания в чат WB отправлены, ответа нет",
    ],
    next: "написать покупателю лично или открыть выкуп вручную из консоли DBS",
  });
}

/** Э2: покупатель прислал в бота код доставки WB позже трёхчасового окна
 * автопривязки. Сам бот его не привязывает — по решению владельца это делает
 * человек, и вот его пинг. */
export function notifyDbsBuyerFoundLate(
  wbOrderId: string,
  activationCode: string | null,
  who: string,
  hoursAgo: number,
) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель нашёлся сам, нужна привязка",
    lines: [
      wbOrderRef(wbOrderId, [activationCode ? `код <code>${escapeHtml(activationCode)}</code>` : null]),
      `Прислал свой код доставки в бота: ${who} (заказ получен ${hoursAgo} ч назад)`,
    ],
    next: "консоль DBS → «Привязать покупателя» — окно автопривязки в 3 часа уже прошло",
  });
}

/** Э2: заказ на выкуп открыт вручную и висит на служебном аккаунте. */
export function notifyDbsBuyerUnlinked(wbOrderId: string, activationCode: string) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "выкуп открыт, но покупатель не привязан",
    lines: [wbOrderRef(wbOrderId, [`код <code>${escapeHtml(activationCode)}</code>`])],
    next: "покупатель не получит уведомлений — привязать его в консоли DBS, когда он напишет",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Живая карточка заказа (Э5-B)
// ─────────────────────────────────────────────────────────────────────────────

/** Одна карточка на DBS-заказ вместо четырёх-пяти отдельных сообщений.
 *
 * Сверху текущее состояние, снизу свёрнутая история этапов. Десять заказов в
 * день дают десять карточек вместо полусотни сообщений — а именно объём и
 * делал очередь нечитаемой.
 *
 * `messageIds` хранится на заказе как `{ "<adminTgId>": <messageId> }`; если
 * Telegram отказался редактировать (сообщение слишком старое или текст не
 * изменился), карточка просто отправляется заново. */
export type DbsCardState = {
  wbOrderId: string;
  buyerName: string | null;
  denomination: number | null;
  priceKopecks: number | null;
  activationCode: string | null;
  marker: "progress" | "waiting" | "action" | "urgent" | "done" | "cancelled";
  title: string;
  next: string | null;
  /** Уже пройденные этапы, в порядке появления: `["22:48 заказ принят", …]`. */
  timeline: string[];
};

export function renderDbsCard(state: DbsCardState): string {
  const head = formatAdminNotice({
    marker: state.marker,
    zone: "DBS",
    title: state.title,
    lines: [
      wbOrderRef(state.wbOrderId, [
        denomLine(state.denomination, state.priceKopecks),
        state.buyerName ? escapeHtml(state.buyerName) : null,
      ]),
      state.activationCode ? `Код гейта: <code>${escapeHtml(state.activationCode)}</code>` : null,
    ],
    next: state.next,
  });
  if (!state.timeline.length) return head;
  const rows = state.timeline.map((row, index) => {
    const glyph = index === state.timeline.length - 1 ? "└" : "├";
    return `<code>${glyph}</code> ${escapeHtml(row)}`;
  });
  return `${head}\n\n${rows.join("\n")}`;
}

/** Пишет или обновляет карточку у каждого админа.
 * Возвращает новую карту `{ adminId: messageId }` для сохранения на заказе.
 *
 * Если Telegram отказался редактировать — сообщение действительно исчезло —
 * старая карточка удаляется перед отправкой новой. Иначе в чате копится хвост
 * из устаревших состояний одного и того же заказа: ровно то, что владелец
 * увидел 20.08 (три карточки по заказу 5536525331 подряд). */
export async function pushDbsCard(
  state: DbsCardState,
  existing: Record<string, number> | null,
): Promise<Record<string, number>> {
  if (!ADMIN_IDS.length) return existing ?? {};
  const text = renderDbsCard(state);
  const next: Record<string, number> = { ...(existing ?? {}) };
  await Promise.allSettled(ADMIN_IDS.map(async (id) => {
    const known = next[id];
    if (known) {
      if (await tgEdit(id, known, text, { parse_mode: "HTML" })) return;
      await tgDelete(id, known);
      delete next[id];
    }
    const messageId = tgMessageId(await tgSend(id, text, { parse_mode: "HTML" }));
    if (messageId !== null) next[id] = messageId;
  }));
  return next;
}
