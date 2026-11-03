import "server-only";

import { prisma } from "@/lib/prisma";
import { wbSecretHmac } from "../../bots/shared/wb-delivery-crypto";

/* ─────────────────────────────────────────────────────────────────────────────
   Номер заказа WB → заказ на выкуп.

   У `WbOrder` нет поля с номером заказа Wildberries, и завести его нельзя
   задёшево: номер принадлежит доставке, а не выкупу, и у обычной печатной карты
   его нет вовсе. Связь идёт через код гейта:

       WbMarketplaceOrder.wbOrderId → WbMarketplaceOrder.wbCode.code → WbOrder.wbCode

   Из-за этого поиск по `5674129925` находил строку доставки, но ноль заказов:
   номер, которым покупатель называет свой заказ в чате WB, не приводил к
   карточке, где с этим заказом работают (разбор 05.09.2026). Один индексный
   запрос закрывает разрыв — дешевле денормализации, которую пришлось бы
   поддерживать в одиннадцати местах, где рождается `WbOrder`.

   Порог в пять цифр — не вкусовщина: номера WB десятизначные, а короткий
   фрагмент по `contains` притянул бы случайные заказы. Всё, что короче,
   остаётся ID геймпасса и TG/VK-идентификатором, как и было.
   ───────────────────────────────────────────────────────────────────────── */

/** Минимум цифр, при котором запрос вообще похож на номер заказа WB. */
export const WB_ORDER_NUMBER_MIN_DIGITS = 5;

/** Сколько заказов доставки разворачиваем в коды: защита от «1»-подобных запросов. */
const MAX_CODES = 20;

export function looksLikeWbOrderNumber(digits: string): boolean {
  return digits.length >= WB_ORDER_NUMBER_MIN_DIGITS;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Код доставки WB → заказ (27.10.2026).

   Покупатель называет заказ то номером, то 5–6-значным кодом из приложения WB,
   и админке нужно находить его по обоим. Открытым текстом код у нас не живёт:
   после `receive` конверт затирается в `PURGED`, но `codeHmac` остаётся — по
   нему и ищем, точным совпадением (код не фрагмент, `contains` тут бессмыслен).
   Это только админский поиск: покупательский путь со своим лимитом попыток —
   `bots/shared/wb-buyer-link.ts`. Код есть лишь у заказов, где покупатель сам
   прислал его в чат WB (~18 %), у остальных поиск по коду честно пуст.
   ───────────────────────────────────────────────────────────────────────── */

export function looksLikeDeliveryCode(digits: string): boolean {
  return /^\d{5,7}$/.test(digits);
}

/**
 * Заказы доставки, чей код доставки равен `digits`: их id и коды гейта.
 * Пусто на любой осечке — включая ненастроенный ключ шифрования.
 */
export async function dbsOrdersForDeliveryCode(
  digits: string,
): Promise<{ ids: string[]; codes: string[] }> {
  const empty = { ids: [], codes: [] };
  if (!looksLikeDeliveryCode(digits)) return empty;
  try {
    const hmac = wbSecretHmac(digits, "delivery-code");
    const rows = await prisma.wbDeliverySecret.findMany({
      where: { codeHmac: hmac },
      orderBy: { receivedAt: "desc" },
      take: MAX_CODES,
      select: {
        marketplaceOrderId: true,
        marketplaceOrder: { select: { wbCode: { select: { code: true } } } },
      },
    });
    return {
      ids: rows.map((row) => row.marketplaceOrderId),
      codes: rows
        .map((row) => row.marketplaceOrder.wbCode?.code)
        .filter((code): code is string => Boolean(code)),
    };
  } catch {
    return empty;
  }
}

/**
 * Коды гейта заказов доставки, чей номер WB содержит `digits` — или чей код
 * доставки равен `digits`.
 *
 * Возвращает пустой массив на любой осечке: поиск обязан продолжить работать
 * по остальным ключам, даже если таблица доставки недоступна.
 */
export async function gateCodesForWbOrderNumber(digits: string): Promise<string[]> {
  if (!looksLikeWbOrderNumber(digits)) return [];
  const [byNumber, byDeliveryCode] = await Promise.all([
    prisma.wbMarketplaceOrder.findMany({
      where: { wbOrderId: { contains: digits } },
      select: { wbCode: { select: { code: true } } },
      orderBy: { firstSeenAt: "desc" },
      take: MAX_CODES,
    }).then((rows) => rows
      .map((row) => row.wbCode?.code)
      .filter((code): code is string => Boolean(code)))
      .catch(() => [] as string[]),
    dbsOrdersForDeliveryCode(digits).then((found) => found.codes),
  ]);
  return [...new Set([...byNumber, ...byDeliveryCode])];
}
