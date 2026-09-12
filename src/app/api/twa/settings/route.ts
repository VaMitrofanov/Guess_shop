import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import {
  AdminSettingsValidationError,
  loadAdminSettingsOverview,
  updateAdminSettings,
} from "@/lib/admin-settings";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(await loadAdminSettingsOverview(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  try {
    const settings = await updateAdminSettings(body);
    revalidateTag("admin-finance", "max");
    revalidateTag("admin-economics", "max");
    return NextResponse.json(settings, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AdminSettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
