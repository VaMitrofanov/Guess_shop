import { NextResponse } from "next/server";
import { storefrontPulse } from "@/lib/storefront-pulse";

export const dynamic = "force-dynamic";

/** Лента выдач, счётчик и отзывы WB для главной. Кэш в памяти — минута. */
export async function GET() {
  try {
    const pulse = await storefrontPulse();
    return NextResponse.json(pulse, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
  } catch (error) {
    console.error("[pulse] failed", { error: (error as Error)?.message });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
