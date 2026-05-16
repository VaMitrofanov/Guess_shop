import crypto from "crypto";
import * as jose from "jose";

const ADMIN_IDS_RAW = process.env.ADMIN_IDS ?? "";
const ADMIN_SET = new Set(
  ADMIN_IDS_RAW.split(",").map(s => s.trim()).filter(Boolean)
);

export function validateInitData(initData: string): { valid: boolean; userId?: number; firstName?: string } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };

    params.delete("hash");

    const checkString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(process.env.TG_TOKEN ?? "")
      .digest();

    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(checkString)
      .digest("hex");

    if (computedHash !== hash) return { valid: false };

    // Reject if older than 24h
    const authDate = parseInt(params.get("auth_date") ?? "0", 10);
    if (Date.now() / 1000 - authDate > 86400) return { valid: false };

    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;
    return { valid: true, userId: user?.id, firstName: user?.first_name };
  } catch {
    return { valid: false };
  }
}

export function isAdmin(userId?: number): boolean {
  if (!userId) return false;
  return ADMIN_SET.has(String(userId));
}

const getSecret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "fallback");

export async function signTwaToken(userId: number, firstName: string): Promise<string> {
  return new jose.SignJWT({ sub: String(userId), firstName, role: "twa-admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function verifyTwaToken(token: string): Promise<{ userId: number; firstName: string } | null> {
  try {
    const { payload } = await jose.jwtVerify(token, getSecret());
    if (payload.role !== "twa-admin") return null;
    return { userId: parseInt(payload.sub!, 10), firstName: payload.firstName as string };
  } catch {
    return null;
  }
}

export async function extractTwaUser(req: Request): Promise<{ userId: number; firstName: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return verifyTwaToken(token);
}
