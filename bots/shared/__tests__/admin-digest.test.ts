import { flushAdminDigest, renderDigest } from "../admin-digest";

function fakeDb(lines: string[]) {
  const rows = lines.map((line, i) => ({ id: `d${i}`, line, createdAt: new Date(1000 + i), sentAt: null as Date | null }));
  return {
    rows,
    adminDigestItem: {
      create: async () => undefined,
      findMany: async () => rows.filter((r) => !r.sentAt),
      updateMany: async (args: any) => {
        let count = 0;
        for (const r of rows) if (args.where.id.in.includes(r.id) && (args.where.sentAt === undefined || r.sentAt === args.where.sentAt)) { r.sentAt = args.data.sentAt; count += 1; }
        return { count };
      },
    },
  };
}

describe("часовая сводка «Ленты»", () => {
  it("одним сообщением, строки помечаются отправленными", async () => {
    const db = fakeDb(["✅ выкуп · A", "🔐 вход на сайт · B"]);
    const sent: string[] = [];
    expect(await flushAdminDigest(db as never, async (t) => { sent.push(t); return true; })).toBe(2);
    expect(sent[0]).toContain("лента за час · 2");
    expect(await flushAdminDigest(db as never, async () => true)).toBe(0);
  });
  it("не ушло — строки возвращаются в очередь", async () => {
    const db = fakeDb(["x"]);
    expect(await flushAdminDigest(db as never, async () => false)).toBe(0);
    expect(db.rows[0].sentAt).toBeNull();
  });
  it("больше 40 строк — хвост «…и ещё N»", () => {
    expect(renderDigest(Array(40).fill("a"), 5)).toContain("…и ещё 5");
  });
});
