import { tgSend, tgEdit, tgDelete, tgMessageId, escapeHtml } from "./notify";
import {
  denomLine,
  formatAdminNotice,
  mskTime,
  orderRef,
  type AdminNotice,
} from "./notify-format";
import type { AutoReceiveSkip } from "./wb-delivery-sync";

const ADMIN_IDS: string[] = [...new Set(
  (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)];

/**
 * Всё, что нужно сообщению, чтобы выглядеть частью того же заказа, что и живая
 * карточка: ключи для шапки и id самой карточки у каждого админа — корень ветки.
 *
 * Раньше уведомления знали только `wbOrderId`, поэтому карточка входа на сайт
 * (её ключ — код гейта) и сообщения DBS (их ключ — номер WB) не пересекались
 * ни одним полем.
 */
export type DbsRef = {
  wbOrderId: string;
  code?: string | null;
  denomination?: number | null;
  priceKopecks?: number | null;
  buyerName?: string | null;
  /** `{ "<adminTgId>": <messageId> }` живой карточки заказа. */
  cardMessages?: Record<string, number> | null;
};

/**
 * Сообщение о заказе уходит ответом на его живую карточку: Telegram рисует
 * цитату сверху, и три сообщения об одном заказе перестают читаться как три
 * разных дела, а тап по цитате прыгает на карточку.
 *
 * `allow_sending_without_reply` обязателен: карточку могли удалить или
 * переслать заново (`pushDbsCard` так и делает, когда Telegram отказался
 * редактировать), и на исчезнувший корень Telegram ответил бы отказом —
 * уведомление о деньгах не имеет права потеряться из-за оформления.
 */
function threadTo(ref: DbsRef | null | undefined, adminId: string): Record<string, unknown> {
  const rootId = ref?.cardMessages?.[adminId];
  return rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {};
}

/** Шапка заказа для сообщения — тот же формат, что и в живой карточке. */
function refLine(ref: DbsRef, extra?: Array<string | null | undefined | false>): string {
  return orderRef(ref, extra);
}

function broadcast(notice: AdminNotice, ref?: DbsRef | null) {
  if (!ADMIN_IDS.length) return;
  const text = formatAdminNotice(notice);
  void Promise.allSettled(ADMIN_IDS.map((id) =>
    tgSend(id, text, { parse_mode: "HTML", ...threadTo(ref, id) })));
}

// Отдельных сообщений на «заказ принят», «ушёл автозапрос», «доставка закрыта»
// и «гейт отправлен» больше нет: это ровно те четыре шага, которые складывались
// в кашу из пяти сообщений на заказ. Все они видны в живой карточке
// (`pushDbsCard`), которая переписывает саму себя. Отдельным сообщением уходит
// только то, что требует человека — редактирование в Telegram не даёт звука.

export function notifyDbsBuyerMessage(ref: DbsRef, textPreview: string) {
  const preview = textPreview.length > 120 ? textPreview.slice(0, 117) + "…" : textPreview;
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "сообщение покупателя",
    lines: [refLine(ref), `<i>${escapeHtml(preview)}</i>`],
    next: "ответить из консоли DBS или из кабинета WB",
  }, ref);
}

/** A WB cancellation is never routine: the buyer's money went back, and
 * whatever we opened on the back of that order has to stop. */
export function notifyDbsOrderCancelled(
  ref: DbsRef,
  wbStatus: string,
  internalStatus: string | null,
  outcome: "rejected" | "needs_human" | "no_internal_order",
) {
  const activationCode = ref.code ?? null;
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
    lines: [refLine(ref, [`<i>${escapeHtml(wbStatus)}</i>`])],
    next,
  }, ref);
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
    text: "WB отклонял код все 6 часов расписания — <b>закрыть доставку вручную в кабинете WB</b>, гейт покупателю ещё не ушёл",
  },
  // Запасной текст: обычный путь для этого пропуска — ветка с самим кодом ниже.
  order_too_old: {
    marker: "urgent",
    text: "заказ старше четырёх часов — <b>решение за оператором</b>: закрыть доставку в кабинете WB или отклонить",
  },
  wb_not_in_delivery: {
    marker: "action",
    text: "WB ещё не перевёл заказ в доставку — закрытие повторится само на следующем цикле",
  },
  wb_rejected: {
    marker: "urgent",
    text: "WB отклонил код — повторяем по расписанию до 6 ч (1–2–3–5 мин, дальше 10–20–30 мин и час); гейт покупателю не уйдёт, пока доставка не закрыта",
  },
  wb_unknown: {
    marker: "urgent",
    text: "<b>исход неизвестен — сверить кабинет WB</b>, повторять вслепую нельзя",
  },
};

/** Заказ старше окна автозакрытия: бот не тронул доставку и отдаёт решение
 * человеку. Код доставки идёт прямо в сообщении — без него оператор не закроет
 * заказ в кабинете WB, а идти за ним в консоль в пределах часового окна WB
 * значит терять то самое время, ради которого уведомление и существует. */
export type HeldDeliveryCode = { deliveryCode: string; ageHours: number };

/** «121 ч» заставляет оператора делить в уме под часовым окном WB. */
function ageLabel(hours: number): string {
  return hours < 48 ? `${hours} ч` : `${Math.round(hours / 24)} сут`;
}

export function notifyDbsCodeCaptured(
  ref: DbsRef,
  skip: AutoReceiveSkip = null,
  held?: HeldDeliveryCode,
) {
  if (skip === "order_too_old" && held) {
    broadcast({
      marker: "urgent",
      zone: "DBS",
      title: "код доставки получен — решение за вами",
      lines: [
        refLine(ref),
        `Код доставки: <code>${escapeHtml(held.deliveryCode)}</code>`,
        `Заказ оформлен <b>${ageLabel(held.ageHours)}</b> назад — автозакрытие не применяется`,
      ],
      next: "закрыть доставку этим кодом (кабинет WB или консоль DBS) — или отклонить. " +
        "Гейт покупателю уйдёт сам, как только доставка закроется",
    }, ref);
    return;
  }
  if (!skip) {
    broadcast({
      marker: "progress",
      zone: "DBS",
      title: "код доставки получен",
      lines: [refLine(ref)],
      next: "закрываю доставку на WB и отправляю гейт",
    }, ref);
    return;
  }
  const reason = SKIP_REASON[skip];
  broadcast({
    marker: reason.marker,
    zone: "DBS",
    title: "код получен, но доставка не закрыта",
    lines: [refLine(ref)],
    next: reason.text,
  }, ref);
}

export function notifyDbsAutoReceiveFailed(
  ref: DbsRef,
  outcomeUnknown: boolean,
  providerCode?: string,
  nextTryAt?: Date | null,
) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "WB не принял код доставки",
    lines: [refLine(ref, [providerCode ? `ответ WB: <code>${escapeHtml(providerCode)}</code>` : null])],
    next: outcomeUnknown
      ? "<b>сверить кабинет WB перед повтором</b> — исход неизвестен, повторять вслепую нельзя"
      // Гейт больше не уходит вперёд закрытия: покупателю ничего не обещано, и
      // он получит свой код сам, как только доставка закроется. Срок следующей
      // попытки — чтобы «повторим» не читалось как «когда-нибудь»: расписание
      // тянется до шести часов, и вмешиваться руками раньше времени не нужно.
      : `повторяем по расписанию${nextTryAt ? `, следующая попытка ~${mskTime(nextTryAt)} МСК` : ""}`
        + " — до 6 ч с прихода кода. Гейт покупателю не отправлен;"
        + " закрыть доставку вручную в кабинете WB можно в любой момент, гейт уйдёт сам",
  }, ref);
}

/** Середина расписания: код всё ещё у нас, повторы идут, покупателя попросили
 * перепроверить цифры. Не «urgent» — вмешательство здесь не требуется, но знать
 * о том, что покупателю ушло сообщение, оператор обязан. */
export function notifyDbsCodeRecheck(ref: DbsRef, askedBuyer: boolean, nextTryAt: Date | null) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "WB тянет с кодом — продолжаем повторы",
    lines: [
      refLine(ref),
      nextTryAt ? `Следующая попытка ~<b>${mskTime(nextTryAt)}</b> МСК` : "Расписание повторов заканчивается",
    ],
    next: askedBuyer
      ? "покупателя попросили перепроверить код; код остаётся у нас, повторы идут сами"
      : "<b>сообщение покупателю не ушло</b> — проверить чат WB; повторы идут сами",
  }, ref);
}

/** Код отклонён на всех попытках: дальше без покупателя или без человека не
 * обойтись. Отдельным сообщением, потому что живая карточка не звенит. */
export function notifyDbsCodeRejected(ref: DbsRef, askedBuyer: boolean) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "код доставки не подошёл",
    lines: [refLine(ref)],
    next: askedBuyer
      ? "покупателя попросили прислать код заново — гейт придержан до закрытия доставки"
      : "<b>разобраться вручную</b>: просить код заново больше не будем, покупатель без выдачи",
  }, ref);
}

/** WB даёт около часа на закрытие доставки с момента прихода кода. Пропущенное
 * окно не отыгрывается, поэтому это единственное сообщение, которое кричит. */
export function notifyDbsDeliveryStuck(ref: DbsRef, supplierStatus: string, codeReceivedAt: Date) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "доставка не закрыта двадцать минут",
    lines: [
      refLine(ref, [`WB держит статус «${escapeHtml(supplierStatus)}»`]),
      // Про «окно примерно до +1 ч» здесь больше не пишем: 22.08 заказ
      // 5550714937 закрылся тем же кодом через 3 ч 56 мин, и ложный дедлайн
      // толкал закрывать наугад там, где достаточно подождать.
      `Код у нас с <b>${mskTime(codeReceivedAt)}</b> МСК, повторы идут сами до 6 ч`,
    ],
    next: "ждать повторов не обязательно: <b>кабинет WB → «Передать в доставку»</b>, затем закрыть заказ"
      + " — или сделать это из консоли DBS. Гейт покупателю уйдёт сам, как только доставка закроется",
  }, ref);
}

/** Э7: покупатель получил ссылку и не открыл её даже через сутки. Деньги
 * приняты, товар не выдан — дальше это работа человека, а не бота. */
export function notifyDbsGateNotOpened(ref: DbsRef) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель не открыл свой код",
    lines: [refLine(ref), "Два напоминания в чат WB отправлены, ответа нет"],
    next: "написать покупателю лично или открыть выкуп вручную из консоли DBS",
  }, ref);
}

/** Э2: покупатель прислал в бота код доставки WB позже трёхчасового окна
 * автопривязки. Сам бот его не привязывает — по решению владельца это делает
 * человек, и вот его пинг. */
export function notifyDbsBuyerFoundLate(ref: DbsRef, who: string, hoursAgo: number) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель нашёлся сам, нужна привязка",
    lines: [
      refLine(ref),
      `Прислал свой код доставки в бота: ${who} (заказ получен ${hoursAgo} ч назад)`,
    ],
    next: "консоль DBS → «Привязать покупателя» — окно автопривязки в 3 часа уже прошло",
  }, ref);
}

/** Э2: заказ на выкуп открыт вручную и висит на служебном аккаунте. */
export function notifyDbsBuyerUnlinked(ref: DbsRef) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "выкуп открыт, но покупатель не привязан",
    lines: [refLine(ref)],
    next: "покупатель не получит уведомлений — привязать его в консоли DBS, когда он напишет",
  }, ref);
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
    // Шапка карточки и шапка любого сообщения о заказе — одна и та же строка:
    // код гейта переехал в неё из отдельной строки «Код гейта: …», чтобы у
    // карточки и у ответов в ветке совпадал каждый ключ, а не только номер WB.
    lines: [
      orderRef({
        wbOrderId: state.wbOrderId,
        code: state.activationCode,
        denomination: state.denomination,
        priceKopecks: state.priceKopecks,
        buyerName: state.buyerName,
      }),
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
