import { after, NextRequest, NextResponse } from "next/server";
import { ClientSignalSchema, formatClientSignal } from "@/lib/client-observability";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function alertOperators(summary: string) {
  const token = process.env.TG_TOKEN?.trim();
  const chatIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!token || chatIds.length === 0) return;

  await Promise.all(chatIds.map((chatId) => sendTelegramMessage(
    token,
    chatId,
    `⚠️ <b>Сайт: клиентский сигнал</b>\n${escapeHtml(summary)}`,
  )));
}

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
  const shouldAlert = signal.type === "client-error" || signal.rating === "poor";

  after(async () => {
    console.warn("[client-observability]", summary);
    if (!shouldAlert) return;

    // A separate global bucket prevents a broken client release from flooding
    // the operator chat while preserving the structured server log for every
    // accepted signal.
    const alertLimit = rateLimit("client-observability:operator-alert", 4, 1 / 900);
    if (alertLimit.ok) await alertOperators(summary);
  });

  return NextResponse.json(
    { accepted: true },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
