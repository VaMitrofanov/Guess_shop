/**
 * Картинки экосистемы (18.11.2026), 1200×675 PNG, в стиле письма-билета:
 *   • profile-assembled — «Профиль собран» (TG-бот после привязки/склейки)
 *     → bots/shared/assets/brand/profile-assembled.png (в образе TG-бота);
 *   • tg-invite — «Ваши заказы уже ждут в Telegram» (приглашение во ВК, шлёт Web)
 *     → public/brand/tg-invite.png (в образе Web: standalone берёт public/).
 * Файлом, не ссылкой: сайт из РФ Telegram забирает не всегда.
 *
 *   node scripts/render-brand-cards.mjs
 * Нужен локальный Google Chrome; puppeteer-core уже в зависимостях.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Inter:wght@600;700;800&display=swap" rel="stylesheet">`;
const PLANE = (size, fill) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M21 4.5L2.8 11.4c-.9.35-.9 1.1 0 1.4l4.6 1.5 1.8 5.4c.2.6.9.8 1.4.4l2.6-2.2 4.7 3.5c.6.4 1.4.1 1.6-.6L22.4 5.9c.2-1-.5-1.7-1.4-1.4z" fill="${fill}"/></svg>`;
const BASE = `*{box-sizing:border-box}body{margin:0;width:1200px;height:675px;overflow:hidden;font-family:Inter,sans-serif;color:#fff}
.c{position:relative;width:1200px;height:675px;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
.top{display:flex;justify-content:space-between;font-weight:800;font-size:24px;letter-spacing:.16em}
.top b{color:#c9bcff}.top span{color:#c9bcff;font-size:20px}
h1{margin:0;font-family:Unbounded,sans-serif;font-weight:800;font-size:76px;line-height:1.02;letter-spacing:-.04em}
.ring{position:absolute;right:-140px;top:-140px;width:520px;height:520px;border-radius:50%;border:64px solid rgba(255,255,255,.07)}
.cut{position:absolute;top:0;bottom:0;width:0;border-left:4px dashed rgba(255,255,255,.28)}`;

const cards = {
  "profile-assembled": {
    out: "bots/shared/assets/brand",
    html: `<style>${BASE}
.c{background:linear-gradient(135deg,#251b3f 0%,#3b2a8f 55%,#7556e8 100%)}
.chain{display:flex;align-items:center}
.av{width:116px;height:116px;border-radius:58px;background:#fff;color:#251b3f;display:grid;place-items:center;font:800 40px Unbounded,sans-serif;box-shadow:8px 8px 0 #45d6aa}
.dash{width:44px;border-top:5px dashed #c9bcff}
.chip{padding:18px 28px;border-radius:999px;font-weight:800;font-size:30px;display:flex;align-items:center;gap:12px}
.tg{background:#229ED9}.vk{background:#0077FF}.site{background:#fff;color:#251b3f}
.ok{width:30px;height:30px;border-radius:15px;background:rgba(255,255,255,.25);display:grid;place-items:center;font-size:20px}
.site .ok{background:#ece7ff;color:#5b3fd6}
p{margin:14px 0 0;font-size:30px;font-weight:600;color:#e4dcff}
</style><div class="c"><div class="ring"></div>
<div class="top"><div>ROBLOX<b>BANK</b></div><span>ПРОФИЛЬ СОБРАН</span></div>
<div class="chain"><div class="av">R$</div><div class="dash"></div>
<div class="chip tg">Telegram</div><div class="dash"></div>
<div class="chip vk">ВКонтакте</div><div class="dash"></div>
<div class="chip site">Сайт</div></div>
<div><h1>Это всё вы —<br>один профиль</h1><p>Где бы вы ни покупали — заказы вместе, статус в Telegram</p></div>
</div>`,
  },
  "tg-invite": {
    out: "public/brand",
    html: `<style>${BASE}
.c{background:linear-gradient(160deg,#2AABEE 0%,#229ED9 45%,#3b2a8f 100%)}
.top b{color:#fff}.top{color:#d6efff}.top span{color:#d6efff}
.plane{position:absolute;right:70px;top:150px;transform:rotate(-6deg);filter:drop-shadow(10px 10px 0 rgba(37,27,63,.35))}
.path{position:absolute;left:640px;top:250px;width:230px;border-top:5px dashed rgba(255,255,255,.45);transform:rotate(-14deg)}
.pills{display:flex;gap:14px;margin-top:22px}.pills span{padding:12px 22px;border-radius:999px;background:rgba(255,255,255,.2);font-weight:800;font-size:26px}
</style><div class="c"><div class="ring"></div><div class="path"></div><div class="plane">${PLANE(300, "#fff")}</div>
<div class="top"><div>ROBLOX<b>BANK</b> · TELEGRAM</div></div>
<div><h1>Ваши заказы<br>уже ждут<br>в Telegram</h1><div class="pills"><span>статус сразу</span><span>ответ быстрее</span><span>одно нажатие</span></div></div>
</div>`,
  },
};

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
try {
  for (const [name, card] of Object.entries(cards)) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}</head><body>${card.html}</body></html>`, { waitUntil: "networkidle0", timeout: 60_000 });
    const dir = path.resolve(card.out);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`), type: "png" });
    console.log(`${card.out}/${name}.png`);
  }
} finally {
  await browser.close();
}
