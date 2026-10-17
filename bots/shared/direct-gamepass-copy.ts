/* ─────────────────────────────────────────────────────────────────────────────
   Что бот говорит покупателю про геймпасс в прямом заказе.

   Один текст на TG и VK: расхождение здесь означает, что два канала объясняют
   человеку разные правила про одни и те же деньги.

   Порядок путей задан владельцем 08.09.2026 и обратен прежнему: сначала ключ
   («один раз и забыл»), потом инструкция, и только потом «пасс уже есть».
   Раньше первым везде стоял «создам сам» — самый долгий путь предлагался как
   основной, а самый быстрый прятался вторым.
   ───────────────────────────────────────────────────────────────────────── */

import { expectedGamepassPrice } from "./gamepass-plan";
import type { DirectRequote } from "./direct-requote";

/** Продажа ключа: почему это лучший путь. Одна формулировка на все экраны. */
export const KEY_PITCH_LINES = [
  "🔑 <b>Сделаем за тебя</b> — самый быстрый путь",
  "Пришлёшь один ключ из Roblox — создадим геймпасс сами, с точной ценой.",
  "• пароль не нужен, ключ отзывается в любой момент",
  "• <b>один раз настроил — и про геймпассы можно забыть</b>: следующие заказы будут создаваться сами",
  "• минута против 3–5 минут ручной возни и цены, которую легко ошибиться",
] as const;

export function keyPitchText(plain = false): string {
  const lines = KEY_PITCH_LINES.join("\n");
  return plain ? lines.replace(/<\/?b>/g, "") : lines;
}

/**
 * Пасс есть, но он не под этот заказ.
 *
 * Ключевая мысль: мы не отказываем. У пасса есть своя честная цена заказа, и мы
 * её называем — человек решает, ехать на неё или поправить пасс.
 */
export function priceMismatchText(opts: {
  passRobux: number;
  totalAmount: number;
  requote: DirectRequote | null;
  plain?: boolean;
}): string {
  const { passRobux, totalAmount, requote } = opts;
  const need = expectedGamepassPrice(totalAmount);
  const lines = [
    `⚠️ <b>Этот геймпасс — под другой объём</b>`,
    "",
    `Твой пасс стоит <b>${passRobux} R$</b>. Roblox удерживает 30%, поэтому за него ты получишь <b>${robuxOf(passRobux)} R$</b>, а не ${totalAmount}.`,
    "",
  ];
  if (requote) {
    lines.push(
      `Два варианта — оба рабочие:`,
      "",
      `1️⃣ <b>Едем на ${requote.totalAmount} R$</b> за <b>${requote.rublePrice} ₽</b> — ничего менять не нужно, пасс уже готов.`,
      `2️⃣ Оставить ${totalAmount} R$ — тогда нужен пасс на <b>${need} R$</b>.`,
    );
  } else {
    lines.push(`Для заказа на ${totalAmount} R$ нужен геймпасс на <b>${need} R$</b>.`);
  }
  lines.push("", ...KEY_PITCH_LINES);
  const text = lines.join("\n");
  return opts.plain ? text.replace(/<\/?b>/g, "") : text;
}

/** Пассов у ника не нашлось вовсе. */
export function noGamepassText(opts: { nick: string; passPrice: number; plain?: boolean }): string {
  const text = [
    `⚠️ У <b>${opts.nick}</b> не нашли геймпассов на продаже.`,
    "",
    `Для заказа нужен один — на <b>${opts.passPrice} R$</b>.`,
    "",
    ...KEY_PITCH_LINES,
    "",
    "📖 Хочешь сам — покажем каждое нажатие с картинкой.",
    "🔢 Пасс уже есть, но поиск его не видит (например, плейс скрыт) — пришли ссылку или номер.",
  ].join("\n");
  return opts.plain ? text.replace(/<\/?b>/g, "") : text;
}

/** Сколько чистых R$ несёт пасс — та же формула, что в `direct-requote`. */
function robuxOf(passRobux: number): number {
  return Math.floor(passRobux * 0.7);
}
