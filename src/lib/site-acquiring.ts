import crypto from "crypto";

export type SiteAcquiringMode = "off" | "allowlist" | "percentage" | "on";

type SiteAcquiringInput = {
  userId?: string | null;
  masterFlag?: string;
  mode?: string;
  allowlist?: string;
  percentage?: string;
};

export type SiteAcquiringDecision = {
  masterEnabled: boolean;
  mode: SiteAcquiringMode;
  eligible: boolean;
};

/** The master switch remains an exact, fail-closed emergency kill switch. */
export function isSiteAcquiringEnabled(value = process.env.SITE_ACQUIRING_ENABLED) {
  return value === "true";
}

export function parseSiteAcquiringMode(value = process.env.SITE_ACQUIRING_MODE): SiteAcquiringMode {
  return value === "allowlist" || value === "percentage" || value === "on" ? value : "off";
}

function parsePercentage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
}

/** Stable assignment: changing servers or restarting a container never reshuffles customers. */
export function siteAcquiringBucket(userId: string) {
  const prefix = crypto.createHash("sha256").update(userId, "utf8").digest().readUInt32BE(0);
  return prefix % 100;
}

export function siteAcquiringDecision({
  userId,
  masterFlag = process.env.SITE_ACQUIRING_ENABLED,
  mode = process.env.SITE_ACQUIRING_MODE,
  allowlist = process.env.SITE_ACQUIRING_ALLOWLIST_USER_IDS,
  percentage = process.env.SITE_ACQUIRING_ROLLOUT_PERCENT,
}: SiteAcquiringInput = {}): SiteAcquiringDecision {
  const masterEnabled = isSiteAcquiringEnabled(masterFlag);
  const resolvedMode = parseSiteAcquiringMode(mode);
  if (!masterEnabled || !userId || resolvedMode === "off") {
    return { masterEnabled, mode: resolvedMode, eligible: false };
  }

  if (resolvedMode === "on") return { masterEnabled, mode: resolvedMode, eligible: true };
  if (resolvedMode === "allowlist") {
    const ids = new Set((allowlist ?? "").split(",").map((id) => id.trim()).filter(Boolean));
    return { masterEnabled, mode: resolvedMode, eligible: ids.has(userId) };
  }

  return {
    masterEnabled,
    mode: resolvedMode,
    eligible: siteAcquiringBucket(userId) < parsePercentage(percentage),
  };
}

export function publicSiteAcquiringMode(decision: SiteAcquiringDecision): "off" | "limited" | "on" {
  if (!decision.masterEnabled || decision.mode === "off") return "off";
  return decision.mode === "on" ? "on" : "limited";
}
