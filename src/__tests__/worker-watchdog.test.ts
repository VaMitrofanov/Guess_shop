import {
  heartbeatHealth,
  HEARTBEAT_STALE_MS,
} from "@/lib/worker-watchdog";

describe("payment worker heartbeat", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  test("distinguishes a missing, fresh and stale worker", () => {
    expect(heartbeatHealth(null, now)).toBe("missing");
    expect(heartbeatHealth(new Date(now.getTime() - HEARTBEAT_STALE_MS), now)).toBe("fresh");
    expect(heartbeatHealth(new Date(now.getTime() - HEARTBEAT_STALE_MS - 1), now)).toBe("stale");
  });
});
