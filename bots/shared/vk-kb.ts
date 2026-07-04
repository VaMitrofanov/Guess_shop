/**
 * VK inline-keyboard limits (Bots API):
 *   • максимум 10 кнопок всего
 *   • максимум 6 рядов
 *   • максимум 5 кнопок в ряду
 *
 * Превышение любого лимита → VK отвергает весь messages.send → исключение →
 * глобальный catch отвечает «⚠️ Произошла ошибка» (P0 2026-07-04: пикер
 * геймпассов прямого заказа строил 7 рядов клиентам с ≥5 пассами — заказ
 * умирал молча, без алертов).
 *
 * `enforceVkInlineKbLimits` — последний рубеж: билдеры обязаны укладываться в
 * лимиты сами, но если что-то переполнилось — громко усекаем (console.warn)
 * вместо падения отправки. ПОСЛЕДНИЙ ряд сохраняется всегда: по конвенции в нём
 * сервисные кнопки («Другой ник» / «Назад» / «Отменить»), без которых юзер
 * остаётся в тупике.
 */

export const VK_INLINE_MAX_BUTTONS = 10;
export const VK_INLINE_MAX_ROWS = 6;
export const VK_INLINE_MAX_PER_ROW = 5;

interface ParsedKb {
  inline?: boolean;
  buttons?: unknown[][];
  [k: string]: unknown;
}

/**
 * Принимает vk-io KeyboardBuilder (или готовую JSON-строку клавиатуры),
 * возвращает JSON-строку, гарантированно вписанную в лимиты VK.
 * vk-io принимает `keyboard` строкой — результат передаётся в ctx.reply как есть.
 */
export function enforceVkInlineKbLimits(kb: unknown, tag = "vk-kb"): string {
  const json = typeof kb === "string" ? kb : JSON.stringify(kb);
  let parsed: ParsedKb;
  try {
    parsed = JSON.parse(json);
  } catch {
    return json; // не наш формат — не трогаем
  }
  const rows = parsed?.buttons;
  if (!Array.isArray(rows) || rows.length === 0) return json;

  // Ряды длиннее 5 кнопок усекаем всегда (VK не примет их в любом случае).
  const clamped: unknown[][] = rows.map((r) =>
    Array.isArray(r) ? r.slice(0, VK_INLINE_MAX_PER_ROW) : [],
  );
  const total = clamped.reduce((s, r) => s + r.length, 0);
  const rowClamped = clamped.some((r, i) => r.length !== (Array.isArray(rows[i]) ? rows[i].length : 0));

  if (!rowClamped && clamped.length <= VK_INLINE_MAX_ROWS && total <= VK_INLINE_MAX_BUTTONS) {
    return json; // в лимитах — отдаём нетронутым
  }

  // Переполнение: резервируем последний ряд (сервисные кнопки), затем набираем
  // ряды сверху, пока влезают.
  const last = clamped[clamped.length - 1];
  const kept: unknown[][] = [];
  let buttons = last.length;
  for (let i = 0; i < clamped.length - 1; i++) {
    const row = clamped[i];
    if (kept.length + 2 > VK_INLINE_MAX_ROWS) break; // +1 этот ряд, +1 последний
    if (buttons + row.length > VK_INLINE_MAX_BUTTONS) break;
    kept.push(row);
    buttons += row.length;
  }
  kept.push(last);

  console.warn(
    `[${tag}] VK inline keyboard за лимитами (rows=${rows.length}, buttons=${total}) — ` +
    `усечено до rows=${kept.length}, buttons=${buttons}`,
  );
  return JSON.stringify({ ...parsed, buttons: kept });
}
