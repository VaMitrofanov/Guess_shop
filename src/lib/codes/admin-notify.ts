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
    await Promise.allSettled(targets.map((target) => sendTelegramMessage(token, target.chatId, text, target.extra)));
  } catch {
    // Уведомление не должно ломать обработку платежа.
  }
}
