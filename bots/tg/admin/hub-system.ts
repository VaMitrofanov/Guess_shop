/**
 * 🛠 System Hub — admin dashboard module.
 *
 * Shows service health (via HTTP healthchecks), process memory,
 * in-memory log ring buffer, and restart stubs.
 */

import { Markup, type Context } from "telegraf";
import { CB } from "../../shared/admin";
import { db } from "../../shared/db";
import { sendOrEditWidget, editWidget } from "./widgets";

// ── Service config from env ──────────────────────────────────────────────────

interface ServiceConfig {
  name: string;
  url:  string; // health endpoint
  icon: string;
}

function getServices(): ServiceConfig[] {
  const containers = (process.env.DOCKER_CONTAINERS ?? "").split(",").map(s => s.trim()).filter(Boolean);

  // Default services if env not set
  const defaults: ServiceConfig[] = [
    { name: "Main",  url: process.env.MAIN_HEALTH_URL  ?? "", icon: "🌐" },
    { name: "Guide", url: process.env.GUIDE_HEALTH_URL ?? "", icon: "🌐" },
  ];

  if (containers.length > 0) {
    return containers.map(name => ({
      name,
      url: process.env[`${name.toUpperCase().replace(/-/g, "_")}_HEALTH_URL`] ?? "",
      icon: "🌐",
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
    return { ok: res.ok, ms: Date.now() - start };
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

  // Parallel health checks
  const checks = await Promise.all(
    services.map(async (s) => {
      const health = await checkHealth(s.url);
      return { ...s, ...health };
    })
  );

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
    `💾 Память: <b>${heapMB} MB</b> heap / <b>${rssMB} MB</b> RSS`
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
