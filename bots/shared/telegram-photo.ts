/**
 * Фото для Telegram байтами, а не ссылкой.
 *
 * 27.09.2026: ни один скрин оплаты из VK не приложился к карточке админам —
 * Telegram отвечал `failed to get HTTP URL content`. Ссылка была свежей, но CDN
 * VK (`sun9-*.userapi.com`) за рубеж почти не отдаёт: с RF-хоста 0,19 с, с SG
 * обрыв на 15-й секунде. Серверы Telegram — за рубежом. Поэтому фото качает тот,
 * кто стоит рядом с источником (VK-бот в РФ), а до Telegram оно едет файлом:
 * через мост — полем `photo_base64` в JSON, дальше мост шлёт multipart.
 */

/** Предел на скачивание: Telegram принимает фото до 10 МБ. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Скачать фото по ссылке. `null` — если не вышло: вызывающий отправит ссылку,
 * как раньше, и у него остаётся текстовый фолбэк.
 */
export async function downloadPhoto(url: string, timeoutMs = 10_000): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Тело запроса к Bot API. Без `photo_base64` — прежний JSON; с ним — multipart,
 * где объекты (`reply_markup`, `reply_parameters`) идут JSON-строкой, как того
 * требует Bot API для form-data.
 */
export function telegramRequestInit(fields: Record<string, unknown>): RequestInit {
  const { photo_base64, ...rest } = fields;
  const withMode = { parse_mode: "HTML", ...rest };
  if (typeof photo_base64 !== "string" || !photo_base64) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withMode),
    };
  }
  const form = new FormData();
  for (const [key, value] of Object.entries(withMode)) {
    if (value === undefined || value === null || key === "token" || key === "photo") continue;
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  const bytes = Buffer.from(photo_base64, "base64");
  form.set("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "photo.jpg");
  return { method: "POST", body: form };
}
