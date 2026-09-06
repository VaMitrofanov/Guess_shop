import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { gamepassAutocreateEnabled } from "@/lib/gamepass-autocreate-flag";
import { verifyGamePassKeyViaBridge } from "@/lib/roblox-gamepass-create";
import { forgetRobloxApiKey, listRobloxApiKeys, rememberRobloxApiKey } from "@/lib/roblox-api-key-store";
import { sendTelegramMessageId } from "@/lib/telegram";
import { formatAdminNotice } from "../../../../../bots/shared/notify-format";
import { MAX_KEY_LEN, looksLikeApiKey } from "../../../../../bots/shared/gamepass-autocreate";

/**
 * Ключ для геймпассов в личном кабинете.
 *
 * Зачем отдельно от инструкции: там ключ просят в момент, когда заказ уже висит
 * и покупателю некогда. В кабинете он привязывается заранее и один раз — дальше
 * человеку остаётся только оплатить, а геймпасс нужной цены мы создадим сами.
 *
 * Проверка здесь НЕ создаёт пасс: заказа ещё нет, и оставлять покупателю
 * геймпасс, которого он не заказывал, нельзя. Мост проверяет обе операции
 * безопасными запросами — чтение списком, запись PATCH-ем несуществующего
 * пасса (`verifyGamePassKeyDirect`). Проверка «полная» именно в этом смысле:
 * `game-pass:read` и `game-pass:write` подтверждаются по отдельности.
 *
 * Ключ не возвращается наружу ни одним ответом и не пишется в логи. В базе
 * живёт зашифрованным (`RobloxApiKey`, AES-256-GCM).
 */

export const dynamic = "force-dynamic";
const PRIVATE = { "cache-control": "private, no-store" } as const;
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

async function ownUserId() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/** Что показываем в кабинете: только метаданные, никогда не сам ключ. */
async function statusFor(userId: string) {
  const keys = await listRobloxApiKeys(userId);
  return {
    enabled: gamepassAutocreateEnabled(),
    keys: keys.map((key) => ({
      id: key.id,
      username: key.robloxUsername,
      linkedAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      createdPasses: key.createdPasses,
    })),
  };
}

export async function GET() {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  return NextResponse.json(await statusFor(userId), { headers: PRIVATE });
}

export async function POST(req: NextRequest) {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  if (!gamepassAutocreateEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404, headers: PRIVATE });
  }

  // Проверка ключа ходит в Roblox через мост — льём скупо и по пользователю,
  // а не только по IP: за одним IP сидит целая квартира.
  const limited = rateLimit(`account-key:${userId}:${clientIp(req)}`, 5, 0.05);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { ...PRIVATE, "retry-after": String(limited.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const nick = typeof body.username === "string" ? body.username.trim().replace(/^@/, "") : "";

  if (!key || key.length > MAX_KEY_LEN || !looksLikeApiKey(key)) {
    return NextResponse.json({ ok: false, error: "bad_key" }, { headers: PRIVATE });
  }
  if (!NICK_RE.test(nick)) {
    return NextResponse.json({ ok: false, error: "no_universe" }, { headers: PRIVATE });
  }

  const verdict = await verifyGamePassKeyViaBridge({ apiKey: key, username: nick });

  if (!verdict.ok) {
    // Неудачную попытку не храним: строка с чужим/протухшим ключом в базе
    // ничего не даёт, а удалять её потом некому.
    console.warn(`[account-key] ключ не принят: ${verdict.error}`);
    return NextResponse.json({ ok: false, error: verdict.error ?? "roblox_error" }, { headers: PRIVATE });
  }

  const saved = await rememberRobloxApiKey({
    key,
    robloxUsername: nick,
    userId,
    result: "verified",
    createdPasses: 0,
  });
  if (saved === "skipped") {
    // Единственная причина — не настроено шифрование. Врать «сохранили» нельзя:
    // покупатель ждёт, что в следующий заказ делать ничего не придётся.
    return NextResponse.json({ ok: false, error: "storage" }, { headers: PRIVATE });
  }

  void notifyAdmins({ userId, nick, updated: saved === "updated" });

  return NextResponse.json({ ok: true, ...(await statusFor(userId)) }, { headers: PRIVATE });
}

export async function DELETE(req: NextRequest) {
  const userId = await ownUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const removed = await forgetRobloxApiKey(userId, id);
  if (!removed) return NextResponse.json({ error: "Ключ не найден" }, { status: 404, headers: PRIVATE });
  return NextResponse.json(await statusFor(userId), { headers: PRIVATE });
}

/**
 * Уведомление админам — по образцу карточки входа на сайт.
 *
 * Смысл не в «ещё одном сигнале», а в том, что такой покупатель обслуживается
 * иначе: его заказ можно закрыть, не дожидаясь, пока он создаст геймпасс.
 * Ключ в сообщение не попадает — только факт и ник.
 */
async function notifyAdmins(opts: { userId: string; nick: string; updated: boolean }): Promise<void> {
  const token = process.env.TG_TOKEN;
  const chatIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) return;

  try {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { name: true, username: true, email: true, tgId: true, vkId: true },
    });
    const orders = await prisma.wbOrder.count({ where: { userId: opts.userId, status: "COMPLETED" } });
    const display = user?.username
      ? `@${user.username}`
      : user?.vkId
        ? `<a href="https://vk.com/id${user.vkId}">${escape(user.name ?? "покупатель")}</a>`
        : escape(user?.name ?? user?.email ?? "покупатель");

    const text = formatAdminNotice({
      marker: "progress",
      zone: "САЙТ",
      title: opts.updated ? "покупатель обновил ключ для геймпассов" : "покупатель привязал ключ для геймпассов",
      lines: [
        `🔑 Ник Roblox: <b>${escape(opts.nick)}</b>`,
        `👤 Юзер: ${display}`,
        orders > 0 ? `🔄 Выполненных заказов: <b>${orders}</b>` : null,
        `📅 ${new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
          year: "numeric", hour: "2-digit", minute: "2-digit",
        })} МСК`,
      ],
      next: "его следующий заказ можно закрыть без ожидания — геймпасс создастся сам",
    });

    await Promise.allSettled(chatIds.map((chatId) => sendTelegramMessageId(token, chatId, text)));
  } catch (err) {
    console.warn("[account-key] уведомление не ушло:", err instanceof Error ? err.message : err);
  }
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
