import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CodeOrderError, codesSalesOpen, createCodeOrder, payUrlFor } from "@/lib/codes/orders";
import { claimReferralCode, ensureReferralCode, viewerCodeDiscount } from "@/lib/codes/referral";
import { codesInstantDelivery } from "@/lib/codes/fulfillment";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 🎟 Коды и приглашения для TG/VK-ботов (15.11.2026).
 *
 * Бот не считает цены и не создаёт заказы сам: сумму, скидку и ссылку на
 * оплату даёт сервер — тот же `createCodeOrder`, что у сайта. Покупатель бота
 * опознаётся по tgId/vkId (как в оплате прямых заказов); его аккаунт — тот же
 * `User`, поэтому скидка и приглашения общие с сайтом.
 */

const Base = z.object({ platform: z.enum(["TG", "VK"]), subject: z.string().trim().regex(/^\d{1,20}$/) });
const Schema = z.discriminatedUnion("action", [
  Base.extend({ action: z.literal("view") }),
  Base.extend({ action: z.literal("order"), denomination: z.number().int().positive(), idempotencyKey: z.uuid() }),
  Base.extend({ action: z.literal("referral"), code: z.string().trim().regex(/^[a-z0-9]{6,12}$/) }),
]);

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
}

async function userFor(platform: "TG" | "VK", subject: string) {
  const where = platform === "TG" ? { tgId: subject } : { vkId: subject };
  const found = await prisma.user.findUnique({ where, select: { id: true, createdAt: true } });
  if (found) return found;
  // Бот ещё не завёл профиль (человек сразу нажал «Код»). Гонка с ботом — по unique.
  try {
    return await prisma.user.create({ data: where, select: { id: true, createdAt: true } });
  } catch {
    return prisma.user.findUniqueOrThrow({ where, select: { id: true, createdAt: true } });
  }
}

export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const parsed = Schema.safeParse(signed.body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad request" }, { status: 400, headers: internalNoStore });
  const input = parsed.data;
  const user = await userFor(input.platform, input.subject);

  try {
    if (input.action === "view") {
      const [discount, referralCode] = await Promise.all([viewerCodeDiscount(user.id), ensureReferralCode(user.id)]);
      return NextResponse.json({
        ok: true,
        salesOpen: codesSalesOpen(),
        instant: codesInstantDelivery(),
        discountPercent: discount.percent,
        invitedCount: discount.invitedCount,
        referralCode,
        siteLink: `${appUrl()}/r/${referralCode}`,
      }, { headers: internalNoStore });
    }

    if (input.action === "referral") {
      const result = await claimReferralCode(user.id, { code: input.code, at: Date.now() });
      return NextResponse.json({ ok: true, result }, { headers: internalNoStore });
    }

    const { order, reused } = await createCodeOrder({
      denomination: input.denomination,
      userId: user.id,
      createdVia: "SELF",
      channel: input.platform,
      idempotencyKey: input.idempotencyKey,
    });
    return NextResponse.json({
      ok: true,
      reused,
      publicId: order.publicId,
      denomination: order.denomination,
      finalAmountKopecks: order.finalAmountKopecks,
      baseAmountKopecks: order.baseAmountKopecks,
      discountPercent: order.discountPercent,
      payUrl: payUrlFor(order.id),
      instant: codesInstantDelivery(),
    }, { status: reused ? 200 : 201, headers: internalNoStore });
  } catch (error) {
    if (error instanceof CodeOrderError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status, headers: internalNoStore });
    }
    console.error("[bot-codes] failed", { action: input.action, error: (error as Error)?.message });
    return NextResponse.json({ ok: false, error: "Не получилось. Попробуй ещё раз через минуту." }, { status: 500, headers: internalNoStore });
  }
}
