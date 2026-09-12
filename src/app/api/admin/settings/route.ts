import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import {
  AdminSettingsValidationError,
  loadAdminSettingsOverview,
  updateAdminSettings,
} from "@/lib/admin-settings";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const authMs = performance.now() - startedAt;
  const data = await loadAdminSettingsOverview();
  return NextResponse.json(data, { headers: {
    ...PRIVATE_HEADERS,
    "Server-Timing": `auth;dur=${authMs.toFixed(1)}, data;dur=${(performance.now() - startedAt - authMs).toFixed(1)}`,
  } });
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const body = await req.json().catch(() => null);
  try {
    const settings = await updateAdminSettings(body);
    revalidateTag("admin-finance", "max");
    revalidateTag("admin-economics", "max");
    return NextResponse.json(settings, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSettingsValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
    }
    throw error;
  }
}
