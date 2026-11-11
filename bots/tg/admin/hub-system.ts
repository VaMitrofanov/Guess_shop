/**
 * 🛠 System Hub — admin dashboard module.
 *
 * Shows service health (via HTTP healthchecks), process memory,
 * in-memory log ring buffer, and restart stubs.
 */

import { ADMIN_IDS } from "../../shared/admin";
import { db } from "../../shared/db";
import { tgSend } from "../../shared/notify";

// ── Service config from env ──────────────────────────────────────────────────


// ── Health check ─────────────────────────────────────────────────────────────

// ── Ring buffer for logs (max 50 lines) ──────────────────────────────────────

const LOG_BUFFER_SIZE = 50;
const logBuffer: string[] = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function addToBuffer(level: string, args: unknown[]): void {
  const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  const line = `[${time}] ${level} ${msg}`;
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}

/** Call once at bot startup to intercept console output. */
export function initLogCapture(): void {
  console.log = (...args: unknown[]) => { addToBuffer("INFO", args); originalLog.apply(console, args); };
  console.error = (...args: unknown[]) => { addToBuffer("ERR ", args); originalError.apply(console, args); };
  console.warn = (...args: unknown[]) => { addToBuffer("WARN", args); originalWarn.apply(console, args); };
}

// ── Main widget ──────────────────────────────────────────────────────────────

// ── Logs view ────────────────────────────────────────────────────────────────

// ── Restart stub ─────────────────────────────────────────────────────────────

// ── Hetzner Cloud API ─────────────────────────────────────────────────────────

interface HetznerServer {
  id:     number;
  name:   string;
  status: string;
  datacenter: { name: string; location: { name: string; city: string } };
  server_type: {
    name:   string;
    cores:  number;
    memory: number;
    prices: Array<{ location: string; price_monthly: { gross: string } }>;
  };
  public_net: { ipv4: { ip: string } | null };
}

async function fetchHetznerServers(): Promise<HetznerServer[]> {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch("https://api.hetzner.cloud/v1/servers?per_page=50", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as any).servers ?? [];
  } catch {
    return [];
  }
}

function hetznerStatusEmoji(status: string): string {
  switch (status) {
    case "running":    return "🟢";
    case "off":        return "🔴";
    case "starting": case "stopping": case "rebuilding": return "🟡";
    default:           return "⚪";
  }
}

// ── VDSina API ────────────────────────────────────────────────────────────────
// Auth: email + password via CSRF session (api2.vdsina.ru — the real API host).
// Flow: GET /login (JSON) → POST /login with CSRF → session cookie → GET /account/view
// Env vars: VDSINA_EMAIL, VDSINA_PASSWORD, VDSINA_LOW_BALANCE (default 500)

interface VdsinaBalance { balance: number; currency: string }

// Cached session + CSRF
let _vdsinaSession: string | null = null;
let _vdsinaSessionAt = 0;

const VDSINA_BASE = "https://api2.vdsina.ru";
const VDSINA_HDRS = {
  "Accept":            "application/json",
  "X-Requested-With":  "XMLHttpRequest",
  "Origin":            "https://cp.vdsina.ru",
  "Referer":           "https://cp.vdsina.ru/",
  "User-Agent":        "Mozilla/5.0",
};

async function vdsinaLogin(): Promise<string | null> {
  const email    = process.env.VDSINA_EMAIL;
  const password = process.env.VDSINA_PASSWORD;
  if (!email || !password) return null;

  // Reuse session for 12h
  if (_vdsinaSession && Date.now() - _vdsinaSessionAt < 12 * 3_600_000) {
    return _vdsinaSession;
  }

  try {
    // Step 1: GET /login → CSRF token + session cookie
    const r1 = await fetch(`${VDSINA_BASE}/login`, {
      headers: VDSINA_HDRS,
      signal: AbortSignal.timeout(8000),
    });
    if (!r1.ok) return null;

    const d1  = (await r1.json()) as any;
    const csrf = d1._csrf as string | undefined;
    if (!csrf) return null;

    // Capture Set-Cookie (need raw value to avoid truncation by URL-decode)
    const rawCookies: Record<string, string> = {};
    r1.headers.forEach((v, k) => {
      if (k.toLowerCase() === "set-cookie") {
        const name = v.split("=")[0].trim();
        const val  = v.split("=").slice(1).join("=").split(";")[0].trim();
        rawCookies[name] = val;
      }
    });
    const cookieStr = Object.entries(rawCookies).map(([k, v]) => `${k}=${v}`).join("; ");

    // Step 2: POST /login with CSRF in body + header
    const r2 = await fetch(`${VDSINA_BASE}/login`, {
      method:  "POST",
      headers: {
        ...VDSINA_HDRS,
        "Content-Type": "application/json",
        "Cookie":        cookieStr,
        "X-CSRF-Token":  csrf,
      },
      body:   JSON.stringify({ email, password, _csrf: csrf, remember_me: 1 }),
      signal: AbortSignal.timeout(8000),
    });

    if (!r2.ok) return null;
    const d2 = (await r2.json()) as any;
    if (d2.status !== "ok" && d2.status !== "success") return null;

    _vdsinaSession    = d2._session ?? null;
    _vdsinaSessionAt  = Date.now();
    return _vdsinaSession;
  } catch {
    return null;
  }
}

async function fetchVdsinaBalance(): Promise<VdsinaBalance | null> {
  const session = await vdsinaLogin();
  if (!session) return null;
  try {
    const res = await fetch(`${VDSINA_BASE}/account/view`, {
      headers: { ...VDSINA_HDRS, "Cookie": `_session=${session}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    // Response shape: { status: "ok", data: { balance: "123.45", ... } }
    const obj  = data.data ?? data.result ?? data;
    const balance = parseFloat(obj.balance ?? obj.credit ?? obj.amount ?? "0");
    return { balance, currency: "₽" };
  } catch {
    return null;
  }
}

// ── Neon DB stats via direct query ────────────────────────────────────────────
// No API key needed — queries the connected DB directly.
// Env vars: NEON_BILLING_DAY (default 1), NEON_DB_SIZE_ALERT_MB (default 450)

interface NeonDbStats {
  sizeBytes:         bigint;
  orderCount:        bigint;
  unusedCodes:       bigint;
  activeConnections: bigint;
}

async function fetchNeonDbStats(): Promise<NeonDbStats | null> {
  try {
    const result = await db.$queryRaw`
      SELECT
        pg_database_size(current_database())                                    AS size_bytes,
        (SELECT count(*) FROM "WbOrder")                                        AS order_count,
        (SELECT count(*) FROM "WbCode" WHERE "isUsed" = false)                  AS unused_codes,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections
    `;
    const row = (result as any[])[0];
    return {
      sizeBytes:         BigInt(row.size_bytes         ?? 0),
      orderCount:        BigInt(row.order_count        ?? 0),
      unusedCodes:       BigInt(row.unused_codes       ?? 0),
      activeConnections: BigInt(row.active_connections ?? 0),
    };
  } catch {
    return null;
  }
}

// ── Combined servers section ──────────────────────────────────────────────────

// ── Background server monitor ─────────────────────────────────────────────────

const _prevHetznerStatus: Record<string, string> = {};
let _vdsinaAlertAt = 0;

async function runServerCheck(): Promise<void> {
  const alerts: string[] = [];

  if (process.env.HETZNER_API_TOKEN) {
    const servers = await fetchHetznerServers();
    for (const srv of servers) {
      const prev = _prevHetznerStatus[srv.name];
      if (prev !== undefined && prev !== srv.status) {
        alerts.push(`🇩🇪 Hetzner <b>${srv.name}</b>: ${prev} → ${hetznerStatusEmoji(srv.status)} <b>${srv.status}</b>`);
      }
      _prevHetznerStatus[srv.name] = srv.status;
    }
  }

  if (process.env.VDSINA_EMAIL && process.env.VDSINA_PASSWORD) {
    const result = await fetchVdsinaBalance();
    if (result) {
      const low    = parseFloat(process.env.VDSINA_LOW_BALANCE ?? "500");
      const now    = Date.now();
      if (result.balance < low && now - _vdsinaAlertAt > 12 * 3_600_000) {
        alerts.push(`🇷🇺 VDSina: 💰 баланс <b>${result.balance.toFixed(2)} ${result.currency}</b> — пора пополнить!`);
        _vdsinaAlertAt = now;
      }
    }
  }

  // Neon: alert if DB size exceeds threshold (default 450 MB — warns before 500 MB free-tier limit)
  {
    const stats = await fetchNeonDbStats();
    if (stats) {
      const sizeMB  = Number(stats.sizeBytes) / (1024 ** 2);
      const limitMB = parseFloat(process.env.NEON_DB_SIZE_ALERT_MB ?? "450");
      if (sizeMB > limitMB) {
        alerts.push(`🐘 Neon DB: 💾 размер <b>${(sizeMB / 1024).toFixed(2)} GB</b> — превышен порог ${limitMB} MB`);
      }
    }
  }

  if (alerts.length > 0) {
    const text = `🚨 <b>СЕРВЕРНЫЙ АЛЕРТ</b>\n━━━━━━━━━━━━━━━━\n` + alerts.join("\n");
    await Promise.allSettled(ADMIN_IDS.map(id => tgSend(id, text)));
  }
}

/** Start background server monitor. Call once at bot startup. */
export function startServerMonitor(): void {
  const hasAny = process.env.HETZNER_API_TOKEN
    || (process.env.VDSINA_EMAIL && process.env.VDSINA_PASSWORD);
  if (!hasAny) return;

  // First check after 1 min (populate _prevHetznerStatus baseline without alerting),
  // then every 30 min for ongoing monitoring.
  setTimeout(async () => {
    // Silent baseline — fill previous-status map without sending alerts
    if (process.env.HETZNER_API_TOKEN) {
      const servers = await fetchHetznerServers().catch(() => [] as HetznerServer[]);
      for (const srv of servers) _prevHetznerStatus[srv.name] = srv.status;
    }
    setInterval(() => runServerCheck().catch(e => console.error("[server-monitor]", e)), 30 * 60_000);
  }, 60_000);
}
