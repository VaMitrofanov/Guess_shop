export type PartnerLedgerTaskRef = {
  id: string;
  robloxUsername: string | null;
  gamepassId: string | null;
} | null;

export type PartnerLedgerRow = {
  id: string;
  type: string;
  amount: number;
  currency: string;
  rateUsdtPer1000?: number | null;
  robuxAmount?: number | null;
  purchaseAccountName?: string | null;
  batchId?: string | null;
  itemCount?: number;
  reference: string | null;
  comment: string | null;
  taskId?: string | null;
  task?: PartnerLedgerTaskRef;
  createdAt: string;
};

export type PartnerLedgerTimelineItem =
  | { kind: "entry"; entry: PartnerLedgerRow }
  | {
      kind: "buyout-group";
      key: string;
      accountName: string;
      dayKey: string;
      entries: PartnerLedgerRow[];
      totalUsdt: number;
      totalRobux: number;
      totalItems: number;
    };

const MOSCOW_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function partnerLedgerDayKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid-date";
  const parts = MOSCOW_DAY.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * New BUYOUT rows are already durable purchase batches and must never be merged with
 * another click. The account/day fallback is retained only for pre-v2 rows.
 */
export function groupPartnerLedgerEntries(entries: PartnerLedgerRow[]): PartnerLedgerTimelineItem[] {
  const result: PartnerLedgerTimelineItem[] = [];

  for (const entry of entries) {
    if (entry.type !== "BUYOUT") {
      result.push({ kind: "entry", entry });
      continue;
    }

    const accountName = entry.purchaseAccountName?.trim() || "Вручную / из таблицы";
    const dayKey = partnerLedgerDayKey(entry.createdAt);
    const key = entry.batchId ? `batch:${entry.batchId}` : `legacy:${accountName}\u0000${dayKey}`;
    const previous = result.at(-1);
    if (previous?.kind === "buyout-group" && previous.key === key) {
      previous.entries.push(entry);
      previous.totalUsdt += Math.abs(entry.amount);
      previous.totalRobux += entry.robuxAmount ?? 0;
      previous.totalItems += entry.itemCount ?? 1;
      continue;
    }

    result.push({
      kind: "buyout-group",
      key,
      accountName,
      dayKey,
      entries: [entry],
      totalUsdt: Math.abs(entry.amount),
      totalRobux: entry.robuxAmount ?? 0,
      totalItems: entry.itemCount ?? 1,
    });
  }

  return result;
}
