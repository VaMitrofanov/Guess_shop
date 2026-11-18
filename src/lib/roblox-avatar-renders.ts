import "server-only";

/* 🪪 Картинки аватара Roblox для карточки профиля (18.11.2026): полный рост и
   по пояс. Портрет уже лежит в базе (`robloxAvatarUrl`).

   Только 2D и только публичное: `thumbnails.roblox.com` отдаёт рендер по id без
   входа. С RF-хоста этот домен отвечает (~0,4 с), а сами картинки на
   `tr.rbxcdn.com` прод не видит вовсе — их грузит браузер покупателя, у него
   адрес резолвится (см. `customer-roblox-profile.tsx`). Поэтому сервер отдаёт
   только АДРЕСА, а не байты.

   Ответ держим в памяти 6 часов: кабинет открывают часто, а адреса Roblox живут
   30 дней. Не ответил за 2,5 с — карточка покажет портрет, страница не ждёт. */

export type AvatarRenders = { full: string | null; bust: string | null };

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: AvatarRenders }>();

type ThumbRow = { requestId?: string; state?: string; imageUrl?: string | null };

export async function loadAvatarRenders(robloxUserId: string | null | undefined): Promise<AvatarRenders> {
  const empty: AvatarRenders = { full: null, bust: null };
  if (!robloxUserId || !/^\d{1,20}$/.test(robloxUserId)) return empty;
  const hit = cache.get(robloxUserId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const res = await fetch("https://thumbnails.roblox.com/v1/batch", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify([
        { requestId: "full", targetId: Number(robloxUserId), type: "Avatar", size: "720x720", format: "Png" },
        { requestId: "bust", targetId: Number(robloxUserId), type: "AvatarBust", size: "420x420", format: "Png" },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return hit?.value ?? empty;
    const body = (await res.json().catch(() => null)) as { data?: ThumbRow[] } | null;
    const url = (id: string) => {
      const row = body?.data?.find((r) => r.requestId === id);
      return row?.state === "Completed" && typeof row.imageUrl === "string" && row.imageUrl.startsWith("https://") ? row.imageUrl : null;
    };
    const value = { full: url("full"), bust: url("bust") };
    // «Pending» (Roblox ещё рисует) не кэшируем — со следующего захода будет готово.
    if (value.full || value.bust) {
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(robloxUserId, { at: Date.now(), value });
    }
    return value;
  } catch {
    return hit?.value ?? empty;
  }
}
