import { ClientSignalSchema, formatClientSignal } from "../lib/client-observability";

describe("client observability contract", () => {
  test("accepts only bounded, PII-free Web Vitals", () => {
    const parsed = ClientSignalSchema.parse({
      type: "web-vital",
      route: "/checkout",
      name: "LCP",
      value: 2431.42,
      rating: "needs-improvement",
    });
    expect(formatClientSignal(parsed)).toBe("LCP=2431.42 (needs-improvement) on /checkout");
  });

  test("accepts a client error fingerprint without the raw message", () => {
    const parsed = ClientSignalSchema.parse({
      type: "client-error",
      route: "/guide",
      kind: "TypeError",
      fingerprint: "0123abcd",
    });
    expect(formatClientSignal(parsed)).toBe("TypeError #0123abcd on /guide");
  });

  test.each([
    { type: "client-error", route: "/checkout?email=user@example.com", kind: "Error", fingerprint: "0123abcd" },
    { type: "client-error", route: "/checkout", kind: "Error", fingerprint: "raw-message" },
    { type: "web-vital", route: "/", name: "CUSTOM", value: 1, rating: "good" },
    { type: "web-vital", route: "/", name: "LCP", value: -1, rating: "poor" },
  ])("rejects unsafe or malformed payload %#", (payload) => {
    expect(ClientSignalSchema.safeParse(payload).success).toBe(false);
  });
});
