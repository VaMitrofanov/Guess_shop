import type { PrismaClient, UserIdentityProvider } from "@prisma/client";
import { linkOrMergeVerifiedIdentity, type MergeMethod } from "./account-merge";
import { vkCanReceive } from "./notify";

/* ─────────────────────────────────────────────────────────────────────────────
   Код гейта открывает заказ на ЛЮБОЙ площадке (вариант Б1, решение владельца
   12.09.2026).

   До этого дня человек, начавший заказ через VK на сайте и пришедший потом в
   Telegram, упирался в «⚠️ Этот код уже был активирован другим пользователем» —
   и это был тупик: оспорить можно было только через поддержку. Между тем «другой
   пользователь» в половине случаев — он сам: из ~800 профилей в базе **ни один**
   не имел одновременно TG и VK, то есть вторая площадка означала новый профиль
   всегда.

   Правило разбора владельца кода (по убыванию силы):

     1. владелец — сам предъявитель                         → `mine`;
     2. у владельца УЖЕ есть аккаунт на площадке предъявителя
        (другой subject того же провайдера)                 → `conflict`:
        это две учётки на одной площадке, то есть настоящий второй аккаунт;
     3. у предъявителя есть СВОИ заказы, а владельца не спросить
                                                            → `conflict`:
        сливать двух живых клиентов по одному коду нельзя;
     4. владельцу можно написать                            → `ask_owner`:
        решает он, у себя на площадке, одной кнопкой;
     5. владельцу написать нельзя (VK без диалога)          → `link_now`:
        спрашивать некого, а код на руках — этого достаточно.

   Пункт 2 — то, чем ложная тревога отличается от настоящей. Прежний сторож
   («userId не совпал») ловил на этом собственного владельца при повторном
   входе: 4 срабатывания за 20 часов, все до единого ложные.
   ───────────────────────────────────────────────────────────────────────── */

type Db = Pick<PrismaClient, "user" | "wbOrder" | "wbCode" | "userIdentity" | "$transaction">;

export type ClaimProvider = Extract<UserIdentityProvider, "TG" | "VK">;

export type CodeOwner = {
  id: string;
  tgId: string | null;
  vkId: string | null;
  name: string | null;
  username: string | null;
};

export type CodeClaimVerdict =
  /** Код ещё ничей — обычный путь активации. */
  | { kind: "free" }
  /** Код уже за этим человеком: повторный вход, а не чужая активация. */
  | { kind: "mine"; ownerUserId: string }
  /** Спрашивать некого — площадки можно связать прямо сейчас. */
  | { kind: "link_now"; owner: CodeOwner; ownerLabel: string }
  /** Владелец достижим: спрашиваем его, ничего не трогая. */
  | { kind: "ask_owner"; owner: CodeOwner; ownerLabel: string }
  /** Настоящий второй аккаунт. */
  | { kind: "conflict"; owner: CodeOwner; ownerLabel: string; reason: ConflictReason };

export type ConflictReason = "owner_has_same_platform" | "claimant_has_own_orders";

const OWNER_SELECT = { id: true, tgId: true, vkId: true, name: true, username: true } as const;

export function ownerLabel(owner: CodeOwner): string {
  if (owner.username) return `@${owner.username}`;
  if (owner.name) return owner.name;
  if (owner.tgId) return `tg:${owner.tgId}`;
  if (owner.vkId) return `vk:${owner.vkId}`;
  return "покупатель";
}

/** Куда владельцу можно написать. Telegram-профиль в базе появляется только от
 *  того, что человек сам написал боту, поэтому TG считается достижимым по
 *  построению; проверять нужно ровно VK. */
export async function isOwnerReachable(owner: CodeOwner): Promise<boolean> {
  if (owner.tgId) return true;
  if (!owner.vkId) return false;
  // `null` (VK не ответил) — не повод объявлять человека недостижимым и
  // связывать площадки без спроса: считаем, что написать можно, и спрашиваем.
  return (await vkCanReceive(owner.vkId)) !== false;
}

/**
 * Кто владеет кодом и что с этим делать. Ничего не меняет — только решает.
 *
 * `claimantUserId` может быть ещё не создан (человек впервые пишет боту) — в
 * этом случае передавайте `null`: своих заказов у него по определению нет.
 */
export async function resolveCodeClaim(db: Db, input: {
  code: string;
  claimantUserId: string | null;
  provider: ClaimProvider;
}): Promise<CodeClaimVerdict> {
  const code = await db.wbCode.findUnique({
    where: { code: input.code },
    select: { userId: true, status: true, isUsed: true },
  });
  if (!code?.userId) return { kind: "free" };
  if (input.claimantUserId && code.userId === input.claimantUserId) {
    return { kind: "mine", ownerUserId: code.userId };
  }

  const owner = await db.user.findUnique({ where: { id: code.userId }, select: OWNER_SELECT });
  if (!owner) return { kind: "free" };
  const label = ownerLabel(owner);

  // (2) У владельца уже есть учётка на площадке предъявителя — значит перед
  // нами два разных аккаунта на одной площадке, а не человек со второй.
  const ownerSameProvider = input.provider === "TG" ? owner.tgId : owner.vkId;
  if (ownerSameProvider) {
    return { kind: "conflict", owner, ownerLabel: label, reason: "owner_has_same_platform" };
  }

  // (3) У предъявителя своя история заказов: слияние соединило бы двух живых
  // клиентов. Это решает только владелец кода — или никто.
  const claimantOrders = input.claimantUserId
    ? await db.wbOrder.count({ where: { userId: input.claimantUserId } })
    : 0;

  const reachable = await isOwnerReachable(owner);
  if (claimantOrders > 0 && !reachable) {
    return { kind: "conflict", owner, ownerLabel: label, reason: "claimant_has_own_orders" };
  }
  if (reachable) return { kind: "ask_owner", owner, ownerLabel: label };
  return { kind: "link_now", owner, ownerLabel: label };
}

/**
 * Связать площадки: аккаунт предъявителя вливается в аккаунт владельца кода.
 *
 * Направление именно такое: у владельца лежит заказ, бонусы и история, а у
 * предъявителя — свежий профиль, созданный ботом минуту назад. Обратное слияние
 * увело бы заказ на пустую учётку.
 */
export async function linkClaimantToCodeOwner(
  db: Db,
  input: {
    ownerUserId: string;
    provider: ClaimProvider;
    subject: string;
    name?: string | null;
    method: MergeMethod;
  },
) {
  return linkOrMergeVerifiedIdentity(
    db as Parameters<typeof linkOrMergeVerifiedIdentity>[0],
    input.ownerUserId,
    { provider: input.provider, subject: input.subject, name: input.name ?? undefined },
    input.method,
  );
}

/* ── Подтверждение владельцем ────────────────────────────────────────────────
   Кнопка уходит ТОЛЬКО владельцу кода, а при нажатии право проверяется заново
   по базе: нажавший обязан быть текущим владельцем этого кода. Полезной
   нагрузки в payload хватает ровно на «какой код» и «кого пускаем».
   ───────────────────────────────────────────────────────────────────────── */

export const XLINK_PREFIX = "xlink";

export function buildXlinkPayload(code: string, claimantUserId: string): string {
  return `${XLINK_PREFIX}:${code}:${claimantUserId}`;
}

export function parseXlinkPayload(raw: string): { code: string; claimantUserId: string } | null {
  const parts = raw.split(":");
  if (parts.length !== 3 || parts[0] !== XLINK_PREFIX) return null;
  if (!/^[A-Z0-9]{7}$/.test(parts[1]) || !/^[a-z0-9]{10,40}$/i.test(parts[2])) return null;
  return { code: parts[1], claimantUserId: parts[2] };
}

export type XlinkConfirmResult =
  | { ok: true; claimant: CodeOwner; merged: boolean }
  | { ok: false; reason: "not_owner" | "claimant_gone" | "failed" };

/** Владелец нажал «да, это я». `pressedByUserId` — тот, кто нажал. */
export async function confirmXlink(
  db: Db,
  input: { code: string; claimantUserId: string; pressedByUserId: string },
): Promise<XlinkConfirmResult> {
  const [code, claimant] = await Promise.all([
    db.wbCode.findUnique({ where: { code: input.code }, select: { userId: true } }),
    db.user.findUnique({ where: { id: input.claimantUserId }, select: OWNER_SELECT }),
  ]);
  if (!code?.userId || code.userId !== input.pressedByUserId) return { ok: false, reason: "not_owner" };
  if (!claimant) return { ok: false, reason: "claimant_gone" };

  const provider: ClaimProvider | null = claimant.tgId ? "TG" : claimant.vkId ? "VK" : null;
  const subject = claimant.tgId ?? claimant.vkId;
  if (!provider || !subject) return { ok: false, reason: "claimant_gone" };

  try {
    const result = await linkClaimantToCodeOwner(db, {
      ownerUserId: code.userId,
      provider,
      subject,
      name: claimant.name,
      method: "gate-code-owner-confirmed",
    });
    return { ok: true, claimant, merged: result.merged };
  } catch (error) {
    console.warn("[xlink] слияние не прошло:", (error as Error)?.message ?? error);
    return { ok: false, reason: "failed" };
  }
}

/* ── Потолок на красный алерт ────────────────────────────────────────────────
   Сигнал, который приходит пачкой, перестают читать — ровно это случилось с
   прежним сторожем ПВЗ-фрода (4 ложных срабатывания за 20 часов). Настоящий
   конфликт редок, но человек, упершийся в тупик, жмёт ещё и ещё, и каждая его
   попытка поднимала бы новый красный. Раз в час на код — этого хватает, чтобы
   узнать о проблеме, и достаточно, чтобы не утопить в ней остальные.
   ───────────────────────────────────────────────────────────────────────── */

const conflictSeen = new Map<string, number>();

export function allowConflictAlert(code: string, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  if (conflictSeen.size > 2_000) {
    for (const [key, at] of conflictSeen) if (now - at > windowMs) conflictSeen.delete(key);
  }
  const last = conflictSeen.get(code);
  if (last !== undefined && now - last < windowMs) return false;
  conflictSeen.set(code, now);
  return true;
}
