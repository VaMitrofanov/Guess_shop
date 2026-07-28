/**
 * Shape of the session probe used by every public storefront page to prefill
 * the Roblox username. A guest is an expected caller, not an error, so the
 * probe must answer 200 with an explicit `authenticated:false` rather than 401.
 *
 * The guest payload is a constant carrying no customer data: the answer is
 * byte-identical for "never signed in" and "session expired", so the endpoint
 * cannot be used to probe whether an account exists.
 */
export interface AccountMePayload {
  authenticated: boolean;
  robloxUsername: string | null;
  email: string | null;
  emailVerified: boolean;
}

export const GUEST_ACCOUNT_PAYLOAD: Readonly<AccountMePayload> = Object.freeze({
  authenticated: false,
  robloxUsername: null,
  email: null,
  emailVerified: false,
});

export function accountMePayload(
  user: { robloxUsername: string | null; email?: string | null; emailVerifiedAt?: Date | null } | null | undefined,
): AccountMePayload {
  if (!user) return { ...GUEST_ACCOUNT_PAYLOAD };
  return {
    authenticated: true,
    robloxUsername: user.robloxUsername,
    email: user.email ?? null,
    emailVerified: user.emailVerifiedAt instanceof Date,
  };
}
