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

export function notifyDbsBuyerMessage(wbOrderId: string, senderName: string, textPreview: string) {
  const preview = textPreview.length > 120 ? textPreview.slice(0, 117) + "…" : textPreview;
  broadcast(
    `💬 <b>DBS: сообщение покупателя</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `<i>${escapeHtml(preview)}</i>`,
  );
}

export function notifyDbsCodeCaptured(wbOrderId: string) {
  broadcast(
    `🔑 <b>DBS: код доставки получен</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Покупатель прислал 6-значный код — можно выпускать гейт`,
  );
}

export function notifyDbsAutoGateIssued(wbOrderId: string, activationCode: string) {
  broadcast(
    `🤖 <b>DBS: авто-гейт выпущен и отправлен</b>\n` +
    `WB #${escapeHtml(wbOrderId)}\n` +
    `Код: <code>${escapeHtml(activationCode)}</code>`,
  );
}
