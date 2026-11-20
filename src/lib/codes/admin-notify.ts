import { sendTelegramMessage, sendTelegramMessageId } from "@/lib/telegram";
import { adminTargets } from "../../../bots/shared/admin-route";
import { vkDialogLink } from "../../../bots/shared/vk-links";
import { formatAdminNotice, mskTime } from "../../../bots/shared/notify-format";
import { codeComponents, formatRubKopecks } from "@/lib/codes-pricing";
import { prisma } from "@/lib/prisma";

/** Кнопка «🎟 Выдать код» под алертом — её ловит TG-бот (`bots/tg/codes-issue-reply.ts`). */
export const CODE_ISSUE_CB = "cdi";

const CHANNEL_WORD: Record<string, string> = { SITE: "сайт", TG: "бот TG", VK: "бот ВК" };

/** Куда уйдёт код — без самого адреса (16.11.2026). */
export function deliveryLine(order: { deliveryMode: string; channel: string; giftSendAt: Date | null }): string {
  const from = CHANNEL_WORD[order.channel] ?? order.channel;
  if (order.deliveryMode === "GIFT") {
    return `🎁 Подарок-открытка на почту получателя${order.giftSendAt ? ` · ${order.giftSendAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} МСК` : ""} · куплен: ${from}`;
  }
  if (order.deliveryMode === "EMAIL") return `📬 Код уйдёт письмом на почту покупателя · куплен: ${from}`;
  const chat = order.channel === "TG" || order.channel === "VK" ? ` + в чат ${order.channel === "TG" ? "бота TG" : "бота ВК"}` : "";
  return `👤 Код ляжет в кабинет (и письмом, если почта подтверждена)${chat} · куплен: ${from}`;
}

/**
 * Пуш админам о заказе кода — в беседу «Уведы», тема «Коды» (до 16.11 — «Нужно действие»)
 * (правило проекта: всё админам — через `adminTargets`, не в личку).
 * Значения кода и адреса получателя здесь не бывает никогда.
 */
export async function notifyCodeAdmins(input: {
  marker: "urgent" | "action" | "done";
  title: string;
  orderPublicId: string;
  denomination: number;
  amountKopecks: number;
  next: string;
  /** Кнопка «🎟 Выдать код» (ручная выдача). */
  issueButton?: boolean;
}): Promise<void> {
  // «🟢 выдан» уходит ответом на алерт «выдать код» (16.11.2026): Web не умеет
  // править сообщения (мост пропускает только отправку), а ветка «алерт → выдан»
  // в беседе читается так же — заказ закрыт.
  const roots = input.marker === "done" ? await alertRoots(input.orderPublicId) : {};
  const token = process.env.TG_TOKEN;
  if (!token) return;
  const order = await prisma.codeOrder.findUnique({
    where: { publicId: input.orderPublicId },
    select: { deliveryMode: true, channel: true, giftSendAt: true },
  }).catch(() => null);
  const text = formatAdminNotice({
    marker: input.marker,
    zone: "САЙТ",
    title: `код активации: ${input.title}`,
    lines: [
      `🎟 <code>${input.orderPublicId}</code> · ${input.denomination.toLocaleString("ru-RU")} R$ · ${formatRubKopecks(input.amountKopecks)}`,
      input.issueButton && supplierLabel(input.denomination) !== null ? `📦 нужно: ${supplierLabel(input.denomination)}` : null,
      order ? deliveryLine(order) : null,
      // У 🟠 формат прячет `next`, а для ручной выдачи подсказка про «ответом» нужна.
      input.marker !== "urgent" && input.issueButton ? `👉 ${input.next}` : null,
    ],
    next: input.next,
  });
  const markup = input.issueButton
    ? { reply_markup: { inline_keyboard: [[{ text: `🎟 Выдать ${supplierLabel(input.denomination) ?? `код ${input.denomination.toLocaleString("ru-RU")} R$`}`, callback_data: `${CODE_ISSUE_CB}:${input.orderPublicId}` }]] } }
    : {};
  try {
    // Своя тема «Коды» (16.11.2026). Её ещё нет (бот не перезапускался) — адресат
    // сам упадёт в личку админов: `adminTargets` без темы шлёт в ADMIN_IDS.
    // Покупатель уже заплатил и ждёт код — ручная выдача будит и ночью, хоть и 🟠.
    const targets = await adminTargets("codes", { loud: true, urgent: input.marker === "urgent" || Boolean(input.issueButton) });
    const sent: Record<string, number> = {};
    await Promise.allSettled(targets.map(async (target) => {
      const reply = roots[target.key] ? { reply_to_message_id: roots[target.key], allow_sending_without_reply: true } : {};
      const messageId = await sendTelegramMessageId(token, target.chatId, text, { ...target.extra, ...markup, ...reply });
      if (messageId !== null) { sent[target.key] = messageId; return; }
      // Telegram отклонил разметку («can't parse entities») — алерт о деньгах не
      // имеет права потеряться из-за оформления: повтор тем же текстом без тегов
      // (CODE-827TX8XJ, 15.11.2026: «<код>» в подсказке убил алерт целиком).
      await sendTelegramMessage(token, target.chatId, plainForTelegram(text), { ...target.extra, ...markup, ...reply });
    }));
    // Алерт «выдать код» запоминаем — к нему потом прицепится «🟢 выдан».
    if (input.issueButton && Object.keys(sent).length > 0) await rememberAlert(input.orderPublicId, sent);
  } catch {
    // Уведомление не должно ломать обработку платежа.
  }
}

/** «2 ч 14 мин», «5 мин», «3 дн 4 ч» — сколько прошло от выдачи до открытия. */
export function elapsedRu(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч ${min % 60} мин`;
  return `${Math.floor(h / 24)} дн ${h % 24} ч`;
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Покупатель впервые открыл код (21.11.2026, владелец: «надо для понимания,
 * когда он ±его ввёл — код может быть плохой, либо он хочет нас обмануть»).
 *
 * Ловим два места, где показ — отдельное действие: кабинет (`revealedAt`) и
 * открытка по ссылке (`giftOpenedAt`). В чате бота и в письме код стоит прямо в
 * тексте — момент прочтения там не узнать, поэтому увед называет, когда код
 * туда ушёл: с этой минуты покупатель мог его ввести. Без звука, ответом на
 * алерт «выдать код», чтобы вся история заказа была одной веткой.
 */
export async function notifyCodeOpened(orderId: string, via: "cabinet" | "gift" | "chat_tg" | "chat_vk"): Promise<void> {
  const token = process.env.TG_TOKEN;
  if (!token) return;
  try {
    const order = await prisma.codeOrder.findUnique({
      where: { id: orderId },
      select: {
        publicId: true, denomination: true, finalAmountKopecks: true, issuedAt: true,
        chatDeliveredAt: true, emailSentAt: true, channel: true, giftTo: true,
        creator: { select: { username: true, name: true, tgId: true, vkId: true } },
      },
    });
    if (!order) return;
    const now = new Date();
    const where = via === "gift" ? `по ссылке-подарку${order.giftTo ? ` (для «${esc(order.giftTo)}»)` : ""}`
      : via === "chat_tg" ? "в чате бота TG (кнопка «Показать код»)"
      : via === "chat_vk" ? "в чате бота ВК (кнопка «Показать код»)"
      : "в кабинете";
    // В чат с 21.11.2026 уходит «конверт» без кода — доставка туда не значит, что код видели.
    const sealed = await prisma.codeOrderEvent.findFirst({ where: { orderId, type: "CHAT_SEALED_SENT" }, select: { id: true } }).catch(() => null);
    const after = order.issuedAt ? `, через ${elapsedRu(now.getTime() - order.issuedAt.getTime())} после выдачи` : "";
    const earlier = [
      order.chatDeliveredAt && !sealed ? `в чат бота ${order.channel === "VK" ? "ВК" : "TG"} ${mskTime(order.chatDeliveredAt)}` : null,
      order.emailSentAt ? `письмом ${mskTime(order.emailSentAt)}` : null,
    ].filter(Boolean);
    const c = order.creator;
    const who = c?.username ? `@${esc(c.username)}`
      : c?.tgId ? `<a href="tg://user?id=${c.tgId}">${esc(c.name ?? "покупатель")}</a>`
      : c?.vkId ? vkDialogLink(c.vkId, esc(c.name ?? "покупатель"))
      : null;
    const text = formatAdminNotice({
      marker: "progress",
      zone: "САЙТ",
      title: "код активации: покупатель открыл код",
      lines: [
        `🎟 <code>${order.publicId}</code> · ${order.denomination.toLocaleString("ru-RU")} R$ · ${formatRubKopecks(order.finalAmountKopecks)}`,
        `👁 Открыт ${where} · ${mskTime(now)} МСК${after}`,
        earlier.length ? `📨 Код уже видел раньше: ${earlier.join(", ")} — вводить мог с того момента` : null,
        who ? `👤 ${who}` : null,
      ],
    });
    const roots = await alertRoots(order.publicId);
    const targets = await adminTargets("codes", { loud: false });
    await Promise.allSettled(targets.map(async (target) => {
      const reply = roots[target.key] ? { reply_to_message_id: roots[target.key], allow_sending_without_reply: true } : {};
      const id = await sendTelegramMessageId(token, target.chatId, text, { ...target.extra, ...reply });
      if (id === null) await sendTelegramMessage(token, target.chatId, plainForTelegram(text), { ...target.extra, ...reply });
    }));
  } catch {
    // Увед не должен ломать показ кода покупателю.
  }
}

/** HTML уведомления → тот же текст без тегов, с экранированными символами. */
export function plainForTelegram(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ALERT_EVENT = "ADMIN_ALERT_SENT";

async function rememberAlert(publicId: string, messages: Record<string, number>): Promise<void> {
  const order = await prisma.codeOrder.findUnique({ where: { publicId }, select: { id: true } }).catch(() => null);
  if (!order) return;
  await prisma.codeOrderEvent.create({
    data: { orderId: order.id, type: ALERT_EVENT, idempotencyKey: `code-admin-alert:${order.id}:${Date.now()}`, payload: { messages } },
  }).catch(() => undefined);
}

/** Где лежит последний алерт «выдать код» по заказу: `{ ключ цели: message_id }`. */
async function alertRoots(publicId: string): Promise<Record<string, number>> {
  const order = await prisma.codeOrder.findUnique({ where: { publicId }, select: { id: true } }).catch(() => null);
  if (!order) return {};
  const event = await prisma.codeOrderEvent.findFirst({
    where: { orderId: order.id, type: ALERT_EVENT },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  }).catch(() => null);
  const messages = (event?.payload as { messages?: Record<string, unknown> } | null)?.messages ?? {};
  return Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

/**
 * Какие коды поставщика закрывают заказ, если это не «один код того же
 * номинала» (20.11.2026): «2 000» → «2 кода по 1 000 R$», «199» → «код 200 R$».
 */
export function supplierLabel(denomination: number): string | null {
  const parts = codeComponents(denomination);
  if (parts.length === 1 && parts[0] === denomination) return null;
  if (parts.length === 1) return `код ${parts[0].toLocaleString("ru-RU")} R$`;
  const same = parts.every((part) => part === parts[0]);
  return same
    ? `${parts.length} кода по ${parts[0].toLocaleString("ru-RU")} R$`
    : `коды ${parts.map((part) => part.toLocaleString("ru-RU")).join(" + ")} R$`;
}
