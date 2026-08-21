import "server-only";

import { prisma } from "@/lib/prisma";
import { getRobloxPublicProfile, getRobloxPublicProfileById, type RobloxPublicProfile } from "@/lib/roblox";

export const ROBLOX_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBLOX_USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export type CustomerRobloxAccountSource = "ORDER_HISTORY" | "MANUAL";

export type CustomerRobloxProfile = {
  accountId: string;
  id: string | null;
  username: string;
  displayName: string;
  description: string | null;
  createdAt: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  syncedAt: string | null;
  stale: boolean;
  source: CustomerRobloxAccountSource;
  orderCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  selected: boolean;
};

type RobloxAccountRow = {
  id: string;
  userId: string;
  robloxUserId: string | null;
  username: string;
  usernameNormalized: string;
  displayName: string | null;
  avatarUrl: string | null;
  description: string | null;
  accountCreatedAt: Date | null;
  profileSyncedAt: Date | null;
  source: CustomerRobloxAccountSource;
  orderCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  selectedAt: Date | null;
  hiddenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ACCOUNT_SELECT = {
  id: true,
  userId: true,
  robloxUserId: true,
  username: true,
  usernameNormalized: true,
  displayName: true,
  avatarUrl: true,
  description: true,
  accountCreatedAt: true,
  profileSyncedAt: true,
  source: true,
  orderCount: true,
  firstOrderAt: true,
  lastOrderAt: true,
  selectedAt: true,
  hiddenAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function normalizeUsername(raw: string) {
  const username = raw.trim().replace(/^@/, "");
  return ROBLOX_USERNAME_RE.test(username) ? username : null;
}

function dateMs(value: Date | null | undefined) {
  return value?.getTime() ?? 0;
}

function accountActivity(row: RobloxAccountRow) {
  return Math.max(dateMs(row.selectedAt), dateMs(row.lastOrderAt), dateMs(row.createdAt));
}

function sortAccounts(rows: RobloxAccountRow[]) {
  return [...rows].sort((a, b) => accountActivity(b) - accountActivity(a));
}

function customerAccount(row: RobloxAccountRow, selectedId: string): CustomerRobloxProfile {
  const stale = !row.profileSyncedAt
    || Date.now() - row.profileSyncedAt.getTime() >= ROBLOX_PROFILE_TTL_MS;
  return {
    accountId: row.id,
    id: row.robloxUserId,
    username: row.username,
    displayName: row.displayName || row.username,
    description: row.description,
    createdAt: row.accountCreatedAt?.toISOString() ?? null,
    avatarUrl: row.avatarUrl,
    profileUrl: row.robloxUserId
      ? `https://www.roblox.com/users/${encodeURIComponent(row.robloxUserId)}/profile`
      : null,
    syncedAt: row.profileSyncedAt?.toISOString() ?? null,
    stale,
    source: row.source,
    orderCount: row.orderCount,
    firstOrderAt: row.firstOrderAt?.toISOString() ?? null,
    lastOrderAt: row.lastOrderAt?.toISOString() ?? null,
    selected: row.id === selectedId,
  };
}

function minDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function mirrorSelectedAccount(userId: string, row: RobloxAccountRow | null) {
  await prisma.user.update({
    where: { id: userId },
    data: row ? {
      robloxUsername: row.username,
      robloxUserId: row.robloxUserId,
      robloxDisplayName: row.displayName,
      robloxAvatarUrl: row.avatarUrl,
      robloxDescription: row.description,
      robloxAccountCreatedAt: row.accountCreatedAt,
      robloxProfileSyncedAt: row.profileSyncedAt,
    } : {
      robloxUsername: null,
      robloxUserId: null,
      robloxDisplayName: null,
      robloxAvatarUrl: null,
      robloxDescription: null,
      robloxAccountCreatedAt: null,
      robloxProfileSyncedAt: null,
    },
  });
}

async function importLegacyProfile(user: {
  id: string;
  robloxUsername: string | null;
  robloxUserId: string | null;
  robloxDisplayName: string | null;
  robloxAvatarUrl: string | null;
  robloxDescription: string | null;
  robloxAccountCreatedAt: Date | null;
  robloxProfileSyncedAt: Date | null;
  updatedAt: Date;
}) {
  const username = normalizeUsername(user.robloxUsername ?? "");
  // The legacy username field was also populated by old unpaid checkout
  // drafts. Import only profiles that were actually resolved against Roblox;
  // paid/completed order usernames are projected separately below.
  if (!username || !user.robloxUserId || !user.robloxProfileSyncedAt) return;
  await prisma.userRobloxAccount.upsert({
    where: { userId_usernameNormalized: { userId: user.id, usernameNormalized: username.toLowerCase() } },
    create: {
      userId: user.id,
      username,
      usernameNormalized: username.toLowerCase(),
      robloxUserId: user.robloxUserId,
      displayName: user.robloxDisplayName,
      avatarUrl: user.robloxAvatarUrl,
      description: user.robloxDescription,
      accountCreatedAt: user.robloxAccountCreatedAt,
      profileSyncedAt: user.robloxProfileSyncedAt,
      source: "MANUAL",
      selectedAt: user.updatedAt,
    },
    update: {},
  });
}

/**
 * Projects only the signed-in customer's own paid/completed, non-test orders.
 * `probableNick`, unpaid checkout drafts and other users' orders never enter
 * this identity list.
 */
export async function syncCustomerRobloxAccountsFromOrders(userId: string) {
  const [orders, existing] = await Promise.all([
    prisma.wbOrder.findMany({
      where: {
        userId,
        isTest: false,
        robloxUsername: { not: null },
        OR: [{ paidAt: { not: null } }, { status: "COMPLETED" }],
      },
      orderBy: { createdAt: "desc" },
      select: { robloxUsername: true, createdAt: true },
    }),
    prisma.userRobloxAccount.findMany({ where: { userId }, select: ACCOUNT_SELECT }),
  ]);

  const groups = new Map<string, { username: string; count: number; first: Date; last: Date }>();
  for (const order of orders) {
    const username = normalizeUsername(order.robloxUsername ?? "");
    if (!username) continue;
    const key = username.toLowerCase();
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { username, count: 1, first: order.createdAt, last: order.createdAt });
      continue;
    }
    current.count += 1;
    current.first = minDate(current.first, order.createdAt)!;
    current.last = maxDate(current.last, order.createdAt)!;
  }

  if (groups.size === 0) return;
  const existingByUsername = new Map(existing.map((row) => [row.usernameNormalized, row]));
  await prisma.$transaction([...groups.entries()].map(([usernameNormalized, group]) => {
    const current = existingByUsername.get(usernameNormalized);
    const unhide = current?.hiddenAt && group.last > current.hiddenAt ? null : current?.hiddenAt;
    return prisma.userRobloxAccount.upsert({
      where: { userId_usernameNormalized: { userId, usernameNormalized } },
      create: {
        userId,
        username: group.username,
        usernameNormalized,
        source: "ORDER_HISTORY",
        orderCount: group.count,
        firstOrderAt: group.first,
        lastOrderAt: group.last,
        selectedAt: group.last,
      },
      update: {
        username: group.username,
        source: "ORDER_HISTORY",
        orderCount: group.count,
        firstOrderAt: group.first,
        lastOrderAt: group.last,
        ...(unhide === null ? { hiddenAt: null } : {}),
      },
    });
  }));
}

async function persistResolvedProfile(userId: string, account: RobloxAccountRow, profile: RobloxPublicProfile) {
  const usernameNormalized = profile.username.toLowerCase();
  const syncedAt = new Date();
  const collision = await prisma.userRobloxAccount.findFirst({
    where: {
      userId,
      usernameNormalized,
      NOT: { id: account.id },
    },
    select: ACCOUNT_SELECT,
  });

  if (collision) {
    const selectedAt = maxDate(account.selectedAt, collision.selectedAt);
    const updated = await prisma.$transaction(async (tx) => {
      const merged = await tx.userRobloxAccount.update({
        where: { id: collision.id },
        data: {
          robloxUserId: profile.id,
          username: profile.username,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          description: profile.description,
          accountCreatedAt: profile.createdAt ? new Date(profile.createdAt) : null,
          profileSyncedAt: syncedAt,
          source: account.source === "ORDER_HISTORY" || collision.source === "ORDER_HISTORY" ? "ORDER_HISTORY" : "MANUAL",
          orderCount: account.orderCount + collision.orderCount,
          firstOrderAt: minDate(account.firstOrderAt, collision.firstOrderAt),
          lastOrderAt: maxDate(account.lastOrderAt, collision.lastOrderAt),
          selectedAt,
          hiddenAt: null,
        },
        select: ACCOUNT_SELECT,
      });
      await tx.userRobloxAccount.delete({ where: { id: account.id } });
      return merged;
    });
    await mirrorSelectedAccount(userId, updated);
    return updated;
  }

  const updated = await prisma.userRobloxAccount.update({
    where: { id: account.id },
    data: {
      robloxUserId: profile.id,
      username: profile.username,
      usernameNormalized,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      description: profile.description,
      accountCreatedAt: profile.createdAt ? new Date(profile.createdAt) : null,
      profileSyncedAt: syncedAt,
    },
    select: ACCOUNT_SELECT,
  });
  await mirrorSelectedAccount(userId, updated);
  return updated;
}

async function refreshAccount(userId: string, account: RobloxAccountRow) {
  const resolved = account.robloxUserId
    ? await getRobloxPublicProfileById(account.robloxUserId)
    : await getRobloxPublicProfile(account.username);
  if (!resolved) return account;
  return persistResolvedProfile(userId, account, resolved);
}

async function visibleAccounts(userId: string) {
  return sortAccounts(await prisma.userRobloxAccount.findMany({
    where: { userId, hiddenAt: null },
    select: ACCOUNT_SELECT,
  }) as RobloxAccountRow[]);
}

async function profilePayload(userId: string, preferredAccountId?: string | null) {
  let rows = await visibleAccounts(userId);
  if (rows.length === 0) {
    await mirrorSelectedAccount(userId, null);
    return { status: "missing-username" as const, profile: null, accounts: [], suggestedUsername: null };
  }

  let selected = rows.find((row) => row.id === preferredAccountId) ?? rows[0];
  const selectedSummary = customerAccount(selected, selected.id);
  if (selectedSummary.stale) {
    try {
      selected = await refreshAccount(userId, selected);
      rows = await visibleAccounts(userId);
      selected = rows.find((row) => row.id === selected.id) ?? rows[0];
    } catch {
      // Roblox is an optional public enrichment. The paid-order username stays
      // usable for checkout when the external API is temporarily unavailable.
    }
  }

  // Keep the legacy single-profile columns as a compatibility projection even
  // when Roblox enrichment is stale or temporarily unavailable.
  await mirrorSelectedAccount(userId, selected);

  const accounts = rows.map((row) => customerAccount(row, selected.id));
  const profile = accounts.find((row) => row.accountId === selected.id) ?? accounts[0];
  return {
    status: profile.stale ? "stale" as const : "ok" as const,
    profile,
    accounts,
    suggestedUsername: null,
  };
}

export async function loadCustomerRobloxProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      robloxUsername: true,
      robloxUserId: true,
      robloxDisplayName: true,
      robloxAvatarUrl: true,
      robloxDescription: true,
      robloxAccountCreatedAt: true,
      robloxProfileSyncedAt: true,
      updatedAt: true,
    },
  });
  if (!user) return { status: "missing-user" as const, profile: null, accounts: [], suggestedUsername: null };
  await importLegacyProfile(user);
  await syncCustomerRobloxAccountsFromOrders(userId);
  return profilePayload(userId);
}

export async function addCustomerRobloxAccount(userId: string, rawUsername: string) {
  const username = normalizeUsername(rawUsername);
  if (!username) return { status: "missing-username" as const, profile: null, accounts: [], suggestedUsername: null };
  const resolved = await getRobloxPublicProfile(username);
  if (!resolved) return { status: "not-found" as const, profile: null, accounts: [], suggestedUsername: null };

  const existing = await prisma.userRobloxAccount.findFirst({
    where: {
      userId,
      OR: [
        { usernameNormalized: resolved.username.toLowerCase() },
        { robloxUserId: resolved.id },
      ],
    },
    select: ACCOUNT_SELECT,
  });
  const now = new Date();
  const account = existing
    ? await prisma.userRobloxAccount.update({
        where: { id: existing.id },
        data: { hiddenAt: null, selectedAt: now },
        select: ACCOUNT_SELECT,
      })
    : await prisma.userRobloxAccount.create({
        data: {
          userId,
          username: resolved.username,
          usernameNormalized: resolved.username.toLowerCase(),
          robloxUserId: resolved.id,
          displayName: resolved.displayName,
          avatarUrl: resolved.avatarUrl,
          description: resolved.description,
          accountCreatedAt: resolved.createdAt ? new Date(resolved.createdAt) : null,
          profileSyncedAt: now,
          source: "MANUAL",
          selectedAt: now,
        },
        select: ACCOUNT_SELECT,
      });
  const hydrated = await persistResolvedProfile(userId, account as RobloxAccountRow, resolved);
  return profilePayload(userId, hydrated.id);
}

export async function selectCustomerRobloxAccount(userId: string, accountId: string) {
  const account = await prisma.userRobloxAccount.findFirst({
    where: { id: accountId, userId, hiddenAt: null },
    select: ACCOUNT_SELECT,
  }) as RobloxAccountRow | null;
  if (!account) return { status: "not-found" as const, profile: null, accounts: [], suggestedUsername: null };
  const selected = await prisma.userRobloxAccount.update({
    where: { id: account.id },
    data: { selectedAt: new Date() },
    select: ACCOUNT_SELECT,
  }) as RobloxAccountRow;
  let hydrated = selected;
  if (customerAccount(selected, selected.id).stale) {
    try { hydrated = await refreshAccount(userId, selected); } catch {}
  }
  await mirrorSelectedAccount(userId, hydrated);
  return profilePayload(userId, hydrated.id);
}

export async function disconnectCustomerRobloxProfile(userId: string, accountId?: string | null) {
  const rows = await visibleAccounts(userId);
  const selected = rows.find((row) => row.id === accountId) ?? rows[0];
  if (!selected) return profilePayload(userId);
  await prisma.userRobloxAccount.update({
    where: { id: selected.id },
    data: { hiddenAt: new Date() },
  });
  const remaining = await visibleAccounts(userId);
  if (remaining[0]) {
    const next = await prisma.userRobloxAccount.update({
      where: { id: remaining[0].id },
      data: { selectedAt: new Date() },
      select: ACCOUNT_SELECT,
    }) as RobloxAccountRow;
    await mirrorSelectedAccount(userId, next);
    return profilePayload(userId, next.id);
  }
  await mirrorSelectedAccount(userId, null);
  return { status: "missing-username" as const, profile: null, accounts: [], suggestedUsername: null };
}

// Backward-compatible name for callers that used PATCH as "link profile".
export const refreshCustomerRobloxProfile = addCustomerRobloxAccount;
