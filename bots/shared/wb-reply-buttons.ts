/* ─────────────────────────────────────────────────────────────────────────────
   Кнопки «ответить в чат WB» под уведом и связь «сообщение в Telegram → заказ»
   (15.11.2026). Отдельно от `wb-chat-reply.ts`: этот модуль тянет и ВК-бот
   (через уведы), а в его образе нет API WB и zod (`bot-module-graph.test.ts`).
   ───────────────────────────────────────────────────────────────────────── */

import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "wbSyncCursor">;

export const WB_REPLY_CB = "wbr";
export type WbReplyKind = "g" | "c" | "r" | "w";

/** Кнопки под уведом «покупатель пишет». `callback_data` ≤ 64 байт: `wbr:g:<wbOrderId>`. */
export function wbReplyMarkup(wbOrderId: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const cb = (k: WbReplyKind) => `${WB_REPLY_CB}:${k}:${wbOrderId}`;
  return {
    inline_keyboard: [
      [{ text: "📖 Инструкция", callback_data: cb("g") }, { text: "🔑 Пришлите код", callback_data: cb("c") }],
      [{ text: "🚚 Курьера нет", callback_data: cb("r") }, { text: "✍️ Свой ответ", callback_data: cb("w") }],
    ],
  };
}

export function parseWbReplyCallback(data: string): { kind: WbReplyKind; wbOrderId: string } | null {
  const m = /^wbr:([gcrw]):([0-9A-Za-z_-]{1,40})$/.exec(data);
  return m ? { kind: m[1] as WbReplyKind, wbOrderId: m[2] } : null;
}

/* ── «ответ на увед → заказ» ─────────────────────────────────────────────── */

const MAP_STREAM = "wb-reply-map";
const MAP_CAP = 500;
type ReplyMap = { m: Record<string, string>; order: string[] };

async function loadMap(db: Db): Promise<ReplyMap> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: MAP_STREAM } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as Partial<ReplyMap>;
  return { m: meta.m ?? {}, order: meta.order ?? [] };
}

/** Запомнить: это сообщение в Telegram — увед по заказу `wbOrderId`. */
export async function rememberWbReplyMessage(db: Db, chatId: string | number, messageId: number, wbOrderId: string): Promise<void> {
  const map = await loadMap(db);
  const key = `${chatId}:${messageId}`;
  if (!map.m[key]) map.order.push(key);
  map.m[key] = wbOrderId;
  while (map.order.length > MAP_CAP) delete map.m[map.order.shift()!];
  await db.wbSyncCursor.upsert({
    where: { stream: MAP_STREAM },
    create: { stream: MAP_STREAM, metadata: map as never },
    update: { metadata: map as never },
  }).catch(() => undefined);
}

export async function wbOrderForMessage(db: Db, chatId: string | number, messageId: number): Promise<string | null> {
  return (await loadMap(db)).m[`${chatId}:${messageId}`] ?? null;
}

