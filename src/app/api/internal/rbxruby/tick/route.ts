import { NextRequest, NextResponse } from "next/server";
import { runRbxrubyTick } from "@/lib/rbxruby-buyout";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Раз в минуту от TG-бота: автовыкуп через RBXRUBY (режим — env RBXRUBY_MODE). */
export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const report = await runRbxrubyTick();
  return NextResponse.json({ ok: true, ...report }, { headers: internalNoStore });
}
