/**
 * Server-side verification of VK ID users (security risk #5, docs/security.md).
 *
 * The vk-id CredentialsProvider must never trust identity fields from the
 * request body — anyone with a CSRF token could sign in as an arbitrary
 * VK ID. Instead the client passes the raw tokens from
 * `VKID.Auth.exchangeCode()`, and we resolve the identity through VK's own
 * endpoints:
 *
 *   POST https://id.vk.com/oauth2/user_info    (access_token + client_id)
 *   POST https://id.vk.com/oauth2/public_info  (id_token + client_id)
 *
 * VK validates the token server-side and returns the profile, so no local
 * signature/JWKS handling is needed. `user_info` is preferred (proves a
 * live session token); `public_info` is the fallback for the rare case
 * where the SDK returned only an id_token.
 */

const VK_APP_ID = process.env.NEXT_PUBLIC_VK_APP_ID ?? "54539012";

export interface VerifiedVkUser {
  vkId: string;
  /** Full name from VK; empty string when VK returned no name parts. */
  name: string;
  avatar: string;
}

async function callVkIdEndpoint(
  endpoint: "user_info" | "public_info",
  params: Record<string, string>
): Promise<VerifiedVkUser | null> {
  try {
    const res = await fetch(`https://id.vk.com/oauth2/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: VK_APP_ID }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    const user = data?.user;
    if (!res.ok || !user?.user_id) {
      console.warn(
        `[vk-id] ${endpoint} rejected: http=${res.status} error=${data?.error ?? "?"} (${data?.error_description ?? ""})`
      );
      return null;
    }
    const name = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return {
      vkId: String(user.user_id),
      name,
      avatar: user.avatar ?? "",
    };
  } catch (err) {
    console.error(`[vk-id] ${endpoint} request failed:`, err);
    return null;
  }
}

export async function verifyVkIdUser(
  accessToken: string,
  idToken: string
): Promise<VerifiedVkUser | null> {
  if (accessToken) {
    const user = await callVkIdEndpoint("user_info", {
      access_token: accessToken,
    });
    if (user) return user;
  }
  if (idToken) {
    const user = await callVkIdEndpoint("public_info", { id_token: idToken });
    if (user) return user;
  }
  return null;
}
