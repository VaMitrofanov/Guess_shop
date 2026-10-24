import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("donor cookie single-egress contract", () => {
  const protectedFiles = [
    "src/lib/roblox-buyout.ts",
    "src/app/api/twa/dashboard/route.ts",
    "src/app/api/twa/orders/route.ts",
    "src/app/api/twa/roblox-account/route.ts",
    "src/app/api/twa/roblox-account/purchase/route.ts",
    "src/app/api/twa/partners/[slug]/tasks/route.ts",
    "bots/shared/roblox.ts",
    "bots/tg/handlers.ts",
    "bots/tg/auto-workers.ts",
  ];

  test.each(protectedFiles)("%s не посылает .ROBLOSECURITY напрямую в Roblox", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/Cookie\s*:\s*[`'"]\.ROBLOSECURITY=/);
  });

  test("ручной drain не передаёт donorCookie в direct-fetch helpers", () => {
    const source = read("src/app/api/twa/drain/route.ts");
    expect(source).not.toMatch(/(?:authed|currency|getCsrf)\(donorCookie\)/);
    expect(source).not.toContain("economy.roblox.com/v1/purchases/products");
  });

  test("автослив не передаёт donorCookie в direct-fetch helpers", () => {
    const source = read("bots/shared/drain.ts");
    expect(source).not.toMatch(/(?:drainAuthedUser|drainCurrency|getCsrf)\(donorCookie\)/);
    expect(source).not.toContain("economy.roblox.com/v1/purchases/products");
  });

  test("ручные скрипты не теряют donor account guard", () => {
    const web = read("src/app/api/twa/orders/route.ts");
    const tg = read("bots/tg/handlers.ts");
    expect(web).toContain("if (!info.buyerAccountId)");
    expect(web).toContain("buyerUserId: info.buyerAccountId");
    expect(tg).toContain("if (!info.buyerUserId)");
    expect(tg).toContain("buyerUserId: info.buyerUserId");
  });

  test("auto-workers ставят backoff при недоступной donor session", () => {
    const source = read("bots/tg/auto-workers.ts");
    expect(source).toContain("backoffUntil = Date.now() + 15 * 60 * 1000");
    expect(source).toContain("browserFailureMessage(donorSession.reason, donorSession.code)");
  });

  test("browser service не пишет cookie или script в structured logs", () => {
    const source = read("scripts/browser-purchase-service.mjs");
    const logCalls = source.match(/console\.(?:log|error)\([^\n]+/g) ?? [];
    expect(logCalls.join("\n")).not.toMatch(/cookie|script/i);
  });
});
