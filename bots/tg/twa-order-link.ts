/* ─────────────────────────────────────────────────────────────────────────────
   Кнопка «открыть этот заказ в TWA» под сообщениями бота в беседе админов
   (13.11.2026).

   Кнопки `web_app` Telegram пускает только в личку с ботом, поэтому здесь —
   ссылка `t.me/<бот>?startapp=<код>`. Она открывает главное мини-приложение
   бота (BotFather → Main Mini App = /twa) поверх беседы; TWA читает
   `start_param` и сразу открывает «Заказы» с поиском по коду (`TwaApp.tsx`).
   Вход — по initData того, кто нажал, поэтому одна кнопка годится всем админам.

   Коды берём из текста сообщения и сверяем с базой: показываем кнопку только
   для заказов, которые действительно есть.
   ───────────────────────────────────────────────────────────────────────── */

import { db } from "../shared/db";

export type UrlButton = { text: string; url: string };

/** `start_param`: латиница, цифры, `_` и `-`, до 64 символов — код заказа влезает. */
export function twaOrderUrl(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?startapp=${encodeURIComponent(code)}`;
}

/** Кандидаты в коды заказа: DIR-XXXXXXXX и 7-символьные коды WB с буквой и цифрой. */
export function orderCodeCandidates(text: string): string[] {
  const plain = text.replace(/<[^>]+>/g, " ");
  const out = new Set<string>();
  for (const m of plain.matchAll(/(?<![A-Za-z0-9-])(DIR-[A-Z0-9]{8}|[A-Z0-9]{7})(?![A-Za-z0-9])/g)) {
    const code = m[1];
    if (code.startsWith("DIR-") || (/[A-Z]/.test(code) && /\d/.test(code))) out.add(code);
  }
  return [...out];
}

/** Ряды кнопок «📱 КОД — открыть в TWA» для заказов из текста (до `max`). */
export async function twaOrderRows(botUsername: string | undefined, text: string, max = 3): Promise<UrlButton[][]> {
  const candidates = orderCodeCandidates(text).slice(0, 20);
  if (!botUsername || candidates.length === 0) return [];
  const found = await db.wbOrder.findMany({ where: { wbCode: { in: candidates } }, select: { wbCode: true } }).catch(() => []);
  const real = new Set(found.map((o) => o.wbCode));
  return candidates
    .filter((c) => real.has(c))
    .slice(0, max)
    .map((code) => [{ text: `📱 ${code} — открыть в TWA`, url: twaOrderUrl(botUsername, code) }]);
}
