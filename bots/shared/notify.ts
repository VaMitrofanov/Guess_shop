/**
 * Raw Telegram & VK API helpers.
 *
 * These avoid importing the full library in modules that only need to
 * send/edit messages — keeping the dependency graph clean.
 */

// ── Telegram ──────────────────────────────────────────────────────────────────

function tgUrl(method: string): string {
  return `https://api.telegram.org/bot${process.env.TG_TOKEN}/${method}`;
}

/** Send a text message to a Telegram chat. Returns the sent message object. */
export async function tgSend(
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const bridgeUrl   = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();

  if (bridgeUrl) {
    // Route through the Singapore bridge (Russia cannot reach api.telegram.org)
    const res = await fetch(`${bridgeUrl}/tg-proxy`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
      },
      body: JSON.stringify({
        token:                    process.env.TG_TOKEN,
        chat_id:                  chatId,
        text,
        disable_web_page_preview: true,
        ...extra,
      }),
    });
    return (res.json() as Promise<Record<string, unknown>>).catch(() => ({}));
  }

  const res = await fetch(tgUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/** Edit an existing Telegram message text. */
export async function tgEdit(
  chatId: string | number,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await fetch(tgUrl("editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    }),
  });
}

/** Edit an existing Telegram message caption (for photo messages). */
export async function tgEditCaption(
  chatId: string | number,
  messageId: number,
  caption: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await fetch(tgUrl("editMessageCaption"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: "HTML",
      ...extra,
    }),
  });
}

/** Send a photo to a Telegram chat (accepts file_id or HTTPS URL). */
export async function tgSendPhoto(
  chatId: string | number,
  photo: string,
  caption: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const bridgeUrl    = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();

  if (bridgeUrl) {
    // Route through bridge — method auto-detected as 'sendPhoto' by the bridge
    await fetch(`${bridgeUrl}/tg-proxy`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
      },
      body: JSON.stringify({
        token:      process.env.TG_TOKEN,
        chat_id:    chatId,
        photo,
        caption,
        parse_mode: "HTML",
        ...extra,
      }),
    }).catch((err) => console.warn("[notify] tgSendPhoto bridge error:", err?.message));
    return;
  }

  await fetch(tgUrl("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra }),
  });
}

// ── VK ────────────────────────────────────────────────────────────────────────

function vkApiUrl(method: string): string {
  return `https://api.vk.com/method/${method}`;
}

/**
 * Fetch a VK user's first + last name via users.get.
 * Returns "VK #<id>" as fallback so callers never get undefined.
 */
export async function vkGetName(vkUserId: number): Promise<string> {
  try {
    const params = new URLSearchParams({
      user_ids:     String(vkUserId),
      fields:       "first_name,last_name",
      access_token: process.env.VK_TOKEN ?? "",
      v:            "5.131",
    });
    const res  = await fetch(vkApiUrl("users.get"), {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });
    const json = (await res.json()) as any;
    const u    = json?.response?.[0];
    if (u?.first_name) {
      return [u.first_name, u.last_name].filter(Boolean).join(" ");
    }
  } catch {
    // non-fatal — fall through to default
  }
  return `VK #${vkUserId}`;
}

/** Send a text message to a VK user. */
export async function vkSend(
  vkUserId: string | number,
  message: string
): Promise<void> {
  const params = new URLSearchParams({
    user_id:    String(vkUserId),
    message,
    random_id:  String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:          "5.131",
  });
  await fetch(vkApiUrl("messages.send"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

// ── Util ──────────────────────────────────────────────────────────────────────

/** Strip HTML tags for platforms that don't support HTML formatting. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
