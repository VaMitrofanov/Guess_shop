import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin, type AdminActor } from "@/lib/admin-access";
import { rateLimit } from "@/lib/rate-limit";
import {
  loadWbDeliveryOrder,
  loadWbDeliveryOverview,
  performWbDeliveryAction,
  WbDeliveryWorkflowError,
} from "@/lib/wb-delivery-workflow";

function actorKey(actor: AdminActor) {
  return actor.via === "telegram" ? `tg:${actor.telegramId}` : `user:${actor.userId ?? "unknown"}`;
}

function mutationOriginAllowed(req: Request) {
  if ((req.headers.get("authorization") ?? "").startsWith("Bearer ")) return true;
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const allowedOrigins = new Set([
    new URL(req.url).origin,
    "https://robloxbank.ru",
    "https://www.robloxbank.ru",
  ]);
  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL, process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
      if (parsed.protocol === "https:" || localHttp) allowedOrigins.add(parsed.origin);
    } catch {
      // Invalid environment values never widen the allowlist.
    }
  }
  return Boolean(origin && allowedOrigins.has(origin) && (!fetchSite || fetchSite === "same-origin"));
}

export async function wbDeliveryGet(req: Request) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const orderId = new URL(req.url).searchParams.get("orderId");
    if (orderId) {
      if (!/^[a-z0-9_-]{1,80}$/i.test(orderId)) {
        return NextResponse.json({ error: "Некорректный ID заказа", code: "VALIDATION_ERROR" }, { status: 400 });
      }
      const order = await loadWbDeliveryOrder(orderId);
      if (!order) return NextResponse.json({ error: "Заказ не найден", code: "ORDER_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ generatedAt: new Date().toISOString(), order }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return NextResponse.json(await loadWbDeliveryOverview(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code === "P2021" ? "SCHEMA_NOT_READY" : "LOAD_FAILED";
    return NextResponse.json({ error: "Контур WB DBS пока недоступен", code }, { status: 503 });
  }
}

export async function wbDeliveryPost(req: Request) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!mutationOriginAllowed(req)) {
    return NextResponse.json({ error: "Недопустимый источник запроса", code: "ORIGIN_REJECTED" }, { status: 403 });
  }
  const limited = rateLimit(`wb-delivery:${actorKey(actor)}`, 30, 0.5);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Слишком много действий. Подождите несколько секунд.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await performWbDeliveryAction(actorKey(actor), body), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof WbDeliveryWorkflowError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const code = (error as { code?: string } | null)?.code === "P2021" ? "SCHEMA_NOT_READY" : "ACTION_FAILED";
    return NextResponse.json({ error: "Действие не выполнено", code }, { status: 500 });
  }
}
