import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { findActiveOrder } from "@/lib/active-order";

/**
 * Живой заказ покупателя для строки «твой заказ» в шапке сайта.
 *
 * Решение владельца 07.09.2026: как только заказ оформлен, человек ходит где
 * хочет — но и в боте, и на сайте у него перед глазами висит «ваш заказ такой-то,
 * статус такой-то». В боте это уже делает приветствие; на сайте — эта строка.
 *
 * Отвечает только про СВОЙ заказ и только вошедшему: `private, no-store`.
 */

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" } as const;

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ order: null }, { headers: PRIVATE });

  const order = await findActiveOrder(userId).catch(() => null);
  if (!order) return NextResponse.json({ order: null }, { headers: PRIVATE });

  return NextResponse.json(
    {
      order: {
        ref: order.ref,
        amount: order.amount,
        status: order.status,
        label: order.label,
        tone: order.tone,
        href: order.href,
        corridor: order.corridor,
        needsGamepass: order.needsGamepass,
      },
    },
    { headers: PRIVATE },
  );
}
