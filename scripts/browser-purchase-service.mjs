/**
 * Authenticated single-flight bridge from RobloxBank containers to the Chrome
 * purchase driver on the SG host. The service never logs or writes the
 * supplied .ROBLOSECURITY value to its own storage; it injects it into the
 * isolated persistent Chrome profile through CDP immediately before purchase.
 */
import http from "node:http";
import crypto from "node:crypto";
import puppeteer from "puppeteer-core";
import { buyGamepass } from "./browser-buy-gamepass.mjs";

const HOST = process.env.PURCHASE_SERVICE_HOST ?? "172.17.0.1";
const PORT = Number(process.env.PURCHASE_SERVICE_PORT ?? 9223);
const TOKEN = process.env.PURCHASE_SERVICE_TOKEN ?? "";
const BROWSER_URL = process.env.BROWSER_URL ?? "http://127.0.0.1:9222";
const MAX_BODY_BYTES = 32 * 1024;
// No backlog: a caller that arrives during a purchase gets QueueFull and can
// retry later. This prevents an HTTP timeout from leaving a queued purchase
// that executes after the caller has already treated it as failed.
const MAX_QUEUE = 1;

if (TOKEN.length < 32) {
  throw new Error("PURCHASE_SERVICE_TOKEN must contain at least 32 characters");
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
};

const authorized = (req) => {
  const supplied = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const readJson = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("BodyTooLarge");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const validateInput = (body) => {
  if (!body || typeof body !== "object") throw new Error("BadInput");
  if (typeof body.cookie !== "string" || body.cookie.length < 40 || body.cookie.length > 4096)
    throw new Error("BadCookie");
  if (typeof body.script !== "string" || body.script.length < 100 || body.script.length > 16_000)
    throw new Error("BadScript");
  for (const key of ["gamepassId", "expectedBuyerId", "expectedPrice"]) {
    if (!Number.isFinite(Number(body[key])) || Number(body[key]) <= 0) throw new Error(`Bad${key}`);
  }
  return {
    cookie: body.cookie,
    script: body.script,
    gamepassId: String(body.gamepassId),
    expectedBuyerId: Number(body.expectedBuyerId),
    expectedPrice: Number(body.expectedPrice),
    requestId: String(body.requestId ?? "").slice(0, 80),
    source: String(body.source ?? "unknown").slice(0, 40),
  };
};

const validateCookieInput = (body) => {
  if (!body || typeof body !== "object") throw new Error("BadInput");
  if (typeof body.cookie !== "string" || body.cookie.length < 40 || body.cookie.length > 4096)
    throw new Error("BadCookie");
  return {
    cookie: body.cookie,
    requestId: String(body.requestId ?? "").slice(0, 80),
    source: String(body.source ?? "unknown").slice(0, 40),
  };
};

const validatePreflightInput = (body) => {
  const input = validateCookieInput(body);
  if (!/^\d+$/.test(String(body.gamepassId ?? "")) || Number(body.gamepassId) <= 0)
    throw new Error("BadgamepassId");
  return { ...input, gamepassId: String(body.gamepassId) };
};

const codeForReason = (reason) => {
  const value = String(reason ?? "");
  if (/NotLoggedIn|not authenticated/i.test(value)) return "DONOR_COOKIE_INVALID";
  if (/WrongAccount/i.test(value)) return "WRONG_DONOR_ACCOUNT";
  if (/TwoStepRequired/i.test(value)) return "TWO_STEP_REQUIRED";
  if (/QueueFull/i.test(value)) return "BROWSER_BUSY";
  if (/BalanceMismatch/i.test(value)) return "BALANCE_MISMATCH";
  if (/BalanceUnconfirmed/i.test(value)) return "BALANCE_UNCONFIRMED";
  if (/AlreadyOwned/i.test(value)) return "OWNERSHIP_GUARD";
  if (/GuardStop.*ПРОДАВЕЦ|ПРОДАВЕЦ-СТОП/i.test(value)) return "SELLER_GUARD";
  if (/GuardStop.*ЦЕНА|ЦЕНА-СТОП|PriceChanged/i.test(value)) return "PRICE_GUARD";
  if (/NotForSale/i.test(value)) return "NOT_FOR_SALE";
  if (/InsufficientFunds/i.test(value)) return "INSUFFICIENT_FUNDS";
  if (/NoPurchaseDialog|BuyButtonMissing|NotConfirmed|ScriptRefused/i.test(value)) return "PURCHASE_NOT_CONFIRMED";
  if (/CookieInjectionFailed/i.test(value)) return "COOKIE_INJECTION_FAILED";
  if (/BrowserUnavailable|DriverError/i.test(value)) return "BROWSER_SERVICE_UNAVAILABLE";
  return "PURCHASE_REFUSED";
};

const injectCookie = async (cookie) => {
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null }).catch(() => null);
  if (!browser) throw new Error("BrowserUnavailable: Chrome не отвечает на CDP");
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    const cdp = await page.createCDPSession();
    const existing = await cdp.send("Network.getAllCookies");
    for (const current of existing.cookies.filter((item) => item.name === ".ROBLOSECURITY")) {
      await cdp.send("Network.deleteCookies", {
        name: current.name,
        domain: current.domain,
        path: current.path,
      });
    }
    const result = await cdp.send("Network.setCookie", {
      name: ".ROBLOSECURITY",
      value: cookie,
      domain: ".roblox.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "None",
    });
    if (!result.success) throw new Error("CookieInjectionFailed");
  } finally {
    await browser.disconnect().catch(() => {});
  }
};

const browserSnapshot = async ({ cookie, gamepassId = null }) => {
  await injectCookie(cookie);
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null }).catch(() => null);
  if (!browser) throw new Error("BrowserUnavailable: Chrome не отвечает на CDP");
  try {
    const page = (await browser.pages()).find((item) => item.url().includes("roblox.com")) ?? (await browser.newPage());
    // Auth/product-info are read through the persistent browser context; a
    // navigation is only needed when Chrome has no Roblox origin yet.
    if (!page.url().includes("roblox.com")) {
      await page.goto("https://www.roblox.com/home", { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    const snapshot = await page.evaluate(async (gp) => {
      const read = async (url) => {
        const response = await fetch(url, { credentials: "include", cache: "no-store" }).catch(() => null);
        if (!response) return { status: 0, body: null };
        return { status: response.status, body: await response.json().catch(() => null) };
      };
      const user = await read("https://users.roblox.com/v1/users/authenticated");
      const currency = await read("https://economy.roblox.com/v1/user/currency");
      if (!gp) return { user, currency, product: null, ownership: null };
      const product = await read(`https://apis.roblox.com/game-passes/v1/game-passes/${gp}/product-info`);
      const ownership = user.body?.id
        ? await read(`https://inventory.roblox.com/v1/users/${user.body.id}/items/GamePass/${gp}`)
        : null;
      return { user, currency, product, ownership };
    }, gamepassId);

    if (snapshot.user.status !== 200 || !snapshot.user.body?.id) {
      return { ok: false, code: "DONOR_COOKIE_INVALID", reason: "NotLoggedIn: cookie не авторизует persistent Chrome" };
    }
    if (snapshot.currency.status !== 200 || !Number.isFinite(Number(snapshot.currency.body?.robux))) {
      return { ok: false, code: "ROBLOX_SESSION_UNAVAILABLE", reason: `CurrencyUnavailable: HTTP ${snapshot.currency.status}` };
    }

    const session = {
      accountId: Number(snapshot.user.body.id),
      accountName: String(snapshot.user.body.name ?? snapshot.user.body.displayName ?? "Unknown"),
      balance: Number(snapshot.currency.body.robux),
    };
    if (!gamepassId) return { ok: true, code: "OK", session };

    const product = snapshot.product;
    if (product?.status !== 200 || !product.body?.ProductId) {
      return { ok: false, code: "ROBLOX_PRECHECK_UNAVAILABLE", reason: `ProductInfoUnavailable: HTTP ${product?.status ?? 0}` };
    }
    const body = product.body;
    const owned = snapshot.ownership?.status === 200 && Array.isArray(snapshot.ownership.body?.data)
      ? snapshot.ownership.body.data.length > 0
      : null;
    return {
      ok: true,
      code: "OK",
      session,
      gamepass: {
        gamepassId: Number(gamepassId),
        productId: Number(body.ProductId),
        name: String(body.Name ?? "Gamepass"),
        price: Number(body.PriceInRobux ?? 0),
        basePriceInRobux: Number(body.UserBasePriceInRobux ?? body.PriceInRobux ?? 0),
        priceDiscountDetails: Array.isArray(body.PriceDiscountDetails) ? body.PriceDiscountDetails : [],
        sellerName: String(body.Creator?.Name ?? "Unknown"),
        sellerId: Number(body.Creator?.Id ?? body.Creator?.CreatorTargetId ?? 0),
        isForSale: Boolean(body.IsForSale),
        owned,
      },
    };
  } finally {
    await browser.disconnect().catch(() => {});
  }
};

let queueTail = Promise.resolve();
let queued = 0;
const enqueue = async (task) => {
  if (queued >= MAX_QUEUE) throw new Error("QueueFull");
  queued++;
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => {});
  try {
    return await run;
  } finally {
    queued--;
  }
};

const browserHealth = async () => {
  const response = await fetch(`${BROWSER_URL}/json/version`, { signal: AbortSignal.timeout(2_500) }).catch(() => null);
  return Boolean(response?.ok);
};

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return json(res, 401, { ok: false, error: "Unauthorized" });

  if (req.method === "GET" && req.url === "/health") {
    const browser = await browserHealth();
    return json(res, browser ? 200 : 503, { ok: browser, browser, queued });
  }

  if (req.method !== "POST" || !["/session", "/gamepass-preflight", "/purchase"].includes(req.url)) {
    return json(res, 404, { ok: false, error: "NotFound" });
  }

  try {
    if (req.url === "/session") {
      const input = validateCookieInput(await readJson(req));
      const started = Date.now();
      const result = await enqueue(() => browserSnapshot(input));
      console.log(JSON.stringify({ event: "session", requestId: input.requestId, source: input.source, code: result.code, durationMs: Date.now() - started }));
      return json(res, result.ok ? 200 : 409, result);
    }

    if (req.url === "/gamepass-preflight") {
      const input = validatePreflightInput(await readJson(req));
      const started = Date.now();
      const result = await enqueue(() => browserSnapshot(input));
      console.log(JSON.stringify({ event: "gamepass-preflight", requestId: input.requestId, source: input.source, gamepassId: input.gamepassId, code: result.code, durationMs: Date.now() - started }));
      return json(res, result.ok ? 200 : 409, result);
    }

    const input = validateInput(await readJson(req));
    const started = Date.now();
    const result = await enqueue(async () => {
      await injectCookie(input.cookie);
      return buyGamepass(input, { browserUrl: BROWSER_URL });
    });
    const status = result.purchased ? 200 : 409;
    const code = result.purchased ? "OK" : codeForReason(result.reason);
    console.log(JSON.stringify({ event: "purchase", requestId: input.requestId, source: input.source, gamepassId: input.gamepassId, purchased: result.purchased, code, reason: String(result.reason ?? "").slice(0, 160), durationMs: Date.now() - started }));
    return json(res, status, { ok: true, code, ...result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "InternalError";
    const status = reason === "QueueFull" ? 429 : /^Bad|BodyTooLarge/.test(reason) ? 400 : 503;
    const code = codeForReason(reason);
    console.error(JSON.stringify({ event: "browser-service-error", path: req.url, code, reason: reason.slice(0, 160) }));
    return json(res, status, { ok: false, purchased: false, code, reason });
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: "started", host: HOST, port: PORT }));
});
