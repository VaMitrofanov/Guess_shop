import { after, NextRequest, NextResponse } from "next/server";
import { ClientSignalSchema, formatClientSignal } from "@/lib/client-observability";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`client-observability:${ip}`, 40, 1 / 2);
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

  after(async () => {
    // 📊 Посещение — в базу (раздел админки «Посетители»), не в журнал: их сотни в день.
    if (signal.type === "event") {
      await prisma.performanceSample.create({
        data: { surface: "site-event", route: signal.route, metric: signal.name, rating: signal.value ?? null, fingerprint: signal.visitor },
      }).catch(() => undefined);
      return;
    }
    if (signal.type === "visit") {
      await prisma.performanceSample.create({
        data: { surface: "site-visit", route: signal.route, metric: `${signal.device}:${signal.ref}`, rating: signal.app, fingerprint: signal.visitor },
      }).catch(() => undefined);
      return;
    }
    // Client telemetry belongs in structured application logs. It is
    // intentionally never forwarded to the operational Telegram bot: noisy
    // browser errors/Web Vitals used to bury actionable order notifications.
    console.warn("[client-observability]", summary);
    if (signal.route === "/admin" || signal.route.startsWith("/admin/")) {
      await prisma.performanceSample.create({
        data: signal.type === "web-vital"
          ? {
              surface: "admin-client",
              route: signal.route,
              metric: signal.name,
              value: signal.value,
              rating: signal.rating,
            }
          : {
              surface: "admin-client",
              route: signal.route,
              metric: signal.kind,
              fingerprint: signal.fingerprint,
            },
      }).catch((error: unknown) => {
        console.error("[client-observability persistence]", error instanceof Error ? error.name : "unknown");
      });
    }
  });

  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
