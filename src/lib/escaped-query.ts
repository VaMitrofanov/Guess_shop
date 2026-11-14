/**
 * Починка адреса, испорченного HTML-экранированием.
 *
 * С 16.09.2026 WB экранирует текст чата, и ссылка гейта доходила до
 * покупателя как `/guide?source=wb&amp;skip=1&amp;code=…`. Браузер честно
 * разбирает её в параметры `amp;skip` и `amp;code`, гайд их не узнаёт, и код не
 * подставляется (21.09: 14 из 42 гейтов DBS). Новые ссылки уходят без `&`
 * (`/wb/<код>`), а эта функция спасает уже отправленные: снимает префикс
 * `amp;` с имён параметров. `null` — адрес и так чистый.
 */
export function repairEscapedQuery(params: Record<string, string | string[] | undefined>): string | null {
  const keys = Object.keys(params);
  if (!keys.some((key) => /^(?:amp;)+/i.test(key))) return null;
  const query = new URLSearchParams();
  for (const [rawKey, rawValue] of Object.entries(params)) {
    const key = rawKey.replace(/^(?:amp;)+/i, "");
    if (!key || query.has(key)) continue;
    const values = Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue];
    for (const value of values) query.append(key, value);
  }
  return query.toString();
}
