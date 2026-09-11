import { Prisma } from "@prisma/client";
import type { PrismaClient, UserIdentityProvider } from "@prisma/client";

/* ─────────────────────────────────────────────────────────────────────────────
   Слияние двух профилей одного человека.

   Ядро переехало сюда из `src/lib/user-identity.ts` 12.09.2026: до этого дня
   связать площадки умел только сайт (кнопка «привязать Telegram» на странице
   оплаты), а боты в той же ситуации показывали тупик «код активирован другим
   пользователем». Боты не видят `src/`, поэтому общий код живёт в `bots/shared`,
   а `src/lib/user-identity.ts` остался тонкой обёрткой над этим файлом.

   Замер, из-за которого это понадобилось (11.09.2026): из ~800 профилей
   **ни один** не имел одновременно TG и VK. Две площадки — два непересекающихся
   мира, и человек, начавший заказ в VK, в Telegram оказывался чужим.
   ───────────────────────────────────────────────────────────────────────── */

export type VerifiedIdentityProfile = {
  name?: string | null;
  image?: string | null;
};

export type VerifiedIdentityInput = VerifiedIdentityProfile & {
  provider: UserIdentityProvider;
  subject: string;
};

/**
 * Чем доказано, что это один человек. Пишется в `AccountMergeAudit.evidence`
 * и остаётся единственным следом, по которому слияние можно разобрать потом.
 *
 *  - `dual-fresh-auth` — человек только что прошёл обе авторизации сам;
 *  - `gate-code-owner-confirmed` — предъявил код гейта, а владелец кода нажал
 *    «да, это я» у себя на площадке;
 *  - `gate-code-bearer` — предъявил код гейта, а владельцу написать нельзя
 *    (VK без диалога с сообществом), то есть спросить было некого.
 */
export type MergeMethod = "dual-fresh-auth" | "gate-code-owner-confirmed" | "gate-code-bearer";

export type MergeDb = Pick<PrismaClient, "$transaction">;

export function normalizeSubject(provider: UserIdentityProvider, subject: string): string {
  const normalized = provider === "EMAIL" ? subject.trim().toLowerCase() : subject.trim();
  if (!normalized) throw new Error("Verified identity subject must not be empty");
  return normalized;
}

export function legacyLookup(
  provider: UserIdentityProvider,
  subject: string,
): Prisma.UserWhereInput {
  switch (provider) {
    case "TG":
      return { tgId: subject };
    case "VK":
      return { vkId: subject };
    case "EMAIL":
      return { email: subject };
  }
}

export function legacyCreateData(
  provider: UserIdentityProvider,
  subject: string,
): Prisma.UserCreateInput {
  switch (provider) {
    case "TG":
      return { tgId: subject, role: "USER", balance: 0 };
    case "VK":
      return { vkId: subject, role: "USER", balance: 0 };
    case "EMAIL":
      return { email: subject, role: "USER", balance: 0 };
  }
}

export function legacyColumn(provider: UserIdentityProvider, subject: string) {
  return provider === "TG" ? { tgId: subject }
    : provider === "VK" ? { vkId: subject }
    : { email: subject };
}

export function profileUpdate(profile: VerifiedIdentityProfile): Prisma.UserUpdateInput {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

export function profileCreate(profile: VerifiedIdentityProfile): Pick<Prisma.UserCreateInput, "name" | "image"> {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

function laterDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export type MergeResult = {
  userId: string;
  merged: boolean;
  alreadyLinked: boolean;
  auditId?: string;
};

/**
 * Привязывает проверенную площадку к уже существующему аккаунту.
 *
 * Если у этой площадки был свой профиль — он вливается в целевой одной
 * сериализуемой транзакцией и остаётся инертным якорем аудита. Совпадений по
 * email, имени или нику Roblox не используется никогда: только доказанное
 * владение subject'ом провайдера.
 */
export async function linkOrMergeVerifiedIdentity(
  db: MergeDb,
  targetUserId: string,
  input: VerifiedIdentityInput,
  method: MergeMethod = "dual-fresh-auth",
): Promise<MergeResult> {
  const subject = normalizeSubject(input.provider, input.subject);
  return db.$transaction(async (tx) => {
    const [target, identity] = await Promise.all([
      tx.user.findUnique({ where: { id: targetUserId }, include: { identities: true } }),
      tx.userIdentity.findUnique({ where: { provider_subject: { provider: input.provider, subject } }, include: { user: true } }),
    ]);
    if (!target) throw new Error("Target user not found");
    if (target.role === "ADMIN") throw new Error("Privileged accounts cannot be merged");

    const targetProvider = target.identities.find((item) => item.provider === input.provider);
    if (targetProvider && targetProvider.subject !== subject) throw new Error("Provider already linked to another subject");

    /* Профиль этой площадки может существовать БЕЗ строки `UserIdentity`:
       боты заводят покупателя простым `user.create({ tgId })`, и таких — почти
       все. Искать источник только по `UserIdentity` значило бы пойти по ветке
       «площадка ничья» и упереться в unique-ключ `tgId` при записи в целевой
       профиль. Поэтому, если идентичности нет, спрашиваем легаси-колонку. */
    const legacyOwner = identity
      ? null
      : await tx.user.findFirst({ where: legacyLookup(input.provider, subject) });
    const source = identity?.user ?? legacyOwner;

    if (source?.id === target.id || targetProvider?.subject === subject) {
      const anchor = identity ?? targetProvider;
      if (anchor) await tx.userIdentity.update({ where: { id: anchor.id }, data: { verifiedAt: new Date() } });
      else await tx.userIdentity.create({ data: { provider: input.provider, subject, userId: target.id } });
      return { userId: target.id, merged: false, alreadyLinked: true };
    }

    if (!source) {
      await tx.userIdentity.create({ data: { provider: input.provider, subject, userId: target.id } });
      await tx.user.update({
        where: { id: target.id },
        data: { ...profileUpdate(input), ...legacyColumn(input.provider, subject) },
      });
      return { userId: target.id, merged: false, alreadyLinked: false };
    }

    if (source.role === "ADMIN") throw new Error("Privileged accounts cannot be merged");
    const sourceIdentities = await tx.userIdentity.findMany({ where: { userId: source.id } });

    /* Пересечение площадок считаем и по легаси-колонкам: у профиля может быть
       `vkId` без строки `UserIdentity`, и тогда слияние двух «VK-людей» прошло
       бы мимо проверки и упало на unique-ключе уже после создания аудита. */
    const providersOf = (user: { tgId: string | null; vkId: string | null; email: string | null },
                         identities: Array<{ provider: UserIdentityProvider }>) => {
      const set = new Set<UserIdentityProvider>(identities.map((item) => item.provider));
      if (user.tgId) set.add("TG");
      if (user.vkId) set.add("VK");
      if (user.email) set.add("EMAIL");
      return set;
    };
    const targetProviders = providersOf(target, target.identities);
    const overlapping = [...providersOf(source, sourceIdentities)].find((provider) => targetProviders.has(provider));
    if (overlapping) throw new Error(`Both profiles already have ${overlapping} identities`);

    const audit = await tx.accountMergeAudit.create({
      data: {
        sourceUserId: source.id,
        targetUserId: target.id,
        status: "PROCESSING",
        evidence: {
          method,
          currentSessionUserId: target.id,
          linkedProvider: input.provider,
          sourceProviders: [...providersOf(source, sourceIdentities)],
          targetProviders: [...targetProviders],
        },
      },
    });

    await Promise.all([
      tx.wbCode.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.wbOrder.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.directIntent.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.userIdentity.updateMany({ where: { userId: source.id }, data: { userId: target.id, verifiedAt: new Date() } }),
      tx.priceQuote.updateMany({ where: { userId: source.id, status: "ACTIVE" }, data: { status: "VOID" } }),
    ]);

    const mergedBalance = target.balance + source.balance;
    if (source.balance !== 0) {
      await tx.bonusLedger.create({
        data: {
          userId: target.id,
          deltaRobux: source.balance,
          balanceAfter: mergedBalance,
          reason: "ACCOUNT_MERGE",
          referenceId: audit.id,
          idempotencyKey: `account-merge:${audit.id}:bonus`,
          metadata: { sourceUserId: source.id },
        },
      });
    }
    // Release legacy unique keys before assigning them to the target.
    await tx.user.update({
      where: { id: source.id },
      data: { tgId: null, vkId: null, email: null, password: null, username: null, balance: 0, rubleDiscount: 0, bonusExpiresAt: null, promoExpiresAt: null },
    });
    await tx.user.update({
      where: { id: target.id },
      data: {
        balance: mergedBalance,
        bonusExpiresAt: laterDate(target.bonusExpiresAt, source.bonusExpiresAt),
        rubleDiscount: Math.max(target.rubleDiscount, source.rubleDiscount),
        promoExpiresAt: laterDate(target.promoExpiresAt, source.promoExpiresAt),
        robloxUsername: target.robloxUsername ?? source.robloxUsername,
        /* @handle переезжает вместе с площадкой: по нему TWA рисует кнопку
           «Написать», и без него менеджер видит слитый профиль, до которого
           не может дотянуться одним тапом. */
        username: target.username ?? source.username,
        ...profileUpdate(input),
        ...legacyColumn(input.provider, subject),
      },
    });
    await tx.accountMergeAudit.update({
      where: { id: audit.id },
      data: {
        status: "COMPLETED",
        result: { movedOrders: true, movedIdentities: sourceIdentities.length, transferredBonusRobux: source.balance },
      },
    });
    return { userId: target.id, merged: true, alreadyLinked: false, auditId: audit.id };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    /* Дефолтные 5 секунд Prisma этой транзакции не хватает.
       Внутри около четырнадцати последовательных обращений к базе, а один
       заход из прода стоит 210 мс (прод в РФ, Neon в Сингапуре) — то есть
       ~3 с на ровном месте, плюс повторы из-за Serializable. Первый же живой
       прогон 12.09.2026 упал на P2028 (9,4 с) и откатился целиком.
       Двадцать секунд — потолок, а не рабочее время: если транзакция в него
       упирается, это уже авария, а не медленная сеть. */
    timeout: 20_000,
    maxWait: 10_000,
  });
}
