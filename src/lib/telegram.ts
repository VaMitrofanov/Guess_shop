/**
 * Sends a Telegram message, routing through the Singapore bridge when
 * VALIDATOR_SOURCE_URL is set (Russia cannot reach api.telegram.org directly).
 *
 * parse_mode is always "HTML" to match existing message formatting.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  extra?: {
    reply_markup?: unknown;
    /** Ответ на живую карточку заказа — Telegram рисует цитату и собирает ветку. */
    reply_to_message_id?: number;
    /** Обязателен рядом с `reply_to_message_id`: корень могли удалить. */
    allow_sending_without_reply?: boolean;
  },
): Promise<boolean> {
  // Поля пересылаются как есть: мост в Сингапуре отдаёт тело Telegram без
  // изменений, поэтому одна и та же форма работает на обоих путях.
  const threading = {
    ...(extra?.reply_to_message_id ? { reply_to_message_id: extra.reply_to_message_id } : {}),
    ...(extra?.allow_sending_without_reply ? { allow_sending_without_reply: true } : {}),
  };
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();

  try {
    let res: Response;

    if (bridgeUrl) {
      res = await fetch(`${bridgeUrl}/tg-proxy`, {
        method:  "POST",
        headers: {
          "Content-Type":    "application/json",
          ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
        },
        body: JSON.stringify({ token, chat_id: chatId, text, ...threading, ...(extra?.reply_markup ? { reply_markup: extra.reply_markup } : {}) }),
      });
    } else {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...threading, ...(extra?.reply_markup ? { reply_markup: extra.reply_markup } : {}) }),
      });
    }

    if (!res.ok) {
      const body = await res.text();
      // Suppress "chat not found" noise — stale admin IDs that no longer exist
      if (res.status === 400 && body.includes("chat not found")) {
        return false;
      }
      console.error(`[telegram] error for chat_id=${chatId}: HTTP ${res.status} — ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[telegram] fetch exception for chat_id=${chatId}:`, err);
    return false;
  }
}

/** Unique Telegram admin recipients; prevents duplicate fan-out from repeated env IDs. */
export function telegramAdminRecipients(): string[] {
  return [...new Set(
    (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}
