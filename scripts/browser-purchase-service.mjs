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
  };
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

  if (req.method !== "POST" || req.url !== "/purchase") {
    return json(res, 404, { ok: false, error: "NotFound" });
  }

  try {
    const input = validateInput(await readJson(req));
    const result = await enqueue(async () => {
      await injectCookie(input.cookie);
      return buyGamepass(input, { browserUrl: BROWSER_URL });
    });
    const status = result.purchased ? 200 : 409;
    console.log(JSON.stringify({ event: "purchase", purchased: result.purchased, reason: String(result.reason ?? "").slice(0, 160) }));
    return json(res, status, { ok: true, ...result });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "InternalError";
    const status = reason === "QueueFull" ? 429 : /^Bad|BodyTooLarge/.test(reason) ? 400 : 503;
    console.error(JSON.stringify({ event: "purchase-error", reason: reason.slice(0, 160) }));
    return json(res, status, { ok: false, purchased: false, reason });
  }
});

server.requestTimeout = 120_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: "started", host: HOST, port: PORT }));
});
