import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets } from "../../../bots/shared/admin-route";
import { formatAdminNotice } from "../../../bots/shared/notify-format";
import { formatRubKopecks } from "@/lib/codes-pricing";
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
  marker: "urgent" | "action";
  title: string;
  orderPublicId: string;
  denomination: number;
  amountKopecks: number;
  next: string;
  /** Кнопка «🎟 Выдать код» (ручная выдача). */
  issueButton?: boolean;
}): Promise<void> {
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
      order ? deliveryLine(order) : null,
    ],
    next: input.next,
  });
  const markup = input.issueButton
    ? { reply_markup: { inline_keyboard: [[{ text: `🎟 Выдать код ${input.denomination.toLocaleString("ru-RU")} R$`, callback_data: `${CODE_ISSUE_CB}:${input.orderPublicId}` }]] } }
    : {};
  try {
    // Своя тема «Коды» (16.11.2026). Её ещё нет (бот не перезапускался) — адресат
    // сам упадёт в личку админов: `adminTargets` без темы шлёт в ADMIN_IDS.
    const targets = await adminTargets("codes", { loud: true, urgent: input.marker === "urgent" });
    await Promise.allSettled(targets.map(async (target) => {
      if (await sendTelegramMessage(token, target.chatId, text, { ...target.extra, ...markup })) return;
      // Telegram отклонил разметку («can't parse entities») — алерт о деньгах не
      // имеет права потеряться из-за оформления: повтор тем же текстом без тегов
      // (CODE-827TX8XJ, 15.11.2026: «<код>» в подсказке убил алерт целиком).
      await sendTelegramMessage(token, target.chatId, plainForTelegram(text), { ...target.extra, ...markup });
    }));
  } catch {
    // Уведомление не должно ломать обработку платежа.
  }
}

/** HTML уведомления → тот же текст без тегов, с экранированными символами. */
export function plainForTelegram(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
