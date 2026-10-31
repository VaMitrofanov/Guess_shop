/**
 * Sends a Telegram message, routing through the Singapore bridge when
 * VALIDATOR_SOURCE_URL is set (Russia cannot reach api.telegram.org directly).
 *
 * parse_mode is always "HTML" to match existing message formatting.
 */
export interface TelegramSendExtra {
  reply_markup?: unknown;
  /** Ответ на живую карточку заказа — Telegram рисует цитату и собирает ветку. */
  reply_to_message_id?: number;
  /** Обязателен рядом с `reply_to_message_id`: корень могли удалить. */
  allow_sending_without_reply?: boolean;
}

/**
 * `message_id` отправленного сообщения — или null, если отправка не удалась.
 *
 * Нужен там, где сообщение становится КОРНЕМ ветки заказа: без id ответить на
 * него нечем. Обычным уведомлениям хватает `sendTelegramMessage` с его
 * boolean — тот просто оборачивает этот вызов.
 */
export async function sendTelegramMessageId(
  token: string,
  chatId: string,
  text: string,
  extra?: TelegramSendExtra,
): Promise<number | null> {
  const body = await sendTelegramRaw(token, chatId, text, extra);
  const id = (body as { result?: { message_id?: unknown } } | null)?.result?.message_id;
  return typeof id === "number" ? id : null;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  extra?: TelegramSendExtra,
): Promise<boolean> {
  return (await sendTelegramRaw(token, chatId, text, extra)) !== null;
}

/** Общее тело отправки: возвращает разобранный ответ Telegram или null. */
async function sendTelegramRaw(
  token: string,
  chatId: string,
  text: string,
  extra?: TelegramSendExtra,
): Promise<unknown | null> {
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
        return null;
      }
      console.error(`[telegram] error for chat_id=${chatId}: HTTP ${res.status} — ${body}`);
      return null;
    }
    // Тело читается всегда: `message_id` нужен корню ветки заказа, а мост в
    // Сингапуре отдаёт ответ Telegram без изменений. Разбор обёрнут в try
    // отдельно от отправки: HTTP 200 с нечитаемым телом — это всё ещё
    // доставленное сообщение, и оформление ветки не имеет права превратить
    // успешную отправку в неуспешную.
    try {
      return await res.json();
    } catch {
      return {};
    }
  } catch (err) {
    console.error(`[telegram] fetch exception for chat_id=${chatId}:`, err);
    return null;
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
