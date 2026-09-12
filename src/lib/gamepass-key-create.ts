/**
 * Создание геймпассов ключом покупателя — общее ядро веб-стороны.
 *
 * Одна и та же операция нужна в трёх местах, и порядок побочных эффектов у неё
 * обязан быть один: инструкция («пришли ключ»), личный кабинет (ключ привязали
 * заранее — и заказ, который висит прямо сейчас, надо доделать самим) и
 * одно-нажатие «создать сохранённым ключом» в квесте. Пока этот порядок жил
 * внутри роута, второе и третье место просто не существовали: ключ в кабинете
 * ничего не делал, о чём владелец и написал 07.09.2026 — «привязал ключ, а с
 * живым висящим заказом не создался гп, не спарсился ник, ничего кроме уведа».
 *
 * Правила ровно те же, что у ботов (`bots/shared/gamepass-autocreate.ts`):
 * ключ не логируется и не возвращается; пассы создаются по одному по порядку;
 * ни один побочный эффект не превращает созданный пасс в ошибку для покупателя.
 */

import { prisma } from "@/lib/prisma";
import { createGamePassViaBridge } from "@/lib/roblox-gamepass-create";
import { rememberRobloxApiKey } from "@/lib/roblox-api-key-store";
import { appendOrderAudit } from "@/lib/order-recovery";
import { auditGamepassAutocreated, type OrderAuditClient } from "@/lib/order-audit";

/** Больше двух пассов на один заказ не бывает (разбивка номинала 2000). */
export const MAX_TARGETS = 2;
export const MIN_PRICE = 1;
export const MAX_PRICE = 100_000;
export const CODE_RE = /^[A-Z0-9]{7}$/;

export interface CreatedPass {
  gamePassId: number;
  priceInRobux: number;
  name?: string;
  universeId?: string;
}

export interface KeyCreateOutcome {
  created: CreatedPass[];
  /** Машинный код отказа: `bad_scope`, `not_authorized`, … Пусто — всё создано. */
  error?: string;
}

/** Отсечь мусор из цен: только целые в разумных пределах, не больше двух. */
export function sanitizeTargets(raw: unknown): number[] {
  return (Array.isArray(raw) ? raw : [])
    .map((t) => Number(t))
    .filter((t) => Number.isInteger(t) && t >= MIN_PRICE && t <= MAX_PRICE)
    .slice(0, MAX_TARGETS);
}

/**
 * Создать пассы и оставить след.
 *
 * Первый отказ останавливает набор: причина у всех целей одна, а половина
 * набора лучше нуля — заказ соберётся из созданного и уже выставленного.
 */
export async function createPassesWithKey(opts: {
  key: string;
  nick: string;
  /** Код ВБ, если заказ известен: по нему находится заказ для следа. */
  code: string;
  targets: number[];
}): Promise<KeyCreateOutcome> {
  const created: CreatedPass[] = [];
  let failure: string | undefined;

  for (const priceInRobux of opts.targets) {
    const res = await createGamePassViaBridge({ apiKey: opts.key, priceInRobux, username: opts.nick });
    if (!res.ok || !res.gamePassId) {
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

  if (created.length > 0) {
    await recordCreation({
      code: opts.code,
      nick: opts.nick,
      key: opts.key,
      created,
      partial: Boolean(failure),
    }).catch((err) => {
      console.warn("[gamepass-create] след не записан:", err instanceof Error ? err.message : err);
    });
  }

  return failure ? { created, error: failure } : { created };
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
