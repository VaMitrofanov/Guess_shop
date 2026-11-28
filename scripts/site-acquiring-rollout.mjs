#!/usr/bin/env node

const STAGES = {
  off: { master: "false", mode: "off", percentage: "0", expectedPublicMode: "off" },
  allowlist: { master: "true", mode: "allowlist", percentage: "0", expectedPublicMode: "limited" },
  "10": { master: "true", mode: "percentage", percentage: "10", expectedPublicMode: "limited" },
  "50": { master: "true", mode: "percentage", percentage: "50", expectedPublicMode: "limited" },
  on: { master: "true", mode: "on", percentage: "100", expectedPublicMode: "on" },
};
const REQUIRED_PREVIOUS = {
  "10": { mode: "allowlist" },
  "50": { mode: "percentage", percentage: "10" },
  on: { mode: "percentage", percentage: "50" },
};
const COMPROMISED_SECRET_CUTOFF = new Date("2026-07-28T00:00:00.000Z");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, "");
}

const stageName = process.argv[2];
const stage = STAGES[stageName];
if (!stage) {
  console.error("Usage: node scripts/site-acquiring-rollout.mjs <off|allowlist|10|50|on> [--confirm-real-money] [--accept-existing-secret-risk]");
  process.exit(2);
}

const apiBase = requiredEnv("COOLIFY_API_URL");
const token = requiredEnv("COOLIFY_TOKEN");
const appUuid = requiredEnv("COOLIFY_WEB_APP_UUID");
const appUrl = (process.env.ROLLOUT_APP_URL?.trim() || "https://robloxbank.ru").replace(/\/$/, "");
const realMoneyStage = stageName === "10" || stageName === "50" || stageName === "on";
const acceptExistingSecretRisk = process.argv.includes("--accept-existing-secret-risk");
if (realMoneyStage && !process.argv.includes("--confirm-real-money")) {
  throw new Error(`${stageName} exposes real checkout traffic; rerun with --confirm-real-money`);
}

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
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Coolify ${init.method || "GET"} ${path}: HTTP ${response.status}`);
  return body;
}

async function publicJson(path, expectedStatus = 200) {
  const response = await fetch(`${appUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  if (response.status !== expectedStatus) throw new Error(`${path}: expected ${expectedStatus}, got ${response.status}`);
  return body;
}

async function waitForPublicJson(path, expectedStatus = 200) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await publicJson(path, expectedStatus);
    } catch (error) {
      lastError = error;
      if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

async function waitForDeployment(deploymentUuid, label, attempts = 40) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const deployment = await coolify(`/deployments/${encodeURIComponent(deploymentUuid)}`);
    const status = String(deployment?.status ?? "unknown");
    console.log(`${label} check ${attempt}/${attempts}: ${status}`);
    if (status === "finished") return;
    if (["failed", "cancelled", "canceled"].includes(status)) throw new Error(`${label} failed: ${status}`);
  }
  throw new Error(`${label} did not finish in time`);
}

const beforeHealth = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(20_000) });
if (!beforeHealth.ok) throw new Error(`web liveness failed before rollout: HTTP ${beforeHealth.status}`);

const envs = await coolify(`/applications/${encodeURIComponent(appUuid)}/envs`);
if (!Array.isArray(envs)) throw new Error("Coolify env response is not an array");
const byKey = new Map(envs.filter((entry) => entry && entry.is_preview === false).map((entry) => [entry.key, entry]));
const currentMode = String(byKey.get("SITE_ACQUIRING_MODE")?.value ?? "off");
const currentPercentage = String(byKey.get("SITE_ACQUIRING_ROLLOUT_PERCENT")?.value ?? "0");
const currentMaster = String(byKey.get("SITE_ACQUIRING_ENABLED")?.value ?? "false");
const requiredPrevious = REQUIRED_PREVIOUS[stageName];
if (requiredPrevious && (
  currentMode !== requiredPrevious.mode ||
  (requiredPrevious.percentage && currentPercentage !== requiredPrevious.percentage)
)) {
  throw new Error(`invalid rollout transition: current mode=${currentMode}, percentage=${currentPercentage}; requested=${stageName}`);
}

if (realMoneyStage) {
  const secretUpdatedAt = new Date(byKey.get("TINKOFF_SECRET_KEY")?.updated_at ?? 0);
  if (!(secretUpdatedAt > COMPROMISED_SECRET_CUTOFF) && !acceptExistingSecretRisk) {
    throw new Error("TINKOFF_SECRET_KEY has not been rotated after the recorded compromise cutoff");
  }
  if (!(secretUpdatedAt > COMPROMISED_SECRET_CUTOFF)) {
    console.warn("SECURITY EXCEPTION: proceeding with the existing T-Bank secret by explicit owner acceptance.");
  }
  const workers = await publicJson("/api/health/workers");
  if (workers?.healthy !== true) throw new Error("payment worker readiness is not healthy");
}

async function writeRolloutConfig(config) {
  // Bulk update is an upsert in Coolify: existing production variables are
  // updated and missing ones are created without ambiguous duplicate keys.
  await coolify(`/applications/${encodeURIComponent(appUuid)}/envs/bulk`, {
    method: "PATCH",
    body: JSON.stringify({
      data: Object.entries({
        SITE_ACQUIRING_ENABLED: config.master,
        SITE_ACQUIRING_MODE: config.mode,
        SITE_ACQUIRING_ROLLOUT_PERCENT: config.percentage,
      }).map(([key, value]) => ({
        key,
        value,
        is_preview: false,
        is_build_time: true,
        is_runtime: true,
      })),
    }),
  });
}

await writeRolloutConfig(stage);

const deployRequest = await coolify(`/deploy?uuid=${encodeURIComponent(appUuid)}&force=true`, { method: "POST" });
const deploymentUuid = deployRequest?.deployments?.[0]?.deployment_uuid;
if (!deploymentUuid) {
  await writeRolloutConfig({ master: currentMaster, mode: currentMode, percentage: currentPercentage });
  throw new Error("Coolify did not return a deployment UUID; previous rollout env restored");
}
console.log(`Rollout stage ${stageName}: env updated, deploy requested.`);

let deploymentFinished = false;
try {
  await waitForDeployment(deploymentUuid, "Deploy");
  deploymentFinished = true;

  const deployedApp = await coolify(`/applications/${encodeURIComponent(appUuid)}`);
  if (String(deployedApp?.status) !== "running:healthy") {
    throw new Error(`application is not healthy after deployment: ${String(deployedApp?.status ?? "unknown")}`);
  }

  const publicStatus = await waitForPublicJson("/api/acquiring/status");
  if (publicStatus?.mode !== stage.expectedPublicMode || publicStatus?.available !== (stageName !== "off")) {
    throw new Error(`public acquiring verification failed for stage ${stageName}`);
  }
  if (realMoneyStage) {
    const workers = await waitForPublicJson("/api/health/workers");
    if (workers?.healthy !== true) throw new Error("payment worker became unhealthy after deploy");
  }
  console.log(`Rollout stage ${stageName} verified: public mode=${publicStatus.mode}, available=${publicStatus.available}.`);
} catch (error) {
  await writeRolloutConfig({ master: currentMaster, mode: currentMode, percentage: currentPercentage });
  if (deploymentFinished) {
    const restart = await coolify(`/applications/${encodeURIComponent(appUuid)}/restart`);
    const rollbackUuid = restart?.deployment_uuid;
    if (!rollbackUuid) throw new AggregateError([error], "Rollout failed and rollback restart returned no UUID");
    await waitForDeployment(rollbackUuid, "Rollback restart", 20);
  }
  console.error(`Rollout stage ${stageName} failed; previous env/runtime restored.`);
  throw error;
}
