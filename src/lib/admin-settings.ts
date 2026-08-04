import "server-only";

import { prisma } from "@/lib/prisma";

export type AdminSettingsUpdate = {
  purchaseRate?: number | null;
  usdToRub?: number;
  autoBuyEnabled?: boolean;
  autoBuyRate?: number;
};

export type AdminSettingsPayload = {
  purchaseRate: number | null;
  usdToRub: number;
  autoBuyEnabled: boolean;
  autoBuyRate: number;
};

export type AdminSettingsOverview = AdminSettingsPayload & {
  bestRate: { rateUSD: number; provider: string; inventory: number } | null;
  pendingOrders: number;
};

const DEFAULTS: AdminSettingsPayload = {
  purchaseRate: null,
  usdToRub: 90,
  autoBuyEnabled: false,
  autoBuyRate: 4,
};

export class AdminSettingsValidationError extends Error {}

function optionalNumber(
  body: Record<string, unknown>,
  key: keyof AdminSettingsUpdate,
  options: { minExclusive?: number; minInclusive?: number; max: number; nullable?: boolean },
) {
  if (!(key in body)) return undefined;
  if (options.nullable && body[key] === null) return null;
  const value = Number(body[key]);
  const belowMin = options.minExclusive !== undefined
    ? value <= options.minExclusive
    : options.minInclusive !== undefined && value < options.minInclusive;
  if (!Number.isFinite(value) || belowMin || value > options.max) {
    throw new AdminSettingsValidationError(`${key} out of range`);
  }
  return value;
}

export function parseAdminSettingsUpdate(input: unknown): AdminSettingsUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AdminSettingsValidationError("Invalid body");
  }
  const body = input as Record<string, unknown>;
  const update: AdminSettingsUpdate = {};

  const purchaseRate = optionalNumber(body, "purchaseRate", {
    minExclusive: 0,
    max: 100,
    nullable: true,
  });
  if (purchaseRate !== undefined) update.purchaseRate = purchaseRate;

  const usdToRub = optionalNumber(body, "usdToRub", { minExclusive: 0, max: 500 });
  if (typeof usdToRub === "number") update.usdToRub = usdToRub;

  if ("autoBuyEnabled" in body) {
    if (typeof body.autoBuyEnabled !== "boolean") {
      throw new AdminSettingsValidationError("autoBuyEnabled must be boolean");
    }
    update.autoBuyEnabled = body.autoBuyEnabled;
  }

  const autoBuyRate = optionalNumber(body, "autoBuyRate", { minInclusive: 1, max: 20 });
  if (typeof autoBuyRate === "number") update.autoBuyRate = autoBuyRate;

  if (Object.keys(update).length === 0) {
    throw new AdminSettingsValidationError("Nothing to update");
  }
  return update;
}

function serializeSettings(settings: AdminSettingsPayload | null): AdminSettingsPayload {
  return {
    purchaseRate: settings?.purchaseRate ?? DEFAULTS.purchaseRate,
    usdToRub: settings?.usdToRub ?? DEFAULTS.usdToRub,
    autoBuyEnabled: settings?.autoBuyEnabled ?? DEFAULTS.autoBuyEnabled,
    autoBuyRate: settings?.autoBuyRate ?? DEFAULTS.autoBuyRate,
  };
}

export async function loadAdminSettingsOverview(): Promise<AdminSettingsOverview> {
  const [settings, bestRate, pendingOrders] = await Promise.all([
    prisma.globalSettings.findUnique({
      where: { id: "global" },
      select: { purchaseRate: true, usdToRub: true, autoBuyEnabled: true, autoBuyRate: true },
    }),
    prisma.marketRate.findFirst({
      orderBy: { rateUSD: "asc" },
      where: { inventory: { gt: 0 } },
      select: { rateUSD: true, provider: true, inventory: true },
    }),
    prisma.wbOrder.count({ where: { status: "PENDING" } }),
  ]);

  return {
    ...serializeSettings(settings),
    bestRate,
    pendingOrders,
  };
}

export async function updateAdminSettings(input: unknown): Promise<AdminSettingsPayload> {
  const update = parseAdminSettingsUpdate(input);
  const settings = await prisma.globalSettings.upsert({
    where: { id: "global" },
    update,
    create: { id: "global", ...DEFAULTS, ...update },
    select: { purchaseRate: true, usdToRub: true, autoBuyEnabled: true, autoBuyRate: true },
  });
  return serializeSettings(settings);
}
