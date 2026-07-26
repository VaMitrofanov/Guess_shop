import crypto from "crypto";

const ADMIN_IDS_RAW = process.env.ADMIN_IDS ?? "";
const ADMIN_SET = new Set(
  ADMIN_IDS_RAW.split(",").map(s => s.trim()).filter(Boolean)
);

/** U1: пропуск живёт 2 часа вместо 12 и тихо продлевается при активности. */
export const TWA_TOKEN_TTL_SEC = 2 * 60 * 60;
/** Порог тихого продления: обновляем токен, если ему осталось меньше получаса. */
export const TWA_TOKEN_RENEW_BEFORE_SEC = 30 * 60;

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

/**
 * U1: отпечаток состава `ADMIN_IDS`. Кладётся в токен и сверяется при каждой
 * проверке — смена состава менеджеров немедленно обесценивает все выданные
 * пропуска, не дожидаясь истечения TTL.
 */
export function adminSetVersion(): string {
  return crypto
    .createHash("sha256")
    .update([...ADMIN_SET].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}

const getSecret = () => {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("[twa-auth] AUTH_SECRET or NEXTAUTH_SECRET must be set");
  return s;
};

// HS256-JWT на node:crypto. Раньше здесь был `jose`, которого нет в
// package.json (тянулся транзитивно через next-auth) и который собран только
// как ESM — из-за этого путь входа в админку было невозможно покрыть unit-
// тестами. Формат токена на проводе не изменился, старые пропуски проверяются.
const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function hs256(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

type TwaJwtClaims = {
  sub: string;
  firstName: string;
  role: string;
  av: string;
  iat: number;
  exp: number;
};

export async function signTwaToken(userId: number, firstName: string): Promise<string> {
  const secret = getSecret();
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: String(userId),
      firstName,
      role: "twa-admin",
      av: adminSetVersion(),
      iat,
      exp: iat + TWA_TOKEN_TTL_SEC,
    } satisfies TwaJwtClaims),
  );
  return `${header}.${payload}.${hs256(`${header}.${payload}`, secret)}`;
}

function verifyJwt(token: string, secret: string): TwaJwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = Buffer.from(hs256(`${header}.${payload}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  let head: { alg?: string };
  let claims: TwaJwtClaims;
  try {
    head = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (head.alg !== "HS256") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  return claims;
}

export type TwaTokenUser = {
  userId: number;
  firstName: string;
  /** Unix-секунды истечения — нужно для тихого продления в /api/twa/ping. */
  expiresAt: number;
};

export async function verifyTwaToken(token: string): Promise<TwaTokenUser | null> {
  try {
    const claims = verifyJwt(token, getSecret());
    if (!claims) return null;
    if (claims.role !== "twa-admin") return null;
    // U1: подпись валидна ≠ доступ разрешён. Состав админов мог смениться.
    if (claims.av !== adminSetVersion()) return null;
    const userId = parseInt(claims.sub ?? "", 10);
    if (!Number.isFinite(userId) || !isAdmin(userId)) return null;
    return {
      userId,
      firstName: claims.firstName ?? "Admin",
      expiresAt: claims.exp,
    };
  } catch {
    return null;
  }
}

export async function extractTwaUser(req: Request): Promise<TwaTokenUser | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return verifyTwaToken(token);
}

// ── Ссылочный токен запуска (U1, замена Path 2) ────────────────────────────
//
// Раньше при отсутствии `initData` роут выдавал полноценный admin-JWT просто
// по `userId` из тела запроса — Telegram ID не секретен, поэтому вход был
// открыт любому, кто его знает. Но и полностью убрать запасной путь нельзя:
// iOS Telegram v9.6+ действительно не отдаёт `tgWebAppData` (поэтому в клиенте
// и появился `?uid=`).
//
// Решение: запасной вход требует не публичный идентификатор, а токен, который
// подписывает сервер бота и вставляет в web_app-ссылку. Ссылка существует
// только внутри личного чата админа с ботом, то есть её знание эквивалентно
// доступу к аккаунту админа в Telegram. Секрет живёт в env Web и TG-бота и
// никогда не попадает в клиентский бандл.

const LINK_TOKEN_VERSION = "v1";

function linkSecret(): Buffer | null {
  const raw = process.env.TWA_LINK_SECRET?.trim();
  if (!raw) return null;
  return Buffer.from(raw, "utf8");
}

export function twaLinkAuthEnabled(): boolean {
  return linkSecret() !== null;
}

function linkSignature(secret: Buffer, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Токен для web_app-ссылки: `v1.<userId>.<expUnixSec>.<sig>`.
 * Генерируется ботом (см. bots/tg/admin/menu.ts).
 */
export function signTwaLinkToken(userId: number | string, ttlSec: number, now = Date.now()): string | null {
  const secret = linkSecret();
  if (!secret) return null;
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = `${LINK_TOKEN_VERSION}.${userId}.${exp}`;
  return `${payload}.${linkSignature(secret, payload)}`;
}

export function verifyTwaLinkToken(token: string, now = Date.now()): number | null {
  const secret = linkSecret();
  if (!secret) return null;

  const parts = String(token).split(".");
  if (parts.length !== 4) return null;
  const [version, rawUserId, rawExp, sig] = parts;
  if (version !== LINK_TOKEN_VERSION) return null;

  const expected = linkSignature(secret, `${version}.${rawUserId}.${rawExp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const exp = Number(rawExp);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;

  const userId = Number(rawUserId);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  // Состав админов проверяется здесь же: старая ссылка уволенного менеджера
  // перестаёт работать сразу после правки ADMIN_IDS.
  if (!isAdmin(userId)) return null;

  return userId;
}
