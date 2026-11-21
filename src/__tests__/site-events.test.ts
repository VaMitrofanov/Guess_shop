/** 📊 События витрины (18.11.2026): схема сигнала пропускает только известные события. */
import { ClientSignalSchema } from "@/lib/client-observability";

const base = { type: "event", route: "/", visitor: "0a1b2c3d" } as const;

describe("событие витрины", () => {
  it("принимает номинал и id заказа кода", () => {
    expect(ClientSignalSchema.safeParse({ ...base, name: "pack", value: "800" }).success).toBe(true);
    expect(ClientSignalSchema.safeParse({ ...base, name: "order", value: "CODE-AB12CD34" }).success).toBe(true);
    expect(ClientSignalSchema.safeParse({ ...base, name: "gift_on" }).success).toBe(true);
  });
  it("отклоняет неизвестное событие и мусор в значении", () => {
    expect(ClientSignalSchema.safeParse({ ...base, name: "anything" }).success).toBe(false);
    expect(ClientSignalSchema.safeParse({ ...base, name: "pack", value: "<script>" }).success).toBe(false);
    expect(ClientSignalSchema.safeParse({ ...base, name: "pack", value: "800", visitor: "nope" }).success).toBe(false);
  });
});
