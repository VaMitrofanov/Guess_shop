import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { CodeOrderError } from "@/lib/codes/orders";
import { claimReferral, REFERRAL_COOKIE } from "@/lib/codes/referral";

/** id вошедшего покупателя или null. */
export async function sessionUserId(): Promise<string | null> {
  const session = await auth().catch(() => null);
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/**
 * Привязка приглашения по подписанной куке `rb_ref` — на каждом серверном
 * входе контура кодов (каталог, заказ, кабинет). Безопасно звать много раз:
 * привязка ставится один раз и только новому аккаунту.
 */
export async function claimReferralFromCookies(userId: string): Promise<void> {
  try {
    const value = (await cookies()).get(REFERRAL_COOKIE)?.value;
    if (value) await claimReferral(userId, value);
  } catch (error) {
    console.error("[codes] referral claim failed", { error: (error as Error)?.message });
  }
}

export function codeErrorResponse(error: unknown): NextResponse {
  if (error instanceof CodeOrderError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[codes] request failed", { error: (error as Error)?.message });
  return NextResponse.json({ error: "Не получилось. Попробуйте ещё раз через минуту." }, { status: 500 });
}

export const noStore = { "cache-control": "private, no-store" } as const;
