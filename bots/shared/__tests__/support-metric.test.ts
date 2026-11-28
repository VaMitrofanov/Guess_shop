import { SUPPORT_METRIC_EVENT, isRobuxSupportContext, recordSupportMetric } from "../support-metric";

function client(order: { id: string } | null, fail = false) {
  const created: any[] = [];
  return {
    created,
    c: {
      wbOrder: { findFirst: async () => order },
      orderEvent: {
        create: async (args: any) => {
          if (fail) throw new Error("P2002");
          created.push(args.data);
          return args.data;
        },
      },
    },
  };
}

describe("счётчик «где робуксы»", () => {
  it("пишет событие по коду заказа, с окном против дублей", async () => {
    const { c, created } = client({ id: "o1" });
    await recordSupportMetric(c, { type: SUPPORT_METRIC_EVENT.SELF_SERVED, wbCode: "ABC1234", via: "tg-bot", payload: { kind: "eta" }, now: 0 });
    expect(created[0].orderId).toBe("o1");
    expect(created[0].type).toBe("ROBUX_QUESTION_SELF_SERVED");
    expect(created[0].idempotencyKey).toBe("ROBUX_QUESTION_SELF_SERVED:o1:0");
    expect(created[0].payload).toEqual({ via: "tg-bot", kind: "eta" });
  });

  it("без заказа молчит, сбой БД не бросает", async () => {
    const none = client(null);
    await recordSupportMetric(none.c, { type: SUPPORT_METRIC_EVENT.DELIVERED, wbCode: "X", via: "vk-bot" });
    expect(none.created).toHaveLength(0);
    const broken = client({ id: "o1" }, true);
    await expect(recordSupportMetric(broken.c, { type: SUPPORT_METRIC_EVENT.DELIVERED, orderId: "o1", via: "vk-bot" })).resolves.toBeUndefined();
  });

  it("контексты про робуксы", () => {
    expect(isRobuxSupportContext("robux_low_pending")).toBe(true);
    expect(isRobuxSupportContext("robux_overdue")).toBe(true);
    expect(isRobuxSupportContext("general")).toBe(false);
  });
});
