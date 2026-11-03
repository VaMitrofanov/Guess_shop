import { buildBuyoutSummary, buyoutFactsFromEvents, parseNotice, fmtSpan } from "@/lib/buyout-summary";

// YS3NU3X: выкуп 24.10.2026 17:30 UTC (20:30 МСК), две части по 500 за 715.
const base = {
  status: "COMPLETED",
  amount: 1000,
  createdAt: "2026-10-23T07:24:08Z",
  pendingAt: "2026-10-23T07:24:37Z",
  completedAt: "2026-10-24T17:30:33Z",
  purchaserUsername: null,
  completedBy: "Demid",
  orderSource: "WB_DBS",
  adminNote: "[НИК? 2026-10-23] Kabsjdvdnd\n[УВЕД 2026-10-24 17:30] TG: покупатель извещён о выкупе",
  splitGamepasses: [
    { amount: 500, position: 1, chargedPrice: 715, purchasedAt: "2026-10-24T17:28:00Z" },
    { amount: 500, position: 0, chargedPrice: 715, purchasedAt: "2026-10-24T17:20:00Z" },
  ],
  buyoutFacts: { gross: 1430, survey: "PENDING" as const, surveyAt: "2026-10-26T09:54:46Z", supportAfter: { total: 0, robux: 0 } },
};
const NOW = new Date("2026-10-26T18:00:00Z");
const row = (s: ReturnType<typeof buildBuyoutSummary>, key: string) => {
  const r = s!.rows.find((x) => x.key === key);
  return r ? { ...r, value: r.value.replace(/\u00a0/g, " ") } : r;
};

describe("блок «Выкуплен»", () => {
  it("когда, кто, сколько, части по порядку, очередь, клиент, опрос", () => {
    const s = buildBuyoutSummary(base, NOW)!;
    expect(s.when).toBe("24 октября, 20:30 МСК");
    expect(s.ago).toBe("2 дня назад");
    expect(row(s, "who")?.value).toBe("Demid · вручную");
    expect(row(s, "charged")?.value).toBe("1 430 R$ · 2 части");
    expect(row(s, "charged")?.sub?.[0]).toMatch(/^✓ часть 1 · 500 R\$ за 715 · 24 окт 20:20$/);
    expect(row(s, "queue")?.value).toBe("1 д 10 ч от пасса до выкупа · всего 1 д 10 ч");
    expect(row(s, "notice")).toMatchObject({ value: "📨 извещён в TG · 24 окт 20:30", tone: "green" });
    expect(row(s, "survey")?.value).toContain("«в Pending»");
    expect(row(s, "confirm")).toMatchObject({ tone: "muted" });
    expect(row(s, "support")).toBeUndefined();
    expect(row(s, "sale")?.value).toBe("WB DBS");
    expect(s.attention).toBe(false);
  });

  it("не извещён и «нигде нет» — красное и требует внимания", () => {
    const s = buildBuyoutSummary({
      ...base,
      adminNote: "[УВЕД-НЕ-ДОШЛО 2026-10-24 17:30] TG не принял «заказ выкуплен» — покупатель НЕ знает",
      buyoutFacts: { gross: 1430, survey: "NONE", surveyAt: null, supportAfter: { total: 2, robux: 1 } },
    }, NOW)!;
    expect(row(s, "notice")).toMatchObject({ tone: "red" });
    expect(row(s, "notice")?.value).toContain("НЕ извещён (TG не принял)");
    expect(row(s, "survey")).toMatchObject({ tone: "red" });
    expect(row(s, "support")?.value).toBe("2 обращения после выкупа · 1 про робуксы");
    expect(s.attention).toBe(true);
  });

  it("автовыкуп, без журнала и продажа в рублях", () => {
    const s = buildBuyoutSummary({
      ...base, purchaserUsername: "donor_7", completedBy: null, splitGamepasses: [], buyoutFacts: null,
      adminNote: null, saleAmountKopecks: 119_900,
    }, NOW)!;
    expect(row(s, "who")?.value).toBe("автовыкуп · аккаунт donor_7");
    expect(row(s, "charged")).toMatchObject({ value: "не записано", tone: "muted" });
    expect(row(s, "notice")?.value).toBe("нет следа уведомления");
    expect(row(s, "sale")?.value).toBe("1 199 ₽ · WB DBS");
  });

  it("не выкупленный — блока нет", () => {
    expect(buildBuyoutSummary({ ...base, status: "PENDING" }, NOW)).toBeNull();
  });
});

it("«✅ Робуксы поступили» — зелёное подтверждение вместо опроса", () => {
  const s = buildBuyoutSummary({ ...base, buyoutFacts: { gross: 1430, survey: "GOT", surveyAt: "2026-10-26T10:00:00Z" } }, NOW)!;
  expect(row(s, "confirm")?.value).toBe("✅ покупатель подтвердил: робуксы поступили · 26 окт 13:00");
  expect(row(s, "survey")).toBeUndefined();
});

describe("журнал → факты", () => {
  it("берёт последний переход в COMPLETED, последний ответ опроса и обращения после выкупа", () => {
    const facts = buyoutFactsFromEvents([
      { orderId: "o", type: "ROBUX_SURVEY_NONE", payload: {}, createdAt: "2026-10-26T10:00:00Z" },
      { orderId: "o", type: "SUPPORT_REQUEST_DELIVERED", payload: { robux: true }, createdAt: "2026-10-26T09:00:00Z" },
      { orderId: "o", type: "ROBUX_SURVEY_PENDING", payload: {}, createdAt: "2026-10-26T08:00:00Z" },
      { orderId: "o", type: "ORDER_STATUS_CHANGED", payload: { to: "COMPLETED", actor: "admin:Sergei", gross: 715 }, createdAt: "2026-10-24T10:00:00Z" },
      { orderId: "o", type: "SUPPORT_REQUEST_DELIVERED", payload: {}, createdAt: "2026-10-23T09:00:00Z" },
      { orderId: "o", type: "ORDER_STATUS_CHANGED", payload: { to: "COMPLETED", actor: "admin:Old", gross: 1 }, createdAt: "2026-10-20T10:00:00Z" },
    ]).get("o")!;
    expect(facts.by).toBe("Sergei");
    expect(facts.gross).toBe(715);
    expect(facts.survey).toBe("NONE");
    expect(facts.supportAfter("2026-10-24T10:00:00Z")).toEqual({ total: 1, robux: 1 });
  });
});

describe("мелочи", () => {
  it("уведомление в чат WB и частичное", () => {
    expect(parseNotice("[УВЕД 2026-10-24 17:30] чат WB: о выкупе сказали там (TG не принял)").state).toBe("wb");
    expect(parseNotice("[УВЕД 2026-10-24 17:30] VK: о выкупе сказали, второе сообщение (бонус/отзыв) не дошло")).toMatchObject({ state: "partial", via: "VK" });
  });
  it("длительности", () => {
    expect(fmtSpan(12 * 60_000)).toBe("12 мин");
    expect(fmtSpan(5 * 3_600_000 + 20 * 60_000)).toBe("5 ч 20 мин");
  });
});

it("тип события перехода совпадает с серверным ORDER_STATUS_EVENT", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("src/lib/order-status-event.ts", "utf8");
  expect(src).toContain('export const ORDER_STATUS_EVENT = "ORDER_STATUS_CHANGED"');
});
