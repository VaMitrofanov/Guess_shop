import { after, NextRequest, NextResponse } from "next/server";
import { ClientSignalSchema, formatClientSignal } from "@/lib/client-observability";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`client-observability:${ip}`, 20, 1 / 3);
  if (!limited.ok) {
    return NextResponse.json(
      { accepted: false },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const parsed = ClientSignalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ accepted: false }, { status: 400 });

  const signal = parsed.data;
  const summary = formatClientSignal(signal);

  after(() => {
    // Client telemetry belongs in structured application logs. It is
    // intentionally never forwarded to the operational Telegram bot: noisy
    // browser errors/Web Vitals used to bury actionable order notifications.
    console.warn("[client-observability]", summary);
  });

  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
