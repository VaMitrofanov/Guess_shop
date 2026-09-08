/* ─────────────────────────────────────────────────────────────────────────────
   След доставки уведомления о выкупе — сторона ботов.

   Зеркало `src/lib/notice-delivery.ts` (bots/ и src/ не импортируют друг друга,
   менять СИНХРОННО). Причина появления одна: по 49ANALQ покупательница не
   узнала о выкупе, а система считала письмо отправленным — отказ Telegram
   глотался `catch {}` и не оставлял следа ни в заказе, ни в алертах.
   ───────────────────────────────────────────────────────────────────────── */

import { tgSend } from "./notify";
import { formatAdminNotice, orderRef } from "./notify-format";

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

export function completedNoticeAuditLine(result: CompletedNoticeResult, stamp: string): string {
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
};

/** Записать исход и, если человек ничего не получил, разбудить админов. */
export async function recordCompletedNotice(
  db: NoticeDb,
  input: { orderId: string; wbCode: string; amount: number; userDisplay: string; result: CompletedNoticeResult },
): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = completedNoticeAuditLine(input.result, stamp);

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
    marker: failedAll ? "urgent" : "action",
    zone: "ВЫКУП",
    title: failedAll ? "покупатель НЕ извещён о выкупе" : "бонусное сообщение не дошло",
    lines: [
      orderRef({ code: input.wbCode, denomination: input.amount }, [input.userDisplay]),
      failedAll
        ? "📵 Telegram/VK не принял сообщение о выкупе"
        : "📵 не дошло второе сообщение — питч отзыва или бонус",
    ],
    next: failedAll
      ? "написать покупателю лично: он не знает, что заказ закрыт"
      : "предложить отзыв вручную, если он нужен",
  });

  await Promise.allSettled(adminIds().map((id) => tgSend(id, text)));
}
