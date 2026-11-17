/* Уведомление владельцу заказа о подключённом аккаунте — общее для TG- и VK-бота. */

import { tgSend, vkSend } from "./notify";
import { CONTACT_CB, OWNER_REMOVE_LABEL, ownerNoticeText, type FoundOrder } from "./order-contacts";

/** Владельцу — где он есть: Telegram или ВКонтакте. */
export async function notifyContactOwner(
  owner: { tgId: string | null; vkId: string | null } | null,
  order: FoundOrder,
  contactId: string,
  who: { platform: "TG" | "VK"; label: string },
): Promise<void> {
  if (!owner) return;
  const cb = `${CONTACT_CB.rm}:${contactId}`;
  try {
    if (owner.tgId) {
      await tgSend(owner.tgId, ownerNoticeText(order, who), {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: OWNER_REMOVE_LABEL, callback_data: cb }]] },
      });
    } else if (owner.vkId) {
      await vkSend(owner.vkId, ownerNoticeText(order, who, false), {
        keyboard: JSON.stringify({
          inline: true,
          buttons: [[{ action: { type: "text", label: OWNER_REMOVE_LABEL, payload: JSON.stringify({ command: CONTACT_CB.rm, id: contactId }) }, color: "secondary" }]],
        }),
      });
    }
  } catch (err) {
    console.warn("[order-contacts] владельцу не ушло:", err instanceof Error ? err.message : err);
  }
}

