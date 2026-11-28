/* ─────────────────────────────────────────────────────────────────────────────
   🎫 «Застрял на геймпассе» — админам только когда покупатель правда застрял
   (17.11.2026, владелец: вариант 1, порог 3).

   Было: TG-бот на ПЕРВУЮ же ошибку пасса (не та цена, не в продаже, закрытая
   игра) слал в ленту свой `⚠️ НЕВЕРНЫЙ ГЕЙМПАСС` — хотя бот в тот же момент
   объясняет покупателю, что исправить. В VK такого уведа не было вовсе.

   Стало, как у «застрял на плейсе» (`no-place-notice.ts`):
   • каждая ошибка — строкой в ленту заказа (`BOT_DEAD_END`, причина `pass_*`);
   • в беседу — один увед на ТРЕТЬЕЙ неудачной попытке подряд (сутки, память
     процесса); удачная проверка пасса счёт обнуляет;
   • общий язык уведов, тихо, ответом на карточку заказа, кнопка TWA.
   ───────────────────────────────────────────────────────────────────────── */

import { tgSend, escapeHtml } from "./notify";
import { formatAdminNotice, orderRef } from "./notify-format";
import { adminTargetsForNotice, replyToRootFor, twaStartappUrl } from "./admin-route";
import { orderThreadRoots } from "./order-thread";
import { recordBuyerDeadEnd, type BuyerStepClient } from "./buyer-step";

export const GAMEPASS_STUCK_AFTER = 3;
const DAY_MS = 24 * 3_600_000;

export type GamepassFailReason = "pass_price" | "pass_not_for_sale" | "pass_private" | "pass_not_in_catalog";

export interface GamepassFail {
  reason: GamepassFailReason;
  /** Коротко для админа: «цена 1 000 вместо 1 429», «не в продаже». */
  detail: string;
  passId: string;
  at: number;
}

const fails = new Map<string, GamepassFail[]>();

/**
 * Записать неудачу. Возвращает попытки, если это ровно `GAMEPASS_STUCK_AFTER`-я
 * за сутки (пора звать человека), иначе `null`.
 */
export function noteGamepassFail(key: string, fail: Omit<GamepassFail, "at">, now = Date.now()): GamepassFail[] | null {
  for (const [k, list] of fails) if (list.every((f) => now - f.at >= DAY_MS)) fails.delete(k);
  const recent = (fails.get(key) ?? []).filter((f) => now - f.at < DAY_MS);
  recent.push({ ...fail, at: now });
  fails.set(key, recent);
  return recent.length === GAMEPASS_STUCK_AFTER ? recent : null;
}

/** Пасс прошёл проверку — счёт с нуля. */
export function clearGamepassFails(key: string): void {
  fails.delete(key);
}

/** Для тестов. */
export function resetGamepassFails(): void {
  fails.clear();
}

export function gamepassStuckText(input: {
  via: "tg-bot" | "vk-bot";
  wbCode: string | null;
  denomination: number | null;
  /** Уже HTML (ссылка на профиль) — вызывающий экранирует сам. */
  buyerHtml: string | null;
  attempts: GamepassFail[];
}): string {
  const last = input.attempts[input.attempts.length - 1];
  const details = [...new Set(input.attempts.map((a) => a.detail))];
  return formatAdminNotice({
    marker: "waiting",
    zone: "ПОДДЕРЖКА",
    title: "застрял на геймпассе",
    lines: [
      orderRef({ code: input.wbCode, denomination: input.denomination }, [
        input.buyerHtml,
        input.via === "tg-bot" ? "TG" : "VK",
      ]),
      `🎫 <code>${escapeHtml(last?.passId ?? "—")}</code> · ${input.attempts.length} попытки: ${escapeHtml(details.join("; "))}`,
    ],
  });
}

/**
 * Неудача проверки пасса в боте: строка в ленту заказа и, на третьей
 * попытке, увед в беседу. Никогда не бросает — поток покупателя важнее.
 */
export async function reportGamepassFail(
  db: BuyerStepClient,
  input: {
    via: "tg-bot" | "vk-bot";
    userKey: string;
    wbCode: string | null;
    denomination: number | null;
    /** HTML покупателя; функция — если его дорого получить (имя из VK), зовётся только для уведа. */
    buyerHtml: string | null | (() => Promise<string | null>);
    fail: Omit<GamepassFail, "at">;
  },
): Promise<void> {
  try {
    if (input.wbCode) {
      void recordBuyerDeadEnd(db, { wbCode: input.wbCode, via: input.via, reason: input.fail.reason });
    }
    const attempts = noteGamepassFail(input.userKey, input.fail);
    if (!attempts) return;
    const buyerHtml = typeof input.buyerHtml === "function"
      ? await input.buyerHtml().catch(() => null)
      : input.buyerHtml;
    const text = gamepassStuckText({ ...input, buyerHtml, attempts });
    const notice = { marker: "waiting" as const, zone: "ПОДДЕРЖКА" as const };
    const [targets, roots] = await Promise.all([
      adminTargetsForNotice(notice),
      orderThreadRoots(db as never, input.wbCode),
    ]);
    const twaUrl = twaStartappUrl(input.wbCode);
    const markup = twaUrl ? { reply_markup: { inline_keyboard: [[{ text: "📱 Открыть в TWA", url: twaUrl }]] } } : {};
    await Promise.allSettled(targets.map((t) => tgSend(t.chatId, text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...markup,
      ...replyToRootFor(roots, t),
      ...t.extra,
    })));
  } catch (err) {
    console.warn("[gamepass-stuck] не отправлено:", err instanceof Error ? err.message : err);
  }
}
