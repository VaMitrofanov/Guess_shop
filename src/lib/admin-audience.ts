import "server-only";

import { UserIdentityProvider } from "@prisma/client";
import { adminGrantFor } from "@/lib/admin-grant";
import { prisma } from "@/lib/prisma";

export type AdminAudienceChannel = "TG" | "VK" | "EMAIL";
export type AdminAudienceFilter = "all" | "tg" | "vk" | "email" | "multi" | "unlinked";

export type AdminAudienceUser = {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
  channels: AdminAudienceChannel[];
  canonicalChannels: AdminAudienceChannel[];
  legacyOnlyChannels: Array<"TG" | "VK">;
  channelDetails: Array<{
    channel: AdminAudienceChannel;
    subject: string;
    username: string | null;
    canonical: boolean;
  }>;
  orders: number;
  isAdmin: boolean;
};

export type CommunityAudienceMetric = {
  platform: "TG" | "VK";
  label: string;
  handle: string;
  href: string;
  members: number | null;
  status: "ok" | "unavailable" | "error";
};

type AudienceSourceUser = {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  role: string;
  tgId: string | null;
  vkId: string | null;
  createdAt: Date;
  identities: Array<{ provider: UserIdentityProvider; subject: string; metadata: unknown }>;
  _count: { wbOrders: number };
};

const CHANNEL_ORDER: AdminAudienceChannel[] = ["TG", "VK", "EMAIL"];

function orderedChannels(values: Iterable<AdminAudienceChannel>) {
  const channels = new Set(values);
  return CHANNEL_ORDER.filter((channel) => channels.has(channel));
}

export function toAdminAudienceUser(user: AudienceSourceUser): AdminAudienceUser {
  const canonicalChannels = orderedChannels(user.identities.map((identity) => identity.provider));
  const channels = new Set<AdminAudienceChannel>(canonicalChannels);
  if (user.tgId) channels.add("TG");
  if (user.vkId) channels.add("VK");
  if (user.email) channels.add("EMAIL");

  const legacyOnlyChannels: Array<"TG" | "VK"> = [];
  if (user.tgId && !canonicalChannels.includes("TG")) legacyOnlyChannels.push("TG");
  if (user.vkId && !canonicalChannels.includes("VK")) legacyOnlyChannels.push("VK");

  const telegramSubjects = user.identities
    .filter((identity) => identity.provider === "TG")
    .map((identity) => identity.subject);
  const hasMultipleSocialChannels = channels.has("TG") && channels.has("VK");
  const metadataUsername = (metadata: unknown) => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
    const value = (metadata as Record<string, unknown>).username;
    return typeof value === "string" && value.trim() ? value.trim().replace(/^@/, "") : null;
  };
  const channelDetails = orderedChannels(channels).map((channel) => {
    const identity = user.identities.find((item) => item.provider === channel);
    const legacySubject = channel === "TG" ? user.tgId : channel === "VK" ? user.vkId : user.email;
    const username = metadataUsername(identity?.metadata)
      ?? (channel !== "EMAIL" && !hasMultipleSocialChannels ? user.username?.replace(/^@/, "") ?? null : null);
    return {
      channel,
      subject: identity?.subject ?? legacySubject ?? "",
      username,
      canonical: Boolean(identity),
    };
  });

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt.toISOString(),
    channels: orderedChannels(channels),
    canonicalChannels,
    legacyOnlyChannels,
    channelDetails,
    orders: user._count.wbOrders,
    isAdmin: adminGrantFor({ email: user.email, role: user.role, telegramSubjects }) !== null,
  };
}

export function summarizeAdminAudience(users: AdminAudienceUser[], now = new Date()) {
  const since7d = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const since30d = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const withChannel = (channel: AdminAudienceChannel) => users.filter((user) => user.channels.includes(channel));
  const socialProfiles = users.filter((user) => user.channels.includes("TG") || user.channels.includes("VK"));
  const canonicalSocialProfiles = users.filter((user) =>
    user.canonicalChannels.includes("TG") || user.canonicalChannels.includes("VK")
  );

  return {
    totalProfiles: users.length,
    customerProfiles: users.filter((user) => !user.isAdmin).length,
    admins: users.filter((user) => user.isAdmin).length,
    tgProfiles: withChannel("TG").length,
    vkProfiles: withChannel("VK").length,
    emailProfiles: withChannel("EMAIL").length,
    verifiedEmails: users.filter((user) => user.emailVerified).length,
    tgOnly: users.filter((user) => user.channels.includes("TG") && !user.channels.includes("VK")).length,
    vkOnly: users.filter((user) => user.channels.includes("VK") && !user.channels.includes("TG")).length,
    tgVk: users.filter((user) => user.channels.includes("TG") && user.channels.includes("VK")).length,
    multiChannel: users.filter((user) => user.channels.length > 1).length,
    unlinked: users.filter((user) => user.channels.length === 0).length,
    withOrders: users.filter((user) => user.orders > 0).length,
    repeatBuyers: users.filter((user) => user.orders > 1).length,
    new7d: users.filter((user) => Date.parse(user.createdAt) >= since7d).length,
    new30d: users.filter((user) => Date.parse(user.createdAt) >= since30d).length,
    socialProfiles: socialProfiles.length,
    canonicalSocialProfiles: canonicalSocialProfiles.length,
    legacyOnlyProfiles: users.filter((user) => user.legacyOnlyChannels.length > 0).length,
    legacyOnlyTg: users.filter((user) => user.legacyOnlyChannels.includes("TG")).length,
    legacyOnlyVk: users.filter((user) => user.legacyOnlyChannels.includes("VK")).length,
  };
}

export function filterAdminAudienceUsers(users: AdminAudienceUser[], filter: AdminAudienceFilter) {
  if (filter === "tg") return users.filter((user) => user.channels.includes("TG"));
  if (filter === "vk") return users.filter((user) => user.channels.includes("VK"));
  if (filter === "email") return users.filter((user) => user.channels.includes("EMAIL"));
  if (filter === "multi") return users.filter((user) => user.channels.length > 1);
  if (filter === "unlinked") return users.filter((user) => user.channels.length === 0);
  return users;
}

async function readTelegramAudience(): Promise<CommunityAudienceMetric> {
  const token = process.env.TG_TOKEN;
  const chatId = process.env.TG_CHANNEL_ID || "@Roblox_Bank_Tg";
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const validatorKey = process.env.VALIDATOR_KEY?.trim();
  const fallback: CommunityAudienceMetric = {
    platform: "TG",
    label: "Telegram-канал",
    handle: "@Roblox_Bank_Tg",
    href: "https://t.me/Roblox_Bank_Tg",
    members: null,
    status: token ? "error" : "unavailable",
  };
  const canUseBridge = Boolean(bridgeUrl && validatorKey);
  if (!canUseBridge && !token) return fallback;

  try {
    const telegramRequest = (method: "getChat" | "getChatMemberCount") => {
      if (bridgeUrl && validatorKey) {
        return fetch(`${bridgeUrl}/tg-proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-validator-key": validatorKey },
          body: JSON.stringify({ method, chat_id: chatId }),
          cache: "no-store",
          signal: AbortSignal.timeout(5_000),
        });
      }
      return fetch(`https://api.telegram.org/bot${token!}/${method}?chat_id=${encodeURIComponent(chatId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
    };
    const [countResponse, chatResponse] = await Promise.all([
      telegramRequest("getChatMemberCount"),
      telegramRequest("getChat"),
    ]);
    const countPayload = await countResponse.json() as { ok?: boolean; result?: number };
    const chatPayload = await chatResponse.json() as {
      ok?: boolean;
      result?: { title?: string; username?: string };
    };
    if (!countResponse.ok || !countPayload.ok || typeof countPayload.result !== "number") return fallback;
    const username = chatPayload.ok && chatPayload.result?.username
      ? `@${chatPayload.result.username}`
      : fallback.handle;
    return {
      ...fallback,
      label: chatPayload.ok && chatPayload.result?.title ? chatPayload.result.title : fallback.label,
      handle: username,
      href: username.startsWith("@") ? `https://t.me/${username.slice(1)}` : fallback.href,
      members: countPayload.result,
      status: "ok",
    };
  } catch {
    return fallback;
  }
}

async function readVkAudience(): Promise<CommunityAudienceMetric> {
  const token = process.env.VK_TOKEN;
  const groupId = process.env.VK_GROUP_ID;
  const fallback: CommunityAudienceMetric = {
    platform: "VK",
    label: "VK-сообщество",
    handle: "bankroblox",
    href: "https://vk.com/bankroblox",
    members: null,
    status: token && groupId ? "error" : "unavailable",
  };
  if (!token || !groupId) return fallback;

  try {
    const body = new URLSearchParams({
      access_token: token,
      group_id: groupId,
      fields: "members_count",
      v: "5.199",
    });
    const response = await fetch("https://api.vk.com/method/groups.getById", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    const payload = await response.json() as {
      response?: Array<{ name?: string; screen_name?: string; members_count?: number }> | {
        groups?: Array<{ name?: string; screen_name?: string; members_count?: number }>;
      };
    };
    const group = Array.isArray(payload.response) ? payload.response[0] : payload.response?.groups?.[0];
    if (!response.ok || !group || typeof group.members_count !== "number") return fallback;
    const handle = group.screen_name || fallback.handle;
    return {
      ...fallback,
      label: group.name || fallback.label,
      handle,
      href: `https://vk.com/${handle}`,
      members: group.members_count,
      status: "ok",
    };
  } catch {
    return fallback;
  }
}

export async function getCommunityAudienceMetrics() {
  return Promise.all([readTelegramAudience(), readVkAudience()]);
}

export async function getAdminAudienceData() {
  const [sourceUsers, communities] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        emailVerifiedAt: true,
        role: true,
        tgId: true,
        vkId: true,
        createdAt: true,
        identities: { select: { provider: true, subject: true, metadata: true } },
        _count: { select: { wbOrders: { where: { isTest: false } } } },
      },
    }),
    getCommunityAudienceMetrics(),
  ]);

  const users = sourceUsers.map(toAdminAudienceUser);
  return {
    users,
    summary: summarizeAdminAudience(users),
    communities,
    checkedAt: new Date().toISOString(),
  };
}
