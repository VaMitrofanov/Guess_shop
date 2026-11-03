#!/usr/bin/env node
/**
 * Проверка здоровья после переезда TG-бота и моста SG → HK (27.10.2026).
 *
 * Запускается с мака владельца (нужны `ssh hk` / `ssh rf` из ~/.ssh/config и
 * `.env` репозитория) — разово по launchd 29.10.2026 или руками в любой момент.
 * Собирает: состояние контейнера бота на HK (рестарты, память, диск, своп),
 * ошибки бота и работу моста за период, релей Neon, адрес моста у Web/Guide/VK,
 * переключения маршрута до Neon, очередь апдейтов Telegram, сводку опроса и
 * подтверждений «Робуксы поступили». Отчёт печатает и шлёт в Telegram.
 *
 * Только чтение: ничего не перезапускает и не меняет.
 *
 * Использование:
 *   node scripts/hk-health-check.mjs [--tg=<chat_id>] [--hours=48] [--once-flag=<файл>]
 *   --tg         кому прислать отчёт (TG chat id); без него — только печать
 *   --once-flag  если файл есть — выйти молча; после отправки создаётся
 *                (для разового запуска из launchd)
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";
import dotenv from "dotenv";

const here = new URL("..", import.meta.url).pathname;
process.chdir(here);
dotenv.config({ path: ".env" });

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const TG_TO = arg("tg");
const HOURS = Number(arg("hours") ?? 48);
const ONCE = arg("once-flag");
if (ONCE && fs.existsSync(ONCE)) process.exit(0);

/* Адрес HK — из ~/.ssh/config (`Host hk`), а не из кода: репозиторий публичный. */
const HK_IP = execFileSync("/usr/bin/ssh", ["-G", "hk"], { encoding: "utf8" }).match(/^hostname (\S+)$/m)?.[1] ?? "";

const lines = [];
const out = (s = "") => lines.push(s);
let bad = 0;
const flag = (ok, text) => { if (!ok) bad++; out(`${ok ? "✅" : "❌"} ${text}`); };

function ssh(host, script) {
  try {
    return execFileSync("/usr/bin/ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, script], {
      encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    return `ERR ${String(e.stderr || e.message).split("\n")[0]}`;
  }
}

out(`🩺 Проверка после переезда в Гонконг — за ${HOURS} ч`);
out(new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК");
out("");

// ── HK: бот, ресурсы, мост, релей ─────────────────────────────────────────
const hk = ssh("hk", `
c=$(docker ps -a --format '{{.Names}}' | grep gl6r24 | head -1)
echo "STATE=$(docker inspect $c --format '{{.State.Status}} {{.State.Health.Status}} {{.RestartCount}} {{.State.StartedAt}}')"
echo "MEM=$(free -m | awk '/Mem/{print $3"/"$2}')"
echo "SWAP=$(free -m | awk '/Swap/{print $3"/"$2}')"
echo "DISK=$(df -h / | awk 'NR==2{print $5}')"
echo "BOTMEM=$(docker stats --no-stream --format '{{.MemUsage}}' $c | cut -d/ -f1 | tr -d ' ')"
echo "RELAY=$(systemctl is-active neon-relay)"
echo "POLL=$(docker logs --since ${HOURS}h $c 2>&1 | grep -c 'Bot started ✅ (polling)')"
echo "CONFLICT=$(docker logs --since ${HOURS}h $c 2>&1 | grep -ciE '409: Conflict|terminated by other getUpdates')"
echo "ERRORS=$(docker logs --since ${HOURS}h $c 2>&1 | grep -iE 'error|unhandled|exception' | grep -viE 'chat not found|blocked by the user|statistics-api|stocks' | wc -l)"
echo "TGPROXY=$(docker logs --since ${HOURS}h $c 2>&1 | grep -c 'tg-proxy\\] → chat')"
echo "TGPROXYFAIL=$(docker logs --since ${HOURS}h $c 2>&1 | grep -ciE 'tg-proxy\\] (TG error|fetch failed)')"
echo "CHECKPASS=$(docker logs --since ${HOURS}h $c 2>&1 | grep -c 'Validating gamepass')"
echo "TOPERR<<"
docker logs --since ${HOURS}h $c 2>&1 | grep -iE 'error|unhandled|exception' | grep -viE 'chat not found|blocked by the user|statistics-api|stocks' | sed -E 's/[0-9]{5,}/…/g' | cut -c1-90 | sort | uniq -c | sort -rn | head -4
`);
const kv = Object.fromEntries([...hk.matchAll(/^([A-Z]+)=(.*)$/gm)].map((m) => [m[1], m[2]]));
if (hk.startsWith("ERR")) {
  flag(false, `HK-сервер недоступен по SSH: ${hk}`);
} else {
  const [status, health, restarts, started] = (kv.STATE ?? "").split(" ");
  flag(status === "running" && health === "healthy", `TG-бот на HK: ${status}/${health}, рестартов ${restarts}, запущен ${started?.slice(0, 16)} UTC`);
  flag(Number(kv.CONFLICT) === 0, `конфликтов polling (409): ${kv.CONFLICT}`);
  flag(Number(kv.ERRORS) < 30, `ошибок в логе бота: ${kv.ERRORS}`);
  const top = hk.split("TOPERR<<")[1]?.trim();
  if (top) out(top.split("\n").map((l) => "   " + l.trim()).join("\n"));
  flag(Number(kv.TGPROXY) > 0 && Number(kv.TGPROXYFAIL) < 5, `мост: доставлено через tg-proxy ${kv.TGPROXY}, сбоев ${kv.TGPROXYFAIL}, проверок пассов ${kv.CHECKPASS}`);
  flag(kv.RELAY === "active", `релей Neon на HK: ${kv.RELAY}`);
  const memUsed = Number((kv.MEM ?? "0/1").split("/")[0]);
  const swapUsed = Number((kv.SWAP ?? "0/1").split("/")[0]);
  const disk = Number((kv.DISK ?? "0%").replace("%", ""));
  flag(swapUsed < 1500 && disk < 85, `ресурсы HK: память ${kv.MEM} МБ (бот ${kv.BOTMEM}), своп ${kv.SWAP} МБ, диск ${kv.DISK}`);
  void memUsed;
}

// ── RF: адрес моста у приложений, маршрут до Neon ─────────────────────────
const rf = ssh("rf", `
for c in robloxbank-web $(docker ps --format '{{.Names}}' | grep -E 'gmtpfq|ebac6l'); do echo "URL $c $(docker exec $c printenv VALIDATOR_SOURCE_URL)"; done
echo "WEBBRIDGEERR=$(docker logs --since ${HOURS}h robloxbank-web 2>&1 | grep -iE 'bridge|validator|tg-proxy' | grep -ciE 'error|fail|ECONN|timeout')"
echo "RELAYHOST=$(grep -E '^RELAY_HOST=' /etc/neon-route.conf | cut -d= -f2)"
echo "ROUTE<<"
awk -v since="$(date -u -d "-${HOURS} hours" +%Y-%m-%dT%H:%M)" '$1 >= since' /var/log/neon-route.log | tail -4
`);
if (rf.startsWith("ERR")) {
  flag(false, `RF-сервер недоступен по SSH: ${rf}`);
} else {
  const urls = [...rf.matchAll(/^URL (\S+) (.*)$/gm)];
  const onHk = urls.length >= 3 && urls.every((m) => m[2].includes(HK_IP));
  flag(onHk, `адрес моста у Web/Guide/VK: ${onHk ? "Гонконг" : urls.map((m) => m[2]).join(", ")}`);
  const wErr = Number(/WEBBRIDGEERR=(\d+)/.exec(rf)?.[1] ?? 0);
  flag(wErr < 10, `ошибок моста в логе сайта: ${wErr}`);
  const relayHost = /RELAYHOST=(.*)/.exec(rf)?.[1];
  flag(relayHost === HK_IP, `маршрут до Neon смотрит на: ${relayHost === HK_IP ? "Гонконг" : relayHost}`);
  const route = rf.split("ROUTE<<")[1]?.trim();
  out(route ? `   переключения пути до Neon:\n${route.split("\n").map((l) => "   " + l).join("\n")}` : "   переключений пути до Neon не было — прямой путь здоров");
}

// ── Telegram: бот разбирает апдейты ──────────────────────────────────────
try {
  const w = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/getWebhookInfo`).then((r) => r.json());
  const pending = w.result?.pending_update_count ?? -1;
  flag(pending >= 0 && pending < 20, `Telegram: необработанных апдейтов ${pending}`);
} catch (e) {
  flag(false, `Telegram getWebhookInfo: ${e.message}`);
}

// ── База: опрос и подтверждения ──────────────────────────────────────────
try {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const { rows } = await pool.query(`
    SELECT type, count(*)::int n FROM (
      SELECT DISTINCT ON ("orderId") type FROM "OrderEvent"
       WHERE type LIKE 'ROBUX_SURVEY_%' ORDER BY "orderId", "createdAt" DESC) t GROUP BY 1`);
  const { rows: [recent] } = await pool.query(
    `SELECT count(*)::int n FROM "OrderEvent" WHERE "createdAt" > now() - make_interval(hours => $1)`, [HOURS]);
  await pool.end();
  const by = Object.fromEntries(rows.map((r) => [r.type, r.n]));
  out("");
  out(`📊 Подтверждения и опрос (всего): ✅ поступили ${by.ROBUX_SURVEY_GOT ?? 0} · ⏳ в Pending ${by.ROBUX_SURVEY_PENDING ?? 0} · ❌ нигде нет ${by.ROBUX_SURVEY_NONE ?? 0}`);
  flag(recent.n > 0, `событий заказов за ${HOURS} ч: ${recent.n} (база пишется)`);
} catch (e) {
  flag(false, `база: ${e.message}`);
}

out("");
out(bad === 0
  ? "🟢 Всё в порядке — Сингапур можно выводить (удалить TG_bot и сервер в Coolify, туннель/WireGuard на RF, сервер у Hetzner)."
  : `🔴 Проблем: ${bad} — Сингапур пока НЕ удалять, разобраться.`);

const report = lines.join("\n");
console.log(report);

if (TG_TO) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_TO, text: report, link_preview_options: { is_disabled: true } }),
  }).then((x) => x.json()).catch((e) => ({ ok: false, description: e.message }));
  console.log(r.ok ? "→ отчёт отправлен в Telegram" : `→ Telegram не принял: ${r.description}`);
  if (r.ok && ONCE) fs.writeFileSync(ONCE, new Date().toISOString());
}
