import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { gamepassAutocreateEnabled } from "@/lib/gamepass-autocreate-flag";
import { loadRobloxApiKeyForUser } from "@/lib/roblox-api-key-store";
import {
  CODE_RE,
  createPassesWithKey,
  sanitizeTargets,
} from "@/lib/gamepass-key-create";
import { MAX_KEY_LEN, looksLikeApiKey } from "../../../../../bots/shared/gamepass-autocreate";

/**
 * Создание геймпасса по ключу покупателя (инструкция V2, шаг «вставь ключ»).
 *
 * Ключ приходит с формы инструкции, уходит транзитом на SG-мост (с RF-хоста
 * Roblox недоступен) и НЕ попадает ни в ответ, ни в логи. В базе он живёт
 * только зашифрованным (`RobloxApiKey`) — решение владельца 06.09.2026:
 * ключ бессрочен, ограничен геймпассами и нужен нам, чтобы чинить созданный
 * пасс без покупателя и создавать пасс сразу на следующем заказе.
 *
 * Второй режим — `useStored` (07.09.2026). Ключ уже привязан (в кабинете или
 * на прошлом заказе), и покупателю не нужно ни ходить в Roblox, ни что-то
 * присылать: одно нажатие в квесте — и пассы созданы. Ровно это уже умеют боты
 * (`createPassesWithStoredKey`), а сайт до сих пор просил ключ заново.
 *
 * Кто владелец ключа в этом режиме, решает КОД ВБ: заказ по коду знает своего
 * покупателя, а `loadRobloxApiKeyForUser` берёт ключ строго этого покупателя и
 * строго на этот ник. «По нику» брать нельзя — чужой ник стал бы способом
 * создать геймпасс на чужом аккаунте.
 *
 * Что остаётся в заказе после удачного создания:
 *   • `AUDIT_GAMEPASS_AUTOCREATED` на каждый пасс — лента событий в TWA и
 *     веб-админке показывает «создан ботом по API-ключу», с ценой и ID;
 *   • строка в `adminNote` — она видна в карточке заказа обеих админок;
 *   • по этим же событиям карточка выкупа в Telegram ставит маркер 🔑.
 *
 * Ответ всегда 200 с `{ ok }`: покупатель должен увидеть человеческий вердикт
 * (`src/lib/gamepass-create-messages.ts`), а не голый HTTP-код. Настоящие
 * отказы — 429 (частим) и 404 (метод выключен флагом).
 */

export const dynamic = "force-dynamic";

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Покупатель этого заказа — единственный, чей ключ здесь разрешено брать. */
async function orderOwnerId(code: string): Promise<string | null> {
  if (!CODE_RE.test(code)) return null;
  const order = await prisma.wbOrder
    .findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: { userId: true },
    })
    .catch(() => null);
  return order?.userId ?? null;
}

/**
 * Есть ли у покупателя привязанный ключ на этот ник.
 *
 * Нужно квесту, чтобы показать дверь «создать сейчас» первой. Отвечает только
 * «да/нет» и только держателю кода заказа — сам ключ отсюда не уходит.
 */
export async function GET(req: NextRequest) {
  if (!gamepassAutocreateEnabled()) {
    return NextResponse.json({ stored: false }, { headers: { "cache-control": "private, no-store" } });
  }
  const { ok } = rateLimit(`gp-stored:${clientIp(req)}`, 30, 0.5);
  if (!ok) return NextResponse.json({ stored: false }, { status: 429 });

  const url = new URL(req.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  const nick = (url.searchParams.get("nick") ?? "").trim().replace(/^@/, "");
  if (!CODE_RE.test(code) || !NICK_RE.test(nick)) {
    return NextResponse.json({ stored: false }, { headers: { "cache-control": "private, no-store" } });
  }
  const userId = await orderOwnerId(code);
  const stored = userId ? Boolean(await loadRobloxApiKeyForUser(userId, nick).catch(() => null)) : false;
  return NextResponse.json({ stored }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  if (!gamepassAutocreateEnabled()) {
    return NextResponse.json({ ok: false, error: "disabled" }, { status: 404 });
  }

  // Создание пасса — операция с побочным эффектом на чужом аккаунте: льём скупо.
  const { ok: allowed, retryAfter } = rateLimit(`gp-create:${clientIp(req)}`, 5, 0.05);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "roblox_error" });
  }

  const useStored = body.useStored === true;
  const nick = typeof body.nick === "string" ? body.nick.trim().replace(/^@/, "") : "";
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const targets = sanitizeTargets(body.targets);

  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "bad_price" });
  }
  if (!NICK_RE.test(nick)) {
    return NextResponse.json({ ok: false, error: "no_universe" });
  }

  let key: string;
  if (useStored) {
    const userId = await orderOwnerId(code);
    const stored = userId ? await loadRobloxApiKeyForUser(userId, nick).catch(() => null) : null;
    if (!stored) return NextResponse.json({ ok: false, error: "no_stored_key" });
    key = stored.key;
  } else {
    key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key || key.length > MAX_KEY_LEN || !looksLikeApiKey(key)) {
      return NextResponse.json({ ok: false, error: "bad_key" });
    }
  }

  const outcome = await createPassesWithKey({ key, nick, code, targets });

  if (outcome.error) {
    return NextResponse.json({ ok: false, error: outcome.error, created: outcome.created });
  }
  console.log(`[gamepass-create] создано пассов: ${outcome.created.length}`);
  return NextResponse.json({ ok: true, created: outcome.created });
}
