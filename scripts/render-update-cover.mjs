/**
 * Обложка поста-апдейта для канала (1280×720 PNG) из фирменного шаблона.
 *
 *   node scripts/render-update-cover.mjs <id> "<плашка>" "<заголовок, строки через |>" "<подзаголовок>" [тема]
 *   тема: violet (по умолчанию) | mint | night | party
 *
 * Пишет bots/shared/assets/updates/<id>.png — эта папка попадает в образ TG-бота,
 * бот шлёт картинку файлом (не ссылкой: сайт из РФ Telegram забирает не всегда).
 * Нужен локальный Google Chrome; puppeteer-core уже в зависимостях.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [id, badge, titleRaw, subtitle, theme = "violet"] = process.argv.slice(2);
if (!id || !badge || !titleRaw || !subtitle) {
  console.error('node scripts/render-update-cover.mjs <id> "<плашка>" "<заголовок|строки>" "<подзаголовок>" [violet|mint|night|party]');
  process.exit(2);
}

const THEMES = {
  violet: "linear-gradient(150deg,#2e2052 0%,#7556e8 58%,#45d6aa 100%)",
  mint: "linear-gradient(150deg,#123b31 0%,#2fae88 55%,#7556e8 100%)",
  night: "linear-gradient(160deg,#0b1f3d 0%,#12396b 60%,#2fa36b 100%)",
  party: "linear-gradient(160deg,#ff6aa8 0%,#7556e8 70%)",
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const title = titleRaw.split("|").map(esc).join("<br>");

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Inter:wght@600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:Inter,sans-serif}
.c{position:relative;width:1280px;height:720px;background:${THEMES[theme] ?? THEMES.violet};color:#fff;padding:84px 92px;display:flex;flex-direction:column;gap:26px}
.b{align-self:flex-start;padding:12px 24px;border-radius:999px;background:#45d6aa;color:#173f34;font-weight:700;font-size:30px;letter-spacing:.06em;box-shadow:6px 6px 0 #251b3f}
h1{margin:0;font-family:Unbounded,sans-serif;font-weight:800;font-size:104px;line-height:1;letter-spacing:-.05em;max-width:860px}
p{margin:0;font-size:38px;font-weight:600;color:#ece6ff}
.logo{position:absolute;left:92px;bottom:70px;display:flex;align-items:center;gap:18px;font-weight:700;font-size:30px;letter-spacing:.04em}
.logo i{width:64px;height:64px;border-radius:18px;background:#fff;color:#7556e8;display:grid;place-items:center;font:800 22px Unbounded,sans-serif;font-style:normal;box-shadow:5px 5px 0 #45d6aa}
.ring{position:absolute;right:-120px;top:-120px;width:560px;height:560px;border-radius:50%;border:70px solid rgba(255,255,255,.08)}
.card{position:absolute;right:110px;bottom:120px;width:300px;height:200px;border-radius:28px;background:#fff;transform:rotate(-8deg);box-shadow:14px 14px 0 #251b3f;padding:28px;display:flex;flex-direction:column;gap:16px}
.card span{display:block;border-radius:10px;background:#ece7ff;height:44px}.card span+span{background:#45d6aa;width:60%;height:28px}.card span+span+span{background:#dcd5ec;width:40%;height:22px}
.s{position:absolute;color:#ffd36b;font-size:44px}
</style></head><body><div class="c">
<div class="ring"></div><div class="card"><span></span><span></span><span></span></div>
<div class="s" style="left:760px;top:90px">✦</div><div class="s" style="left:1010px;top:330px;font-size:30px">✦</div>
<div class="b">${esc(badge)}</div><h1>${title}</h1><p>${esc(subtitle)}</p>
<div class="logo"><i>R$</i>ROBLOXBANK</div>
</div></body></html>`;

const out = path.resolve("bots/shared/assets/updates");
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.screenshot({ path: path.join(out, `${id}.png`), type: "png" });
  console.log(`bots/shared/assets/updates/${id}.png`);
} finally {
  await browser.close();
}
