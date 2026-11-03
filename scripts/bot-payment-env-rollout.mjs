#!/usr/bin/env node

import crypto from "node:crypto";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const apiBase = requiredEnv("COOLIFY_API_URL").replace(/\/$/, "");
const token = requiredEnv("COOLIFY_TOKEN");
const appIds = {
  web: requiredEnv("COOLIFY_WEB_APP_UUID"),
  tg: requiredEnv("COOLIFY_TG_APP_UUID"),
  vk: requiredEnv("COOLIFY_VK_APP_UUID"),
};
const webBaseUrl = (process.env.WEB_BASE_URL?.trim() || "https://robloxbank.ru").replace(/\/$/, "");

async function coolify(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Coolify ${init.method || "GET"} ${path}: HTTP ${response.status}`);
  return body;
}

async function productionEnv(appId) {
  const entries = await coolify(`/applications/${encodeURIComponent(appId)}/envs`);
  if (!Array.isArray(entries)) throw new Error("Coolify env response is not an array");
  return new Map(entries
    .filter((entry) => entry && entry.is_preview === false && typeof entry.key === "string")
    .map((entry) => [entry.key, String(entry.value ?? "")]));
}

async function upsert(appId, values) {
  await coolify(`/applications/${encodeURIComponent(appId)}/envs/bulk`, {
    method: "PATCH",
    body: JSON.stringify({
      data: Object.entries(values).map(([key, value]) => ({
        key,
        value,
        is_preview: false,
        is_build_time: true,
        is_runtime: true,
      })),
    }),
  });
}

const webEnv = await productionEnv(appIds.web);
const requestedSecret = process.env.BOT_PAYMENT_API_SECRET?.trim();
const existingSecret = webEnv.get("BOT_PAYMENT_API_SECRET")?.trim();
const sharedSecret = requestedSecret || (existingSecret && existingSecret.length >= 32 ? existingSecret : crypto.randomBytes(32).toString("hex"));
if (sharedSecret.length < 32) throw new Error("BOT_PAYMENT_API_SECRET must contain at least 32 characters");

const terminalKey = webEnv.get("TINKOFF_TERMINAL_KEY")?.trim();
const terminalSecret = webEnv.get("TINKOFF_SECRET_KEY")?.trim();
if (!terminalKey || !terminalSecret) throw new Error("Web T-Bank credentials are missing; TG reconciliation cannot be configured safely");

const values = {
  web: {
    BOT_PAYMENT_API_SECRET: sharedSecret,
    MANUAL_TRANSFER_BANK: requiredEnv("MANUAL_TRANSFER_BANK"),
    MANUAL_TRANSFER_RECIPIENT: requiredEnv("MANUAL_TRANSFER_RECIPIENT"),
    MANUAL_TRANSFER_PHONE: requiredEnv("MANUAL_TRANSFER_PHONE"),
    MANUAL_TRANSFER_CONFIG_VERSION: requiredEnv("MANUAL_TRANSFER_CONFIG_VERSION"),
  },
  tg: {
    BOT_PAYMENT_API_SECRET: sharedSecret,
    WEB_BASE_URL: webBaseUrl,
    TINKOFF_TERMINAL_KEY: terminalKey,
    TINKOFF_SECRET_KEY: terminalSecret,
  },
  vk: {
    BOT_PAYMENT_API_SECRET: sharedSecret,
    WEB_BASE_URL: webBaseUrl,
  },
};

for (const name of ["web", "tg", "vk"]) {
  await upsert(appIds[name], values[name]);
}

for (const name of ["web", "tg", "vk"]) {
  const actual = await productionEnv(appIds[name]);
  const missing = Object.entries(values[name])
    .filter(([key, value]) => actual.get(key) !== value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`${name}: env verification failed for ${missing.join(", ")}`);
}

const secretFingerprint = crypto.createHash("sha256").update(sharedSecret).digest("hex").slice(0, 12);
console.log(JSON.stringify({
  ok: true,
  services: ["web", "tg", "vk"],
  secretFingerprint,
  configuredKeys: Object.fromEntries(Object.entries(values).map(([name, serviceValues]) => [name, Object.keys(serviceValues)])),
}));
