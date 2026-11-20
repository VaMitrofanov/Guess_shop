/**
 * Обложка поста-апдейта для канала (1280×720 PNG) из фирменного шаблона.
 *
 *   node scripts/render-update-cover.mjs <id> "<плашка>" "<заголовок, строки через |>" "<подзаголовок>" [тема] [рисунок]
 *   тема:    violet (по умолчанию) | mint | night | party
 *   рисунок: card (по умолчанию) | cabinet | gift | codes | profile
 *
 * Заголовок: слово в *звёздочках* красится акцентом (жёлтым).
 * Рисунок справа — под тему поста: пост в канал без картинки или с одинаковой
 * карточкой на каждом выглядит как служебное объявление (20.11.2026).
 *
 * Пишет bots/shared/assets/updates/<id>.png — эта папка попадает в образ TG-бота,
 * бот шлёт картинку файлом (не ссылкой: сайт из РФ Telegram забирает не всегда).
 * Нужен локальный Google Chrome; puppeteer-core уже в зависимостях.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const [id, badge, titleRaw, subtitle, theme = "violet", art = "card"] = process.argv.slice(2);
if (!id || !badge || !titleRaw || !subtitle) {
  console.error('node scripts/render-update-cover.mjs <id> "<плашка>" "<заголовок|строки>" "<подзаголовок>" [violet|mint|night|party] [card|cabinet|gift|codes|profile]');
  process.exit(2);
}

const THEMES = {
  violet: "linear-gradient(150deg,#2e2052 0%,#7556e8 58%,#45d6aa 100%)",
  mint: "linear-gradient(150deg,#123b31 0%,#2fae88 55%,#7556e8 100%)",
  night: "linear-gradient(160deg,#0b1f3d 0%,#12396b 60%,#2fa36b 100%)",
  party: "linear-gradient(160deg,#ff6aa8 0%,#7556e8 70%)",
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const title = titleRaw.split("|").map((line) => esc(line).replace(/\*([^*]+)\*/g, '<em>$1</em>')).join("<br>");

/* Персонаж — собирательный «кубический» человечек, не чужой ассет. */
const avatar = (scale = 1, shirt = "#7556e8") => `
<div class="av" style="transform:scale(${scale})">
  <div class="av-h"><i></i><i></i><b></b></div>
  <div class="av-t" style="background:${shirt}"><span>R$</span></div>
  <div class="av-a l"></div><div class="av-a r"></div>
  <div class="av-l l"></div><div class="av-l r"></div>
</div>`;

const ART = {
  card: `<div class="ring"></div><div class="card"><span></span><span></span><span></span></div>`,

  cabinet: `<div class="ring"></div>
<div class="panel cab">
  <div class="cab-top">
    <div class="cab-stage">${avatar(1)}<div class="podium"></div></div>
    <div class="cab-who"><b>Привет, Игрок!</b><small>@your_nick</small><small class="mut">в Roblox с 2019</small></div>
  </div>
  <div class="cab-order"><div class="cab-row"><b>Заказ в работе</b><span class="chip">шаг 3 из 4</span></div>
    <div class="steps"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></div></div>
  <div class="cab-quick"><span>🎟 Код</span><span>🎁 Подарить</span><span>💬 Помощь</span></div>
</div>`,

  gift: `<div class="ring"></div>
<div class="env">
  <div class="env-card"><div class="stamp">R$</div><div class="env-txt">С днём рождения!<br><small>Пусть всё получится ✨</small></div>
    <div class="env-code">●●●● ●●●● ●●●●</div></div>
  <div class="env-back"></div><div class="env-flap"></div><div class="seal">R$</div>
</div>
<div class="linkchip">🔗 robloxbank.ru/gift/…</div>
<div class="bubbles"><span style="background:#2aabee">Telegram</span><span style="background:#25d366">WhatsApp</span><span style="background:#0077ff">ВК</span></div>`,

  codes: `<div class="ring"></div>
<div class="tix">
  <div class="tk t1"><small>КОД ROBUX</small><b>10</b><span>R$</span></div>
  <div class="tk t2"><small>КОД ROBUX</small><b>500</b><span>R$</span></div>
  <div class="tk t3"><small>КОД ROBUX</small><b>5 250</b><span>R$</span></div>
</div>
<div class="pill-row"><span>10</span><span>50</span><span>100</span><span>199</span><span>500</span><span>800</span><span>1 000</span><span>…10 000</span></div>`,

  profile: `<div class="ring"></div>
<div class="hub">
  <div class="src s1">🌐 Сайт</div><div class="src s2">ВК</div><div class="src s3">✈️ Telegram</div>
  <svg class="lines" viewBox="0 0 460 420"><path d="M70 60 C 200 60, 200 210, 300 210"/><path d="M70 210 L 300 210"/><path d="M70 360 C 200 360, 200 210, 300 210"/></svg>
  <div class="me">${avatar(0.62)}<b>Один профиль</b></div>
</div>`,
};

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@700;800&family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;width:1280px;height:720px;overflow:hidden;font-family:Inter,sans-serif}
.c{position:relative;width:1280px;height:720px;background:${THEMES[theme] ?? THEMES.violet};color:#fff;padding:84px 92px;display:flex;flex-direction:column;gap:26px;overflow:hidden}
.b{position:relative;z-index:2;align-self:flex-start;padding:12px 24px;border-radius:999px;background:#45d6aa;color:#173f34;font-weight:700;font-size:30px;letter-spacing:.06em;box-shadow:6px 6px 0 #251b3f}
h1{position:relative;z-index:2;margin:0;font-family:Unbounded,sans-serif;font-weight:800;font-size:84px;line-height:1.02;letter-spacing:-.05em;max-width:660px}
h1 em{font-style:normal;color:#ffd36b}
p{position:relative;z-index:2;margin:0;font-size:36px;font-weight:600;color:#ece6ff;max-width:640px}
.logo{position:absolute;z-index:2;left:92px;bottom:70px;display:flex;align-items:center;gap:18px;font-weight:700;font-size:30px;letter-spacing:.04em}
.logo i{width:64px;height:64px;border-radius:18px;background:#fff;color:#7556e8;display:grid;place-items:center;font:800 22px Unbounded,sans-serif;font-style:normal;box-shadow:5px 5px 0 #45d6aa}
.ring{position:absolute;right:-120px;top:-120px;width:560px;height:560px;border-radius:50%;border:70px solid rgba(255,255,255,.08)}
.card{position:absolute;right:110px;bottom:120px;width:300px;height:200px;border-radius:28px;background:#fff;transform:rotate(-8deg);box-shadow:14px 14px 0 #251b3f;padding:28px;display:flex;flex-direction:column;gap:16px}
.card span{display:block;border-radius:10px;background:#ece7ff;height:44px}.card span+span{background:#45d6aa;width:60%;height:28px}.card span+span+span{background:#dcd5ec;width:40%;height:22px}
.s{position:absolute;color:#ffd36b;font-size:44px;z-index:1}

/* персонаж */
.av{position:relative;width:120px;height:200px;transform-origin:bottom center}
.av-h{position:absolute;left:30px;top:0;width:60px;height:56px;border-radius:12px;background:#ffd36b;box-shadow:inset -6px -6px 0 rgba(0,0,0,.08)}
.av-h i{position:absolute;top:20px;width:8px;height:10px;border-radius:3px;background:#251b3f}.av-h i:first-child{left:16px}.av-h i+i{left:36px}
.av-h b{position:absolute;left:18px;top:36px;width:24px;height:7px;border-radius:0 0 8px 8px;background:#251b3f}
.av-t{position:absolute;left:24px;top:60px;width:72px;height:72px;border-radius:10px;display:grid;place-items:center;box-shadow:inset -6px -6px 0 rgba(0,0,0,.12)}
.av-t span{font:800 18px Unbounded,sans-serif;color:#fff}
.av-a{position:absolute;top:62px;width:24px;height:68px;border-radius:9px;background:#ffd36b}.av-a.l{left:-2px;transform:rotate(14deg)}.av-a.r{right:-2px;transform:rotate(-24deg);top:50px}
.av-l{position:absolute;top:134px;width:34px;height:66px;border-radius:8px;background:#2e2052}.av-l.l{left:25px}.av-l.r{left:61px}

/* кабинет */
.panel{position:absolute;z-index:1;border-radius:34px;background:#fff;color:#251b3f;box-shadow:16px 16px 0 #251b3f}
.cab{right:64px;top:130px;width:420px;padding:26px;transform:rotate(3deg);display:flex;flex-direction:column;gap:18px}
.cab-top{display:flex;gap:20px;align-items:flex-end;background:linear-gradient(160deg,#ece7ff,#c9f3e4);border-radius:24px;padding:18px 18px 14px}
.cab-stage{position:relative;width:130px;height:214px;display:flex;justify-content:center}
.cab-stage .av{position:absolute;bottom:20px}
.podium{position:absolute;bottom:0;left:4px;width:122px;height:26px;border-radius:50%;background:#7556e8;box-shadow:0 8px 0 #4b36a8}
.cab-who{display:flex;flex-direction:column;gap:6px;padding-bottom:24px}.cab-who b{font:800 26px Unbounded,sans-serif;letter-spacing:-.03em}
.cab-who small{font-size:20px;font-weight:700;color:#7556e8}.cab-who .mut{color:#8a83a3;font-weight:600}
.cab-order{background:#7556e8;color:#fff;border-radius:20px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.cab-row{display:flex;justify-content:space-between;align-items:center;font-size:21px}.chip{font-size:16px;font-weight:700;background:rgba(255,255,255,.2);padding:5px 12px;border-radius:999px}
.steps{display:flex;gap:8px}.steps i{flex:1;height:10px;border-radius:6px;background:rgba(255,255,255,.28)}.steps i.on{background:#45d6aa}
.cab-quick{display:flex;gap:10px}.cab-quick span{flex:1;text-align:center;font-size:18px;font-weight:700;background:#f2effb;border-radius:14px;padding:12px 4px}

/* подарок */
.env{position:absolute;z-index:1;right:110px;top:150px;width:420px;height:300px;transform:rotate(-6deg)}
.env-back{position:absolute;inset:0;border-radius:26px;background:#ffd36b;box-shadow:16px 16px 0 #251b3f}
.env-flap{position:absolute;left:0;right:0;bottom:0;height:300px;clip-path:polygon(0 30%,50% 70%,100% 30%,100% 100%,0 100%);background:#ffc43d;border-radius:0 0 26px 26px;z-index:3}
.env-card{position:absolute;z-index:2;left:34px;right:34px;top:-110px;height:250px;border-radius:20px;background:#fff;color:#251b3f;padding:24px;box-shadow:0 8px 0 rgba(37,27,63,.18)}
.env-txt{font:800 28px Unbounded,sans-serif;letter-spacing:-.03em;line-height:1.15}.env-txt small{font:600 19px Inter,sans-serif;color:#7556e8}
.env-code{margin-top:20px;font:800 22px Inter,monospace;letter-spacing:.12em;background:repeating-linear-gradient(45deg,#c9bfee 0 8px,#ddd5f7 8px 16px);color:transparent;border-radius:10px;padding:10px 14px;text-shadow:0 0 0 #c9bfee}
.stamp{position:absolute;right:20px;top:20px;width:58px;height:66px;border:3px dashed #7556e8;border-radius:6px;display:grid;place-items:center;font:800 16px Unbounded,sans-serif;color:#7556e8}
.seal{position:absolute;z-index:4;left:174px;top:166px;width:72px;height:72px;border-radius:50%;background:#e8475f;color:#fff;display:grid;place-items:center;font:800 20px Unbounded,sans-serif;box-shadow:0 5px 0 #a82a3e}
.linkchip{position:absolute;z-index:2;right:150px;bottom:150px;background:#251b3f;color:#fff;font-size:24px;font-weight:700;padding:14px 22px;border-radius:999px;box-shadow:6px 6px 0 #45d6aa}
.bubbles{position:absolute;z-index:2;right:110px;bottom:86px;display:flex;gap:10px}.bubbles span{font-size:19px;font-weight:800;padding:8px 16px;border-radius:999px;color:#fff}

/* коды */
.tix{position:absolute;z-index:1;right:-20px;top:120px;width:520px;height:440px}
.tk{position:absolute;width:300px;height:180px;border-radius:24px;padding:22px 26px;display:flex;flex-direction:column;box-shadow:14px 14px 0 #251b3f;
  -webkit-mask:radial-gradient(circle 18px at 0 50%,#0000 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 18px at 100% 50%,#0000 98%,#000) right/51% 100% no-repeat}
.tk small{font-size:17px;font-weight:800;letter-spacing:.12em;opacity:.75}.tk b{font:800 64px Unbounded,sans-serif;letter-spacing:-.05em;line-height:1.05;margin-top:8px}.tk span{font:800 22px Unbounded,sans-serif;opacity:.85}
.t1{left:0;top:30px;background:#45d6aa;color:#173f34;transform:rotate(-12deg)}
.t2{left:120px;top:120px;background:#fff;color:#251b3f;transform:rotate(-2deg)}
.t3{left:220px;top:230px;background:#ffd36b;color:#3d2a00;transform:rotate(8deg)}
.pill-row{position:absolute;z-index:2;right:70px;bottom:58px;width:560px;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.pill-row span{font-size:19px;font-weight:800;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.35)}

/* профиль */
.hub{position:absolute;z-index:1;right:80px;top:150px;width:470px;height:420px}
.src{position:absolute;left:0;width:150px;text-align:center;font-size:24px;font-weight:800;padding:16px 0;border-radius:18px;background:#fff;color:#251b3f;box-shadow:8px 8px 0 #251b3f}
.s1{top:30px}.s2{top:180px;background:#0077ff;color:#fff}.s3{top:330px;background:#2aabee;color:#fff}
.lines{position:absolute;left:80px;top:0;width:460px;height:420px}.lines path{fill:none;stroke:#ffd36b;stroke-width:8;stroke-dasharray:4 16;stroke-linecap:round}
.me{position:absolute;right:0;top:80px;width:200px;height:250px;border-radius:30px;background:#fff;color:#251b3f;box-shadow:14px 14px 0 #251b3f;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:20px}
.me .av{margin-bottom:6px}.me b{font:800 20px Unbounded,sans-serif;letter-spacing:-.03em}
</style></head><body><div class="c">
${ART[art] ?? ART.card}
<div class="s" style="left:700px;top:80px">✦</div><div class="s" style="left:640px;top:520px;font-size:30px">✦</div>
<div class="b">${esc(badge)}</div><h1>${title}</h1><p>${esc(subtitle)}</p>
<div class="logo"><i>R$</i>ROBLOXBANK</div>
</div></body></html>`;

const out = path.resolve(process.env.COVER_OUT_DIR || "bots/shared/assets/updates");
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.screenshot({ path: path.join(out, `${id}.png`), type: "png" });
  console.log(path.join(out, `${id}.png`));
} finally {
  await browser.close();
}
