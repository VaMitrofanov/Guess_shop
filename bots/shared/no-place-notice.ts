/**
 * Покупателю показали инструкцию по плейсу (ключ: «нет игры») — карточка
 * админам и событие заказа. Владелец, 20.10.2026: «прилетает нам в админку,
 * мы сразу видим, что у него нет плейса». Тексты покупателю — `no-place.ts`.
 */

import { formatAdminNotice, orderRef } from "./notify-format";
import { escapeHtml } from "./notify";
import { PLACE_HELP_EVENT } from "./no-place";

export interface PlaceHelpShown {
  via: "tg-bot" | "vk-bot" | "site";
  /** Вердикт ключа: `no_universe` — игр нет вовсе, `games_hidden` — не видим. */
  verdict: string;
  wbCode?: string | null;
  denomination?: number | null;
  nick?: string | null;
  /** Как показать покупателя: @username / имя / id. */
  buyer?: string | null;
}

export function placeHelpAdminText(a: PlaceHelpShown): string {
  return formatAdminNotice({
    marker: "waiting",
    zone: "ПОДДЕРЖКА",
    title: "нет плейса — отправили инструкцию по Studio",
    lines: [
      orderRef({ code: a.wbCode ?? null, denomination: a.denomination ?? null }, [
        a.buyer ? escapeHtml(a.buyer) : null,
        a.via === "site" ? "сайт" : a.via === "tg-bot" ? "TG" : "VK",
      ]),
      a.nick ? `👤 Ник: <code>${escapeHtml(a.nick)}</code>` : null,
      a.verdict === "games_hidden"
        ? "🙈 Игр по нику не видно (скрыты) — возможно, плейса нет вовсе: скорее всего новый аккаунт."
        : "🆕 У аккаунта нет ни одной игры — скорее всего новый аккаунт без плейса.",
      "📖 Ушли шаги: Roblox Studio → New Experience → File → Publish to Roblox.",
    ],
    next: "ждём, пока опубликует плейс и пришлёт ключ ещё раз; застрянет — помочь руками",
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

/** Карточка — не чаще раза в 30 минут на покупателя: повторный ключ не спамит. */
const seen = new Map<string, number>();
export function shouldNotifyPlaceHelp(key: string, now = Date.now()): boolean {
  const last = seen.get(key);
  if (last && now - last < 30 * 60_000) return false;
  seen.set(key, now);
  for (const [k, t] of seen) if (now - t > 2 * 3_600_000) seen.delete(k);
  return true;
}
