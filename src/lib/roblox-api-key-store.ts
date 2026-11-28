/**
 * Хранение Open Cloud-ключей — веб-сторона.
 *
 * Правила и шифрование живут в `bots/shared/roblox-api-key-store.ts`: тем же
 * хранилищем пользуется ветка «пришли ключ» в TG/VK, а боты в `src/` смотреть
 * не умеют. Здесь — только привязка к веб-клиенту Prisma.
 */

import { prisma } from "@/lib/prisma";
import {
  forgetRobloxApiKey as forgetShared,
  listRobloxApiKeys as listShared,
  loadRobloxApiKey as loadShared,
  loadRobloxApiKeyForUser as loadForUserShared,
  rememberRobloxApiKey as rememberShared,
  type LinkedRobloxKey,
  type RememberKeyInput,
  type StoredRobloxApiKey,
} from "../../bots/shared/roblox-api-key-store";

export { robloxApiKeyStoreReady } from "../../bots/shared/roblox-api-key-store";
export type { LinkedRobloxKey, RememberKeyInput, StoredRobloxApiKey };

export function rememberRobloxApiKey(input: RememberKeyInput): Promise<"saved" | "updated" | "skipped"> {
  return rememberShared(prisma as never, input);
}

export function loadRobloxApiKey(robloxUsername: string): Promise<StoredRobloxApiKey | null> {
  return loadShared(prisma as never, robloxUsername);
}

/**
 * Ключ ЭТОГО покупателя на ЭТОТ ник — для одно-нажатия «создать сейчас».
 *
 * Фильтр по `userId` не подлежит ослаблению: ключ — креденшл, и брать его «по
 * нику» значит позволить любому, кто знает чужой ник, создавать геймпассы на
 * чужом аккаунте.
 */
export function loadRobloxApiKeyForUser(userId: string, robloxUsername: string): Promise<StoredRobloxApiKey | null> {
  return loadForUserShared(prisma as never, userId, robloxUsername);
}

/** Ключи, привязанные покупателем в личном кабинете. Значения не отдаются. */
export function listRobloxApiKeys(userId: string): Promise<LinkedRobloxKey[]> {
  return listShared(prisma as never, userId);
}

/** Отвязать ключ по кнопке в кабинете (только свой). */
export function forgetRobloxApiKey(userId: string, id: string): Promise<boolean> {
  return forgetShared(prisma as never, userId, id);
}
