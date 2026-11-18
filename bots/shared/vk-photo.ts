/**
 * Загрузить картинку в диалог ВК и получить строку `attachment` (`photo<owner>_<id>`).
 * Только fetch — годится и боту, и Web (приглашение в Telegram, 18.11.2026).
 * null — ВК не принял: вызывающий шлёт сообщение без картинки.
 */
export async function vkUploadMessagePhoto(vkUserId: string | number, photo: Uint8Array, token = process.env.VK_TOKEN ?? ""): Promise<string | null> {
  const v = "5.131";
  try {
    const srv = await (await fetch(`https://api.vk.com/method/photos.getMessagesUploadServer?peer_id=${vkUserId}&access_token=${token}&v=${v}`)).json() as { response?: { upload_url?: string } };
    const uploadUrl = srv?.response?.upload_url;
    if (!uploadUrl) return null;
    const fd = new FormData();
    fd.append("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "card.png");
    const up = await (await fetch(uploadUrl, { method: "POST", body: fd })).json() as { server?: number; photo?: string; hash?: string };
    if (!up?.photo) return null;
    const saved = await (await fetch("https://api.vk.com/method/photos.saveMessagesPhoto", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ server: String(up.server), photo: up.photo, hash: String(up.hash), access_token: token, v }).toString(),
    })).json() as { response?: Array<{ owner_id: number; id: number }> };
    const ph = saved?.response?.[0];
    return ph ? `photo${ph.owner_id}_${ph.id}` : null;
  } catch (err) {
    console.warn("[vk-photo] не загрузилась:", err instanceof Error ? err.message : err);
    return null;
  }
}
