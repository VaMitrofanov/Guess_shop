import "server-only";

import { prisma } from "@/lib/prisma";

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

/**
 * Коды гейта заказов доставки, чей номер WB содержит `digits`.
 *
 * Возвращает пустой массив на любой осечке: поиск обязан продолжить работать
 * по остальным ключам, даже если таблица доставки недоступна.
 */
export async function gateCodesForWbOrderNumber(digits: string): Promise<string[]> {
  if (!looksLikeWbOrderNumber(digits)) return [];
  try {
    const rows = await prisma.wbMarketplaceOrder.findMany({
      where: { wbOrderId: { contains: digits } },
      select: { wbCode: { select: { code: true } } },
      orderBy: { firstSeenAt: "desc" },
      take: MAX_CODES,
    });
    return rows
      .map((row) => row.wbCode?.code)
      .filter((code): code is string => Boolean(code));
  } catch {
    return [];
  }
}
