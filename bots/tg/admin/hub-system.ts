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

  // Parallel: health checks + servers section
  const [checks, serversSection] = await Promise.all([
    Promise.all(services.map(async (s) => ({ ...s, ...await checkHealth(s.url) }))),
    buildServersSection(),
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
    serversSection
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
// Auth: email + password (no API key — VDSina uses session tokens).
// Env vars: VDSINA_EMAIL, VDSINA_PASSWORD, VDSINA_LOW_BALANCE (default 500)

interface VdsinaBalance { balance: number; currency: string }

// Cached session token with expiry
let _vdsinaToken: string | null = null;
let _vdsinaTokenExpiresAt = 0;

async function getVdsinaToken(): Promise<string | null> {
  const email    = process.env.VDSINA_EMAIL;
  const password = process.env.VDSINA_PASSWORD;
  if (!email || !password) return null;

  // Reuse cached token if still valid (with 5-min buffer)
  if (_vdsinaToken && Date.now() < _vdsinaTokenExpiresAt - 5 * 60_000) {
    return _vdsinaToken;
  }

  try {
    const res = await fetch("https://api.vdsina.com/v1/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const obj  = data.data ?? data;
    _vdsinaToken = obj.token ?? obj.access_token ?? null;
    // VDSina tokens typically last 24h; default to 23h if not specified
    const expiresIn = parseInt(obj.expires_in ?? "82800", 10);
    _vdsinaTokenExpiresAt = Date.now() + expiresIn * 1000;
    return _vdsinaToken;
  } catch {
    return null;
  }
}

async function fetchVdsinaBalance(): Promise<VdsinaBalance | null> {
  const token = await getVdsinaToken();
  if (!token) return null;
  try {
    const res = await fetch("https://api.vdsina.com/v1/account", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const obj  = data.data ?? data.result ?? data;
    const balance = parseFloat(obj.balance ?? obj.credit ?? obj.amount ?? "0");
    return { balance, currency: obj.currency ?? "₽" };
  } catch {
    return null;
  }
}

// ── Combined servers section ──────────────────────────────────────────────────

async function buildServersSection(): Promise<string> {
  const hasHetzner = !!process.env.HETZNER_API_TOKEN;
  const hasVdsina  = !!(process.env.VDSINA_EMAIL && process.env.VDSINA_PASSWORD);
  if (!hasHetzner && !hasVdsina) return "";

  let out = `\n🖥 <b>СЕРВЕРЫ</b>\n`;

  if (hasHetzner) {
    const servers = await fetchHetznerServers();
    if (servers.length === 0) {
      out += `🇩🇪 Hetzner: <i>нет серверов / ошибка API</i>\n`;
    } else {
      for (const srv of servers) {
        const emoji  = hetznerStatusEmoji(srv.status);
        const city   = srv.datacenter?.location?.city ?? srv.datacenter?.name ?? "?";
        const dcLoc  = srv.datacenter?.location?.name;
        const price  = srv.server_type?.prices?.find(p => p.location === dcLoc) ?? srv.server_type?.prices?.[0];
        const eur    = price ? parseFloat(price.price_monthly.gross) : 0;
        const cost   = eur > 0 ? ` · €${eur.toFixed(2)}/мес` : "";
        const spec   = srv.server_type ? ` ${srv.server_type.cores}vCPU ${srv.server_type.memory}GB` : "";
        out += `🇩🇪 <b>${srv.name}</b> [${city}]: ${emoji} ${srv.status}${cost}${spec}\n`;
      }
    }
  }

  if (hasVdsina) {
    const result = await fetchVdsinaBalance();
    if (!result) {
      out += `🇷🇺 VDSina: <i>ошибка API</i>\n`;
    } else {
      const low  = parseFloat(process.env.VDSINA_LOW_BALANCE ?? "500");
      const warn = result.balance < low ? ` ⚠️ <b>ПОПОЛНИТЕ!</b>` : "";
      out += `🇷🇺 VDSina: 💰 <b>${result.balance.toFixed(2)} ${result.currency}</b>${warn}\n`;
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

  if (alerts.length > 0) {
    const text = `🚨 <b>СЕРВЕРНЫЙ АЛЕРТ</b>\n━━━━━━━━━━━━━━━━\n` + alerts.join("\n");
    await Promise.allSettled(ADMIN_IDS.map(id => tgSend(id, text)));
  }
}

/** Start background server monitor. Call once at bot startup. */
export function startServerMonitor(): void {
  if (!process.env.HETZNER_API_TOKEN && !(process.env.VDSINA_EMAIL && process.env.VDSINA_PASSWORD)) return;

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
