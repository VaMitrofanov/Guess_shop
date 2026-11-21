/** 🎄 Новогодний сезон витрины: с 1 декабря по 14 января включительно (МСК). */
export function isNewYearSeason(now = new Date()): boolean {
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const month = msk.getUTCMonth();
  const day = msk.getUTCDate();
  return month === 11 || (month === 0 && day <= 14);
}
