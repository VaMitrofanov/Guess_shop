import "server-only";

import { formatAdminNotice, orderRef } from "../../bots/shared/notify-format";
import { completedNoticeAuditLine, rescueCompletedNotice } from "../../bots/shared/notice-delivery";
import { appendOrderAudit } from "@/lib/order-recovery";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import type { CompletedNoticeResult } from "@/lib/twa-notify";

/* ─────────────────────────────────────────────────────────────────────────────
   След доставки уведомления о выкупе.

   Разбор `49ANALQ` (08.09.2026). Заказ был выкуплен 5 сентября, покупательница
   об этом не узнала и через три дня пришла в поддержку с «долго в обработке».
   Карточка при этом показывала «📸 Ждёт отзыв» — как будто питч ушёл.

   Отказ терялся на трёх уровнях сразу:
     1. мост отвечал `ok: true` на сообщение, которое Telegram ОТКЛОНИЛ
        (`chat not found` глушился как «шум от устаревших ID админов»);
     2. `tgPost` возвращал boolean, который никто не читал;
     3. вызов стоял как `notifyOrderCompleted(...).catch(() => {})`.

   Первые два уровня починены там же, где сломаны. Здесь — третий: исход
   доставки становится фактом в заказе, а недоставка — поводом для алерта.
   Молчание больше не выглядит как успех.

   12.09.2026. Алерт заработал — и сразу показал, что дело не в редком сбое:
   24,5 % VK-покупателей не разрешили сообществу писать вовсе. Поэтому у
   недоставки появился запасной канал — чат Wildberries (`wb-chat-notify`):
   формулировки строки аудита и алерта общие с ботами.
   ───────────────────────────────────────────────────────────────────────── */

function adminIds(): string[] {
  return (process.env.ADMIN_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export { completedNoticeAuditLine };

/**
 * Записать исход и, если человек ничего не получил, разбудить админов.
 *
 * Никогда не бросает: заказ уже выкуплен, и запись о письме не имеет права
 * ломать закрытие. Но и молчать она больше не будет.
 */
export async function recordCompletedNotice(input: {
  orderId: string;
  wbCode: string;
  amount: number;
  userDisplay: string;
  robloxUsername?: string | null;
  completedAt?: Date | null;
  result: CompletedNoticeResult;
}): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  // Ни TG, ни VK не приняли — последняя дверь к покупателю DBS: чат WB.
  const rescue = input.result.delivered
    ? null
    : await rescueCompletedNotice(prisma, {
      wbCode: input.wbCode,
      amount: input.amount,
      robloxUsername: input.robloxUsername,
      completedAt: input.completedAt,
    });
  const rescued = rescue?.sent === true;
  const line = completedNoticeAuditLine(input.result, stamp, rescued);

  try {
    const order = await prisma.wbOrder.findUnique({
      where: { id: input.orderId },
      select: { adminNote: true },
    });
    await prisma.wbOrder.update({
      where: { id: input.orderId },
      data: { adminNote: appendOrderAudit(order?.adminNote, line) },
    });
  } catch (error) {
    console.warn("[notice-delivery] не записали след доставки:", (error as Error)?.message ?? error);
  }

  if (input.result.delivered && input.result.bonusDelivered) return;

  const token = process.env.TG_TOKEN;
  const recipients = adminIds();
  if (!token || recipients.length === 0) return;

  const failedAll = !input.result.delivered;
  const text = formatAdminNotice({
    // Человек заплатил, заказ закрыт, а он об этом не знает — это красный.
    // Спасённое чатом WB уведомление красным уже не является.
    marker: rescued ? "action" : failedAll ? "urgent" : "action",
    zone: "ВЫКУП",
    title: rescued
      ? "покупателю сказали через чат WB"
      : failedAll ? "покупатель НЕ извещён о выкупе" : "бонусное сообщение не дошло",
    lines: [
      orderRef({ code: input.wbCode, denomination: input.amount }, [input.userDisplay]),
      rescued
        ? "📵 Telegram/VK не принял — ушло в чат Wildberries"
        : failedAll
          ? `📵 Telegram/VK не принял сообщение о выкупе${rescue ? ` · чат WB тоже не сработал (${rescue.reason})` : ""}`
          : "📵 не дошло второе сообщение — питч отзыва или бонус",
    ],
    next: rescued
      ? "ничего: человек узнал о выкупе, бонус и отзыв предложить вручную"
      : failedAll
        ? "написать покупателю лично: он не знает, что заказ закрыт"
        : "предложить отзыв вручную, если он нужен",
  });

  await Promise.allSettled(
    recipients.map((id) => sendTelegramMessage(token, id, text)),
  );
}
