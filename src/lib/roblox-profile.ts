import "server-only";

import { prisma } from "@/lib/prisma";
import { getRobloxPublicProfile, getRobloxPublicProfileById, type RobloxPublicProfile } from "@/lib/roblox";

export const ROBLOX_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROBLOX_USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export type CustomerRobloxProfile = RobloxPublicProfile & {
  syncedAt: string;
  stale: boolean;
};

type CachedRobloxUser = {
  robloxUsername: string | null;
  robloxUserId: string | null;
  robloxDisplayName: string | null;
  robloxAvatarUrl: string | null;
  robloxDescription: string | null;
  robloxAccountCreatedAt: Date | null;
  robloxProfileSyncedAt: Date | null;
};

function cachedProfile(user: CachedRobloxUser): CustomerRobloxProfile | null {
  if (!user.robloxUserId || !user.robloxUsername || !user.robloxProfileSyncedAt) return null;
  return {
    id: user.robloxUserId,
    username: user.robloxUsername,
    displayName: user.robloxDisplayName || user.robloxUsername,
    description: user.robloxDescription,
    createdAt: user.robloxAccountCreatedAt?.toISOString() ?? null,
    avatarUrl: user.robloxAvatarUrl,
    profileUrl: `https://www.roblox.com/users/${encodeURIComponent(user.robloxUserId)}/profile`,
    syncedAt: user.robloxProfileSyncedAt.toISOString(),
    stale: Date.now() - user.robloxProfileSyncedAt.getTime() >= ROBLOX_PROFILE_TTL_MS,
  };
}

function normalizeUsername(raw: string) {
  const username = raw.trim().replace(/^@/, "");
  return ROBLOX_USERNAME_RE.test(username) ? username : null;
}

async function persistProfile(userId: string, profile: RobloxPublicProfile) {
  const syncedAt = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: {
      robloxUsername: profile.username,
      robloxUserId: profile.id,
      robloxDisplayName: profile.displayName,
      robloxAvatarUrl: profile.avatarUrl,
      robloxDescription: profile.description,
      robloxAccountCreatedAt: profile.createdAt ? new Date(profile.createdAt) : null,
      robloxProfileSyncedAt: syncedAt,
    },
  });
  return { ...profile, syncedAt: syncedAt.toISOString(), stale: false } satisfies CustomerRobloxProfile;
}

export async function refreshCustomerRobloxProfile(userId: string, rawUsername?: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      robloxUsername: true, robloxUserId: true, robloxDisplayName: true,
      robloxAvatarUrl: true, robloxDescription: true, robloxAccountCreatedAt: true,
      robloxProfileSyncedAt: true,
    },
  });
  if (!user) return { status: "missing-user" as const, profile: null };

  const requestedUsername = rawUsername === undefined
    ? normalizeUsername(user.robloxUsername ?? "")
    : normalizeUsername(rawUsername ?? "");
  if (!requestedUsername && !user.robloxUserId) {
    return { status: "missing-username" as const, profile: null };
  }

  const sameStoredUsername = requestedUsername
    && requestedUsername.toLowerCase() === user.robloxUsername?.toLowerCase();
  const resolved = sameStoredUsername && user.robloxUserId
    ? await getRobloxPublicProfileById(user.robloxUserId)
    : requestedUsername
      ? await getRobloxPublicProfile(requestedUsername)
      : user.robloxUserId
        ? await getRobloxPublicProfileById(user.robloxUserId)
        : null;

  if (!resolved) {
    const cached = cachedProfile(user);
    return { status: cached ? "stale" as const : "not-found" as const, profile: cached };
  }
  return { status: "ok" as const, profile: await persistProfile(userId, resolved) };
}

export async function loadCustomerRobloxProfile(userId: string, suggestedUsername?: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      robloxUsername: true, robloxUserId: true, robloxDisplayName: true,
      robloxAvatarUrl: true, robloxDescription: true, robloxAccountCreatedAt: true,
      robloxProfileSyncedAt: true,
    },
  });
  if (!user) return { status: "missing-user" as const, profile: null, suggestedUsername: null };
  const cached = cachedProfile(user);
  if (cached && !cached.stale) return { status: "ok" as const, profile: cached, suggestedUsername: user.robloxUsername };

  const username = user.robloxUsername ?? suggestedUsername ?? null;
  const refreshed = await refreshCustomerRobloxProfile(userId, username);
  return { ...refreshed, suggestedUsername: username };
}

export async function disconnectCustomerRobloxProfile(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: {
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
