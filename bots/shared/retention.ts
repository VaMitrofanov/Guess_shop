/**
 * Ретенция служебных данных (ultra-review U12).
 *
 * До этого `deleteMany` был во всём проекте ровно один — для
 * `TelegramWebLoginChallenge`. `PriceQuote`, `EmailActionToken` и `OrderEvent`
 * не чистились никогда, и в связке с обходом rate-limit (U2) это был вектор
 * неограниченного роста продовой БД анонимными запросами.
 *
 * `ConsentEvidence` НЕ трогаем — это юридическое доказательство согласия.
 * `OrderEvent` старше 18 месяцев не удаляем без решения владельца: это аудит
 * денежных операций; сейчас только считаем и показываем в логе.
 */

import { db } from "./db";

export const RETENTION = {
  /** Неиспользованные котировки: живут 15 минут, храним неделю на разбор. */
  priceQuoteDays: 7,
  /** Одноразовые ссылки из писем: TTL часы, храним месяц на разбор жалоб. */
  emailTokenDays: 30,
  /** Порог, после которого стоит принимать решение об архиве OrderEvent. */
  orderEventMonths: 18,
} as const;

export type RetentionReport = {
  priceQuotesDeleted: number;
  emailTokensDeleted: number;
  orderEventsOverdue: number;
};

export async function runRetention(now = Date.now()): Promise<RetentionReport> {
  const quoteCutoff = new Date(now - RETENTION.priceQuoteDays * 86_400_000);
  const tokenCutoff = new Date(now - RETENTION.emailTokenDays * 86_400_000);
  const eventCutoff = new Date(now - RETENTION.orderEventMonths * 30 * 86_400_000);

  // Потреблённые котировки связаны с заказом внешним ключом — удаляем только
  // те, что так и не были использованы.
  const quotes = await (db as any).priceQuote.deleteMany({
    where: {
      status: { not: "CONSUMED" },
      expiresAt: { lt: quoteCutoff },
      webOrder: { is: null },
    },
  });

  const tokens = await (db as any).emailActionToken.deleteMany({
    where: { expiresAt: { lt: tokenCutoff } },
  });

  const orderEventsOverdue = await (db as any).orderEvent.count({
    where: { createdAt: { lt: eventCutoff } },
  });

  return {
    priceQuotesDeleted: quotes.count ?? 0,
    emailTokensDeleted: tokens.count ?? 0,
    orderEventsOverdue,
  };
}
