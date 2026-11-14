/**
 * Покупателю показали инструкцию по плейсу (ключ: «нет игры») — карточка
 * админам и событие заказа. Владелец, 20.10.2026: «прилетает нам в админку,
 * мы сразу видим, что у него нет плейса». Тексты покупателю — `no-place.ts`.
 */

import { formatAdminNotice, orderRef } from "./notify-format";
import { escapeHtml } from "./notify";
import { PLACE_HELP_EVENT } from "./no-place";

interface PlaceHelpShown {
  via: "tg-bot" | "vk-bot" | "site";
  /** Вердикт ключа: `no_universe` — игр нет вовсе, `games_hidden` — не видим. */
  verdict: string;
  wbCode?: string | null;
  denomination?: number | null;
  nick?: string | null;
  /** Как показать покупателя: @username / имя / id. */
  buyer?: string | null;
}

/**
 * Карточка админам — ТОЛЬКО когда покупатель застрял (15.11.2026, владелец:
 * «отправить часть инструкции — обычное дело, писать так явно не нужно»).
 * Сам показ инструкции пишется в ленту заказа (`recordPlaceHelp`), а в беседу
 * уходит короткое «застрял», если инструкцию показали `PLACE_HELP_STUCK_AFTER`
 * раз за сутки (`shouldNotifyPlaceHelp`).
 */
export function placeHelpAdminText(a: PlaceHelpShown): string {
  return formatAdminNotice({
    marker: "waiting",
    zone: "ПОДДЕРЖКА",
    title: "застрял на плейсе",
    lines: [
      orderRef({ code: a.wbCode ?? null, denomination: a.denomination ?? null }, [
        a.buyer ? escapeHtml(a.buyer) : null,
        a.via === "site" ? "сайт" : a.via === "tg-bot" ? "TG" : "VK",
        a.nick ? `<code>${escapeHtml(a.nick)}</code>` : null,
      ]),
      `Инструкцию по Studio показали ${PLACE_HELP_STUCK_AFTER} раза за сутки — плейс так и не появился.`,
    ],
    next: "помочь руками",
  });
}

/** Минимум от Prisma-клиента (db в ботах, prisma в Web). */
export type PlaceHelpClient = {
  wbOrder: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  orderEvent: { create: (args: unknown) => Promise<unknown> };
};

/** Пишем в заказ (если он есть). Повтор в течение часа строк не плодит. */
export async function recordPlaceHelp(client: PlaceHelpClient, a: PlaceHelpShown): Promise<void> {
  const code = (a.wbCode ?? "").trim();
  if (!code) return;
  try {
    const order = await client.wbOrder.findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!order) return;
    const bucket = Math.floor(Date.now() / 3_600_000);
    await client.orderEvent.create({
      data: {
        orderId: order.id,
        type: PLACE_HELP_EVENT,
        idempotencyKey: `noplace:${order.id}:${bucket}`,
        payload: { verdict: a.verdict, via: a.via, nick: a.nick ?? null, at: new Date().toISOString() },
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code === "P2002") return;
    console.warn("[no-place] событие не записано:", err instanceof Error ? err.message : err);
  }
}

/** Сколько показов инструкции за сутки значат «застрял». */
export const PLACE_HELP_STUCK_AFTER = 3;
const DAY_MS = 24 * 3_600_000;

/**
 * Звать человека — один раз, на третьем показе за сутки. Первые показы —
 * обычная работа инструкции, о них админам не пишем. Счёт в памяти процесса:
 * после рестарта начинается заново, это допустимо (лишний раз не позовём).
 */
const shows = new Map<string, number[]>();
export function shouldNotifyPlaceHelp(key: string, now = Date.now()): boolean {
  const recent = (shows.get(key) ?? []).filter((t) => now - t < DAY_MS);
  recent.push(now);
  shows.set(key, recent);
  for (const [k, list] of shows) if (list.every((t) => now - t >= DAY_MS)) shows.delete(k);
  return recent.length === PLACE_HELP_STUCK_AFTER;
}
