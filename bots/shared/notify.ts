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
