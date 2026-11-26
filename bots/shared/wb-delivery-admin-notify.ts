import { tgSend, tgEdit, tgDelete, tgMessageId, escapeHtml } from "./notify";
import {
  formatAdminNotice,
  mskTime,
  orderRef,
  type AdminNotice,
  type NoticeMarker,
} from "./notify-format";
import type { AutoReceiveSkip } from "./wb-delivery-sync";
import { adminTargets, adminTargetsForNotice, replyToRootFor, twaStartappUrl } from "./admin-route";
import { noteAdminReply, noteBuyerMessage } from "./buyer-conversation-notice";
import { rememberWbReplyMessage, wbReplyMarkup } from "./wb-reply-buttons";
import { dbsChatMarkup, loadDbsChatStatus, type DbsChatStatus, type DbsChatTone } from "./dbs-chat-status";

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
  const text = formatAdminNotice(notice);
  // Провал доставки обязан быть слышен: раньше ответ Telegram не читался, и
  // потерянное уведомление не оставляло следа (разбор 27.09).
  void adminTargetsForNotice(notice).then((targets) => Promise.allSettled(targets.map(async (t) => {
    // 📱 У каждого уведа о заказе — «Открыть в TWA» (16.11.2026).
    const twaUrl = twaStartappUrl(ref?.code);
    const markup = twaUrl ? { reply_markup: { inline_keyboard: [[{ text: "📱 Открыть в TWA", url: twaUrl }]] } } : {};
    const reply = await tgSend(t.chatId, text, { parse_mode: "HTML", ...markup, ...replyToRootFor(ref?.cardMessages, t), ...t.extra });
    if (reply?.ok !== true) {
      console.warn(`[dbs-notify] «${notice.title}» не доставлено chat_id=${t.chatId}: ${JSON.stringify(reply).slice(0, 200)}`);
    }
  }).map((p) => p.catch((err) =>
    console.warn(`[dbs-notify] «${notice.title}» упало: ${err instanceof Error ? err.message : err}`)))));
}

// Отдельных сообщений на «заказ принят», «ушёл автозапрос», «доставка закрыта»
// и «гейт отправлен» больше нет: это ровно те четыре шага, которые складывались
// в кашу из пяти сообщений на заказ. Все они видны в живой карточке
// (`pushDbsCard`), которая переписывает саму себя. Отдельным сообщением уходит
// только то, что требует человека — редактирование в Telegram не даёт звука.

/** Кружок «покупатель пишет» = состояние заказа (17.11.2026, владелец). */
const TONE_MARKER: Record<DbsChatTone, NoticeMarker> = {
  idle: "idle", work: "waiting", done: "done", stop: "urgent", closed: "cancelled",
};

/** «📦 HZ8AJ72 · 1 000 R$ · ждёт выкупа 23 ч». Номер WB — только пока нет кода,
 *  имя с WB — в строке «кто», здесь оно лишнее. */
function dbsOrderLine(ref: DbsRef, status: Pick<DbsChatStatus, "state">): string {
  return `📦 ${orderRef({ wbOrderId: ref.code ? null : ref.wbOrderId, code: ref.code, denomination: ref.denomination }, [status.state])}`;
}

/**
 * Сообщение покупателя — один увед на разговор (15.11.2026,
 * `buyer-conversation-notice.ts`): следующие сообщения в течение 10 минут
 * дописываются в него правкой без звука, «спасибо»/«ок» нового уведа не
 * открывают. `who` — кто это у нас (`buyer-identity.ts`), берём первую строку.
 */
export function notifyDbsBuyerMessage(ref: DbsRef, textPreview: string, who: string[] = []) {
  const notice = { marker: "action" as const, zone: "DBS" as const };
  /* 16.11.2026 (владелец): вместо четырёх одинаковых кнопок — статус «что уже
     ушло покупателю» и кнопки по этапу (`dbs-chat-status.ts`). Статус не
     прочитался — увед уходит с прежними кнопками, без строк статуса. */
  void Promise.all([
    adminTargetsForNotice(notice),
    import("./db").then(({ db }) => loadDbsChatStatus(db as never, ref.wbOrderId)).catch(() => null),
  ]).then(([targets, status]) => {
  const markup = { reply_markup: status ? dbsChatMarkup(ref.wbOrderId, status) : wbReplyMarkup(ref.wbOrderId) };
  return noteBuyerMessage({
    status: status?.lines ?? null,
    marker: status ? TONE_MARKER[status.tone] : null,
    order: status ? dbsOrderLine(ref, status) : null,
    conversationKey: `dbs:${ref.wbOrderId}`,
    head: refLine(ref),
    who: who[0] ?? null,
    text: textPreview,
    targets: targets.map((t) => ({ key: t.key, chatId: t.chatId, extra: { parse_mode: "HTML", ...markup, ...replyToRootFor(ref.cardMessages, t), ...t.extra } })),
    io: {
      send: async (target, text) => {
        const messageId = tgMessageId(await tgSend(target.chatId, text, target.extra));
        if (messageId !== null) {
          void import("./db")
            .then(({ db }) => rememberWbReplyMessage(db as never, target.chatId, messageId, ref.wbOrderId))
            .catch(() => undefined);
        }
        return messageId;
      },
      edit: (target, messageId, text) => tgEdit(target.chatId, messageId, text, { parse_mode: "HTML", ...markup }),
      remove: (target, messageId) => tgDelete(target.chatId, messageId),
    },
  });
  }).catch((err) => console.warn(`[dbs-notify] сообщение покупателя: ${err instanceof Error ? err.message : err}`));
}

/** Админ ответил в чат WB из Telegram — строкой «↩️» в увед разговора.
 *  `false` — разговора нет в памяти, подтверждать отдельным сообщением. */
export function noteDbsAdminReply(wbOrderId: string, actor: string, what: string): Promise<boolean> {
  return noteAdminReply(`dbs:${wbOrderId}`, actor, what).catch(() => false);
}

/** ИИ в чате WB передал вопрос человеку — с сутью и готовым черновиком. */
export function notifyDbsAiEscalation(ref: DbsRef, input: { text: string; summary: string; draft: string; category: string }, who: string[] = []) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: `🤖 ИИ передал вам · ${input.category}`,
    lines: [
      refLine(ref),
      ...who.map((line) => escapeHtml(line)),
      `<i>${escapeHtml(input.text.slice(0, 600))}</i>`,
      input.summary ? `🧾 ${escapeHtml(input.summary)}` : null,
      input.draft ? `✍️ Черновик: ${escapeHtml(input.draft.slice(0, 1200))}` : null,
    ],
    next: "ответить из консоли DBS или из кабинета WB",
  }, ref);
}

/** Новые находки сверки денег WB с выдачей — одним сообщением на проход. */
export function notifyWbReconcile(lines: string[], total: number) {
  if (lines.length === 0) return;
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: `сверка WB: ${total} ${total === 1 ? "расхождение" : "расхождений"}`,
    lines: [...lines.slice(0, 10), total > 10 ? `…и ещё ${total - 10} — в «Рисках»` : null],
    next: "разобрать в разделе «Риски»",
  });
}

/** Доставка закрыта, а код активации так и не выпущен: покупатель заплатил и
 * ничего не получил. Чаще всего — нет чата WB, куда отправить ссылку. */
export function notifyDbsGateNotIssued(ref: DbsRef) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "заказ закрыт, а код не выдан",
    lines: [
      refLine(ref),
      "Доставка закрыта, а чата покупателя нет — ссылку не отправить",
    ],
    next: "выдать код в консоли DBS и отправить ссылку из кабинета WB",
  }, ref);
}

/** Гейт ушёл дважды, а в чате WB его так и нет: покупатель без кода. */
export function notifyDbsGateUndelivered(ref: DbsRef, code: string | null) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "код не дошёл до покупателя",
    lines: [
      refLine(ref),
      "WB принял отправку дважды, но в чате сообщения нет",
      code ? `Код активации: <code>${escapeHtml(code)}</code>` : null,
    ],
    next: "отправить ссылку с кодом из кабинета WB руками",
  }, ref);
}

/**
 * Покупатель открыл заявку на возврат.
 *
 * Это не «отмена»: деньги ещё у нас, заказ у WB по-прежнему `receive/sold`, и
 * никакой другой сигнал о споре к нам не приходит. Зато текст заявки почти
 * всегда — диагноз продукту («не знаем, как создать геймпасс»), поэтому он
 * идёт в сообщение целиком, а не прячется за ссылкой в кабинет.
 */
/** Что автозащита сделала с нашим заказом, увидев заявку (24.10.2026). */
export type ClaimHoldOutcome =
  | "held"
  | "held_code"
  | "held_in_progress"
  | "already_delivered"
  | "flagged"
  | "failed";

const CLAIM_HOLD_LINE: Record<ClaimHoldOutcome, string> = {
  held: "❄️ Заказ заморожен — выкуп заблокирован",
  held_code: "❄️ Код заморожен — заказ, если появится, выкупаться не будет",
  held_in_progress: "❄️ Заказ заморожен, но <b>выкуп уже шёл</b> — проверить, не потрачены ли робуксы",
  already_delivered: "⚠️ Заказ <b>уже выкуплен</b> — робуксы потрачены, спор решать вручную",
  flagged: "↩ Пометка «Возврат открыт» — заказ остаётся в очереди; договоритесь и нажмите «✓ Договорились»",
  failed: "⚠️ Заморозка не встала — выкуп всё равно заблокирован гардом, но проверить карточку",
};

function claimHoldLine(outcome: ClaimHoldOutcome | undefined): string | null {
  return outcome ? CLAIM_HOLD_LINE[outcome] : null;
}

export function notifyWbBuyerClaim(input: {
  wbOrderId: string;
  code: string | null;
  denomination: number | null;
  buyerName: string | null;
  reason: string | null;
  hold?: ClaimHoldOutcome;
}): Promise<void> {
  const ref: DbsRef = {
    wbOrderId: input.wbOrderId,
    code: input.code,
    denomination: input.denomination,
    buyerName: input.buyerName,
  };
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "покупатель открыл возврат на WB",
    lines: [
      refLine(ref),
      input.reason ? `💬 <i>${escapeHtml(input.reason)}</i>` : null,
      claimHoldLine(input.hold),
    ],
    next: "ответить в чате WB и решить заявку в кабинете",
  }, ref);
  return Promise.resolve();
}

/**
 * Покупатель поставил 1–3★ ещё до выкупа — гейт заморозил заказ (30.10.2026).
 *
 * Раньше такая заморозка была молчаливой, а гейт к тому же не видел заказы без
 * пасса: W3QKRAA написал «★1, не смог создать геймпасс, игнорят», и узнали мы о
 * нём только из заявки на возврат через 40 минут. Совпадение — по имени и
 * товару, имя на WB не уникально, поэтому в тексте прямо сказано, как снять.
 */
export function notifyBuyoutGateBadReview(input: {
  wbOrderId: string | null;
  code: string;
  denomination: number | null;
  buyerName: string | null;
  cardMessages?: Record<string, number> | null;
  /** Статус нашего заказа (`null` — покупатель ещё не вводил код). */
  internalStatus: string | null;
  stars: number;
  text: string | null;
  reviewedAt: Date | null;
  /** Гейт уже отпускал этот заказ по исправленному отзыву, а покупатель вернул плохую оценку. */
  refrozen?: boolean;
  /** Кто это у нас в TG/VK (`buyer-identity.ts`). */
  who?: string[];
}): void {
  const ref: DbsRef = {
    wbOrderId: input.wbOrderId ?? "",
    code: input.code,
    denomination: input.denomination,
    buyerName: input.buyerName,
    cardMessages: input.cardMessages ?? null,
  };
  const text = clipReview(input.text);
  const when = reviewWhen(input.reviewedAt);
  const outcome: ClaimHoldOutcome = input.internalStatus === null
    ? "held_code"
    : input.internalStatus === "IN_PROGRESS" ? "held_in_progress" : "held";
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: input.refrozen ? "отзыв снова плохой — заказ заморожен" : "плохой отзыв до выкупа",
    lines: [
      refLine(ref),
      ...(input.who ?? []).map((line) => escapeHtml(line)),
      `${starsLine(input.stars)}${when ? ` · ${when}` : ""}`,
      text ? `💬 <i>${escapeHtml(text)}</i>` : null,
      claimHoldLine(outcome),
    ],
    next: "совпадение по имени — если это не он, снять заморозку в карточке",
  }, ref);
}

function starsLine(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function clipReview(text: string | null): string | null {
  return text && text.length > 600 ? text.slice(0, 597) + "…" : text;
}

function reviewWhen(at: Date | null): string | null {
  if (!at || !Number.isFinite(at.getTime())) return null;
  const day = at.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" });
  return `${day} ${mskTime(at)}`;
}


/**
 * Плохой отзыв удалён (12.11.2026). `released` — гейт снял свой замок сам;
 * иначе заказ заморожен руками или заявкой, и снимать замок решает человек.
 */
export function notifyBuyoutGateReviewDeleted(input: {
  wbOrderId: string | null;
  code: string;
  denomination: number | null;
  buyerName: string | null;
  cardMessages?: Record<string, number> | null;
  internalStatus: string | null;
  stars: number | null;
  text: string | null;
  reviewedAt: Date | null;
  released: boolean;
}): void {
  const ref: DbsRef = {
    wbOrderId: input.wbOrderId ?? "",
    code: input.code,
    denomination: input.denomination,
    buyerName: input.buyerName,
    cardMessages: input.cardMessages ?? null,
  };
  const when = reviewWhen(input.reviewedAt);
  const text = clipReview(input.text);
  broadcast({
    marker: input.released ? "progress" : "action",
    zone: "DBS",
    title: input.released ? "плохой отзыв удалён — заказ разморожен" : "плохой отзыв удалён — заказ всё ещё заморожен",
    lines: [
      refLine(ref),
      `🗑 ${input.stars ? starsLine(input.stars) : "отзыв"}${when ? ` · ${when}` : ""} — у WB его больше нет`,
      text ? `💬 <i>${escapeHtml(text)}</i>` : null,
      input.released
        ? "🔓 Заморозку гейта снял сам гейт, на заказе пометка «🗑 Был плохой отзыв, удалён»"
        : "❄️ Заморозку ставил не гейт — снимать или нет, решает человек",
    ],
    next: input.released
      ? "выкупать можно; перед выкупом бот покажет пометку"
      : "проверить карточку и решить, размораживать ли",
  }, ref);
}

/** Чем кончилась отмена для НАШЕЙ стороны заказа.
 *
 * `already_delivered` появился 12.09.2026: до него исход считался только когда
 * внутренний статус не `COMPLETED` и не `REJECTED`, поэтому отмена уже
 * выкупленного заказа приходила с текстом «гейт выдан, но не активирован» и
 * спокойным значком. Самый дорогой случай выглядел как самый безобидный. */
export type WbCancellationOutcome =
  | "rejected"
  | "already_rejected"
  | "needs_human"
  | "already_delivered"
  | "no_internal_order";

/** Детали, которые меняют текст, но не исход. */
type WbCancellationFacts = {
  /** Код аннулирован — предъявить его больше нельзя. */
  revoked?: boolean;
  /** Номинал выкупленного заказа: цена этой отмены в робуксах. */
  amount?: number | null;
  completedAt?: Date | null;
};

/** A WB cancellation is never routine: the buyer's money went back, and
 * whatever we opened on the back of that order has to stop. */
export function notifyDbsOrderCancelled(
  ref: DbsRef,
  wbStatus: string,
  internalStatus: string | null,
  outcome: WbCancellationOutcome,
  facts: WbCancellationFacts = {},
) {
  const activationCode = ref.code ?? null;
  const code = activationCode ? `<code>${escapeHtml(activationCode)}</code>` : "—";
  /* Аннулирование — единственная часть отмены, которую человек мог бы забыть
     сделать руками, поэтому оно названо прямо, а не спрятано в «ничего не
     нужно». */
  const revokedTail = facts.revoked ? ` Код ${code} аннулирован — предъявить его больше нельзя.` : "";
  const next = (() => {
    switch (outcome) {
      case "already_delivered": {
        const spent = facts.amount ? ` (${facts.amount} R$` + (facts.completedAt ? `, выкуп ${mskTime(facts.completedAt)}` : "") + ")" : "";
        return `<b>робуксы уже выданы</b>${spent} — деньги вернулись покупателю.`
          + " Оспорить заявку в кабинете WB: выдача подтверждена";
      }
      case "rejected":
        return `выкуп ${code} закрыт автоматически (был ${escapeHtml(internalStatus ?? "—")}) — делать ничего не нужно.${revokedTail}`;
      case "already_rejected":
        return `выкуп ${code} был закрыт и раньше — делать ничего не нужно.${revokedTail}`;
      case "needs_human":
        return `<b>разобрать вручную во вкладке «Заказы»</b>: выкуп ${code} в статусе <b>${escapeHtml(internalStatus ?? "—")}</b>, робуксы могли уйти`;
      default:
        if (!activationCode) return "гейт не выпускался — делать ничего не нужно";
        return `гейт ${code} выдан и не активирован.${revokedTail || " <b>Код остался рабочим — аннулируйте его в консоли DBS.</b>"}`;
    }
  })();
  broadcast({
    marker: outcome === "needs_human" || outcome === "already_delivered" ? "urgent" : "cancelled",
    zone: "DBS",
    title: "заказ отменён на WB",
    lines: [refLine(ref, [`<i>${escapeHtml(wbStatus)}</i>`])],
    next,
  }, ref);
}

/**
 * Заявка на возврат решена.
 *
 * Про открытие заявки мы узнали в прошлой волне, а про исход — ниоткуда:
 * статус DBS меняется только в момент возврата денег, и до него проходило от
 * полутора суток (`XKFFJUU`) до восьми (`BJUM4MN`). Решение в пользу продавца
 * при этом не меняет НИЧЕГО — и именно поэтому о нём надо сказать: иначе заказ
 * так и лежит «со спором», хотя спора уже нет.
 */
export function notifyWbClaimResolved(input: {
  wbOrderId: string;
  code: string | null;
  denomination: number | null;
  buyerName: string | null;
  refunded: boolean;
}): void {
  const ref: DbsRef = {
    wbOrderId: input.wbOrderId,
    code: input.code,
    denomination: input.denomination,
    buyerName: input.buyerName,
  };
  // 15.11.2026: зовём только когда деньги уходят покупателю.
  if (!input.refunded) return;
  broadcast({
    marker: input.refunded ? "urgent" : "progress",
    zone: "DBS",
    title: input.refunded ? "заявка решена в пользу покупателя" : "заявка на возврат закрыта",
    lines: [refLine(ref)],
    next: input.refunded
      ? "деньги уходят покупателю, отмена придёт следом"
      : "деньги остаются у нас; заказ остаётся замороженным — если покупатель ждёт робуксы, снять заморозку в карточке",
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
    text: "WB отклонял код 6 ч — <b>закрыть доставку вручную</b>",
  },
  // Запасной текст: обычный путь для этого пропуска — ветка с самим кодом ниже.
  order_too_old: {
    marker: "urgent",
    text: "заказ старше 4 ч, есть заявка или просьба об отмене — <b>закрыть доставку вручную</b> или отклонить",
  },
  wb_not_in_delivery: {
    marker: "action",
    text: "WB ещё не перевёл заказ в доставку — закрытие повторится само на следующем цикле",
  },
  wb_rejected: {
    marker: "urgent",
    text: "WB отклонил код — повторяем сами до 6 ч",
  },
  wb_unknown: {
    marker: "urgent",
    text: "<b>исход неизвестен — сверить кабинет WB</b>, повторять вслепую нельзя",
  },
  // Обычный путь — отдельные сообщения режима отмены; это запасной текст.
  cancel_requested: {
    marker: "urgent",
    text: "заказ в режиме отмены — отклонить в кабинете WB кодом из консоли DBS",
  },
  grace: {
    marker: "action",
    text: "пауза 2 минуты перед закрытием — вдруг покупатель следом пишет «отмена»; закроется само",
  },
};

/** Заказ старше окна автозакрытия: бот не тронул доставку и отдаёт решение
 * человеку. Код доставки идёт прямо в сообщении — без него оператор не закроет
 * заказ в кабинете WB, а идти за ним в консоль в пределах часового окна WB
 * значит терять то самое время, ради которого уведомление и существует. */
type HeldDeliveryCode = { deliveryCode: string; ageHours: number };

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
      // 17.11.2026 (владелец): «автозакрытие не применяется», «гейт уйдёт сам»
      // и куда идти закрывать админы знают — осталось только то, что меняется.
      title: "код доставки — закрыть вручную",
      lines: [
        refLine(ref, [`заказу ${ageLabel(held.ageHours)}`]),
        // С 21.11.2026 сюда попадает только заказ с тревожным сигналом.
        "⚠️ есть заявка WB или покупатель просил отмену",
        `🔑 <code>${escapeHtml(held.deliveryCode)}</code>`,
      ],
      next: null,
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
      ? "<b>исход неизвестен — сверить кабинет WB</b>"
      // Гейт больше не уходит вперёд закрытия: покупателю ничего не обещано, и
      // он получит свой код сам, как только доставка закроется. Срок следующей
      // попытки — чтобы «повторим» не читалось как «когда-нибудь»: расписание
      // тянется до шести часов, и вмешиваться руками раньше времени не нужно.
      : `повторяем сами до 6 ч${nextTryAt ? `, следующая ~${mskTime(nextTryAt)}` : ""}`,
  }, ref);
}

/** Середина расписания: код всё ещё у нас, повторы идут, покупателя попросили
 * перепроверить цифры. Не «urgent» — вмешательство здесь не требуется, но знать
 * о том, что покупателю ушло сообщение, оператор обязан. */
export function notifyDbsCodeRecheck(ref: DbsRef, askedBuyer: boolean, nextTryAt: Date | null) {
  // 15.11.2026 (меньше уведов): повторы идут сами и покупателя попросили
  // перепроверить — человеку делать нечего. Зовём, только если расписание
  // кончилось или сообщение покупателю не ушло.
  if (nextTryAt && askedBuyer) return;
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
      ? "покупателя попросили прислать код заново"
      : "<b>разобраться вручную</b>: просить код заново больше не будем, покупатель без выдачи",
  }, ref);
}

/* ── Режим отмены (27.10.2026) ───────────────────────────────────────────── */

function cancelWho(by: string): string {
  return `оператор (${escapeHtml(by)})`;
}

/** Отмена включена. Код доставки, если он уже у нас, — прямо в сообщении:
 * без него отказ в кабинете WB не оформить. */
export function notifyDbsCancelRequested(ref: DbsRef, input: {
  by: string;
  deliveryCode: string | null;
  /** Заказ на выкуп уже выкуплен — робуксы ушли, отмена требует решения. */
  buyoutDone?: boolean;
  askedBuyer: boolean;
}) {
  broadcast({
    marker: input.deliveryCode || input.buyoutDone ? "urgent" : "action",
    zone: "DBS",
    title: "запрошена отмена заказа",
    lines: [
      refLine(ref),
      `Кто: ${cancelWho(input.by)}`,
      input.deliveryCode ? `🔑 <code>${escapeHtml(input.deliveryCode)}</code>` : null,
      input.buyoutDone ? "<b>Выкуп уже сделан — робуксы ушли</b>" : null,
    ].filter((line): line is string => Boolean(line)),
    next: input.deliveryCode
      ? "отклонить заказ в кабинете WB этим кодом"
      : input.askedBuyer
        ? "покупателя попросили прислать код доставки — придёт сюда же, доставку бот НЕ закроет"
        : "<b>сообщение покупателю не ушло</b> — попросить код доставки вручную",
  }, ref);
}

/** Код доставки пришёл, когда отмена уже включена. */
export function notifyDbsCancelCode(ref: DbsRef, deliveryCode: string) {
  broadcast({
    marker: "urgent",
    zone: "DBS",
    title: "код для отмены получен",
    lines: [refLine(ref), `🔑 <code>${escapeHtml(deliveryCode)}</code>`],
    next: "отклонить заказ в кабинете WB этим кодом",
  }, ref);
}

/** Отмену сняли: дальше заказ идёт обычным путём. */

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
      `Код у нас с <b>${mskTime(codeReceivedAt)}</b>, повторы идут сами`,
    ],
    next: "можно не ждать: <b>кабинет WB → «Передать в доставку»</b> → закрыть",
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
    next: "консоль DBS → «Привязать покупателя» — окно автопривязки уже прошло",
  }, ref);
}

/**
 * Покупатель прислал в бота цифры, похожие на код доставки, а такого кода у нас
 * нет: чаще всего он не присылал его и в чат WB, поэтому сопоставить не с чем.
 *
 * Раньше это был тупик — бот отвечал «нет активных заявок», и человек оставался
 * один на один с ботом, который его не знает (F14 остался наполовину не закрыт).
 * Теперь оператор узнаёт о нём сразу и может найти заказ по коду в кабинете WB.
 *
 * Цифры в сообщении намеренно: без них оператору нечего искать, а вся власть
 * этого кода — закрыть доставку того же покупателя, что админы и делают.
 */
const unknownCodeSeen = new Map<string, number>();
export function notifyDbsUnknownDeliveryCode(who: string, digits: string) {
  // 15.11.2026 (меньше уведов): с первого раза бот сам объясняет, что нужен
  // семизначный код из чата WB. Человек нужен, только если тот же покупатель
  // снова прислал незнакомый код доставки в течение суток.
  const now = Date.now();
  for (const [k, at] of unknownCodeSeen) if (now - at > 86_400_000) unknownCodeSeen.delete(k);
  if (!unknownCodeSeen.has(who)) { unknownCodeSeen.set(who, now); return; }
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель в боте прислал незнакомый код доставки",
    lines: [
      `👤 ${escapeHtml(who)}`,
      `🔢 <code>${escapeHtml(digits)}</code> — в базе нет`,
    ],
    next: "найти заказ по коду в кабинете WB и привязать покупателя в консоли DBS",
  });
}

/**
 * Покупатель прислал геймпасс в чат WB, и автоматика собрала им заказ.
 *
 * Требование владельца 07.09.2026: «обязательно нужен увед, что в такой-то
 * заказ поставил такой-то гп айди». Сообщение отдельное от карточки выкупа
 * намеренно — карточка отвечает на вопрос «что купить», а это на вопрос
 * «откуда он взялся и почему заказ вдруг собрался сам».
 */
export function notifyDbsChatGamepassAttached(
  ref: DbsRef,
  info: { wbCode: string; gamepassId: string; nick: string; price: number; amount: number; created?: boolean },
) {
  broadcast({
    marker: "progress",
    zone: "DBS",
    // `created` — заказа по коду не было (покупатель без Telegram и VK): бот
    // создал его сам, как кнопка в консоли DBS (31.10.2026, PXGLH7F).
    title: info.created ? "заказ создан из геймпасса в чате WB" : "геймпасс из чата WB подставлен в заказ",
    lines: [
      // 17.11.2026: код и номинал уже в шапке, «сверили у Roblox» — всегда.
      refLine({ ...ref, code: ref.code ?? info.wbCode, denomination: ref.denomination ?? info.amount }),
      `🎫 <code>${escapeHtml(info.gamepassId)}</code> · <b>${info.price} R$</b> · 🎮 <b>${escapeHtml(info.nick)}</b>`,
    ],
    next: "карточка выкупа придёт следом — выкупить и нажать «ВЫКУПЛЕНО»",
  }, ref);
}

/**
 * В чате нашёлся пасс, но собрать им заказ нельзя.
 *
 * Молчать здесь нельзя: покупатель СВОЮ часть сделал и ждёт: он прислал пасс
 * туда, где с ним до этого разговаривали. Ответить ему может только человек.
 */
export function notifyDbsChatGamepassRejected(
  ref: DbsRef,
  info: { gamepassId: string; reason: string; expectedPrice: number },
) {
  broadcast({
    marker: "action",
    zone: "DBS",
    title: "покупатель прислал геймпасс в чат WB, но он не подошёл",
    lines: [
      refLine(ref),
      `🎫 Pass ID: <code>${escapeHtml(info.gamepassId)}</code>`,
      `❌ ${escapeHtml(info.reason)}`,
      `💰 Нужен пасс за <b>${info.expectedPrice} R$</b>`,
    ],
    next: "ответить покупателю в чате WB",
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
  /**
   * Кто пришёл по гейту: имя в боте/на сайте, ссылка на профиль и «новый ли».
   *
   * Стоит в карточке, а не отдельным сообщением. До 05.09.2026 сайт слал по
   * входу покупателя своё «🆕 Новый пользователь / 👤 Имя / 🆔 VK ID» — без
   * кода, без номера WB и мимо ветки: под аккуратной карточкой DBS висели три
   * строки, которые не с чем было связать (скрин владельца по NGS22UR).
   */
  buyer?: {
    display: string;
    url: string | null;
    channel: string;
    isNew: boolean;
  } | null;
  /**
   * Связанные заказы (12.11.2026): та же покупка WB (`orderUid`) и — подсказкой
   * — отдельная покупка с тем же именем в пределах двух часов. WB не даёт id
   * покупателя, поэтому второе — догадка, а не факт (тёзки бывают).
   */
  related?: string[];
  /**
   * Шкала этапов (15.11.2026, владелец: «3 строки вместо 12»): чат → код →
   * гейт → пасс → выкуп. История целиком — в свёрнутом блоке под карточкой.
   */
  steps?: Array<{ label: string; state: "done" | "current" | "todo" }>;
};

/** «✓ чат · ✓ код · <b>▸ пасс</b> · ○ выкуп» — где заказ сейчас. */
export function dbsStepsLine(steps: NonNullable<DbsCardState["steps"]>): string {
  return steps.map((s) => (s.state === "done" ? `✓ ${s.label}` : s.state === "current" ? `<b>▸ ${s.label}</b>` : `○ ${s.label}`)).join(" · ");
}

/** Кнопка карточки — только «Открыть в TWA» (решение владельца 15.11.2026). */
export function dbsCardMarkup(state: Pick<DbsCardState, "activationCode" | "wbOrderId">): Record<string, unknown> {
  const key = state.activationCode || state.wbOrderId;
  if (!key || !/^[A-Za-z0-9_-]{1,64}$/.test(key)) return {};
  return { reply_markup: { inline_keyboard: [[{ text: "📱 Открыть в TWA", url: `https://t.me/RobloxBankBot?startapp=${encodeURIComponent(key)}` }]] } };
}

export function renderDbsCard(state: DbsCardState): string {
  /* 15.11.2026: компактная карточка. Номер WB и история этапов — в свёрнутом
     блоке (раскрывается тапом), сверху — код, номинал, шкала этапов и кто это.
     Закрытый заказ (выкуплен/отменён) — одна строка под шапкой. */
  const terminal = state.marker === "done" || state.marker === "cancelled";
  const head = formatAdminNotice({
    marker: state.marker,
    zone: "DBS",
    title: state.title,
    lines: [
      orderRef({
        code: state.activationCode,
        denomination: state.denomination,
        priceKopecks: state.priceKopecks,
        buyerName: state.buyerName,
      }),
      !terminal && state.steps?.length ? dbsStepsLine(state.steps) : null,
      state.buyer
        ? [
            state.buyer.url
              ? `👤 <a href="${state.buyer.url}">${escapeHtml(state.buyer.display)}</a>`
              : `👤 ${escapeHtml(state.buyer.display)}`,
            escapeHtml(state.buyer.channel),
            state.buyer.isNew ? "новый клиент" : null,
          ].filter(Boolean).join(" · ")
        : null,
      ...(state.related ?? []).map((line) => escapeHtml(line)),
    ],
    next: state.next,
  });
  const history = [
    `WB #${escapeHtml(state.wbOrderId)}`,
    ...state.timeline.map((row, index) => `${index === state.timeline.length - 1 ? "└" : "├"} ${escapeHtml(row)}`),
  ];
  return `${head}\n<blockquote expandable>${history.join("\n")}</blockquote>`;
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
  const targets = await adminTargets("feed", { loud: false });
  if (!targets.length) return existing ?? {};
  const text = renderDbsCard(state);
  const markup = dbsCardMarkup(state);
  const next: Record<string, number> = { ...(existing ?? {}) };
  await Promise.allSettled(targets.map(async (t) => {
    const known = next[t.key];
    if (known) {
      if (await tgEdit(t.chatId, known, text, { parse_mode: "HTML", ...markup })) return;
      await tgDelete(t.chatId, known);
      delete next[t.key];
    }
    const messageId = tgMessageId(await tgSend(t.chatId, text, { parse_mode: "HTML", ...markup, ...t.extra }));
    if (messageId !== null) next[t.key] = messageId;
  }));
  return next;
}

/**
 * Вопрос к карточке WB, который требует человека (12.11.2026): жалоба или
 * возврат (бот уже ответил «напишите в чат заказа»), непонятный вопрос (бот
 * молчит) или код получения, присланный в вопрос (вопрос скрыт). Имя на WB не
 * уникально — «похоже на» лишь подсказка.
 */
export function notifyWbQuestion(input: {
  kind: "complaint" | "unknown" | "code";
  productName: string | null;
  buyerName: string | null;
  text: string;
  answered: boolean;
  code?: string | null;
  candidates: Array<{ code: string | null; wbOrderId: string; amount: number | null; status: string }>;
}): void {
  const title = input.kind === "code"
    ? "код получения прислали в вопрос"
    : input.kind === "complaint"
      ? `жалоба в вопросах WB${input.answered ? " — ответили шаблоном" : " — ответ не ушёл, повторим"}`
      : "вопрос на WB без шаблона";
  const quote = clipReview(input.text);
  broadcast({
    marker: input.kind === "unknown" ? "action" : "urgent",
    zone: "DBS",
    title,
    lines: [
      `🛒 ${escapeHtml(input.productName ?? "карточка WB")}${input.buyerName ? ` · ${escapeHtml(input.buyerName)}` : ""}`,
      quote ? `💬 <i>${escapeHtml(quote)}</i>` : null,
      input.kind === "code" && input.code ? `🔑 Код получения: <code>${escapeHtml(input.code)}</code> — вопрос скрыт, покупателю сказали писать в чат заказа` : null,
      ...input.candidates.slice(0, 3).map((c) =>
        `👥 похоже: ${c.code ? `<code>${escapeHtml(c.code)}</code> · ` : ""}WB #${escapeHtml(c.wbOrderId)}${c.amount ? ` · ${c.amount} R$` : ""} · ${escapeHtml(c.status)}`),
      input.candidates.length === 0 && input.buyerName ? "👥 заказа с таким именем на этой карточке не нашли" : null,
    ],
    next: input.kind === "code"
      ? "если заказ ждёт код — ввести его в консоли DBS"
      : input.kind === "complaint"
        ? "найти заказ и написать покупателю в чат заказа"
        : "ответить на вопрос в кабинете WB",
  });
}

/**
 * 800code (ручной заказ): покупатель написал, а за минуту никто не ответил
 * (`wb-manual-chat-alert.ts`, 23.11.2026). Бот в таких чатах молчит намеренно,
 * поэтому сигнал громкий и один на заказ; код доставки — прямо в нём, без него
 * доставку в кабинете WB не закрыть. Кнопки ответа — те же, что у «покупатель пишет».
 */
export function notifyDbsManualChatWaiting(ref: DbsRef, input: {
  product: string;
  firstAt: Date;
  texts: string[];
  deliveryCode: string | null;
}) {
  const notice = {
    marker: "urgent" as const,
    zone: "DBS" as const,
    title: `${input.product} — покупатель ждёт в чате`,
    lines: [
      refLine(ref),
      `💬 пишет с <b>${mskTime(input.firstAt)}</b>, ответа нет`,
      ...input.texts.map((t) => `«${escapeHtml(t.length > 160 ? `${t.slice(0, 159)}…` : t)}»`),
      input.deliveryCode ? `🔑 код доставки <code>${escapeHtml(input.deliveryCode)}</code>` : null,
    ],
    next: "бот этот заказ не ведёт — <b>ответить и выдать код вручную</b>",
  };
  const text = formatAdminNotice(notice);
  void adminTargetsForNotice(notice).then((targets) => Promise.allSettled(targets.map(async (t) => {
    const reply = await tgSend(t.chatId, text, {
      parse_mode: "HTML",
      reply_markup: wbReplyMarkup(ref.wbOrderId),
      ...replyToRootFor(ref.cardMessages, t),
      ...t.extra,
    });
    const messageId = tgMessageId(reply);
    if (messageId === null) {
      console.warn(`[dbs-notify] «${notice.title}» не доставлено chat_id=${t.chatId}: ${JSON.stringify(reply).slice(0, 200)}`);
      return;
    }
    void import("./db")
      .then(({ db }) => rememberWbReplyMessage(db as never, t.chatId, messageId, ref.wbOrderId))
      .catch(() => undefined);
  })));
}
