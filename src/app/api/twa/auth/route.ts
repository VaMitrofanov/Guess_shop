import { NextRequest, NextResponse } from "next/server";
import { validateInitData, isAdmin, signTwaToken } from "@/lib/twa-auth";

export async function POST(req: NextRequest) {
  const { initData } = await req.json().catch(() => ({ initData: "" }));
  if (!initData) return NextResponse.json({ error: "No initData" }, { status: 400 });

  const result = validateInitData(initData);
  if (!result.valid) return NextResponse.json({ error: "Invalid initData" }, { status: 401 });
  if (!isAdmin(result.userId)) return NextResponse.json({ error: "Not admin" }, { status: 403 });

  const token = await signTwaToken(result.userId!, result.firstName ?? "Admin");
  return NextResponse.json({ token, firstName: result.firstName });
}
