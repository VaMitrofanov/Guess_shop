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
): Promise<boolean> {
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
        body: JSON.stringify({ token, chat_id: chatId, text }),
      });
    } else {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
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
