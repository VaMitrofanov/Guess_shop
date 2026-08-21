import { after, NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Приёмник нарушений CSP (ultra-review U10, этап 1).
 *
 * Текущая политика допускает `unsafe-inline` и `unsafe-eval` в `script-src` —
 * на платёжном сайте это главный отсутствующий барьер против XSS. Ужесточать
 * её вслепую нельзя: гейт открывают из Telegram WebView и VK WebView, а
 * поломка входа там видна только по жалобам клиентов.
 *
 * Поэтому рядом с боевой политикой едет строгая `Report-Only`: браузер ничего
 * не блокирует, но присылает сюда всё, что строгая политика запретила бы.
 * Enforce включаем только после чистого отчёта на целевых клиентах.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limited = rateLimit(`csp-report:${ip}`, 30, 1 / 2);
  if (!limited.ok) {
    return new NextResponse(null, {
      status: 429,
      headers: { "retry-after": String(limited.retryAfter) },
    });
  }

  const body = await req.json().catch(() => null);
  // Браузеры шлют либо `{"csp-report": {...}}` (report-uri), либо массив
  // отчётов `[{type:"csp-violation", body:{...}}]` (Reporting API).
  const reports: Record<string, unknown>[] = Array.isArray(body)
    ? body.map((r) => (r?.body ?? r) as Record<string, unknown>)
    : body?.["csp-report"]
      ? [body["csp-report"] as Record<string, unknown>]
      : body
        ? [body as Record<string, unknown>]
        : [];

  if (reports.length === 0) return new NextResponse(null, { status: 400 });

  after(() => {
    for (const r of reports.slice(0, 10)) {
      const directive = r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"];
      const blocked = r["blocked-uri"] ?? r["blockedURL"] ?? r["blockedURI"];
      const doc = r["document-uri"] ?? r["documentURL"];
      const sample = String(r["script-sample"] ?? r["sample"] ?? "").slice(0, 120);
      console.warn(
        `[csp-report] directive=${directive} blocked=${blocked} doc=${doc}` +
        (sample ? ` sample="${sample}"` : ""),
      );
    }
  });

  return new NextResponse(null, { status: 204 });
}
