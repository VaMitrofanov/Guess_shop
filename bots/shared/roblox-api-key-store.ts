/**
 * Хранение Open Cloud API-ключей покупателей.
 *
 * Решение владельца 06.09.2026: ключ НЕ стираем после создания пасса. Он не
 * даёт доступа к аккаунту, робуксам и платежам — только к геймпассам того, кто
 * его выпустил (`game-passes: read + write`), — и бессрочен, если покупатель не
 * выбрал дату истечения. Взамен мы получаем две вещи:
 *
 *   1. **Починку без покупателя.** Пасс создан, но цена уехала или продажа
 *      слетела — правим тем же ключом, не гоняя человека в Creator Hub.
 *   2. **Быстрый повторный заказ.** Постоянному покупателю пасс создаётся
 *      сразу: ему остаётся оплатить.
 *
 * Значение лежит зашифрованным (AES-256-GCM) — тот же конверт и тот же
 * `WB_DELIVERY_ENCRYPTION_KEY`, что у кодов доставки WB. Наружу (в ответ роута,
 * в логи, в карточку админа) ключ не отдаётся никогда: отсюда возвращаются
 * только метаданные, а расшифровка живёт в `loadRobloxApiKey` для будущих
 * админских действий.
 *
 * Ни одна ошибка здесь не роняет пользовательский поток: пасс уже создан,
 * и «не сохранили ключ» — это потеря удобства, а не заказа.
 */

import {
  decryptWbSecret,
  encryptWbSecret,
  wbDeliveryCryptoReady,
  wbSecretHmac,
} from "./wb-delivery-crypto";

/**
 * Клиент Prisma приходит снаружи: у веба это `@/lib/prisma`, у ботов —
 * `bots/shared/db`. Своего импорта здесь нет намеренно — иначе ветка ключа в
 * боте тянула бы веб-клиент, а веб — второй пул соединений ботов.
 */
export type RobloxApiKeyClient = {
  robloxApiKey: {
    findUnique: (args: any) => Promise<any>;
    findFirst: (args: any) => Promise<any>;
    findMany?: (args: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    deleteMany?: (args: any) => Promise<{ count: number }>;
  };
};

const PURPOSE = "roblox-api-key" as const;

export interface RememberKeyInput {
  /** Сам ключ. В логи и наружу не попадает ни при каком исходе. */
  key: string;
  /** Ник Roblox, на аккаунте которого ключ работает. */
  robloxUsername: string;
  /** Наш пользователь, если заказ уже привязан к учётке. */
  userId?: string | null;
  /** Заказ, на котором ключ применялся. */
  orderId?: string | null;
  /** Машинный исход применения: `ok`, `bad_scope`, `not_authorized`, … */
  result: string;
  /** Сколько пассов этим ключом создано в этот раз. */
  createdPasses?: number;
}

/** Готово ли хранилище: без ключа шифрования сохранять нечего. */
export function robloxApiKeyStoreReady(): boolean {
  return wbDeliveryCryptoReady();
}

/**
 * Запомнить ключ (или обновить след у уже известного).
 *
 * Дедупликация по HMAC: тот же ключ, присланный второй раз, не плодит строк —
 * у него просто растёт `useCount` и обновляется последний исход.
 */
export async function rememberRobloxApiKey(db: RobloxApiKeyClient, input: RememberKeyInput): Promise<"saved" | "updated" | "skipped"> {
  const key = input.key.trim();
  const nick = input.robloxUsername.trim().toLowerCase();
  if (!key || !nick) return "skipped";
  if (!robloxApiKeyStoreReady()) {
    console.warn("[roblox-api-key] WB_DELIVERY_ENCRYPTION_KEY не задан — ключ не сохранён");
    return "skipped";
  }
  try {
    const keyHmac = wbSecretHmac(key, PURPOSE);
    const existing = await db.robloxApiKey.findUnique({ where: { keyHmac }, select: { id: true, createdPasses: true } });
    const now = new Date();
    if (existing) {
      await db.robloxApiKey.update({
        where: { id: existing.id },
        data: {
          robloxUsername: nick,
          userId: input.userId ?? undefined,
          lastOrderId: input.orderId ?? undefined,
          lastResult: input.result,
          lastUsedAt: now,
          useCount: { increment: 1 },
          createdPasses: { increment: input.createdPasses ?? 0 },
          // Перешифровываем: конверт несёт свежий IV, а строка ключа та же.
          encryptedValue: encryptWbSecret(key, PURPOSE),
        },
      });
      return "updated";
    }
    await db.robloxApiKey.create({
      data: {
        robloxUsername: nick,
        userId: input.userId ?? null,
        encryptedValue: encryptWbSecret(key, PURPOSE),
        keyHmac,
        lastOrderId: input.orderId ?? null,
        lastResult: input.result,
        lastUsedAt: now,
        useCount: 1,
        createdPasses: input.createdPasses ?? 0,
      },
    });
    return "saved";
  } catch (err) {
    // Ключ — удобство, заказ важнее. Сообщение печатаем без значения ключа.
    console.warn("[roblox-api-key] не сохранили:", err instanceof Error ? err.message : err);
    return "skipped";
  }
}

export interface StoredRobloxApiKey {
  id: string;
  robloxUsername: string;
  key: string;
  lastUsedAt: Date | null;
  createdPasses: number;
}

/**
 * Достать последний рабочий ключ этого ника — для админских действий
 * («поправить пасс», «создать сразу»). Возвращает расшифрованное значение,
 * поэтому вызывать только из серверного кода и никогда не отдавать в ответ.
 */
export async function loadRobloxApiKey(db: RobloxApiKeyClient, robloxUsername: string): Promise<StoredRobloxApiKey | null> {
  const nick = robloxUsername.trim().toLowerCase();
  if (!nick || !robloxApiKeyStoreReady()) return null;
  try {
    const row = await db.robloxApiKey.findFirst({
      where: { robloxUsername: nick },
      // Сначала тот, которым что-то реально создавали, затем свежий.
      orderBy: [{ lastResult: "asc" }, { lastUsedAt: "desc" }],
      select: { id: true, robloxUsername: true, encryptedValue: true, lastUsedAt: true, createdPasses: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      robloxUsername: row.robloxUsername,
      key: decryptWbSecret(row.encryptedValue, PURPOSE),
      lastUsedAt: row.lastUsedAt,
      createdPasses: row.createdPasses,
    };
  } catch (err) {
    console.warn("[roblox-api-key] не прочитали:", err instanceof Error ? err.message : err);
    return null;
  }
}

/* ── Ключи в личном кабинете ────────────────────────────────────────────────
   В кабинете ключ привязывают ЗАРАНЕЕ, когда заказа ещё нет: покупателю
   остаётся только оплатить, а геймпасс мы создадим сами. Наружу отсюда уходят
   только метаданные — сам ключ не отдаётся никогда и ни при каком запросе.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Ключ ЭТОГО покупателя для этого ника — для автосоздания без повторного ввода.
 *
 * Фильтр по `userId` обязателен и не подлежит ослаблению: ключ — креденшл, и
 * брать его «по нику» значит позволить любому, кто знает чужой ник, создавать
 * геймпассы на чужом аккаунте. Владелец ключа — тот, кто его привязал.
 */
export async function loadRobloxApiKeyForUser(
  db: RobloxApiKeyClient,
  userId: string,
  robloxUsername: string,
): Promise<StoredRobloxApiKey | null> {
  const nick = robloxUsername.trim().toLowerCase();
  if (!userId || !nick || !robloxApiKeyStoreReady()) return null;
  try {
    const row = await db.robloxApiKey.findFirst({
      where: { userId, robloxUsername: nick },
      orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, robloxUsername: true, encryptedValue: true, lastUsedAt: true, createdPasses: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      robloxUsername: row.robloxUsername,
      key: decryptWbSecret(row.encryptedValue, PURPOSE),
      lastUsedAt: row.lastUsedAt,
      createdPasses: row.createdPasses,
    };
  } catch (err) {
    console.warn("[roblox-api-key] не прочитали ключ покупателя:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface LinkedRobloxKey {
  id: string;
  /** Ник Roblox, на аккаунте которого ключ работает. */
  robloxUsername: string;
  /** Когда привязан. */
  createdAt: Date;
  /** Когда последний раз применялся (создание пасса). */
  lastUsedAt: Date | null;
  /** Сколько пассов этим ключом уже создано. */
  createdPasses: number;
  /** Исход последнего применения: `verified`, `ok`, `bad_scope`, … */
  lastResult: string | null;
}

/** Ключи, привязанные этим покупателем. Значения не расшифровываются. */
export async function listRobloxApiKeys(
  db: RobloxApiKeyClient,
  userId: string,
): Promise<LinkedRobloxKey[]> {
  if (!userId || !db.robloxApiKey.findMany) return [];
  try {
    const rows = await db.robloxApiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, robloxUsername: true, createdAt: true,
        lastUsedAt: true, createdPasses: true, lastResult: true,
      },
    });
    return rows as LinkedRobloxKey[];
  } catch (err) {
    console.warn("[roblox-api-key] не прочитали список:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Отвязать ключ (кнопка «Удалить» в кабинете).
 *
 * Удаляем строку целиком, а не помечаем: покупатель просил убрать креденшл, и
 * «мы его больше не используем, но храним» — это не то, о чём он просил.
 * Ограничение по `userId` обязательно: id строки чужим быть не должен.
 */
export async function forgetRobloxApiKey(
  db: RobloxApiKeyClient,
  userId: string,
  id: string,
): Promise<boolean> {
  if (!userId || !id || !db.robloxApiKey.deleteMany) return false;
  try {
    const { count } = await db.robloxApiKey.deleteMany({ where: { id, userId } });
    return count > 0;
  } catch (err) {
    console.warn("[roblox-api-key] не удалили:", err instanceof Error ? err.message : err);
    return false;
  }
}
