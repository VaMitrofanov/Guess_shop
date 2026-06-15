/**
 * СБП-QR для прямых заказов.
 *
 * Картинка хранится как base64 в `GlobalSettings.sbpQrBase64` (приватно, в БД —
 * НЕ в публичном репозитории и НЕ по открытому URL). Боты читают её рантайм-
 * запросом и шлют покупателю прямой загрузкой (TG multipart / VK upload).
 *
 * Обновить QR без редеплоя:
 *   UPDATE "GlobalSettings" SET "sbpQrBase64" = '<base64>' WHERE id = 'global';
 * После этого перезапустить бота (или подождать сброса кэша рестартом).
 */

import { db } from "./db";

let cached: Buffer | null = null;

/**
 * Возвращает буфер СБП-QR из БД (кэш в памяти процесса) или `null`, если QR
 * ещё не загружен. Колонка добавлена raw-миграцией, читаем через `$queryRaw`,
 * чтобы не завязываться на регенерацию Prisma-клиента.
 */
export async function getSbpQrBuffer(): Promise<Buffer | null> {
  if (cached) return cached;
  try {
    const rows = (await (db as any).$queryRaw`
      SELECT "sbpQrBase64" FROM "GlobalSettings" WHERE id = 'global'
    `) as Array<{ sbpQrBase64: string | null }>;
    const b64 = rows?.[0]?.sbpQrBase64;
    if (!b64) return null;
    cached = Buffer.from(b64, "base64");
    return cached;
  } catch (err: any) {
    console.warn("[sbp] getSbpQrBuffer error:", err?.message ?? err);
    return null;
  }
}
