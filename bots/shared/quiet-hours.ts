/** 🌙 Тихие часы напоминаний покупателю (15.11.2026): с 22:00 до 9:00 МСК не пишем —
 *  ночные пуши детям — частая причина блокировки бота. Напоминание уйдёт утром. */
export function isBuyerQuietHourMsk(now = Date.now()): boolean {
  const hour = new Date(now + 3 * 3600_000).getUTCHours();
  return hour >= 22 || hour < 9;
}
