import { LOGIN_APPROVED_MODE, approveWebLogin, approvedTelegramId, parseWebLoginApprove, webLoginStateHash } from "../telegram-web-login";

const STATE = "a".repeat(32);

function db(row: { mode: string; consumedAt: Date | null; expiresAt: Date }) {
  const rows = new Map([[webLoginStateHash(STATE), { ...row, targetUserId: null as string | null }]]);
  return {
    rows,
    telegramWebLoginChallenge: {
      updateMany: async ({ where, data }: { where: { stateHash: string; mode: string; consumedAt: null; expiresAt: { gt: Date } }; data: { mode: string; targetUserId: string } }) => {
        const r = rows.get(where.stateHash);
        if (!r || r.mode !== where.mode || r.consumedAt || r.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
  };
}

describe("вход «вернитесь в браузер»", () => {
  it("кнопка бота: wla:<32 знака>, влезает в callback_data", () => {
    expect(parseWebLoginApprove(`wla:${STATE}`)).toBe(STATE);
    expect(parseWebLoginApprove("wla:short")).toBeNull();
    expect(`wla:${STATE}`.length).toBeLessThanOrEqual(64);
  });
  it("одобряет только живой вызов входа и только один раз; пишет tg:<id>", async () => {
    const d = db({ mode: "login", consumedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    expect(await approveWebLogin(d, STATE, "85137352")).toBe(true);
    const r = d.rows.get(webLoginStateHash(STATE))!;
    expect(r.mode).toBe(LOGIN_APPROVED_MODE);
    expect(approvedTelegramId(r.targetUserId)).toBe("85137352");
    expect(await approveWebLogin(d, STATE, "1111111")).toBe(false);
  });
  it("истёкший, использованный или привязка — не одобряем", async () => {
    expect(await approveWebLogin(db({ mode: "login", consumedAt: null, expiresAt: new Date(Date.now() - 1) }), STATE, "123456")).toBe(false);
    expect(await approveWebLogin(db({ mode: "login", consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }), STATE, "123456")).toBe(false);
    expect(await approveWebLogin(db({ mode: "link", consumedAt: null, expiresAt: new Date(Date.now() + 60_000) }), STATE, "123456")).toBe(false);
    expect(approvedTelegramId("cmwl123")).toBeNull();
  });
});
