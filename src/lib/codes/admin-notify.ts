import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets } from "../../../bots/shared/admin-route";
import { formatAdminNotice } from "../../../bots/shared/notify-format";
import { formatRubKopecks } from "@/lib/codes-pricing";

/**
 * Пуш админам о заказе кода — в беседу «Уведы», тема «Нужно действие»
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
}): Promise<void> {
  const token = process.env.TG_TOKEN;
  if (!token) return;
  const text = formatAdminNotice({
    marker: input.marker,
    zone: "САЙТ",
    title: `код активации: ${input.title}`,
    lines: [`🎟 <code>${input.orderPublicId}</code> · ${input.denomination.toLocaleString("ru-RU")} R$ · ${formatRubKopecks(input.amountKopecks)}`],
    next: input.next,
  });
  try {
    const targets = await adminTargets("action", { loud: input.marker === "urgent" });
    await Promise.allSettled(targets.map(async (target) => {
      if (await sendTelegramMessage(token, target.chatId, text, target.extra)) return;
      // Telegram отклонил разметку («can't parse entities») — алерт о деньгах не
      // имеет права потеряться из-за оформления: повтор тем же текстом без тегов
      // (CODE-827TX8XJ, 15.11.2026: «<код>» в подсказке убил алерт целиком).
      await sendTelegramMessage(token, target.chatId, plainForTelegram(text), target.extra);
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
