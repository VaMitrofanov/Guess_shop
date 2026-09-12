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
  /** All tasks behind a durable batch ledger row (batch rows have no taskId). */
  tasks?: Exclude<PartnerLedgerTaskRef, null>[];
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
 * The ledger is an accounting journal, but the TWA first shows the operational
 * question: which donor account bought which gamepasses. Group all BUYOUT rows by
 * donor account, while preserving the individual durable ledger rows inside.
 */
export function groupPartnerLedgerEntries(entries: PartnerLedgerRow[]): PartnerLedgerTimelineItem[] {
  const result: PartnerLedgerTimelineItem[] = [];
  const groupsByAccount = new Map<string, Extract<PartnerLedgerTimelineItem, { kind: "buyout-group" }>>();

  for (const entry of entries) {
    if (entry.type !== "BUYOUT") {
      result.push({ kind: "entry", entry });
      continue;
    }

    const accountName = entry.purchaseAccountName?.trim() || "Вручную / из таблицы";
    const dayKey = partnerLedgerDayKey(entry.createdAt);
    const key = `account:${accountName}`;
    const existing = groupsByAccount.get(key);
    if (existing) {
      existing.entries.push(entry);
      existing.totalUsdt += Math.abs(entry.amount);
      existing.totalRobux += entry.robuxAmount ?? 0;
      existing.totalItems += entry.itemCount ?? 1;
      continue;
    }

    const group: Extract<PartnerLedgerTimelineItem, { kind: "buyout-group" }> = {
      kind: "buyout-group",
      key,
      accountName,
      dayKey,
      entries: [entry],
      totalUsdt: Math.abs(entry.amount),
      totalRobux: entry.robuxAmount ?? 0,
      totalItems: entry.itemCount ?? 1,
    };
    groupsByAccount.set(key, group);
    result.push(group);
  }

  return result;
}
