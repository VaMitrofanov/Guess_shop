import { NextRequest, NextResponse } from "next/server";
import { runCodesTick } from "@/lib/codes/manual-issue";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Раз в минуту от TG-бота: отложенные подарки и недоставленные сообщения в чат. */
export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const result = await runCodesTick();
  return NextResponse.json({ ok: true, ...result }, { headers: internalNoStore });
}
