import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createGamePassViaBridge } from "@/lib/roblox-gamepass-create";
import { gamepassAutocreateEnabled } from "@/lib/gamepass-autocreate-flag";
import { rememberRobloxApiKey } from "@/lib/roblox-api-key-store";
import { appendOrderAudit } from "@/lib/order-recovery";
import { auditGamepassAutocreated, type OrderAuditClient } from "@/lib/order-audit";

/**
 * Создание геймпасса по ключу покупателя (инструкция V2, шаг «вставь ключ»).
 *
 * Ключ приходит с формы инструкции, уходит транзитом на SG-мост (с RF-хоста
 * Roblox недоступен) и НЕ попадает ни в ответ, ни в логи. В базе он живёт
 * только зашифрованным (`RobloxApiKey`) — решение владельца 06.09.2026:
 * ключ бессрочен, ограничен геймпассами и нужен нам, чтобы чинить созданный
 * пасс без покупателя и создавать пасс сразу на следующем заказе.
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

/** Больше двух пассов на один заказ не бывает (разбивка номинала 2000). */
const MAX_TARGETS = 2;
const MIN_PRICE = 1;
const MAX_PRICE = 100_000;
/** Ключ Open Cloud — длинный блоб; всё, что заметно длиннее, к нам не относится. */
const MAX_KEY_LEN = 4000;
const CODE_RE = /^[A-Z0-9]{7}$/;
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

interface CreatedPass {
  gamePassId: number;
  priceInRobux: number;
  name?: string;
  universeId?: string;
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

  const key = typeof body.key === "string" ? body.key.trim() : "";
  const nick = typeof body.nick === "string" ? body.nick.trim().replace(/^@/, "") : "";
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  const targets = rawTargets
    .map((t) => Number(t))
    .filter((t) => Number.isInteger(t) && t >= MIN_PRICE && t <= MAX_PRICE)
    .slice(0, MAX_TARGETS);

  if (!key || key.length > MAX_KEY_LEN) {
    return NextResponse.json({ ok: false, error: "bad_key" });
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "bad_price" });
  }
  if (!NICK_RE.test(nick)) {
    return NextResponse.json({ ok: false, error: "no_universe" });
  }

  // Пассы создаём по одному и по порядку: create не идемпотентен, а параллельный
  // запуск на одном ключе легко ловит лимиты Roblox.
  const created: CreatedPass[] = [];
  let failure: string | null = null;
  for (const priceInRobux of targets) {
    const res = await createGamePassViaBridge({ apiKey: key, priceInRobux, username: nick });
    if (!res.ok || !res.gamePassId) {
      // Первый пасс мог уже создаться — отдаём его, чтобы заказ собрался хотя бы наполовину.
      failure = res.error ?? "roblox_error";
      console.warn(`[gamepass-create] отказ: ${failure} (создано ${created.length})`);
      break;
    }
    created.push({
      gamePassId: res.gamePassId,
      priceInRobux: res.priceInRobux ?? priceInRobux,
      name: res.name,
      universeId: res.universeId,
    });
  }

  // Побочные эффекты — только когда что-то реально создано. Ни один из них не
  // должен превратить созданный пасс в ошибку для покупателя.
  if (created.length > 0) {
    await recordCreation({ code, nick, key, created, partial: Boolean(failure) }).catch((err) => {
      console.warn("[gamepass-create] след не записан:", err instanceof Error ? err.message : err);
    });
  }

  if (failure) {
    return NextResponse.json({ ok: false, error: failure, created });
  }
  console.log(`[gamepass-create] создано пассов: ${created.length}`);
  return NextResponse.json({ ok: true, created });
}

/**
 * След созданного пасса: событие аудита на каждый пасс, строка в заметке заказа
 * и сохранённый ключ. Заказа может не быть вовсе (покупка на сайте без кода WB) —
 * тогда остаётся только ключ.
 */
async function recordCreation(opts: {
  code: string;
  nick: string;
  key: string;
  created: CreatedPass[];
  partial: boolean;
}): Promise<void> {
  const order = CODE_RE.test(opts.code)
    ? await prisma.wbOrder.findFirst({
        where: { wbCode: { equals: opts.code, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, userId: true, adminNote: true },
      })
    : null;

  await rememberRobloxApiKey({
    key: opts.key,
    robloxUsername: opts.nick,
    userId: order?.userId ?? null,
    orderId: order?.id ?? null,
    result: opts.partial ? "partial" : "ok",
    createdPasses: opts.created.length,
  });

  if (!order) return;

  for (const pass of opts.created) {
    await auditGamepassAutocreated(prisma as unknown as OrderAuditClient, {
      gamepassId: String(pass.gamePassId),
      price: pass.priceInRobux,
      robloxUsername: opts.nick,
      orderId: order.id,
      universeId: pass.universeId ?? null,
    });
  }

  // Заметка — то, что админ видит в карточке заказа и в TWA, не открывая ленту.
  const line = `🔑 Пасс создан по API-ключу покупателя: ${opts.created
    .map((p) => `${p.gamePassId} · ${p.priceInRobux} R$`)
    .join(", ")}`;
  await prisma.wbOrder.update({
    where: { id: order.id },
    data: { adminNote: appendOrderAudit(order.adminNote, line) },
  });
}
