/**
 * U1 (риск №1 в docs/security.md): вход в TWA-админку.
 *
 * Раньше `/api/twa/auth` подписывал 12-часовой admin-JWT по `userId` из тела
 * запроса — публичного Telegram ID хватало, чтобы получить доступ к возвратам
 * денег, выкупу робуксов и сливу баланса. Тесты фиксируют новые инварианты:
 * подпись обязательна, членство в ADMIN_IDS проверяется на каждом запросе,
 * смена состава админов немедленно обесценивает выданные пропуска.
 */

const ADMIN_ID = 111111;
const OTHER_ADMIN_ID = 222222;
const STRANGER_ID = 999999;

process.env.AUTH_SECRET = "test-auth-secret-for-twa";
process.env.TWA_LINK_SECRET = "test-link-secret";
process.env.ADMIN_IDS = `${ADMIN_ID},${OTHER_ADMIN_ID}`;

import crypto from "crypto";

/** Своя подпись HS256 — чтобы подделать токен ровно так, как это сделал бы
 *  тот, кто узнал секрет подписи, но не входит в ADMIN_IDS. */
function forgeJwt(claims: Record<string, unknown>, secret: string): string {
  const b64 = (v: string) => Buffer.from(v).toString("base64url");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({ iat, exp: iat + 7200, ...claims }));
  const sig = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function decodeClaims(token: string): { exp: number; iat: number } {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function loadAuth() {
  jest.resetModules();
  return import("../lib/twa-auth");
}

describe("verifyTwaToken", () => {
  it("принимает свой же свежий токен", async () => {
    const { signTwaToken, verifyTwaToken } = await loadAuth();
    const token = await signTwaToken(ADMIN_ID, "Vadim");
    const user = await verifyTwaToken(token);
    expect(user?.userId).toBe(ADMIN_ID);
  });

  it("выдаёт токен на 2 часа, а не на 12", async () => {
    const { signTwaToken, TWA_TOKEN_TTL_SEC } = await loadAuth();
    expect(TWA_TOKEN_TTL_SEC).toBe(2 * 60 * 60);
    const token = await signTwaToken(ADMIN_ID, "Vadim");
    const claims = decodeClaims(token);
    expect(claims.exp - claims.iat).toBe(TWA_TOKEN_TTL_SEC);
  });

  it("отклоняет валидно подписанный токен с чужим sub", async () => {
    const { verifyTwaToken, adminSetVersion } = await loadAuth();
    const forged = forgeJwt(
      { sub: String(STRANGER_ID), firstName: "Intruder", role: "twa-admin", av: adminSetVersion() },
      process.env.AUTH_SECRET!,
    );

    expect(await verifyTwaToken(forged)).toBeNull();
  });

  it("обесценивает старый токен, когда состав ADMIN_IDS изменился", async () => {
    const { signTwaToken } = await loadAuth();
    const token = await signTwaToken(ADMIN_ID, "Vadim");

    process.env.ADMIN_IDS = `${OTHER_ADMIN_ID}`;
    const reloaded = await loadAuth();
    expect(await reloaded.verifyTwaToken(token)).toBeNull();

    process.env.ADMIN_IDS = `${ADMIN_ID},${OTHER_ADMIN_ID}`;
  });

  it("отклоняет токен без роли twa-admin", async () => {
    const { verifyTwaToken, adminSetVersion } = await loadAuth();
    const wrongRole = forgeJwt(
      { sub: String(ADMIN_ID), role: "user", av: adminSetVersion() },
      process.env.AUTH_SECRET!,
    );

    expect(await verifyTwaToken(wrongRole)).toBeNull();
  });
});

describe("токен запуска из web_app-ссылки (замена Path 2)", () => {
  it("подписанный ботом токен принимается", async () => {
    const { signTwaLinkToken, verifyTwaLinkToken } = await loadAuth();
    const token = signTwaLinkToken(ADMIN_ID, 3600)!;
    expect(verifyTwaLinkToken(token)).toBe(ADMIN_ID);
  });

  it("подделанная подпись отклоняется", async () => {
    const { signTwaLinkToken, verifyTwaLinkToken } = await loadAuth();
    const token = signTwaLinkToken(ADMIN_ID, 3600)!;
    const [v, uid, exp] = token.split(".");
    expect(verifyTwaLinkToken(`${v}.${uid}.${exp}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });

  it("подмена userId в теле токена ломает подпись", async () => {
    const { signTwaLinkToken, verifyTwaLinkToken } = await loadAuth();
    const token = signTwaLinkToken(ADMIN_ID, 3600)!;
    const [v, , exp, sig] = token.split(".");
    expect(verifyTwaLinkToken(`${v}.${OTHER_ADMIN_ID}.${exp}.${sig}`)).toBeNull();
  });

  it("просроченный токен отклоняется", async () => {
    const { signTwaLinkToken, verifyTwaLinkToken } = await loadAuth();
    const token = signTwaLinkToken(ADMIN_ID, 60, Date.now() - 120_000)!;
    expect(verifyTwaLinkToken(token)).toBeNull();
  });

  it("токен исключённого из ADMIN_IDS больше не работает", async () => {
    const { signTwaLinkToken } = await loadAuth();
    const token = signTwaLinkToken(ADMIN_ID, 3600)!;

    process.env.ADMIN_IDS = `${OTHER_ADMIN_ID}`;
    const reloaded = await loadAuth();
    expect(reloaded.verifyTwaLinkToken(token)).toBeNull();

    process.env.ADMIN_IDS = `${ADMIN_ID},${OTHER_ADMIN_ID}`;
  });

  it("без TWA_LINK_SECRET запасной вход отключён целиком", async () => {
    const previous = process.env.TWA_LINK_SECRET;
    delete process.env.TWA_LINK_SECRET;
    const { signTwaLinkToken, verifyTwaLinkToken, twaLinkAuthEnabled } = await loadAuth();
    expect(twaLinkAuthEnabled()).toBe(false);
    expect(signTwaLinkToken(ADMIN_ID, 3600)).toBeNull();
    expect(verifyTwaLinkToken("v1.1.9999999999.x")).toBeNull();
    process.env.TWA_LINK_SECRET = previous;
  });
});
