import { accountMePayload, GUEST_ACCOUNT_PAYLOAD } from "@/lib/account-session";

describe("public session probe", () => {
  test("treats a guest as an expected caller and carries no customer data", () => {
    expect(accountMePayload(null)).toEqual({
      authenticated: false,
      robloxUsername: null,
      selectedRobloxAccountId: null,
      robloxAccounts: [],
      email: null,
      emailVerified: false,
    });
  });

  test("answers a signed-out and a deleted-user session identically", () => {
    // A stale session must not be distinguishable from a plain guest, otherwise
    // the probe reveals whether an account exists.
    expect(accountMePayload(null)).toEqual(accountMePayload(undefined));
  });

  test("returns the owner's own prefill once authenticated", () => {
    expect(accountMePayload({
      robloxUsername: "KrytishVadim4ick",
      email: "owner@example.com",
      emailVerifiedAt: new Date("2026-07-28T00:00:00Z"),
    })).toEqual({
      authenticated: true,
      robloxUsername: "KrytishVadim4ick",
      selectedRobloxAccountId: null,
      robloxAccounts: [],
      email: "owner@example.com",
      emailVerified: true,
    });
  });

  test("keeps a signed-in user without a saved nickname authenticated", () => {
    expect(accountMePayload({ robloxUsername: null })).toEqual({
      authenticated: true,
      robloxUsername: null,
      selectedRobloxAccountId: null,
      robloxAccounts: [],
      email: null,
      emailVerified: false,
    });
  });

  test("does not let a caller mutate the shared guest payload", () => {
    const payload = accountMePayload(null);
    payload.robloxUsername = "leaked";
    expect(GUEST_ACCOUNT_PAYLOAD.robloxUsername).toBeNull();
  });

  test("returns only the account summaries supplied by the private owner lookup", () => {
    const accounts = [{
      accountId: "rba-1",
      username: "Builderman",
      displayName: "Builderman",
      avatarUrl: null,
      source: "ORDER_HISTORY" as const,
      orderCount: 2,
      selected: true,
    }];
    expect(accountMePayload({
      robloxUsername: "Builderman",
      selectedRobloxAccountId: "rba-1",
      robloxAccounts: accounts,
    })).toEqual(expect.objectContaining({
      selectedRobloxAccountId: "rba-1",
      robloxAccounts: accounts,
    }));
  });
});
