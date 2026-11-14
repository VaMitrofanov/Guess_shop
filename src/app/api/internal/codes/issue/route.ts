import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { issueCodeManually } from "@/lib/codes/manual-issue";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  publicId: z.string().trim().regex(/^CODE-[A-Z0-9]{8}$/i),
  code: z.string().trim().min(6).max(64),
  denomination: z.number().int().positive().optional(),
  label: z.string().trim().max(60).optional(),
});

/** Ручная выдача кода по оплаченному заказу (`scripts/codes-issue.mjs`). Код в ответ не возвращается. */
export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const parsed = Schema.safeParse(signed.body);
  if (!parsed.success) return NextResponse.json({ ok: false, status: "bad_request" }, { status: 400, headers: internalNoStore });
  try {
    const result = await issueCodeManually(parsed.data);
    return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: internalNoStore });
  } catch (error) {
    console.error("[codes] manual issue failed", { order: parsed.data.publicId, error: (error as Error)?.message });
    return NextResponse.json({ ok: false, status: "error" }, { status: 500, headers: internalNoStore });
  }
}
