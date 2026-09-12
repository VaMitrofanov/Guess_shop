import { syncVerifiedBotUser } from "./db";
import { vkGetProfile } from "./notify";

const PROFILE_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
const recentlySynced = new Map<string, number>();

function shouldSync(key: string) {
  const lastSync = recentlySynced.get(key) ?? 0;
  if (Date.now() - lastSync < PROFILE_SYNC_TTL_MS) return false;
  recentlySynced.set(key, Date.now());
  return true;
}

export async function syncTelegramActor(actor: {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}) {
  const key = `TG:${actor.id}`;
  if (!shouldSync(key)) return;
  try {
    await syncVerifiedBotUser("TG", actor.id, {
      name: [actor.first_name, actor.last_name].filter(Boolean).join(" ") || null,
      username: actor.username ?? null,
      metadata: {
        languageCode: actor.language_code,
        isPremium: actor.is_premium,
      },
    });
  } catch (error) {
    recentlySynced.delete(key);
    console.warn("[profile-sync] Telegram actor not persisted:", error instanceof Error ? error.message : error);
  }
}

export async function syncVkActor(vkUserId: number) {
  const key = `VK:${vkUserId}`;
  if (!shouldSync(key)) return;
  try {
    const profile = await vkGetProfile(vkUserId);
    await syncVerifiedBotUser("VK", vkUserId, {
      name: profile?.name,
      username: profile?.username,
      image: profile?.image,
      metadata: {
        deactivated: profile?.deactivated,
        isClosed: profile?.isClosed,
        providerProfileAvailable: Boolean(profile),
      },
    });
  } catch (error) {
    recentlySynced.delete(key);
    console.warn("[profile-sync] VK actor not persisted:", error instanceof Error ? error.message : error);
  }
}
