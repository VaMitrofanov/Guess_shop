import { groupPartnerLedgerEntries, partnerLedgerDayKey, type PartnerLedgerRow } from "@/lib/partner-ledger";

function row(input: Partial<PartnerLedgerRow> & Pick<PartnerLedgerRow, "id" | "type" | "createdAt">): PartnerLedgerRow {
  return {
    amount: -1,
    currency: "USDT",
    reference: null,
    comment: null,
    ...input,
  };
}

describe("partner ledger v2", () => {
  it("uses the Moscow calendar day around UTC midnight", () => {
    expect(partnerLedgerDayKey("2026-07-12T21:30:00.000Z")).toBe("2026-07-13");
  });

  it("keeps one durable row for a seven-gamepass purchase batch", () => {
    const grouped = groupPartnerLedgerEntries([
      row({ id: "a", type: "BUYOUT", createdAt: "2026-07-13T10:00:00Z", amount: -9.35, robuxAmount: 1850, itemCount: 7, batchId: "batch-a", purchaseAccountName: "Donor" }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: "buyout-group", accountName: "Donor", totalUsdt: 9.35, totalRobux: 1850, totalItems: 7 });
  });

  it("groups different batches from the same account into one expandable account", () => {
    const grouped = groupPartnerLedgerEntries([
      row({ id: "a", type: "BUYOUT", createdAt: "2026-07-13T10:00:00Z", batchId: "batch-a", purchaseAccountName: "Donor" }),
      row({ id: "b", type: "BUYOUT", createdAt: "2026-07-13T09:00:00Z", batchId: "batch-b", purchaseAccountName: "Donor" }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ kind: "buyout-group", totalItems: 2 });
  });

  it("keeps topups in chronology while keeping the account group intact", () => {
    const grouped = groupPartnerLedgerEntries([
      row({ id: "a", type: "BUYOUT", createdAt: "2026-07-13T10:00:00Z", batchId: "batch-a", purchaseAccountName: "Donor" }),
      row({ id: "topup", type: "TOPUP", createdAt: "2026-07-13T09:30:00Z", amount: 10 }),
      row({ id: "b", type: "BUYOUT", createdAt: "2026-07-13T09:00:00Z", batchId: "batch-b", purchaseAccountName: "Donor" }),
    ]);

    expect(grouped.map((item) => item.kind)).toEqual(["buyout-group", "entry"]);
  });

  it("uses the manual bucket when no donor account was recorded", () => {
    const [group] = groupPartnerLedgerEntries([
      row({ id: "a", type: "BUYOUT", createdAt: "2026-07-13T10:00:00Z", purchaseAccountName: null }),
    ]);
    expect(group).toMatchObject({ kind: "buyout-group", accountName: "Вручную / из таблицы" });
  });
});
