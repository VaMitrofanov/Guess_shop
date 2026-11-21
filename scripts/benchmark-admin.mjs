#!/usr/bin/env node

const baseArg = process.argv.find((value) => value.startsWith("--base="));
const runsArg = process.argv.find((value) => value.startsWith("--runs="));
const BASE = (baseArg?.slice(7) || "https://robloxbank.ru").replace(/\/$/, "");
const RUNS = Math.min(50, Math.max(3, Number(runsArg?.slice(7) || 15)));
const cookie = process.env.ADMIN_BENCH_COOKIE?.trim();
const routes = ["/admin", "/admin/orders", "/admin/users", "/admin/activity", "/admin/economics", "/admin/buyout", "/admin/partners/anton"];

if (!cookie) {
  console.error("ADMIN_BENCH_COOKIE is required; pass a temporary authenticated Cookie header via env.");
  process.exit(2);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function measure(route) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE}${route}`, {
    headers: { cookie, accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.arrayBuffer();
  return {
    status: response.status,
    durationMs: performance.now() - startedAt,
    bytes: body.byteLength,
  };
}

for (const route of routes) {
  await measure(route); // warm-up
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) samples.push(await measure(route));
  const bad = samples.find((sample) => sample.status !== 200);
  if (bad) {
    console.error(`${route}: HTTP ${bad.status}; benchmark aborted`);
    process.exitCode = 1;
    continue;
  }
  const times = samples.map((sample) => sample.durationMs);
  const bytes = samples.map((sample) => sample.bytes);
  console.log(JSON.stringify({
    route,
    runs: RUNS,
    p50Ms: Math.round(percentile(times, 0.5)),
    p95Ms: Math.round(percentile(times, 0.95)),
    responseBytesP50: percentile(bytes, 0.5),
  }));
}
