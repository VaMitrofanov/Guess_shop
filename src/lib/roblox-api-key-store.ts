/**
 * Хранение Open Cloud-ключей — веб-сторона.
 *
 * Правила и шифрование живут в `bots/shared/roblox-api-key-store.ts`: тем же
 * хранилищем пользуется ветка «пришли ключ» в TG/VK, а боты в `src/` смотреть
 * не умеют. Здесь — только привязка к веб-клиенту Prisma.
 */

import { prisma } from "@/lib/prisma";
import {
  loadRobloxApiKey as loadShared,
  rememberRobloxApiKey as rememberShared,
  type RememberKeyInput,
  type StoredRobloxApiKey,
} from "../../bots/shared/roblox-api-key-store";

export { robloxApiKeyStoreReady } from "../../bots/shared/roblox-api-key-store";
export type { RememberKeyInput, StoredRobloxApiKey };

export function rememberRobloxApiKey(input: RememberKeyInput): Promise<"saved" | "updated" | "skipped"> {
  return rememberShared(prisma as never, input);
}

export function loadRobloxApiKey(robloxUsername: string): Promise<StoredRobloxApiKey | null> {
  return loadShared(prisma as never, robloxUsername);
}
