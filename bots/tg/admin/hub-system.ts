/**
 * 🛠 System Hub — admin dashboard module.
 *
 * Shows service health (via HTTP healthchecks), process memory,
 * in-memory log ring buffer, and restart stubs.
 */

import { Markup, type Context } from "telegraf";
import { CB, ADMIN_IDS } from "../../shared/admin";
import { db } from "../../shared/db";
import { tgSend } from "../../shared/notify";
import { sendOrEditWidget, editWidget } from "./widgets";

// ── Service config from env ──────────────────────────────────────────────────

interface ServiceConfig {
  name: string;
  url:  string; // health endpoint
  icon: string;
}

function getServices(): ServiceConfig[] {
  const containers = (process.env.DOCKER_CONTAINERS ?? "").split(",").map(s => s.trim()).filter(Boolean);

  // Default services pointing to production URLs
  const defaults: ServiceConfig[] = [
    { name: "Main (Web)",  url: process.env.MAIN_HEALTH_URL  ?? "https://www.robloxbank.ru", icon: "🌐" },
    { name: "Guide (Web)", url: process.env.GUIDE_HEALTH_URL ?? "https://www.robloxbank.ru/guide", icon: "🌐" },
    { name: "VK Bot",      url: process.env.VK_BOT_HEALTH_URL ?? "http://5.223.95.11:3000", icon: "🤖" },
  ];

  if (containers.length > 0) {
    return containers.map(name => ({
      name,
      url: process.env[`${name.toUpperCase().replace(/-/g, "_")}_HEALTH_URL`] ?? "",
      icon: name.includes("bot") ? "🤖" : "🌐",
    }));
  }

  return defaults;
}

// ── Health check ─────────────────────────────────────────────────────────────

async function checkHealth(url: string): Promise<{ ok: boolean; ms: number }> {
  if (!url) return { ok: false, ms: 0 };
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    // The VK bridge server returns 404 for the root URL, so we accept it as "online"
    const isOk = res.ok || (res.status === 404 && url.includes(":3000"));
    return { ok: isOk, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

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

export async function showSystemHub(ctx: Context): Promise<void> {
  const text = await buildSystemText();
  const services = getServices();

  const logButtons = services
    .filter(s => s.url)
    .map(s => Markup.button.callback(`📋 ${s.name}`, CB.sysLogs(s.name)));

  const restartButtons = services
    .filter(s => s.url)
    .map(s => Markup.button.callback(`🔄 ${s.name}`, CB.sysRestart(s.name)));

  const keyboard = [
    logButtons.length > 0 ? logButtons : [],
    restartButtons.length > 0 ? restartButtons : [],
    [Markup.button.callback("🔄 Обновить", CB.sysRefresh)],
  ].filter(row => row.length > 0);

  await sendOrEditWidget(ctx, text, Markup.inlineKeyboard(keyboard));
}

async function buildSystemText(): Promise<string> {
  const services = getServices();

  // Parallel: health checks + servers + Neon
  const [checks, serversSection, neonSection] = await Promise.all([
    Promise.all(services.map(async (s) => ({ ...s, ...await checkHealth(s.url) }))),
    buildServersSection(),
    buildNeonSection(),
  ]);

  // DB check
  let dbOk = false;
  try {
    await (db as any).$queryRaw`SELECT 1`;
    dbOk = true;
  } catch { /* */ }

  // Process info
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  const rssMB = Math.round(mem.rss / 1024 / 1024);
  const uptimeH = Math.floor(process.uptime() / 3600);
  const uptimeM = Math.floor((process.uptime() % 3600) / 60);

  // Last order time
  const lastOrder = await (db as any).wbOrder.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const lastOrderAgo = lastOrder
    ? `${Math.floor((Date.now() - new Date(lastOrder.createdAt).getTime()) / 60_000)} мин назад`
    : "нет заказов";

  let serviceLines = "";
  for (const c of checks) {
    if (!c.url) {
      serviceLines += `${c.icon} ${c.name}: ⚪ <i>не настроен</i>\n`;
    } else {
      const status = c.ok ? `🟢 Online (${c.ms}ms)` : `🔴 Offline`;
      serviceLines += `${c.icon} ${c.name}: ${status}\n`;
    }
  }

  return (
    `🛠 <b>СОСТОЯНИЕ СИСТЕМЫ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    serviceLines +
    `🤖 TG Bot: 🟢 Online (${uptimeH}ч ${uptimeM}м)\n\n` +
    `📊 База данных: ${dbOk ? "🟢 Connected" : "🔴 Disconnected"}\n` +
    `⏰ Последний заказ: <b>${lastOrderAgo}</b>\n` +
    `💾 Память: <b>${heapMB} MB</b> heap / <b>${rssMB} MB</b> RSS` +
    serversSection +
    neonSection
  );
}

// ── Logs view ────────────────────────────────────────────────────────────────

export async function showLogs(ctx: Context, serviceName: string): Promise<void> {
  const last10 = logBuffer.slice(-10);

  const logsText = last10.length > 0
    ? last10.map(l => l.substring(0, 120)).join("\n")
    : "Логов пока нет.";

  await editWidget(
    ctx,
    `📋 <b>ЛОГИ: ${serviceName}</b>\n━━━━━━━━━━━━━━━━\n\n<code>${logsText}</code>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", CB.hubSystem)]])
  );
  await ctx.answerCbQuery();
}

// ── Restart stub ─────────────────────────────────────────────────────────────

export async function showRestartConfirm(ctx: Context, serviceName: string): Promise<void> {
  await editWidget(
    ctx,
    `⚠️ Перезагрузить <b>${serviceName}</b>?\n\n<i>Эта функция будет доступна после подключения Docker API.</i>`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Подтвердить", CB.sysConfirmRestart(serviceName)),
        Markup.button.callback("❌ Отмена", CB.hubSystem),
      ],
    ])
  );
  await ctx.answerCbQuery();
}

export async function handleRestartConfirm(ctx: Context, serviceName: string): Promise<void> {
  // Stub — Docker API integration will be added later
  await editWidget(
    ctx,
    `⚠️ Перезагрузка <b>${serviceName}</b> пока недоступна.\n\n<i>Подключи Docker API или Coolify webhook для управления контейнерами.</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", CB.hubSystem)]])
  );
  await ctx.answerCbQuery("Функция в разработке");
}

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
    const result = await (db as any).$queryRaw`
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

async function buildNeonSection(): Promise<string> {
  const stats = await fetchNeonDbStats();
  if (!stats) return `\n🐘 <b>Neon DB</b>: <i>ошибка запроса</i>\n`;

  const sizeMB = Number(stats.sizeBytes) / (1024 ** 2);
  const sizeStr = sizeMB >= 100
    ? `${(sizeMB / 1024).toFixed(2)} GB`
    : `${sizeMB.toFixed(0)} MB`;

  // Billing countdown from NEON_BILLING_DAY (default: 1st of month)
  const billingDay = parseInt(process.env.NEON_BILLING_DAY ?? "1");
  const now = new Date();
  let nextBillDate = new Date(now.getFullYear(), now.getMonth(), billingDay);
  if (nextBillDate.getTime() <= now.getTime()) {
    nextBillDate = new Date(now.getFullYear(), now.getMonth() + 1, billingDay);
  }
  const daysLeft   = Math.ceil((nextBillDate.getTime() - now.getTime()) / 86_400_000);
  const billWarn   = daysLeft <= 5 ? " ⚠️" : "";
  const nextBillStr = nextBillDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

  return (
    `\n🐘 <b>Neon DB</b>\n` +
    `💾 ${sizeStr} · 📦 ${stats.orderCount} заказов · 🎫 ${stats.unusedCodes} кодов\n` +
    `📅 оплата ${nextBillStr} (через ${daysLeft}д${billWarn})\n`
  );
}

// ── Combined servers section ──────────────────────────────────────────────────

async function buildServersSection(): Promise<string> {
  const hasHetzner = !!process.env.HETZNER_API_TOKEN;
  const hasVdsina  = !!(process.env.VDSINA_EMAIL && process.env.VDSINA_PASSWORD);
  if (!hasHetzner && !hasVdsina) return "";

  let out = `\n🖥 <b>СЕРВЕРЫ</b>\n`;

  // Hetzner: bills on the 1st of every month (postpay)
  if (hasHetzner) {
    const servers = await fetchHetznerServers();
    if (servers.length === 0) {
      out += `🇩🇪 Hetzner: <i>нет серверов / ошибка API</i>\n`;
    } else {
      let totalEur = 0;
      for (const srv of servers) {
        const emoji  = hetznerStatusEmoji(srv.status);
        const city   = srv.datacenter?.location?.city ?? srv.datacenter?.name ?? "?";
        const dcLoc  = srv.datacenter?.location?.name;
        const price  = srv.server_type?.prices?.find(p => p.location === dcLoc) ?? srv.server_type?.prices?.[0];
        const eur    = price ? parseFloat(price.price_monthly.gross) : 0;
        const spec   = srv.server_type ? ` ${srv.server_type.cores}vCPU ${srv.server_type.memory}GB` : "";
        totalEur += eur;
        out += `🇩🇪 <b>${srv.name}</b> [${city}]: ${emoji} ${srv.status}${spec}\n`;
      }
      // Days until Hetzner billing (1st of next month)
      const now  = new Date();
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const days = Math.ceil((next.getTime() - now.getTime()) / 86_400_000);
      const daysStr = days <= 5 ? ` ⚠️ через <b>${days}д</b>` : ` через ${days}д`;
      out += `   💶 Оплата: ~€${totalEur.toFixed(2)}/мес · 1-е числа${daysStr}\n`;
    }
  }

  if (hasVdsina) {
    const result = await fetchVdsinaBalance();
    if (!result) {
      out += `🇷🇺 VDSina: <i>ошибка API</i>\n`;
    } else {
      const low    = parseFloat(process.env.VDSINA_LOW_BALANCE ?? "500");
      // Estimate days left: daily burn ≈ monthly cost / 30
      // VDSINA_MONTHLY_COST env var lets user set the monthly cost for ETA
      const monthly = parseFloat(process.env.VDSINA_MONTHLY_COST ?? "0");
      const dailyBurn = monthly > 0 ? monthly / 30 : 0;
      const daysLeft  = dailyBurn > 0 ? Math.floor(result.balance / dailyBurn) : null;
      const etaStr    = daysLeft !== null
        ? (daysLeft <= 7 ? ` ⚠️ <b>~${daysLeft}д осталось!</b>` : ` · ~${daysLeft}д`)
        : "";
      const warn = result.balance < low && etaStr === "" ? ` ⚠️ <b>ПОПОЛНИТЕ!</b>` : "";
      out += `🇷🇺 VDSina: 💰 <b>${result.balance.toFixed(2)} ₽</b>${etaStr}${warn}\n`;
    }
  }

  return out;
}

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
