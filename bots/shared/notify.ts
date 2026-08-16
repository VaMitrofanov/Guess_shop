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
