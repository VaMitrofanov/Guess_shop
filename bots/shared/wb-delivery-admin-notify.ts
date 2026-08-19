import { tgSend, escapeHtml } from "./notify";

const ADMIN_IDS: string[] = [...new Set(
  (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)];

function broadcast(text: string) {
  if (!ADMIN_IDS.length) return;
  void Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, text, { parse_mode: "HTML" })));
}

export function notifyDbsNewOrder(wbOrderId: string, denomination: number | null, priceKopecks: number | null) {
  const denomLine = denomination ? ` · <b>${denomination} R$</b>` : "";
  const priceLine = priceKopecks ? ` · ${Math.round(priceKopecks / 100)} ₽` : "";
  broadcast(`📦 <b>DBS: новый заказ</b>\nWB #${escapeHtml(wbOrderId)}${denomLine}${priceLine}`);
}

export function notifyDbsBuyerMessage(wbOrderId: string, buyerName: string | null, textPreview: string) {
  const preview = textPreview.length > 120 ? textPreview.slice(0, 117) + "…" : textPreview;
  const who = buyerName ? `${escapeHtml(buyerName)} · WB #${escapeHtml(wbOrderId)}` : `WB #${escapeHtml(wbOrderId)}`;
  broadcast(
    `💬 <b>DBS: сообщение покупателя</b>\n` +
    `${who}\n` +
    `<i>${escapeHtml(preview)}</i>`,
  );
}

/** A WB cancellation is never routine: the buyer's money went back, and
 * whatever we opened on the back of that order has to stop. The message says
 * plainly what was done automatically and what still needs a person. */
export function notifyDbsOrderCancelled(
  wbOrderId: string,
  wbStatus: string,
  activationCode: string | null,
  internalStatus: string | null,
  outcome: "rejected" | "needs_human" | "no_internal_order",
) {
  const tail = outcome === "rejected"
    ? `Заказ на выкуп <code>${escapeHtml(activationCode ?? "")}</code> закрыт автоматически (был ${escapeHtml(internalStatus ?? "—")}).`
    : outcome === "needs_human"
      ? `⚠️ Заказ на выкуп <code>${escapeHtml(activationCode ?? "")}</code> в статусе <b>${escapeHtml(internalStatus ?? "—")}</b> — робуксы могли уже уйти. Разберите вручную во вкладке «Заказы».`
      : activationCode
        ? `Гейт <code>${escapeHtml(activationCode)}</code> был выдан, но покупатель его не активировал — заказ остаётся в разделе DBS как «Нужна проверка».`
        : `Гейт не выпускался — делать ничего не нужно.`;
  broadcast(
    `🚫 <b>DBS: заказ отменён на WB</b>\n` +
    `WB #${escapeHtml(wbOrderId)} · <i>${escapeHtml(wbStatus)}</i>\n` +
    tail,
  );
}

export function notifyDbsCodeCaptured(wbOrderId: string) {
  broadcast(
    `🔑 <b>DBS: код доставки получен</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Покупатель прислал код доставки — можно выпускать гейт`,
  );
}

export function notifyDbsAutoReplySent(wbOrderId: string) {
  broadcast(
    `🤖 <b>DBS: автоответ отправлен</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Покупателю ушёл запрос кода доставки — ждём ответ`,
  );
}

export function notifyDbsAutoReceived(wbOrderId: string) {
  broadcast(
    `✅ <b>DBS: доставка закрыта автоматически</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Код покупателя отправлен в WB, секрет удалён. Заказ теперь в нашем боте.`,
  );
}

export function notifyDbsAutoReceiveFailed(wbOrderId: string, outcomeUnknown: boolean) {
  broadcast(
    `⚠️ <b>DBS: не удалось закрыть доставку</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    (outcomeUnknown
      ? `WB не подтвердил результат — <b>сверьте кабинет</b> перед повтором.`
      : `WB отклонил код. Гейт покупателю уже отправлен, закройте доставку вручную.`),
  );
}

export function notifyDbsAutoGateIssued(wbOrderId: string, activationCode: string) {
  broadcast(
    `🤖 <b>DBS: авто-гейт выпущен и отправлен</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Код: <code>${escapeHtml(activationCode)}</code>`,
  );
}
