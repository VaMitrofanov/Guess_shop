import "server-only";

import { prisma } from "@/lib/prisma";
import { sanitizeCodesUsdRub } from "@/lib/codes-pricing";

/**
 * Курс доллара для цен кодов (20.11.2026, решение владельца — вручную):
 * поле «USD → RUB» в настройках TWA (`GlobalSettings.usdToRub`). Цены
 * пересчитываются от прайса при 85 ₽/$ (`bots/shared/codes-pricing.ts`).
 *
 * Кэш на минуту в процессе: витрина зовёт курс на каждый запрос, а один заход
 * в базу с прода — ~200 мс. Сбой базы не закрывает витрину — берём последний
 * известный курс, а без него — опорный 85.
 */

const TTL_MS = 60_000;
let cached: { value: number; at: number } | null = null;

export async function codesUsdRub(now = Date.now()): Promise<number> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const row = await prisma.globalSettings.findUnique({ where: { id: "global" }, select: { usdToRub: true } });
    const value = sanitizeCodesUsdRub(row?.usdToRub);
    cached = { value, at: now };
    return value;
  } catch (error) {
    console.warn("[codes] курс недоступен:", (error as Error)?.message);
    return cached?.value ?? sanitizeCodesUsdRub(null);
  }
}

/** После сохранения настроек — чтобы новая цена появилась сразу, а не через минуту. */
export function forgetCodesUsdRub(): void {
  cached = null;
}
