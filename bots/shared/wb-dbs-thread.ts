import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  wbAutoReceiveWithinWindow,
  wbDeliverySecretIsLive,
  wbGateDelivered,
  wbOrderAgeHours,
} from "./wb-delivery-policy";
import {
  pushDbsCard,
  renderDbsCard,
  type DbsCardState,
  type DbsRef,
} from "./wb-delivery-admin-notify";
import { mskTime } from "./notify-format";

/**
 * Живая карточка DBS-заказа и нить вокруг неё.
 *
 * Живёт отдельно от `wb-delivery-sync` по одной причине: карточку читают и
 * дополняют все три приложения — воркер на TG, VK-бот и сайт, — а сам воркер
 * тянет за собой `wb-delivery-api` и `zod`, которых нет в образе VK-бота. Один
 * импорт «за компанию» уронил VK-бота в проде (`MODULE_NOT_FOUND: zod`,
 * 02.09.2026), потому что образы ботов собираются по своим `package.json`.
 *
 * Здесь только карточка: prisma, политика (без импортов) и отправка в Telegram.
 */

type Db = PrismaClient;

/** Код ошибки без стека и без чувствительных данных — в лог уходит он один. */
function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code) return code;
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" && name ? name : "unknown";
}

/** Событие заказа. Локальная копия `audit` из воркера: тянуть весь воркер ради
 * одного upsert — ровно та связь, из-за которой этот модуль и появился. */
async function noteEvent(
  db: Db,
  marketplaceOrderId: string,
  type: string,
  idempotencyKey: string,
  payload: Record<string, string | number | boolean | null>,
) {
  await db.wbMarketplaceEvent.upsert({
    where: { idempotencyKey },
    create: { marketplaceOrderId, type, idempotencyKey, actor: "wb-thread", payload },
    update: {},
  });
}

/** Ссылка на заказ для уведомления: ключи единой шапки плюс id живой карточки
 * у каждого админа — то, к чему сообщение пришивается ответом.
 *
 * Один маленький запрос на уведомление: уведомления редки (все тихие шаги
 * живут в самой карточке), а без id карточки ветка не собирается.
 * Не бросает никогда — сообщение о деньгах важнее своего оформления. */
const DBS_REF_SELECT = {
  wbOrderId: true,
  buyerName: true,
  denominationSnapshot: true,
  priceKopecks: true,
  finalPriceKopecks: true,
  adminCardMessages: true,
  wbCode: { select: { code: true } },
} as const;

/** `adminCardMessages` — свободный JSON, поэтому форма проверяется на входе. */
function cardMessagesOf(raw: unknown): Record<string, number> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, number>
    : null;
}

export async function dbsRef(db: Db, orderId: string, fallbackWbOrderId: string): Promise<DbsRef> {
  try {
    const row = await db.wbMarketplaceOrder.findUnique({
      where: { id: orderId },
      select: DBS_REF_SELECT,
    });
    if (!row) return { wbOrderId: fallbackWbOrderId };
    return {
      wbOrderId: row.wbOrderId,
      code: row.wbCode?.code ?? null,
      denomination: row.denominationSnapshot,
      priceKopecks: row.finalPriceKopecks ?? row.priceKopecks,
      buyerName: row.buyerName,
      cardMessages: cardMessagesOf(row.adminCardMessages),
    };
  } catch {
    return { wbOrderId: fallbackWbOrderId };
  }
}

/** Подписи этапов для живой карточки. Берутся из аудита — он и так пишет
 * каждый шаг, так что второй источник правды заводить не нужно. */
const CARD_STEP: Record<string, string> = {
  ORDER_SYNCED: "заказ принят",
  DELIVERY_CODE_REQUESTED: "запрошен код доставки",
  DELIVERY_CODE_CAPTURED: "код получен",
  DELIVERY_CODE_REJECTED: "WB не принял код — просим новый",
  WB_CONFIRM_SUCCEEDED: "передан на сборку",
  WB_DELIVER_SUCCEEDED: "передан в доставку",
  WB_RECEIVE_SUCCEEDED: "доставка закрыта",
  AUTO_GATE_ISSUED_AND_SENT: "гейт отправлен",
  GATE_CODE_ISSUED: "гейт выпущен",
  GATE_LINK_SENT: "гейт отправлен",
  GATE_REMINDER_SENT: "напоминание покупателю",
  GATE_SERVED_EXTERNALLY: "выдан вне системы",
  INTERNAL_ORDER_CREATED: "выкуп открыт вручную",
  BUYER_LINKED: "покупатель привязан",
  BUYER_SIGNED_IN: "вошёл на сайт",
  WB_ORDER_CANCELLED: "отменён на WB",
};

/** Подпись этапа. У входа на сайт важен канал — «вошёл на сайт (VK)»: по нему
 * оператор понимает, в каком боте искать покупателя. */
function cardStepLabel(event: { type: string; payload: unknown }): string | null {
  const base = CARD_STEP[event.type];
  if (!base) return null;
  if (event.type !== "BUYER_SIGNED_IN") return base;
  const channel = (event.payload as { channel?: string } | null)?.channel;
  return channel ? `${base} (${channel})` : base;
}

/** Одна живая карточка на заказ (Э5-B).
 *
 * Состояние выводится из строки заказа, а не из того, кто её вызвал: карточка
 * не может разойтись с реальностью, даже если какой-то переход прошёл мимо
 * уведомления.
 *
 * Отдельные сообщения при этом никуда не делись — но только громкие.
 * Редактирование сообщения в Telegram **не даёт уведомления**, поэтому всё,
 * что требует человека, обязано приходить отдельным сообщением, а карточка
 * остаётся местом, где видно текущее состояние без листания. */
export async function refreshDbsCard(db: Db, orderId: string) {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      wbCode: { select: { code: true } },
      deliverySecret: { select: { consumedAt: true, encryptedValue: true, expiresAt: true, receivedAt: true } },
      events: { orderBy: { createdAt: "asc" }, take: 40 },
    },
  });
  if (!order || order.isTest) return;

  const hasLiveSecret = wbDeliverySecretIsLive(order.deliverySecret);
  const state: DbsCardState = {
    wbOrderId: order.wbOrderId,
    buyerName: order.buyerName,
    denomination: order.denominationSnapshot,
    priceKopecks: order.finalPriceKopecks ?? order.priceKopecks,
    activationCode: order.wbCode?.code ?? null,
    ...dbsCardHeadline(order, hasLiveSecret, order.deliverySecret?.receivedAt ?? null),
    timeline: order.events
      .map((event) => ({ at: event.createdAt, label: cardStepLabel(event) }))
      .filter((row): row is { at: Date; label: string } => Boolean(row.label))
      .map((row) => `${mskTime(row.at)}  ${row.label}`)
      // Один и тот же шаг может записаться дважды (например, повторный запрос
      // кода) — в карточке это шум, а не информация.
      .filter((row, index, all) => all.indexOf(row) === index)
      .slice(-8),
  };

  const existing = cardMessagesOf(order.adminCardMessages);

  // Один захваченный код вызывает refresh трижды за секунду — из auto-receive,
  // из auto-gate и из самого захвата. Два последних вызова видят то же самое
  // состояние, и пересылать по ним карточку незачем: если id сообщения по
  // какой-то причине не сохранился, каждый такой вызов превращается в дубль.
  const hash = dbsCardHash(renderDbsCard(state));
  if (order.adminCardHash === hash && existing && Object.keys(existing).length) return;

  const updated = await pushDbsCard(state, existing);
  await db.wbMarketplaceOrder.update({
    where: { id: orderId },
    data: { adminCardMessages: updated, adminCardHash: hash },
  }).catch(() => {});
}

/**
 * Покупатель дошёл по гейт-ссылке до сайта и вошёл.
 *
 * Раньше на это уходила отдельная карточка «📦 ЗАКАЗ …» — третье сообщение об
 * одном и том же заказе, да ещё и единственное, которое не знало номера WB
 * (скрин владельца, 01.09.2026). Для DBS-заказа это не задача, а шаг воронки,
 * и место ему — в таймлайне живой карточки.
 *
 * Ключ идемпотентности один на заказ: повторные входы таймлайн не засоряют.
 * Возвращает true, если заказ действительно DBS и шаг записан, — тогда
 * отдельную карточку слать не нужно.
 */
export async function noteDbsBuyerSignedIn(
  db: Db,
  activationCode: string,
  channel: string,
): Promise<boolean> {
  try {
    const order = await db.wbMarketplaceOrder.findFirst({
      where: { wbCode: { code: activationCode } },
      select: { id: true, isTest: true },
    });
    if (!order || order.isTest) return false;
    await noteEvent(db, order.id, "BUYER_SIGNED_IN", `buyer-signed-in:${order.id}`, { channel });
    await refreshDbsCard(db, order.id);
    return true;
  } catch (error) {
    console.error("[WbDbsSync] buyer sign-in note failed:", safeErrorCode(error));
    return false;
  }
}

/** Короткий отпечаток текста карточки. Не крипто — только «изменилось или нет». */
function dbsCardHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("base64url").slice(0, 22);
}

/** Заголовок карточки: маркер, что произошло и что дальше. Порядок проверок
 * повторяет `wbDeliveryStage`, чтобы карточка и консоль никогда не расходились
 * в оценке одного и того же заказа. */
function dbsCardHeadline(
  order: {
    cancelledAt: Date | null;
    completedAt: Date | null;
    lastErrorCode: string | null;
    gateState: string;
    chatState: string;
    supplierStatus: string;
    denominationSnapshot: number | null;
    wbCreatedAt: Date | null;
    firstSeenAt: Date;
  },
  hasLiveSecret: boolean,
  codeReceivedAt: Date | null,
): Pick<DbsCardState, "marker" | "title" | "next"> {
  if (order.cancelledAt) {
    return { marker: "cancelled", title: "отменён на WB", next: "деньги вернулись покупателю" };
  }
  if (!order.denominationSnapshot) {
    return { marker: "urgent", title: "номинал не найден", next: "добавить товар в каталог — иначе гейт не выпустить" };
  }
  // Отказ по коду — не «ошибка синхронизации»: у неё другой ответ, и оператору
  // важно видеть, что покупателя уже попросили прислать код заново.
  if (order.lastErrorCode === "DELIVERY_CODE_REJECTED") {
    return {
      marker: "urgent",
      title: "WB не принял код доставки",
      next: "просим у покупателя новый код — гейт придержан до закрытия доставки",
    };
  }
  if (order.lastErrorCode) {
    return { marker: "urgent", title: `ошибка ${order.lastErrorCode}`, next: "сверить кабинет WB и синхронизировать заказ" };
  }
  if (wbGateDelivered(order.gateState) && order.completedAt) {
    return { marker: "done", title: "доставка закрыта, гейт отправлен", next: "покупатель активирует код в боте" };
  }
  if (wbGateDelivered(order.gateState)) {
    return { marker: "progress", title: "гейт отправлен", next: "закрываю доставку на WB" };
  }
  if (order.completedAt) {
    return { marker: "urgent", title: "закрыт на WB, но гейт не выдан", next: "<b>выпустить и отправить код</b> — деньги уже приняты" };
  }
  if (hasLiveSecret) {
    // Заказ старше окна: бот держит доставку намеренно, и карточка обязана
    // говорить это прямо — иначе оператор ждёт закрытия, которого не будет.
    if (codeReceivedAt && !wbAutoReceiveWithinWindow(order, codeReceivedAt)) {
      return {
        marker: "urgent",
        title: "код получен, доставка НЕ закрыта",
        next: `<b>решать вручную</b>: заказу ${wbOrderAgeHours(order, codeReceivedAt)} ч — закрыть доставку в кабинете WB или отклонить`,
      };
    }
    return { marker: "progress", title: "код получен", next: "закрываю доставку на WB — гейт уйдёт сразу после этого" };
  }
  if (order.chatState === "CODE_REQUESTED" || order.chatState === "REQUEST_SEND_UNKNOWN") {
    return { marker: "waiting", title: "ждём код доставки", next: "покупатель пришлёт 5–6 цифр в чат WB" };
  }
  if (order.chatState === "READY") {
    return { marker: "waiting", title: "чат открыт", next: "автозапрос кода доставки" };
  }
  return { marker: "progress", title: "заказ принят", next: "ждём, когда покупатель откроет чат WB" };
}
