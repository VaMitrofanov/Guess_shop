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

/** Telegram's own envelope, plus the shape the SG bridge wraps a refusal in. */
type TelegramReply = {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number } | null;
  detail?: { description?: string } | null;
};

function telegramDescription(body: TelegramReply): string {
  return body.description ?? body.detail?.description ?? "";
}

/** The id of a message we just sent, when the transport gave us one.
 *
 * Anything that wants to edit its own message later needs this; the bridge used
 * to drop it, so callers silently lost the handle and re-sent instead. */
export function tgMessageId(sent: unknown): number | null {
  const id = (sent as TelegramReply | null)?.result?.message_id;
  return typeof id === "number" ? id : null;
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
    try {
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
        signal: AbortSignal.timeout(15_000),
      });
      return (res.json() as Promise<Record<string, unknown>>).catch(() => ({}));
    } catch (err: any) {
      console.warn("[notify] tgSend bridge error:", err?.message ?? err);
      return {};
    }
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
    signal: AbortSignal.timeout(15_000),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

/** Send a photo to a Telegram chat (accepts file_id or HTTPS URL). */
/** Edit a message we sent earlier, in place.
 *
 * A DBS order used to produce four or five separate admin messages as it moved;
 * ten orders a day buried the queue in fifty. One card per order, rewritten as
 * the order advances, keeps the whole chain to a single readable message.
 *
 * Returns false when Telegram refuses — most often because the text is
 * unchanged or the message is too old to edit — so the caller can fall back to
 * sending a fresh one. */
export async function tgEdit(
  chatId: string | number,
  messageId: number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  };
  try {
    const res = bridgeUrl
      ? await fetch(`${bridgeUrl}/tg-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
        },
        body: JSON.stringify({ token: process.env.TG_TOKEN, method: "editMessageText", ...payload }),
        signal: AbortSignal.timeout(15_000),
      })
      : await fetch(tgUrl("editMessageText"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    const body = await res.json().catch(() => ({})) as TelegramReply;
    if (body.ok === true) return true;
    // Telegram answers an edit that changes nothing with HTTP 400 "message is
    // not modified". The message already says exactly this, which is the
    // outcome we wanted — reading it as failure is what made the caller send a
    // second identical card. The bridge answers this case as success already;
    // this covers the direct path.
    return /message is not modified/i.test(telegramDescription(body));
  } catch (err) {
    console.warn("[notify] tgEdit error:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Remove a message we sent earlier.
 *
 * Used when a card has to be re-created — the old one is deleted rather than
 * left behind, so the chat holds one card per order and not a trail of stale
 * ones. Never throws: a card that cannot be cleaned up is not worth failing a
 * sync cycle over. */
export async function tgDelete(chatId: string | number, messageId: number): Promise<void> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();
  const payload = { chat_id: chatId, message_id: messageId };
  try {
    if (bridgeUrl) {
      await fetch(`${bridgeUrl}/tg-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
        },
        body: JSON.stringify({ token: process.env.TG_TOKEN, method: "deleteMessage", ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
      return;
    }
    await fetch(tgUrl("deleteMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.warn("[notify] tgDelete error:", err instanceof Error ? err.message : err);
  }
}

/**
 * Отправка фото админам. Возвращает, дошло ли — и это не косметика.
 *
 * Раньше функция была `Promise<void>`, глотала сетевую ошибку в `.catch` и
 * **не смотрела на ответ вообще**. Telegram не умеет забрать фото по чужой
 * ссылке (истёкший URL VK CDN, недоступный хост) и отвечает 400 — а вызывающий
 * код видел успех. Вместе с `Promise.allSettled` в `sendAdminReviewCard` это
 * давало разбор 28.08: покупательница получила «✅ Отзыв получен», админам не
 * ушло ничего, ни одной строки в логах, и бонус ей никто не начислил.
 * Провал обязан быть слышным — иначе на него нельзя ответить фолбэком.
 */
export async function tgSendPhoto(
  chatId: string | number,
  photo: string,
  caption: string,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const bridgeUrl    = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();
  const payload = { chat_id: chatId, photo, caption, parse_mode: "HTML", ...extra };

  try {
    const res = bridgeUrl
      // Метод мост определяет сам по наличию `photo`.
      ? await fetch(`${bridgeUrl}/tg-proxy`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(validatorKey ? { "x-validator-key": validatorKey } : {}),
        },
        body: JSON.stringify({ token: process.env.TG_TOKEN, ...payload }),
        signal: AbortSignal.timeout(20_000),
      })
      : await fetch(tgUrl("sendPhoto"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });

    const body = await res.json().catch(() => ({})) as TelegramReply;
    if (body.ok === true) return true;
    console.warn(
      `[notify] tgSendPhoto не доставлено chat_id=${chatId}: HTTP ${res.status} — ` +
      (telegramDescription(body) || JSON.stringify(body).slice(0, 200)),
    );
    return false;
  } catch (err) {
    console.warn("[notify] tgSendPhoto error:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ── VK ────────────────────────────────────────────────────────────────────────

function vkApiUrl(method: string): string {
  return `https://api.vk.com/method/${method}`;
}

export type VkPublicProfile = {
  name: string;
  username: string | null;
  image: string | null;
  deactivated: string | null;
  isClosed: boolean;
};

type VkUsersGetPayload = {
  response?: Array<{
    id?: number;
    first_name?: string;
    last_name?: string;
    screen_name?: string;
    photo_100?: string;
    deactivated?: string;
    is_closed?: boolean;
  }>;
  error?: { error_code?: number; error_msg?: string };
};

/** Fetch the public fields VK actually returned for a user. A provider/API
 * failure is `null`, not a made-up profile: callers can preserve known data. */
export async function vkGetProfile(vkUserId: number): Promise<VkPublicProfile | null> {
  try {
    const token = process.env.VK_TOKEN;
    if (!token) return null;
    const params = new URLSearchParams({
      user_ids:     String(vkUserId),
      fields:       "screen_name,photo_100,deactivated,is_closed",
      access_token: token,
      v:            "5.199",
    });
    const res  = await fetch(vkApiUrl("users.get"), {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
      signal:  AbortSignal.timeout(5_000),
    });
    const json = (await res.json().catch(() => null)) as VkUsersGetPayload | null;
    const u    = json?.response?.[0];
    if (!res.ok || json?.error || !u?.first_name) return null;
    const screenName = typeof u.screen_name === "string" && u.screen_name !== `id${u.id}`
      ? u.screen_name
      : null;
    return {
      name: [u.first_name, u.last_name].filter(Boolean).join(" "),
      username: screenName,
      image: typeof u.photo_100 === "string" ? u.photo_100 : null,
      deactivated: typeof u.deactivated === "string" ? u.deactivated : null,
      isClosed: u.is_closed === true,
    };
  } catch {
    return null;
  }
}

/** Backwards-compatible name-only helper for message copy. */
export async function vkGetName(vkUserId: number): Promise<string> {
  const profile = await vkGetProfile(vkUserId);
  if (profile) return profile.name;
  return `VK #${vkUserId}`;
}

/**
 * Send a text message to a VK user. Pass `extra` for e.g. an inline `keyboard`.
 * Returns true only when VK confirmed the send — error 901 (user never wrote
 * to the community) and friends otherwise vanish silently, and callers like the
 * GP-watcher must know to retry / alert instead of marking "notified".
 */
export async function vkSend(
  vkUserId: string | number,
  message: string,
  extra: Record<string, string> = {}
): Promise<boolean> {
  const params = new URLSearchParams({
    user_id:    String(vkUserId),
    message,
    random_id:  String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:          "5.131",
    ...extra,
  });
  try {
    const res = await fetch(vkApiUrl("messages.send"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = (await res.json().catch(() => null)) as any;
    if (json?.error) {
      console.warn("[notify] vkSend VK error:", json.error.error_code, json.error.error_msg);
      return false;
    }
    return json?.response !== undefined;
  } catch (err: any) {
    console.warn("[notify] vkSend error:", err?.message ?? err);
    return false;
  }
}

/**
 * Send a photo (raw bytes) to a VK user via the messages-photo upload flow.
 *
 * VK `messages.send` cannot take a remote URL or a Telegram file_id, so we run
 * the full 4-step upload: getMessagesUploadServer → upload bytes → save → send.
 * Caption rides along in the message body. Returns `true` on success.
 */
export async function vkSendPhoto(
  vkUserId: string | number,
  photo: Buffer,
  caption: string
): Promise<boolean> {
  const token = process.env.VK_TOKEN ?? "";
  const v = "5.131";
  try {
    // 1. upload server bound to this dialog (peer_id = user_id for DMs)
    const srvRes = await fetch(
      `${vkApiUrl("photos.getMessagesUploadServer")}?peer_id=${vkUserId}&access_token=${token}&v=${v}`
    );
    const srv = (await srvRes.json()) as any;
    const uploadUrl = srv?.response?.upload_url;
    if (!uploadUrl) throw new Error("no upload_url: " + JSON.stringify(srv?.error ?? srv));

    // 2. multipart upload of the raw bytes
    const fd = new FormData();
    // A Node Buffer can sit on a SharedArrayBuffer, which BlobPart rejects; the
    // copy into a plain Uint8Array keeps the bytes and satisfies the DOM type.
    fd.append("photo", new Blob([new Uint8Array(photo)], { type: "image/jpeg" }), "qr.jpg");
    const upRes = await fetch(uploadUrl, { method: "POST", body: fd });
    const up = (await upRes.json()) as any;
    if (!up?.photo) throw new Error("upload failed: " + JSON.stringify(up));

    // 3. persist the uploaded photo
    const saveRes = await fetch(vkApiUrl("photos.saveMessagesPhoto"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        server: String(up.server), photo: up.photo, hash: up.hash,
        access_token: token, v,
      }).toString(),
    });
    const saved = (await saveRes.json()) as any;
    const ph = saved?.response?.[0];
    if (!ph) throw new Error("save failed: " + JSON.stringify(saved));

    // 4. send the message with the photo attachment
    await fetch(vkApiUrl("messages.send"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        user_id: String(vkUserId),
        message: caption,
        attachment: `photo${ph.owner_id}_${ph.id}`,
        random_id: String(Date.now() + Math.floor(Math.random() * 1000)),
        access_token: token, v,
      }).toString(),
    });
    return true;
  } catch (err: any) {
    console.warn("[notify] vkSendPhoto error:", err?.message ?? err);
    return false;
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

/** Strip HTML tags for platforms that don't support HTML formatting. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Escape &, <, > for Telegram HTML parse_mode. User-controlled strings
 * (display names, gamepass titles) MUST pass through this before being
 * embedded in an HTML message — otherwise Telegram rejects the whole
 * message ("can't parse entities") and the notification is silently lost.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
