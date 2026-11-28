import { pickClaimActions } from "@/lib/wb-claim-actions";

describe("ответ на заявку WB строится из actions заявки (27.11.2026)", () => {
  it("rejectcustom — отказ с комментарием, approvedbs1 — возврат", () => {
    expect(pickClaimActions(["approvedbs1", "rejectcustom", "autorefund1"])).toEqual({ reject: "rejectcustom", refund: "approvedbs1", rejectNeedsComment: true });
  });
  it("только автовозврат — отказать нельзя", () => {
    expect(pickClaimActions(["autorefund1"])).toEqual({ reject: null, refund: "autorefund1", rejectNeedsComment: false });
  });
  it("готовый отказ WB без комментария", () => {
    expect(pickClaimActions(["reject1"]).reject).toBe("reject1");
    expect(pickClaimActions(["reject1"]).rejectNeedsComment).toBe(false);
  });
  it("пусто — никаких кнопок", () => {
    expect(pickClaimActions([])).toEqual({ reject: null, refund: null, rejectNeedsComment: false });
  });
});
