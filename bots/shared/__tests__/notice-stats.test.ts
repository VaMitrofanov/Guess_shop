import { countConversation, countNoticeSent, flushNoticeStats, pendingNoticeStats, resetNoticeStats, mskDay } from "../notice-stats";

function fakeDb(initial: unknown = null) {
  let metadata = initial;
  return {
    get: () => metadata,
    wbSyncCursor: {
      findUnique: async () => (metadata ? { metadata } : null),
      upsert: async (args: { create: { metadata: unknown } }) => { metadata = args.create.metadata; return {}; },
    },
  };
}

describe("счётчик уведов (16.11.2026)", () => {
  beforeEach(() => resetNoticeStats());
  const t = new Date(Date.UTC(2026, 10, 15, 22, 0)); // 01:00 МСК 16.11

  it("день — по МСК", () => {
    expect(mskDay(t)).toBe("2026-11-16");
  });

  it("считает по теме, склейку отдельно, и складывает с тем, что уже в базе", async () => {
    countNoticeSent("-100", 5, t);
    countNoticeSent("-100", 5, t);
    countNoticeSent("999", undefined, t);
    countConversation("appended", t);
    countConversation("resurfaced", t);
    countConversation("opened", t);
    const db = fakeDb({ days: { "2026-11-16": { sent: { "-100#5": 3 }, merged: 1, resurfaced: 0 } } });
    await flushNoticeStats(db as never);
    expect((db.get() as { days: Record<string, unknown> }).days["2026-11-16"]).toEqual({
      sent: { "-100#5": 5, "999": 1 }, merged: 2, resurfaced: 1,
    });
    expect(pendingNoticeStats().size).toBe(0);
  });

  it("упала база — счётчики не теряются", async () => {
    countNoticeSent("-100", 5, t);
    const broken = { wbSyncCursor: { findUnique: async () => { throw new Error("neon"); }, upsert: async () => ({}) } };
    await expect(flushNoticeStats(broken as never)).rejects.toThrow("neon");
    expect(pendingNoticeStats().get("2026-11-16")?.sent["-100#5"]).toBe(1);
  });
});
