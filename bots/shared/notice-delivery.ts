/* ─────────────────────────────────────────────────────────────────────────────
   След доставки уведомления о выкупе — сторона ботов.

   Зеркало `src/lib/notice-delivery.ts` (bots/ и src/ не импортируют друг друга,
   менять СИНХРОННО). Причина появления одна: по 49ANALQ покупательница не
   узнала о выкупе, а система считала письмо отправленным — отказ Telegram
   глотался `catch {}` и не оставлял следа ни в заказе, ни в алертах.

   12.09.2026 добавлен запасной канал: если ни TG, ни VK не приняли сообщение,
   покупателю DBS пишем в чат Wildberries. Там доставка стопроцентная — этим
   каналом человеку пришла сама ссылка на гейт.
   ───────────────────────────────────────────────────────────────────────── */

import { tgSend } from "./notify";
import { formatAdminNotice, orderRef } from "./notify-format";
import { notifyBuyerViaWbChat, wbChatCompletedMessage, type WbChatNoticeResult } from "./wb-chat-notify";

/** Список админов читается здесь, а не импортом из `admin.ts`: тот тянет за
 *  собой базу, и маленький модуль следа доставки становился бы неподъёмным. */
function adminIds(): string[] {
  return (process.env.ADMIN_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

export interface CompletedNoticeResult {
  delivered: boolean;
  bonusDelivered: boolean;
  channel: "tg" | "vk" | "none";
}

export function completedNoticeAuditLine(
  result: CompletedNoticeResult,
  stamp: string,
  rescuedViaWbChat = false,
): string {
  if (rescuedViaWbChat) {
    const via = result.channel === "none" ? "ни TG, ни VK" : result.channel.toUpperCase();
    return `[УВЕД ${stamp}] чат WB: о выкупе сказали там (${via} не принял)`;
  }
  if (result.channel === "none") {
    return `[УВЕД-НЕ-ДОШЛО ${stamp}] у покупателя нет ни TG, ни VK — сказать о выкупе некому`;
  }
  const via = result.channel.toUpperCase();
  if (!result.delivered) {
    return `[УВЕД-НЕ-ДОШЛО ${stamp}] ${via} не принял «заказ выкуплен» — покупатель НЕ знает, что заказ закрыт`;
  }
  if (!result.bonusDelivered) {
    return `[УВЕД ${stamp}] ${via}: о выкупе сказали, второе сообщение (бонус/отзыв) не дошло`;
  }
  return `[УВЕД ${stamp}] ${via}: покупатель извещён о выкупе`;
}

type NoticeDb = {
  wbOrder: {
    findUnique: (args: unknown) => Promise<{ adminNote: string | null } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  wbMarketplaceOrder: unknown;
};

/**
 * Последняя попытка достучаться: чат Wildberries.
 *
 * Зовётся только когда основное сообщение НЕ дошло — «выкуплено» в чате WB
 * рядом с доставленным ботом дублем выглядело бы как сбой, а не как забота.
 */
export async function rescueCompletedNotice(
  db: { wbMarketplaceOrder: unknown },
  input: { wbCode: string; amount: number; robloxUsername?: string | null; completedAt?: Date | null },
): Promise<WbChatNoticeResult> {
  return notifyBuyerViaWbChat(
    db as never,
    input.wbCode,
    wbChatCompletedMessage(input.amount, input.robloxUsername ?? null, input.completedAt ?? null),
  ).catch((error) => {
    console.warn("[notice-delivery] запасной канал WB упал:", (error as Error)?.message ?? error);
    return { sent: false, reason: "send_failed" as const };
  });
}

/** Записать исход и, если человек ничего не получил, разбудить админов. */
export async function recordCompletedNotice(
  db: NoticeDb,
  input: {
    orderId: string;
    wbCode: string;
    amount: number;
    userDisplay: string;
    robloxUsername?: string | null;
    completedAt?: Date | null;
    result: CompletedNoticeResult;
  },
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  // Человек не узнал о выкупе ни от TG, ни от VK — пробуем чат WB.
  const rescue = input.result.delivered
    ? null
    : await rescueCompletedNotice(db, input);
  const rescued = rescue?.sent === true;
  const line = completedNoticeAuditLine(input.result, stamp, rescued);

  try {
    const order = await db.wbOrder.findUnique({ where: { id: input.orderId }, select: { adminNote: true } });
    const current = order?.adminNote?.trim() ?? "";
    if (!current.split("\n").includes(line)) {
      await db.wbOrder.update({
        where: { id: input.orderId },
        data: { adminNote: (current ? `${current}\n${line}` : line).slice(-2000) },
      });
    }
  } catch (error) {
    console.warn("[notice-delivery] не записали след доставки:", (error as Error)?.message ?? error);
  }

  if (input.result.delivered && input.result.bonusDelivered) return;

  const failedAll = !input.result.delivered;
  const text = formatAdminNotice({
    // Красный — только когда человек и правда остался без ответа. Спасённое
    // чатом WB уведомление это уже не «деньги взяли и молчим».
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

  await Promise.allSettled(adminIds().map((id) => tgSend(id, text)));
}
