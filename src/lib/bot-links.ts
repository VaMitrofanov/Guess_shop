/**
 * Ссылки в ботов со страниц коридора.
 *
 * Зачем отдельный модуль. Кнопка «Telegram» жила в четырёх местах инструкции, и
 * во всех четырёх при отсутствии кода вела на ГОЛЫЙ `t.me/RobloxBankBot`.
 * Человек, открывший `robloxbank.ru/guide` из запасной строки сообщения WB и не
 * введший код, приходил в бота пустым: бот его не знал, отвечал приветствием
 * «купи напрямую» — и покупатель уходил бродить по сайту. Владелец 07.09.2026:
 * «голая ссылка всё руинит, пользователи тыкают по сайту как неприкаянные».
 *
 * Теперь у ссылки без кода есть свой payload — `wbhelp`. Он ничего не
 * открывает и ничего не активирует: это просто признак «гость пришёл со
 * страницы инструкции, кода у него при себе нет». Бот по нему сначала ищет
 * заказ самого пользователя, а если не находит — просит код с карточки или код
 * доставки из чата Wildberries вместо общего велкома.
 */

export const TG_BOT_URL = "https://t.me/RobloxBankBot";
export const VK_BOT_URL = "https://vk.me/club237309399";

// Значение общее с ботами: сайт его кладёт, бот разбирает.
export { TG_HELP_START, VK_HELP_REF } from "../../bots/shared/bot-links";
import { TG_HELP_START, VK_HELP_REF } from "../../bots/shared/bot-links";

/** Deep-link в Telegram-бота: с кодом — в заказ, без кода — за помощью. */
export function tgBotHref(code?: string | null, sessionId?: string | null): string {
  const clean = code?.trim().toUpperCase();
  if (!clean) return `${TG_BOT_URL}?start=${TG_HELP_START}`;
  const suffix = sessionId ? `_${sessionId}` : "";
  return `${TG_BOT_URL}?start=wb_${encodeURIComponent(clean)}${suffix}`;
}

/**
 * То же самое для ВКонтакте.
 *
 * Половина правки 07.09.2026 осталась несделанной: `t.me` без кода стал нести
 * `wbhelp`, а `vk.me/club…` в тех же местах инструкции остался ГОЛЫМ. Гость из
 * ВК приходил ровно туда же, куда до правки приходил гость из Telegram, — в
 * сообщество, которое его не знает.
 *
 * `ref` передаётся как есть: в него кладут и код ВБ, и код с префиксом `GD`
 * (гайд-режим), и оба значения снимают бот и `src/auth.ts`.
 */
export function vkBotHref(ref?: string | null): string {
  const clean = ref?.trim();
  return `${VK_BOT_URL}?ref=${encodeURIComponent(clean || VK_HELP_REF)}`;
}
