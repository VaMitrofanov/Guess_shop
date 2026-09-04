/**
 * Оформление инструкции по геймпассу. Один файл на обе поверхности: пошаговую
 * страницу (`WBInstructionV2`) и проверку аккаунта перед ней (`GamepassCheck`).
 * Все классы с префиксом `wbi-`, скин `.wbi-v3` — язык витрины.
 */
export const GUIDE_CSS = `
.wbi-root{--gold:#a68bff;--gold2:#c2b2ff;--grn:#45d6aa;--bg:#0b0912;--panel:#151120;--line:#30283f;--txt:#f4f0ff;--mut:#aaa3b8;position:relative;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;min-height:100vh;min-height:100dvh}
.wbi-root *{box-sizing:border-box}
.wbi-bgfx{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.wbi-blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.16}
.wbi-b1{width:520px;height:520px;background:#7556e8;top:-160px;right:-140px;animation:wbi-drift1 22s ease-in-out infinite}
.wbi-b2{width:460px;height:460px;background:#237e69;bottom:-180px;left:-160px;animation:wbi-drift2 26s ease-in-out infinite}
@keyframes wbi-drift1{50%{transform:translate(-40px,60px)}}
@keyframes wbi-drift2{50%{transform:translate(50px,-50px)}}
.wbi-wrap{position:relative;z-index:1;max-width:880px;margin:0 auto;padding:env(safe-area-inset-top,0px) max(18px,env(safe-area-inset-right,0px)) calc(70px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px))}
.wbi-top{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid rgba(201,168,76,.22);gap:12px;flex-wrap:wrap}
.wbi-eye{font-size:13px;font-weight:800;letter-spacing:2.2px;color:var(--gold)}
.wbi-top-sub{font-size:15px;color:var(--txt);margin-top:2px}
.wbi-tag{font-size:14px;font-weight:750;color:var(--gold2);border:1px solid rgba(201,168,76,.4);padding:6px 12px;border-radius:8px;background:rgba(201,168,76,.06);white-space:nowrap}
.wbi-reset{font-size:14px;color:var(--gold);background:transparent;border:1px solid rgba(201,168,76,.3);padding:7px 12px;border-radius:8px;cursor:pointer;transition:border-color .2s}
.wbi-reset:hover{border-color:rgba(201,168,76,.7)}
.wbi-hero{padding:40px 0 30px;text-align:center}
.wbi-kick{font-size:14px;font-weight:800;letter-spacing:2.5px;color:#71e0bd;margin-bottom:14px}
.wbi-h1{font-size:clamp(34px,7vw,58px);font-weight:900;text-transform:uppercase;line-height:.95;letter-spacing:-.02em}
.wbi-g{background:linear-gradient(100deg,#7556e8,#c2b2ff,#45d6aa,#7556e8);background-size:240% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wbi-shine 6s linear infinite}
@keyframes wbi-shine{to{background-position:200% center}}
.wbi-lead{color:var(--mut);font-size:18px;max-width:560px;margin:18px auto 0}
.wbi-chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px}
.wbi-chip{display:flex;flex-direction:column;align-items:center;gap:3px;border:1px solid var(--line);background:rgba(255,255,255,.02);border-radius:12px;padding:12px 18px;min-width:92px}
.wbi-chip b{color:var(--grn);font-size:17px}.wbi-chip span{font-size:12px;font-weight:750;letter-spacing:1px;color:var(--mut)}
.wbi-must{max-width:560px;margin:24px auto 0;text-align:left;border:1px solid rgba(245,158,11,.45);background:radial-gradient(circle at 50% 0,rgba(245,158,11,.1),transparent 70%),#0b0d18;border-radius:16px;padding:18px 20px}
.wbi-must-h{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;letter-spacing:1px;color:#fcd34d;margin-bottom:12px}
.wbi-must-it{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}
.wbi-must-it .wbi-n{flex-shrink:0;width:26px;height:26px;border-radius:8px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.5);color:#fcd34d;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.wbi-must-it b{color:#fff}.wbi-must-it span{font-size:16px;color:#e7d4a6;line-height:1.5}
.wbi-must-ft{font-size:14px;color:#d7c17f;margin-top:10px;font-style:italic;line-height:1.5}
.wbi-tl{position:relative;margin-top:34px;padding-left:50px}
.wbi-tl::before{content:'';position:absolute;left:17px;top:8px;bottom:40px;width:2px;background:linear-gradient(180deg,rgba(201,168,76,.05),rgba(201,168,76,.55),rgba(0,212,132,.5),rgba(201,168,76,.05))}
.wbi-step{position:relative;margin-bottom:26px}
.wbi-dot{position:absolute;left:-50px;top:2px;width:36px;height:36px;border-radius:50%;background:#0d1120;border:2px solid rgba(201,168,76,.55);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--gold2);font-size:15px;z-index:2}
.wbi-dot.wbi-pulse{animation:wbi-pulse 2.6s infinite}
@keyframes wbi-pulse{0%{box-shadow:0 0 0 0 rgba(240,192,64,.45)}70%{box-shadow:0 0 0 14px rgba(240,192,64,0)}100%{box-shadow:0 0 0 0 rgba(240,192,64,0)}}
.wbi-card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(26,20,39,.9),rgba(16,13,24,.94));border-radius:20px;padding:22px;transition:transform .3s,border-color .3s,box-shadow .3s}
.wbi-card.wbi-key{border:1px solid rgba(201,168,76,.5);animation:wbi-glow 3.4s ease-in-out infinite}
@keyframes wbi-glow{0%,100%{box-shadow:0 0 0 1px rgba(201,168,76,.25),0 0 22px rgba(201,168,76,.08)}50%{box-shadow:0 0 0 1px rgba(201,168,76,.6),0 0 44px rgba(201,168,76,.2)}}
.wbi-kbadge{display:inline-block;background:linear-gradient(90deg,#c9a84c,#f7d574);color:#1a1405;font-size:14px;font-weight:850;letter-spacing:.8px;padding:7px 13px;border-radius:20px;margin-bottom:14px}
/* Finish step — green "finish line" accent so it can't be missed when scrolling fast */
.wbi-card.wbi-finish{border:1px solid rgba(0,224,138,.6);animation:wbi-glow-fin 3s ease-in-out infinite}
@keyframes wbi-glow-fin{0%,100%{box-shadow:0 0 0 1px rgba(0,224,138,.3),0 0 26px rgba(0,224,138,.12)}50%{box-shadow:0 0 0 1px rgba(0,224,138,.72),0 0 54px rgba(0,224,138,.28)}}
.wbi-finish .wbi-kbadge{background:linear-gradient(90deg,#00e08a,#5ef0b0);color:#06210f}
.wbi-step:has(.wbi-finish) .wbi-dot.wbi-pulse{background:#00e08a;color:#06210f;animation:wbi-pulse-fin 2.6s infinite}
@keyframes wbi-pulse-fin{0%{box-shadow:0 0 0 0 rgba(0,224,138,.5)}70%{box-shadow:0 0 0 14px rgba(0,224,138,0)}100%{box-shadow:0 0 0 0 rgba(0,224,138,0)}}
.wbi-ttl{font-size:24px;font-weight:800;color:#fff;margin-bottom:6px}
.wbi-t{color:#c3c9d4;font-size:17px;margin:8px 0;line-height:1.65}
.wbi-card b,.wbi-card strong{color:#fff;font-weight:700}
.wbi-cols{display:grid;grid-template-columns:1fr;gap:20px;align-items:center;margin-top:6px}
@media(min-width:860px){.wbi-cols.wbi-media{grid-template-columns:minmax(0,1fr) minmax(300px,360px)}.wbi-cols.wbi-rev .wbi-mcol{order:-1}}
.wbi-mcol{display:flex;flex-direction:column;align-items:center}
.wbi-intro-step{align-items:start}
.wbi-intro-step .wbi-mcol{width:100%;max-width:420px;justify-self:end}
.wbi-intro-step .wbi-btnL{width:100%}
.wbi-quicknotes{display:grid;gap:8px;margin-top:14px}
.wbi-quicknotes span{display:block;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:rgba(51,95,255,.07);color:var(--mut);font-size:15.5px;line-height:1.5}
.wbi-figure{width:100%;max-width:440px;margin:0;position:relative}
.wbi-figure::before{content:'ROBLOX  ·  CREATOR HUB';position:absolute;z-index:5;right:9px;top:9px;padding:6px 9px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:rgba(17,18,20,.94);color:#f7f7f8;font-size:12px;font-weight:850;letter-spacing:.06em;line-height:1;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.25)}
.wbi-figure img{width:100%;border-radius:12px;border:1px solid #26314a;display:block;transition:transform .35s}
.wbi-figure:hover img{transform:scale(1.015)}
.wbi-figure.wbi-spot{position:relative;border-radius:12px}
.wbi-figure.wbi-spot::after{content:'';position:absolute;inset:-4px;border-radius:14px;border:2px solid rgba(0,212,132,0);animation:wbi-ring 2.8s ease-in-out infinite;pointer-events:none}
@keyframes wbi-ring{0%,100%{border-color:rgba(0,212,132,0)}50%{border-color:rgba(0,212,132,.55)}}
.wbi-figure video{width:100%;border-radius:12px;border:1px solid #26314a;display:block;background:#070b15}
.wbi-figure figcaption{font-size:16px;color:#d6dbe4;margin-top:10px;background:rgba(0,176,111,.08);border-left:3px solid var(--grn);padding:11px 14px;border-radius:0 8px 8px 0;line-height:1.55}
.wbi-shot{width:100%;max-width:660px;margin:18px auto 0}
.wbi-btnL{display:inline-block;background:linear-gradient(180deg,#2aa8e0,#1f8fc6);border:1px solid rgba(34,158,217,.8);box-shadow:0 5px 0 #14638c,0 10px 22px rgba(34,158,217,.32);color:#fff;font-weight:800;font-size:16px;padding:16px 26px;border-radius:12px;text-decoration:none;text-align:center;transition:transform .12s}
.wbi-btnL:active{transform:translateY(3px);box-shadow:0 2px 0 #14638c}
.wbi-url{text-align:center;font-size:14px;color:#a3aabc;margin-top:9px}
.wbi-ol{list-style:none;counter-reset:s;margin:8px 0;padding:0}
.wbi-ol li{counter-increment:s;position:relative;padding:10px 0 10px 44px;font-size:16.5px;line-height:1.5;border-bottom:1px solid rgba(255,255,255,.05)}
.wbi-ol li:last-child{border-bottom:0}
.wbi-ol li::before{content:counter(s);position:absolute;left:0;top:7px;width:27px;height:27px;border-radius:50%;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.5);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800}
.wbi-pill{display:inline-block;font-weight:800;color:#fff;background:#1d4ed8;padding:2px 11px;border-radius:7px}
.wbi-ok{font-size:16px;color:#a3f3d2;background:rgba(0,176,111,.1);padding:12px 15px;border-radius:10px;margin-top:14px;border:1px solid rgba(0,212,132,.25);line-height:1.55}
.wbi-warn{font-size:16px;color:#fcd34d;background:rgba(245,158,11,.09);padding:12px 15px;border-radius:10px;margin-top:10px;border:1px solid rgba(245,158,11,.25);line-height:1.55}
.wbi-calc{border:2px solid rgba(201,168,76,.5);background:radial-gradient(circle at 50% 0,rgba(201,168,76,.14),transparent 72%),#070b15;border-radius:16px;padding:22px 24px;text-align:center;width:100%;max-width:330px;margin:14px auto 0}
.wbi-lbl{font-size:14px;letter-spacing:2px;color:var(--gold);font-weight:800}
.wbi-v{font-size:64px;line-height:1;color:var(--gold2);font-weight:900;margin:10px 0 6px;text-shadow:0 0 26px rgba(240,192,64,.4)}
.wbi-v.wbi-copy{display:inline-flex;align-items:center;gap:10px;justify-content:center;border-radius:10px;padding:2px 10px;cursor:pointer;transition:transform .15s}
.wbi-v.wbi-copy:hover{transform:scale(1.03)}
.wbi-ci{font-size:24px;opacity:.7}
.wbi-sub{font-size:14px;color:#9aa1b0}
.wbi-nomrow{font-size:15px;color:#c3c9d4;margin:8px 0 2px}
.wbi-input{width:104px;font-size:22px;font-weight:800;text-align:center;background:#0d1424;border:1px solid rgba(201,168,76,.5);color:#fff;border-radius:8px;padding:7px 8px;margin:0 4px;-moz-appearance:textfield}
.wbi-input:focus{outline:none;border-color:var(--gold2)}
.wbi-input::-webkit-outer-spin-button,.wbi-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.wbi-copyhint{font-size:15.5px;color:#8ff0bf;margin-top:10px;line-height:1.45}
/* ── Annotation overlay layer (highlights/labels live in CSS, screenshots stay clean) ── */
.wbi-anno{position:relative;display:block;line-height:0;container-type:inline-size;overflow:hidden;border-radius:12px;animation:wbi-media-focus 7s cubic-bezier(.22,1,.36,1) infinite}
.wbi-anno img{display:block}
.wbi-figure:hover .wbi-anno img{transform:none}
.wbi-box{position:absolute;border:3px solid transparent;border-radius:11px;pointer-events:none;z-index:2}
.wbi-box.pill{border-radius:999px}
.wbi-box.g{border-color:#335fff;box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 16px rgba(51,95,255,.58);animation:wbi-target-pulse 2.2s ease-in-out infinite}
.wbi-box.g::after{content:'';position:absolute;left:50%;top:50%;width:18px;height:18px;border:3px solid #fff;border-radius:50%;background:rgba(51,95,255,.82);box-shadow:0 0 0 7px rgba(51,95,255,.2),0 3px 12px rgba(0,0,0,.35);transform:translate(-50%,-50%);animation:wbi-roblox-tap 2.2s cubic-bezier(.22,1,.36,1) infinite}
.wbi-box.y{border-color:#f2c14e;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 0 16px rgba(242,193,78,.45)}
.wbi-tip{position:absolute;transform:translate(-50%,-50%);z-index:3;pointer-events:none;line-height:1;font-weight:850;letter-spacing:.3px;white-space:nowrap;font-size:clamp(13px,2.7cqw,17px);padding:.46em .66em;border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,.4)}
.wbi-tip.g{background:#335fff;color:#fff;animation:wbi-tip-float 2.2s ease-in-out infinite}
.wbi-tip.y{background:#f2c14e;color:#241a02}
.wbi-tip.r{background:#ff4444;color:#fff}
.wbi-tip.caret{font-size:clamp(13px,2.4cqw,16px)}
.wbi-tip.caret::after{content:"";position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);border:5px solid transparent;border-top-color:#335fff;border-bottom:0}
.wbi-tip.r.caret::after{border-top-color:#ff4444}
@keyframes wbi-media-focus{0%,18%,100%{transform:scale(1)}45%,72%{transform:scale(1.025)}}
@keyframes wbi-target-pulse{0%,100%{box-shadow:0 0 0 1px rgba(0,0,0,.45),0 0 10px rgba(51,95,255,.34)}50%{box-shadow:0 0 0 5px rgba(51,95,255,.2),0 0 30px rgba(51,95,255,.82)}}
@keyframes wbi-roblox-tap{0%,18%,100%{opacity:0;transform:translate(-50%,-50%) scale(.55)}35%,64%{opacity:1;transform:translate(-50%,-50%) scale(1)}76%{opacity:0;transform:translate(-50%,-50%) scale(1.65)}}
@keyframes wbi-tip-float{0%,100%{margin-top:0}50%{margin-top:-5px}}
.wbi-price6{position:absolute;left:13%;top:65.7%;transform:translateY(-50%);z-index:2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-weight:500;font-size:4.7cqw;line-height:1;color:#f1f1f3;white-space:nowrap;letter-spacing:.3px}
/* ── Step-7 verification gate + nick search ── */
.wbi-checks{display:flex;flex-direction:column;gap:10px;margin-top:14px}
.wbi-check{display:flex;align-items:flex-start;gap:12px;cursor:pointer;border:1px solid var(--line);background:#0b0f1c;border-radius:12px;padding:13px 15px;transition:border-color .2s,background .2s}
.wbi-check:hover{border-color:rgba(201,168,76,.45)}
.wbi-check.on{border-color:rgba(0,224,138,.55);background:radial-gradient(circle at 0 0,rgba(0,224,138,.1),transparent 70%),#0b0f1c}
.wbi-check input{position:absolute;opacity:0;width:0;height:0}
.wbi-cbox{flex-shrink:0;width:26px;height:26px;border-radius:8px;border:2px solid #394760;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:transparent;transition:all .15s}
.wbi-check.on .wbi-cbox{background:#00e08a;border-color:#00e08a;color:#06210f}
.wbi-ctext{font-size:15.5px;color:#cdd3de;line-height:1.45;padding-top:1px}
.wbi-check.on .wbi-ctext{color:#e7e9ee}
.wbi-checknote{font-size:15.5px;color:#b9c0cf;line-height:1.55;padding:4px 6px}
.wbi-checknote b{color:#c3c9d4}
.wbi-search{margin-top:16px;transition:opacity .25s}
.wbi-search.locked{opacity:.55}
.wbi-locknote{font-size:14px;color:#fcd34d;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px;padding:11px 14px;margin-bottom:12px;line-height:1.45}
.wbi-sinput:disabled{cursor:not-allowed;opacity:.7}
.wbi-sbtn:disabled{cursor:not-allowed}
.wbi-srow{display:flex;gap:10px;flex-wrap:wrap}
.wbi-sinput{flex:1 1 180px;min-width:0;font-size:18px;background:#0d1424;border:1px solid rgba(201,168,76,.5);color:#fff;border-radius:11px;padding:14px;scroll-margin-block:24px 180px}
.wbi-sinput:focus{outline:none;border-color:var(--gold2)}
.wbi-sinput::placeholder{color:#6b7280}
.wbi-sbtn{flex:0 0 auto;font-size:16px;font-weight:800;color:#06210f;background:linear-gradient(180deg,#00e08a,#00b46f);border:1px solid rgba(0,224,138,.6);border-radius:11px;padding:14px 22px;cursor:pointer;transition:transform .12s,opacity .2s;white-space:nowrap}
.wbi-sbtn:active{transform:translateY(1px)}
.wbi-sbtn:disabled{opacity:.6;cursor:default}
.wbi-shint{font-size:16px;color:var(--mut);margin-top:10px;line-height:1.55}
.wbi-gplist{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.wbi-gpcard{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--line);background:#0d1424;border-radius:12px;padding:12px 14px}
.wbi-gpcard.pick{cursor:pointer;border-color:rgba(0,224,138,.45);transition:transform .12s,border-color .2s,box-shadow .2s}
.wbi-gpcard.pick:hover{transform:translateY(-2px);border-color:#00e08a;box-shadow:0 0 0 1px #00e08a,0 8px 22px rgba(0,224,138,.18)}
.wbi-gpcard.dim{opacity:.85}
.wbi-gpthumb{width:54px;height:54px;border-radius:10px;flex-shrink:0;object-fit:cover;background:#070b15;border:1px solid #26314a}
.wbi-gpmeta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.wbi-gpmeta b{color:#fff;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wbi-gpmeta span{color:var(--gold2);font-size:16px;font-weight:750}
.wbi-pickbadge{flex-shrink:0;font-size:14px;font-weight:850;color:#06210f;background:#63e8b6;border-radius:999px;padding:7px 12px}
.wbi-picked{margin-top:14px;border:1px solid rgba(0,224,138,.5);background:radial-gradient(circle at 50% 0,rgba(0,224,138,.12),transparent 70%),#060f0b;border-radius:14px;padding:18px;text-align:center}
.wbi-picked-h{font-size:14px;font-weight:850;letter-spacing:1.2px;color:#a3f3d2}
.wbi-picked-b{font-size:21px;color:#fff;font-weight:800;margin-top:6px}
.wbi-relink{margin-top:14px;font-size:14.5px;color:var(--gold);background:transparent;border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:8px 14px;cursor:pointer}
/* Запасной вход «вставить ссылку»: тихая ссылка, пока поиск по нику
   работает, и раскрытая панель — как только он зашёл в тупик. */
.wbi-manualtoggle{display:block;width:100%;margin-top:12px;padding:11px 14px;font-size:15px;font-weight:700;text-align:left;color:var(--mut);background:transparent;border:1px dashed var(--line);border-radius:11px;cursor:pointer;transition:color .2s,border-color .2s}
.wbi-manualtoggle:hover{color:var(--txt);border-color:var(--gold2)}
.wbi-manual{margin-top:14px;padding:15px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.02)}
.wbi-manual-h{font-size:14px;font-weight:850;letter-spacing:.9px;color:var(--gold2);margin-bottom:8px}
.wbi-relink:hover{border-color:rgba(201,168,76,.7)}
.wbi-blist{list-style:none;margin:10px 0 4px;padding:0;display:flex;flex-direction:column;gap:10px}
.wbi-blist li{position:relative;padding:11px 14px;font-size:15.5px;line-height:1.5;color:#c3c9d4;border:1px solid var(--line);background:rgba(255,255,255,.02);border-radius:11px}
.wbi-blist li b{color:#fff}
.wbi-directnote{margin-top:14px;font-size:15px;line-height:1.55;color:#e7e9ee;border:1px solid rgba(0,224,138,.4);background:radial-gradient(circle at 0 0,rgba(0,224,138,.1),transparent 70%),#0a1410;border-radius:12px;padding:13px 15px}
.wbi-directnote b{color:#7df0b6}
.wbi-icoTile{width:100%;max-width:300px;aspect-ratio:16/10;border-radius:14px;border:1px solid var(--line);background:radial-gradient(circle at 50% 40%,rgba(201,168,76,.1),transparent 70%),#070b15;display:flex;align-items:center;justify-content:center;font-size:64px}
.wbi-cta{border:1px solid rgba(201,168,76,.45);background:radial-gradient(circle at 50% 0,rgba(201,168,76,.12),transparent 70%),#0a0d18;border-radius:18px;padding:26px;margin-top:30px;text-align:center}
.wbi-cta h3{font-size:22px;color:#fff}.wbi-cta .wbi-s{font-size:15px;color:var(--mut);margin-top:7px;line-height:1.55}
.wbi-sitepay{display:flex;align-items:center;justify-content:center;width:min(100%,360px);min-height:58px;margin:20px auto 0;padding:0 22px;border-radius:13px;background:#7556e8;color:#fff;font-size:17px;font-weight:900;text-decoration:none;box-shadow:4px 4px 0 #45d6aa;transition:transform .15s}
.wbi-sitepay:hover{transform:translateY(-2px)}
.wbi-sitepay.disabled{background:#474052;color:#aaa3b8;box-shadow:none;cursor:not-allowed}
.wbi-row{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:20px;align-items:stretch}
.wbi-tg{display:inline-flex;align-items:center;justify-content:center;gap:12px;padding:20px 30px;border-radius:14px;font-size:21px;font-weight:800;letter-spacing:.3px;white-space:nowrap;color:#fff;text-decoration:none;transition:transform .15s,box-shadow .15s;flex:1 1 240px;max-width:300px;background:linear-gradient(180deg,#2aa8e0,#1f8fc6);border:1px solid rgba(34,158,217,.8);box-shadow:0 5px 0 #14638c,0 10px 22px rgba(34,158,217,.32)}
.wbi-tg svg{width:28px;height:28px;flex-shrink:0}
.wbi-tg:hover{transform:translateY(-3px)}.wbi-tg:active{transform:translateY(1px)}
.wbi-vkwrap{flex:1 1 240px;max-width:300px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:linear-gradient(180deg,#3d8bff,#0a66e0);border:1px solid rgba(0,119,255,.8);box-shadow:0 5px 0 #0a4aa0,0 10px 22px rgba(0,119,255,.32);padding:8px 12px;min-height:66px}
/* Scoped: enlarge the VK button label to match Telegram (does not touch VKAuthButton's global style elsewhere) */
.wbi-vkwrap button{gap:12px!important}
.wbi-vkwrap button span{font-size:21px!important;font-weight:800!important;text-transform:none!important;letter-spacing:.3px!important}
.wbi-vkwrap button svg{width:28px!important;height:28px!important;color:#fff!important;flex-shrink:0}
.wbi-redirect{margin-top:14px;font-size:13.5px;line-height:1.5;color:#bcd9ff;background:rgba(61,139,255,.10);border:1px solid rgba(61,139,255,.34);border-radius:11px;padding:10px 13px;text-align:center}
.wbi-directcta{margin-top:16px;font-size:14.5px;line-height:1.5;color:#bff3d6;background:rgba(0,224,138,.08);border:1px solid rgba(0,224,138,.32);border-radius:11px;padding:11px 14px}
.wbi-directcta b{color:#fff}
.wbi-gphelp{margin-top:16px;text-align:left;border:1px solid rgba(255,171,65,.3);border-radius:11px;background:rgba(255,171,65,.07)}
.wbi-gphelp summary{padding:11px 14px;font-size:15px;font-weight:800;color:#ffc98a;cursor:pointer;list-style:none}
.wbi-gphelp summary::-webkit-details-marker{display:none}
.wbi-gphelp summary::after{content:"⌄";float:right;transition:transform .18s ease}
.wbi-gphelp[open] summary::after{transform:rotate(180deg)}
.wbi-gphelp ul{margin:0;padding:0 14px 4px 32px;color:#e3d6c4;font-size:14.5px;line-height:1.55}
.wbi-gphelp li{margin:6px 0}
.wbi-gphelp > a{display:inline-block;margin:6px 14px 14px;font-size:15px;color:#ffc98a;text-decoration:none;border-bottom:1px solid rgba(255,201,138,.36)}
.wbi-support{display:inline-block;margin-top:22px;font-size:16px;color:var(--gold);text-decoration:none;border-bottom:1px solid rgba(201,168,76,.3)}
.wbi-note{font-size:14px;color:#858da0;text-align:center;margin-top:26px;font-style:italic}
.wbi-reveal{opacity:0;transform:translateY(26px);transition:opacity .65s cubic-bezier(.2,.7,.2,1),transform .65s cubic-bezier(.2,.7,.2,1)}
.wbi-reveal.wbi-in{opacity:1;transform:none}
:is(html[data-theme="light"]) .wbi-root{--bg:#fbfaff;--panel:#fff;--line:#ded8f1;--txt:#251b3f;--mut:#706780;background:radial-gradient(circle at 80% 5%,rgba(117,86,232,.12),transparent 28rem),#fbfaff}
:is(html[data-theme="light"]) .wbi-card{background:rgba(255,255,255,.94);box-shadow:0 18px 50px rgba(68,48,109,.055)}
:is(html[data-theme="light"]) .wbi-ttl,:is(html[data-theme="light"]) .wbi-card b,:is(html[data-theme="light"]) .wbi-card strong{color:#251b3f}
:is(html[data-theme="light"]) .wbi-t,:is(html[data-theme="light"]) .wbi-ol li,:is(html[data-theme="light"]) .wbi-ctext,:is(html[data-theme="light"]) .wbi-blist li{color:#62596f}
:is(html[data-theme="light"]) .wbi-chip,:is(html[data-theme="light"]) .wbi-check,:is(html[data-theme="light"]) .wbi-gpcard,:is(html[data-theme="light"]) .wbi-blist li{background:#fff}
:is(html[data-theme="light"]) .wbi-input,:is(html[data-theme="light"]) .wbi-sinput{background:#fff;color:#251b3f}
:is(html[data-theme="light"]) .wbi-calc,:is(html[data-theme="light"]) .wbi-cta{background:#f4f0ff}
:is(html[data-theme="light"]) .wbi-g{background-image:linear-gradient(100deg,#6246d9,#7556e8,#367aa6,#6246d9)}
:is(html[data-theme="light"]) .wbi-top{border-bottom-color:#d9d1ee}
:is(html[data-theme="light"]) .wbi-eye{color:#674bd2}
:is(html[data-theme="light"]) .wbi-tag{color:#5d44b8;border-color:#b9aae8;background:#f2effd}
:is(html[data-theme="light"]) .wbi-must{border-color:#d79b28;background:linear-gradient(145deg,#fffaf0,#fff4d9);box-shadow:0 12px 30px rgba(139,91,0,.08)}
:is(html[data-theme="light"]) .wbi-must-h{color:#765000}
:is(html[data-theme="light"]) .wbi-must-it{border-top-color:rgba(118,80,0,.18)}
:is(html[data-theme="light"]) .wbi-must-it .wbi-n{color:#765000;border-color:#d79b28;background:#ffedbf}
:is(html[data-theme="light"]) .wbi-must-it span{color:#4d3a17}
:is(html[data-theme="light"]) .wbi-must-it b,:is(html[data-theme="light"]) .wbi-must-ft b{color:#2f220b}
:is(html[data-theme="light"]) .wbi-must-ft{color:#6b501c}
:is(html[data-theme="light"]) .wbi-quicknotes span{border-color:#d9d1ee;background:#f6f3ff;color:#554b69}
:is(html[data-theme="light"]) .wbi-ok{color:#185f47;background:#e9f8f2;border-color:#87d7bb}
:is(html[data-theme="light"]) .wbi-picked{background:#e8f8f1;border-color:#6ccaaa}
:is(html[data-theme="light"]) .wbi-picked-h{color:#185f47}

/* ── Skin v3 (.wbi-v3) — единый язык витрины для ВСЕХ режимов инструкции ──
   Правила выше (без .wbi-v3) — легаси-база: их переопределяет этот блок.
   Раньше скин применялся только к SITE (класс назывался wbi-site-mode);
   с 01.08.2026 он включён и на WB-гейте, и в BOT-режиме — контент, тексты и
   логика режимов при этом не менялись. Режимные отличия (Navbar/Footer,
   переключатель темы, channel-кнопки) остались на isSite / wbi-site-mode. */
.wbi-root.wbi-v3{--gold:var(--rb-accent);--gold2:var(--rb-accent);--grn:#45d6aa;--bg:var(--rb-bg);--panel:var(--rb-surface);--line:var(--rb-border);--txt:var(--rb-text);--mut:var(--rb-muted);background:
 radial-gradient(circle at 82% 4%,rgba(117,86,232,.18),transparent 31rem),
 radial-gradient(circle at 7% 38%,rgba(69,214,170,.08),transparent 26rem),var(--rb-bg);font-family:var(--font-geist-sans),ui-sans-serif,system-ui;overflow:clip}
.wbi-v3 .wbi-bgfx{position:absolute}.wbi-v3 .wbi-blob{opacity:.08;filter:blur(110px)}
.wbi-v3 .wbi-wrap{max-width:1180px;padding:0 20px 104px}
.wbi-v3 .wbi-top{padding:28px 0 0;border:0;align-items:center}
.wbi-v3 .wbi-eye{display:inline-flex;align-items:center;gap:8px;width:max-content;padding:8px 12px;border:1px solid var(--rb-border);border-radius:999px;background:color-mix(in srgb,var(--rb-surface) 78%,transparent);color:var(--rb-accent);font-size:12px;letter-spacing:.12em}
.wbi-v3 .wbi-eye::before{content:"";width:7px;height:7px;border-radius:50%;background:#45d6aa;box-shadow:0 0 0 5px rgba(69,214,170,.11)}
.wbi-v3 .wbi-top-sub{margin:7px 0 0;color:var(--rb-muted);font-size:14px;font-weight:750}
.wbi-v3 .wbi-tag{padding:9px 13px;border-color:var(--rb-border);border-radius:11px;background:var(--rb-surface);color:var(--rb-text);font-size:13px;box-shadow:3px 3px 0 color-mix(in srgb,var(--rb-accent) 26%,transparent)}
.wbi-v3 .wbi-hero{min-height:520px;padding:58px 0 52px;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(380px,.92fr);grid-template-rows:auto auto auto auto;align-content:center;align-items:center;column-gap:72px;text-align:left}
.wbi-v3 .wbi-kick{grid-column:1;grid-row:1;margin:0 0 18px;color:var(--rb-accent);font-size:13px;letter-spacing:.1em}
.wbi-v3 .wbi-h1{grid-column:1;grid-row:2;margin:0;color:var(--rb-text);font-family:var(--font-display),var(--font-geist-sans),sans-serif;font-size:clamp(48px,5.7vw,76px);font-weight:700;line-height:.96;letter-spacing:-.065em;text-transform:none}
.wbi-v3 .wbi-g{background:linear-gradient(100deg,#7556e8 5%,#9274f2 50%,#45d6aa 105%);-webkit-background-clip:text;background-clip:text;color:transparent;animation:none}
.wbi-v3 .wbi-lead{grid-column:1;grid-row:3;max-width:610px;margin:24px 0 0;color:var(--rb-muted);font-size:18px;line-height:1.65}
.wbi-v3 .wbi-chips{grid-column:1;grid-row:4;justify-content:flex-start;margin-top:27px;gap:9px}
.wbi-v3 .wbi-chip{min-width:108px;padding:13px 17px;align-items:flex-start;border-color:var(--rb-border);border-radius:14px;background:color-mix(in srgb,var(--rb-surface) 84%,transparent)}
.wbi-v3 .wbi-chip b{color:var(--rb-text);font-size:16px}.wbi-v3 .wbi-chip span{color:var(--rb-muted);font-size:10px}
.wbi-v3 .wbi-must{grid-column:2;grid-row:1/5;max-width:none;margin:0;position:relative;overflow:hidden;padding:30px 30px 32px;border:1px solid rgba(255,255,255,.17);border-radius:26px;background:linear-gradient(145deg,#8063ed 0%,#6546d4 76%,#5b3bc9 100%);box-shadow:12px 12px 0 #45d6aa,0 30px 80px rgba(67,39,144,.25);color:#fff;transform:rotate(1.5deg)}
.wbi-v3 .wbi-must::after{content:"R$";position:absolute;right:-34px;bottom:-82px;color:rgba(255,255,255,.085);font-family:var(--font-display),sans-serif;font-size:190px;font-weight:700;letter-spacing:-.08em;transform:rotate(-8deg)}
.wbi-v3 .wbi-must-h,.wbi-v3 .wbi-must-it,.wbi-v3 .wbi-must-ft{position:relative;z-index:1}
.wbi-v3 .wbi-must-h{margin-bottom:15px;color:#cffff0;font-size:13px;letter-spacing:.09em}
.wbi-v3 .wbi-must-it{padding:16px 0;border-color:rgba(255,255,255,.18)}
.wbi-v3 .wbi-must-it .wbi-n{background:#45d6aa;border-color:#45d6aa;color:#173f34}
.wbi-v3 .wbi-must-it span,.wbi-v3 .wbi-must-it b{color:#fff;font-size:17px}
.wbi-v3 .wbi-must-ft{margin-top:13px;padding:13px 14px;border:1px solid rgba(255,255,255,.17);border-radius:13px;background:rgba(24,14,62,.2);color:rgba(255,255,255,.84);font-size:14px;font-style:normal}
.wbi-v3 .wbi-must-ft b{color:#fff}
.wbi-roadmap{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 78px}
.wbi-roadmap-card{min-height:190px;padding:23px;display:flex;flex-direction:column;justify-content:flex-end;border:1px solid var(--rb-border);border-radius:22px;background:var(--rb-surface);color:var(--rb-text)}
.wbi-roadmap-card span{margin-bottom:auto;color:var(--rb-accent);font-size:12px;font-weight:900;letter-spacing:.1em}.wbi-roadmap-card b{font-family:var(--font-display),sans-serif;font-size:25px;letter-spacing:-.045em}.wbi-roadmap-card small{margin-top:7px;color:var(--rb-muted);font-size:14px;line-height:1.45}
.wbi-roadmap-accent{border-color:#7556e8;background:#7556e8;color:#fff}.wbi-roadmap-accent span{color:#cffff0}.wbi-roadmap-accent small{color:rgba(255,255,255,.76)}
.wbi-roadmap-dark{border-color:#251b3f;background:#251b3f;color:#fff}.wbi-roadmap-dark span{color:#8cf0d0}.wbi-roadmap-dark small{color:rgba(255,255,255,.7)}
.wbi-v3 .wbi-tl{margin:0;padding:0}.wbi-v3 .wbi-tl::before{display:none}
.wbi-v3 .wbi-step{margin:0 0 20px}
.wbi-v3 .wbi-dot{left:24px;top:24px;width:42px;height:42px;border:0;border-radius:13px;background:#7556e8;color:#fff;box-shadow:3px 3px 0 #45d6aa;font-size:14px;transform:rotate(-4deg)}
.wbi-v3 .wbi-card{min-height:156px;padding:31px 32px 31px 88px;border:1px solid var(--rb-border);border-radius:24px;background:color-mix(in srgb,var(--rb-surface) 94%,transparent);box-shadow:none;transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}
.wbi-v3 .wbi-card:hover{border-color:color-mix(in srgb,var(--rb-accent) 45%,var(--rb-border));box-shadow:0 22px 60px rgba(54,35,91,.09);transform:translateY(-2px)}
.wbi-v3 .wbi-card.wbi-key,.wbi-v3 .wbi-card.wbi-finish{border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border));background:linear-gradient(145deg,color-mix(in srgb,var(--rb-accent-soft) 62%,var(--rb-surface)),var(--rb-surface) 64%);animation:none}
.wbi-v3 .wbi-step:has(.wbi-finish) .wbi-dot.wbi-pulse{background:#45d6aa;color:#173f34;animation:none}
.wbi-v3 .wbi-ttl{margin-bottom:8px;color:var(--rb-text);font-family:var(--font-display),var(--font-geist-sans),sans-serif;font-size:clamp(23px,2.4vw,30px);font-weight:700;line-height:1.15;letter-spacing:-.045em}
.wbi-v3 .wbi-t{color:var(--rb-muted);font-size:16px;line-height:1.65}
.wbi-v3 .wbi-card b,.wbi-v3 .wbi-card strong{color:var(--rb-text)}
@media(min-width:860px){.wbi-v3 .wbi-cols.wbi-media{grid-template-columns:minmax(0,1fr) minmax(360px,.92fr);gap:34px}}
.wbi-v3 .wbi-quicknotes span,.wbi-v3 .wbi-blist li{border-color:var(--rb-border);background:var(--rb-surface-2);color:var(--rb-muted)}
.wbi-v3 .wbi-ol li{border-bottom-color:color-mix(in srgb,var(--rb-border) 72%,transparent);color:var(--rb-muted)}
.wbi-v3 .wbi-ol li::before{border-color:color-mix(in srgb,var(--rb-accent) 48%,transparent);background:var(--rb-accent-soft);color:var(--rb-accent)}
.wbi-v3 .wbi-btnL{background:#7556e8;border-color:#7556e8;box-shadow:5px 5px 0 #45d6aa;font-size:16px}.wbi-v3 .wbi-btnL:active{box-shadow:2px 2px 0 #45d6aa}
.wbi-v3 .wbi-figure img,.wbi-v3 .wbi-figure video{border-color:var(--rb-border);border-radius:16px}.wbi-v3 .wbi-anno{border-radius:16px}.wbi-v3 .wbi-figure figcaption{border-left:0;border:1px solid color-mix(in srgb,#45d6aa 42%,var(--rb-border));border-radius:12px;background:color-mix(in srgb,#45d6aa 9%,var(--rb-surface));color:var(--rb-muted)}
.wbi-v3 .wbi-calc{max-width:390px;border:1px solid color-mix(in srgb,var(--rb-accent) 45%,var(--rb-border));border-radius:19px;background:var(--rb-surface-2);box-shadow:6px 6px 0 var(--rb-accent)}
.wbi-v3 .wbi-lbl,.wbi-v3 .wbi-v{color:var(--rb-accent)}.wbi-v3 .wbi-v{text-shadow:none}
.wbi-v3 .wbi-nomrow{color:var(--rb-muted)}.wbi-v3 .wbi-input,.wbi-v3 .wbi-sinput{border:1.5px solid var(--rb-border);background:var(--rb-surface);color:var(--rb-text)}
.wbi-v3 .wbi-checknote{color:var(--rb-muted)}
:is(html[data-theme="light"]) .wbi-v3 .wbi-checknote{color:#63333d}:is(html[data-theme="light"]) .wbi-v3 .wbi-checknote b{color:#35171e}:is(html[data-theme="light"]) .wbi-v3 .wbi-copyhint{color:#24775d}
.wbi-v3 .wbi-sinput:focus,.wbi-v3 .wbi-input:focus{border-color:var(--rb-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--rb-accent) 12%,transparent)}
.wbi-v3 .wbi-sbtn{background:#7556e8;border-color:#7556e8;color:#fff;box-shadow:3px 3px 0 #45d6aa}
.wbi-v3 .wbi-gpcard{background:var(--rb-surface);border-color:var(--rb-border)}
.wbi-v3 .wbi-manual{border-color:var(--rb-border);border-radius:16px;background:var(--rb-surface-2)}
.wbi-v3 .wbi-manual-h{color:var(--rb-accent)}
.wbi-v3 .wbi-manualtoggle{border-color:var(--rb-border);border-radius:14px;color:var(--rb-muted)}
.wbi-v3 .wbi-manualtoggle:hover{color:var(--rb-text);border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border))}
.wbi-v3 .wbi-icoTile{border-color:var(--rb-border);background:linear-gradient(145deg,var(--rb-accent-soft),var(--rb-surface));font-size:78px}
.wbi-v3 .wbi-cta{margin-top:54px;padding:40px;border:0;border-radius:26px;background:#251b3f;box-shadow:8px 8px 0 #7556e8}
.wbi-v3 .wbi-cta h3{margin:0;font-family:var(--font-display),sans-serif;font-size:clamp(25px,3vw,38px);letter-spacing:-.05em}.wbi-v3 .wbi-cta .wbi-s{color:rgba(255,255,255,.68)}
.wbi-v3 .wbi-sitepay{background:#7556e8;box-shadow:4px 4px 0 #45d6aa}.wbi-v3 .wbi-support{color:#cbbdff;border-color:rgba(203,189,255,.38)}
.wbi-v3 .wbi-note{margin-top:34px;color:var(--rb-muted);font-style:normal}
.wbi-v3 :is(a,button,[role="button"],input):focus-visible{outline:3px solid #45d6aa;outline-offset:3px}
/* ── Channel UI: узлы, которых нет в SITE-режиме (WB-гейт и BOT) ──
   Над инструкцией в этих режимах нет Navbar, поэтому верхняя панель сама
   отвечает за safe-area. Кнопки каналов сохраняют фирменные цвета TG/VK, но
   получают геометрию витрины: плоская заливка + жёсткая мятная тень. */
.wbi-root:not(.wbi-site-mode) .wbi-top{padding-top:max(26px,env(safe-area-inset-top,0px))}
.wbi-v3 .wbi-reset{padding:9px 13px;border:1px solid var(--rb-border);border-radius:11px;background:var(--rb-surface);color:var(--rb-text);font-size:13px;font-weight:750}
.wbi-v3 .wbi-reset:hover{border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border))}
.wbi-v3 .wbi-row{gap:16px;margin-top:24px}
.wbi-v3 .wbi-tg{min-height:60px;padding:0 24px;border:0;border-radius:14px;background:#229ed9;font-size:18px;font-weight:900;box-shadow:4px 4px 0 #45d6aa}
.wbi-v3 .wbi-tg:hover{transform:translateY(-2px)}.wbi-v3 .wbi-tg:active{transform:translateY(1px)}
.wbi-v3 .wbi-vkwrap{min-height:60px;padding:0 16px;border:0;border-radius:14px;background:#0a66e0;box-shadow:4px 4px 0 #45d6aa}
/* «Вернуться в ВКонтакте» длиннее телеграмной подписи: при 300 px и 18 px она
   переносилась на две строки. 330 px + 17 px дают одну строку с запасом ~35 px. */
.wbi-v3 .wbi-tg,.wbi-v3 .wbi-vkwrap{max-width:330px}
/* Второй селектор — фолбэк VKAuthButton при выключенном VK ID (там ссылка, не button). */
.wbi-v3 .wbi-vkwrap button span,.wbi-v3 .wbi-vkwrap a{font-size:17px!important;font-weight:900!important;text-transform:none!important;letter-spacing:.3px!important}
.wbi-v3 .wbi-redirect,.wbi-v3 .wbi-directcta{border-radius:14px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:rgba(255,255,255,.82);font-size:15px}
.wbi-v3 .wbi-redirect b,.wbi-v3 .wbi-directcta b{color:#fff}
.wbi-v3 .wbi-directnote{border-radius:14px;border-color:color-mix(in srgb,#45d6aa 45%,var(--rb-border));background:color-mix(in srgb,#45d6aa 10%,var(--rb-surface));color:var(--rb-text)}
.wbi-v3 .wbi-directnote b{color:var(--rb-accent)}
/* Светлая тема бьёт скин по специфичности: :is(html[data-theme="light"]) .x
   это (0,2,1) против (0,2,0) у .wbi-v3 .x. Из-за этого золотая легаси-карточка
   и светлый .wbi-cta перекрывали фирменные фиолетово-мятные акценты, а в CTA
   получался белый текст на светлом фоне. Возвращаем нужный вид на уровне (0,3,1). */
:is(html[data-theme="light"]) .wbi-v3 .wbi-must{border-color:rgba(255,255,255,.2);background:linear-gradient(145deg,#8063ed 0%,#6546d4 76%,#5b3bc9 100%);box-shadow:12px 12px 0 #45d6aa,0 26px 60px rgba(67,39,144,.17)}
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-h{color:#e2fff7}
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-it{border-top-color:rgba(255,255,255,.2)}
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-it .wbi-n{color:#123c31;border-color:#45d6aa;background:#45d6aa}
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-it span,
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-it b,
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-ft b{color:#fff}
:is(html[data-theme="light"]) .wbi-v3 .wbi-must-ft{color:rgba(255,255,255,.87);background:rgba(24,14,62,.24)}
:is(html[data-theme="light"]) .wbi-v3 .wbi-cta{background:#251b3f}
/* .wbi-warn был описан только для тёмной темы: светло-золотой текст на почти
   белом фоне не читался во всех режимах инструкции. */
:is(html[data-theme="light"]) .wbi-warn{color:#7a4a06;background:rgba(245,158,11,.12);border-color:rgba(180,110,10,.32)}
:is(html[data-theme="light"]) .wbi-warn b{color:#4d2f04}
@media(max-width:900px){
 .wbi-v3 .wbi-hero{min-height:0;grid-template-columns:1fr;grid-template-rows:auto;padding:52px 0 42px;gap:0}
 .wbi-v3 .wbi-kick,.wbi-v3 .wbi-h1,.wbi-v3 .wbi-lead,.wbi-v3 .wbi-chips,.wbi-v3 .wbi-must{grid-column:1;grid-row:auto}
 .wbi-v3 .wbi-must{max-width:620px;margin:40px 8px 10px 0;transform:rotate(.7deg)}
 .wbi-roadmap{margin-bottom:56px}
}
@media(max-width:680px){
 .wbi-v3 .wbi-wrap{padding-inline:14px;padding-bottom:78px}
 .wbi-v3 .wbi-top{padding-top:20px}.wbi-v3 .wbi-eye{font-size:10px}.wbi-v3 .wbi-tag{font-size:12px}
 .wbi-v3 .wbi-hero{padding-top:44px}.wbi-v3 .wbi-h1{font-size:clamp(42px,13vw,60px)}.wbi-v3 .wbi-lead{font-size:16px}
 .wbi-v3 .wbi-must{padding:24px 22px;box-shadow:7px 7px 0 #45d6aa}.wbi-v3 .wbi-must-it span,.wbi-v3 .wbi-must-it b{font-size:15px}
 .wbi-roadmap{grid-template-columns:1fr;gap:9px}.wbi-roadmap-card{min-height:132px}.wbi-roadmap-card small{max-width:360px}
 .wbi-v3 .wbi-dot{left:18px;top:19px;width:36px;height:36px;border-radius:11px}
 .wbi-v3 .wbi-card{padding:68px 18px 22px;border-radius:20px}.wbi-v3 .wbi-card:hover{transform:none}
 .wbi-v3 .wbi-ttl{font-size:24px}.wbi-v3 .wbi-t{font-size:16px}
 .wbi-v3 .wbi-cta{padding:30px 20px;box-shadow:6px 6px 0 #7556e8}
}
/* 480px-правила легаси-таймлайна удалены вместе с легаси-скином: .wbi-v3
   теперь на всех режимах, дот и карточка позиционируются блоком 680px. */
@media (prefers-reduced-motion: reduce){
 .wbi-blob,.wbi-g,.wbi-dot.wbi-pulse,.wbi-card.wbi-key,.wbi-figure.wbi-spot::after,.wbi-anno,.wbi-box.g,.wbi-box.g::after,.wbi-tip.g{animation:none !important}
 .wbi-reveal{opacity:1 !important;transform:none !important}
}

/* ── Проверка аккаунта перед инструкцией (GamepassCheck) ───────────────────
   Экран входа: слева карточка с ником, справа наклонный стек «что мы смотрим».
   Дальше — анимация проверки, разбор найденного и (только если надо) шаги. */
.wbi-checkhero{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(340px,.92fr);column-gap:60px;align-items:center;padding:44px 0 40px}
.wbi-checkhero>*{min-width:0}
.wbi-checkside{display:flex;flex-direction:column;gap:22px;transform:rotate(1.5deg)}
.wbi-checkside .wbi-must{grid-column:auto;grid-row:auto;margin:0;max-width:none;transform:none}
.wbi-entry{margin-top:26px;padding:26px 28px 28px;border-radius:24px;border:2px solid color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border));background:var(--rb-surface);box-shadow:8px 8px 0 var(--rb-accent)}
.wbi-entry-step{display:inline-flex;align-items:center;gap:9px;padding:7px 13px;border-radius:999px;background:var(--rb-accent);color:#fff;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
:is(html[data-theme="dark"]) .wbi-entry-step{color:#1c1330}
.wbi-entry h3{margin:14px 0 0;font-family:var(--font-display),sans-serif;font-size:clamp(23px,2.6vw,31px);line-height:1.12;letter-spacing:-.04em;color:var(--rb-text)}
.wbi-entry .wbi-say{margin:9px 0 0;font-size:17px;line-height:1.55;color:var(--rb-muted)}
.wbi-entry .wbi-say b{color:var(--rb-text)}
.wbi-bigfield{display:flex;align-items:center;gap:14px;margin-top:18px;padding:10px 12px;border-radius:18px;border:2px solid var(--rb-border);background:var(--rb-surface-2);transition:border-color .2s,box-shadow .2s}
.wbi-bigfield:focus-within{border-color:var(--rb-accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--rb-accent) 15%,transparent)}
.wbi-bigfield.idle{animation:wbi-fieldcall 3.4s ease-in-out infinite}
@keyframes wbi-fieldcall{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--rb-accent) 24%,transparent)}55%{box-shadow:0 0 0 10px color-mix(in srgb,var(--rb-accent) 0%,transparent)}}
.wbi-bigfield input{flex:1;min-width:0;border:0;background:transparent;font:inherit;color:var(--rb-text);font-size:clamp(19px,2.4vw,23px);font-weight:700;padding:14px 6px}
.wbi-bigfield input:focus{outline:none}
.wbi-bigfield input::placeholder{color:var(--rb-muted);opacity:.6;font-weight:600}
.wbi-ava{flex:0 0 auto;width:60px;height:60px;border-radius:15px;overflow:hidden;position:relative;background:var(--rb-surface);border:1px solid var(--rb-border);display:flex;align-items:center;justify-content:center;color:var(--rb-muted);font-size:24px;font-weight:800}
.wbi-ava img{width:100%;height:100%;object-fit:cover;display:block}
.wbi-ava.lg{width:78px;height:78px;border-radius:20px}
.wbi-ava.spin::after{content:"";position:absolute;inset:-3px;border-radius:inherit;background:conic-gradient(from 0deg,transparent 0 62%,#45d6aa 78%,var(--rb-accent) 100%);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 4px),#000 calc(100% - 3px));animation:wbi-avaspin 1.05s linear infinite}
@keyframes wbi-avaspin{to{transform:rotate(1turn)}}
.wbi-bigcheck{appearance:none;border:0;cursor:pointer;width:100%;margin-top:16px;min-height:66px;border-radius:16px;font:inherit;font-size:20px;font-weight:800;color:#fff;background:#7556e8;box-shadow:5px 5px 0 #45d6aa}
.wbi-bigcheck:active{transform:translateY(2px);box-shadow:3px 3px 0 #45d6aa}
.wbi-bigcheck:disabled{opacity:.7;cursor:default}
.wbi-helper{margin-top:14px;border:1px solid var(--rb-border);border-radius:14px;background:var(--rb-surface-2)}
.wbi-helper summary{padding:13px 16px;font-size:15.5px;font-weight:700;color:var(--rb-text);cursor:pointer;list-style:none}
.wbi-helper summary::-webkit-details-marker{display:none}
.wbi-helper summary::after{content:"⌄";float:right;transition:transform .18s}
.wbi-helper[open] summary::after{transform:rotate(180deg)}
.wbi-helper-in{padding:0 16px 14px;font-size:15px;line-height:1.6;color:var(--rb-muted)}
.wbi-helper-in b{color:var(--rb-text)}
.wbi-watch-ex{padding:19px 21px 21px;border:1px solid var(--rb-border);border-radius:22px;background:var(--rb-surface)}
.wbi-watch-h{margin:0 0 11px;font-size:12px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--rb-muted)}

.wbi-scan{scroll-margin-top:16px;margin:0 0 26px;padding:26px 28px;border-radius:24px;border:1px solid color-mix(in srgb,var(--rb-accent) 45%,var(--rb-border));background:var(--rb-surface);box-shadow:8px 8px 0 var(--rb-accent)}
.wbi-scan-h{display:flex;align-items:center;gap:16px}
.wbi-scan-h .t{font-family:var(--font-display),sans-serif;font-size:clamp(20px,2.3vw,26px);font-weight:700;letter-spacing:-.04em;color:var(--rb-text)}
.wbi-scan-h .s{margin-top:4px;font-size:15px;color:var(--rb-muted)}
.wbi-scanlines{display:flex;flex-direction:column;gap:9px;margin-top:20px}
.wbi-scanline{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:var(--rb-surface-2);border:1px solid var(--rb-border);font-size:16px;color:var(--rb-muted);opacity:.35;transform:translateY(4px);transition:opacity .3s ease,transform .3s ease,border-color .3s ease}
.wbi-scanline.on{opacity:1;transform:none;border-color:color-mix(in srgb,var(--rb-accent) 40%,var(--rb-border));color:var(--rb-text)}
.wbi-scanline.done{border-color:color-mix(in srgb,#45d6aa 45%,var(--rb-border))}
.wbi-scanline .m{flex:0 0 auto;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;background:var(--rb-surface);border:1px solid var(--rb-border);color:var(--rb-muted)}
.wbi-scanline.done .m{background:#45d6aa;border-color:#45d6aa;color:#08211b}
.wbi-scanline.on:not(.done) .m{color:var(--rb-accent);border-color:color-mix(in srgb,var(--rb-accent) 50%,var(--rb-border));animation:wbi-dotpulse 1s ease-in-out infinite}
@keyframes wbi-dotpulse{0%,100%{opacity:1}50%{opacity:.35}}

.wbi-res{margin:0 0 26px;border-radius:24px;border:1px solid var(--rb-border);background:var(--rb-surface);padding:28px 30px}
.wbi-res.ok{border-color:color-mix(in srgb,#45d6aa 60%,var(--rb-border));box-shadow:8px 8px 0 #45d6aa}
.wbi-res.mix{border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border));box-shadow:8px 8px 0 var(--rb-accent)}
.wbi-res.half{border-color:#d79b28;box-shadow:8px 8px 0 #d79b28}
.wbi-res.none{box-shadow:8px 8px 0 color-mix(in srgb,var(--rb-border) 90%,transparent)}
.wbi-res-k{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;background:var(--rb-surface-2);color:var(--rb-muted);border:1px solid var(--rb-border)}
.wbi-res.ok .wbi-res-k{background:color-mix(in srgb,#45d6aa 12%,var(--rb-surface));color:#128268;border-color:color-mix(in srgb,#45d6aa 45%,transparent)}
:is(html[data-theme="dark"]) .wbi-res.ok .wbi-res-k{color:#7cebc9}
.wbi-res.mix .wbi-res-k{background:var(--rb-accent-soft);color:var(--rb-accent);border-color:color-mix(in srgb,var(--rb-accent) 45%,transparent)}
.wbi-res.half .wbi-res-k{background:rgba(215,155,40,.12);color:#b06e0a;border-color:#d79b28}
:is(html[data-theme="dark"]) .wbi-res.half .wbi-res-k{color:#f0c469}
.wbi-res h3{margin:14px 0 0;font-family:var(--font-display),sans-serif;font-size:clamp(24px,2.8vw,34px);line-height:1.1;letter-spacing:-.045em;color:var(--rb-text)}
.wbi-res .wbi-said{margin:10px 0 0;color:var(--rb-muted);font-size:16px;line-height:1.6;max-width:62ch}
.wbi-res .wbi-said b{color:var(--rb-text)}
.wbi-pcard{display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:18px;background:var(--rb-surface-2);border:1px solid var(--rb-border);margin-top:20px}
.wbi-pcard .m{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.wbi-pcard .k{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#128268}
:is(html[data-theme="dark"]) .wbi-pcard .k{color:#7cebc9}
.wbi-pcard .n{font-size:21px;font-weight:800;color:var(--rb-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbi-pcard .i{font-size:14px;color:var(--rb-muted)}
.wbi-pcard .chg{flex:0 0 auto;appearance:none;cursor:pointer;font:inherit;font-size:14px;font-weight:700;color:var(--rb-muted);background:transparent;border:1px solid var(--rb-border);border-radius:11px;padding:10px 14px}
.wbi-rows{display:flex;flex-direction:column;gap:10px;margin-top:20px}
.wbi-rline{display:flex;align-items:center;gap:14px;padding:13px 15px;border-radius:15px;border:1px solid var(--rb-border);background:var(--rb-surface-2)}
.wbi-rline.dim{opacity:.62}
.wbi-rtile{flex:0 0 auto;width:56px;height:52px;border-radius:13px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--rb-accent);color:#fff;font-weight:700;font-size:14px;overflow:hidden}
.wbi-rtile img{width:100%;height:100%;object-fit:cover;display:block}
.wbi-rtile small{font-size:8px;letter-spacing:.08em;opacity:.75}
.wbi-rtile.todo{background:transparent;border:2px dashed color-mix(in srgb,var(--rb-accent) 50%,var(--rb-border));color:var(--rb-accent)}
.wbi-rmeta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.wbi-rmeta .t{font-size:16px;font-weight:700;color:var(--rb-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wbi-rmeta .s{font-size:14px;color:var(--rb-muted);line-height:1.4}
.wbi-rmeta .s b{color:var(--rb-text)}
.wbi-rnet{flex:0 0 auto;text-align:right;font-weight:700;font-size:16px;color:var(--rb-text);font-variant-numeric:tabular-nums}
.wbi-rnet small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--rb-muted)}
.wbi-rbadge{flex:0 0 auto;padding:6px 11px;border-radius:999px;font-size:12px;font-weight:800;background:color-mix(in srgb,#45d6aa 14%,var(--rb-surface));color:#128268;border:1px solid color-mix(in srgb,#45d6aa 40%,transparent)}
:is(html[data-theme="dark"]) .wbi-rbadge{color:#7cebc9}
.wbi-rbadge.warn2{background:rgba(215,155,40,.14);color:#b06e0a;border-color:#d79b28}
:is(html[data-theme="dark"]) .wbi-rbadge.warn2{color:#f0c469}
.wbi-rbadge.todo{background:var(--rb-accent-soft);color:var(--rb-accent);border-color:color-mix(in srgb,var(--rb-accent) 40%,transparent)}
.wbi-total{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-top:14px;padding:15px 16px;border-radius:15px;background:color-mix(in srgb,#45d6aa 10%,var(--rb-surface));border:1px solid color-mix(in srgb,#45d6aa 40%,var(--rb-border))}
.wbi-total .l{font-size:13px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#128268}
:is(html[data-theme="dark"]) .wbi-total .l{color:#7cebc9}
.wbi-total .r{font-size:24px;font-weight:800;color:var(--rb-text);font-variant-numeric:tabular-nums}
.wbi-total.short{background:rgba(215,155,40,.12);border-color:#d79b28}
.wbi-total.short .l{color:#b06e0a}
:is(html[data-theme="dark"]) .wbi-total.short .l{color:#f0c469}
.wbi-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;align-items:center}
.wbi-bigbtn{appearance:none;border:0;cursor:pointer;font:inherit;font-size:17px;font-weight:800;color:#fff;background:#7556e8;padding:0 28px;min-height:58px;border-radius:14px;box-shadow:4px 4px 0 #45d6aa;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
.wbi-bigbtn:disabled{opacity:.6;cursor:default}
.wbi-ghostbtn{appearance:none;cursor:pointer;font:inherit;font-size:15px;font-weight:700;color:var(--rb-muted);background:transparent;border:1px solid var(--rb-border);border-radius:12px;padding:14px 18px}
.wbi-ghostbtn:hover{color:var(--rb-text);border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border))}
.wbi-supportlink{color:var(--rb-muted);text-decoration:underline;text-underline-offset:3px}
.wbi-supportlink:hover{color:var(--rb-text)}
.wbi-sechead{scroll-margin-top:16px}
.wbi-peek{margin-top:18px;width:100%;appearance:none;cursor:pointer;font:inherit;font-size:15.5px;font-weight:700;text-align:left;padding:15px 17px;border-radius:14px;border:1px dashed var(--rb-border);background:transparent;color:var(--rb-muted)}
.wbi-peek:hover{color:var(--rb-text);border-color:color-mix(in srgb,var(--rb-accent) 55%,var(--rb-border));background:var(--rb-surface-2)}
.wbi-rescue{margin:0 0 26px;padding:26px 28px;border-radius:24px;border:2px solid #d79b28;background:rgba(215,155,40,.1);box-shadow:8px 8px 0 #d79b28}
.wbi-rescue .k{display:inline-flex;align-items:center;gap:9px;padding:6px 12px;border-radius:999px;background:#d79b28;color:#2c1d02;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.wbi-rescue h3{margin:14px 0 0;font-family:var(--font-display),sans-serif;font-size:clamp(21px,2.4vw,28px);line-height:1.15;letter-spacing:-.04em;color:var(--rb-text)}
.wbi-rescue p{margin:10px 0 0;font-size:16px;line-height:1.6;color:var(--rb-text);opacity:.88;max-width:62ch}
.wbi-rescue .wbi-srow{margin-top:18px}
.wbi-rescue .wbi-how{margin-top:14px;padding:14px 16px;border-radius:14px;background:var(--rb-surface);border:1px solid #d79b28;font-size:15px;line-height:1.6;color:var(--rb-text)}
.wbi-sechead{display:flex;align-items:center;gap:14px;margin:0 0 18px}
.wbi-sechead b{font-family:var(--font-display),sans-serif;font-size:13px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--rb-muted)}
.wbi-sechead::after{content:"";flex:1;height:1px;background:var(--rb-border)}
.wbi-goals{display:grid;gap:12px;margin:0 0 22px}
@media(min-width:720px){.wbi-goals{grid-template-columns:1fr 1fr}}
.wbi-goal{display:flex;align-items:center;gap:14px;padding:16px 18px;border-radius:18px;border:1.5px solid var(--rb-border);background:var(--rb-surface)}
.wbi-goal.have{border-color:color-mix(in srgb,#45d6aa 55%,var(--rb-border));background:color-mix(in srgb,#45d6aa 8%,var(--rb-surface))}
.wbi-goal.todo{border-style:dashed;border-color:color-mix(in srgb,var(--rb-accent) 50%,var(--rb-border))}
.wbi-goal .g-t{flex:0 0 auto;width:58px;height:54px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;font-size:15px;overflow:hidden}
.wbi-goal.have .g-t{background:#45d6aa;color:#08211b}
.wbi-goal.have .g-t img{width:100%;height:100%;object-fit:cover}
.wbi-goal.todo .g-t{border:2px dashed color-mix(in srgb,var(--rb-accent) 55%,transparent);color:var(--rb-accent)}
.wbi-goal .g-t small{font-size:8px;letter-spacing:.08em;opacity:.8}
.wbi-goal .g-m{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.wbi-goal .g-m .k{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--rb-muted)}
.wbi-goal.have .g-m .k{color:#128268}
:is(html[data-theme="dark"]) .wbi-goal.have .g-m .k{color:#7cebc9}
.wbi-goal.todo .g-m .k{color:var(--rb-accent)}
.wbi-goal .g-m .v{font-size:16px;font-weight:700;color:var(--rb-text)}
.wbi-goal .g-m .s{font-size:14px;color:var(--rb-muted)}
.wbi-recheck{margin-top:22px;padding:26px 28px;border-radius:22px;background:#251b3f;color:#fff;box-shadow:8px 8px 0 #7556e8}
.wbi-recheck h3{margin:0;font-family:var(--font-display),sans-serif;font-size:clamp(21px,2.4vw,28px);letter-spacing:-.04em;color:#fff}
.wbi-recheck p{margin:9px 0 0;color:rgba(255,255,255,.72);font-size:16px;line-height:1.55}
.wbi-recheck .row{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px;align-items:center}
.wbi-recheck .wbi-bigbtn{background:#45d6aa;color:#08211b;box-shadow:4px 4px 0 #7556e8}
.wbi-recheck .wbi-ghostbtn{color:rgba(255,255,255,.78);border-color:rgba(255,255,255,.24)}
.wbi-calc-badge{display:inline-flex;align-items:center;gap:7px;margin-bottom:10px;padding:5px 11px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.09em;background:var(--rb-accent-soft);color:var(--rb-accent);border:1px solid color-mix(in srgb,var(--rb-accent) 40%,transparent)}
.wbi-calc-b{border-color:color-mix(in srgb,#45d6aa 55%,var(--rb-border));box-shadow:6px 6px 0 #45d6aa}
.wbi-calc-b .wbi-calc-badge{background:color-mix(in srgb,#45d6aa 12%,var(--rb-surface));color:#128268;border-color:color-mix(in srgb,#45d6aa 40%,transparent)}
:is(html[data-theme="dark"]) .wbi-calc-b .wbi-calc-badge{color:#7cebc9}
.wbi-mini{display:grid;gap:10px;margin-top:14px}
@media(min-width:720px){.wbi-mini{grid-template-columns:repeat(4,1fr)}}
.wbi-mini-i{padding:14px;border:1px solid var(--rb-border);border-radius:14px;background:var(--rb-surface-2)}
.wbi-mini-i .k{font-size:11px;font-weight:800;letter-spacing:.1em;color:#128268;text-transform:uppercase}
:is(html[data-theme="dark"]) .wbi-mini-i .k{color:#7cebc9}
.wbi-mini-i .v{margin-top:6px;font-size:15px;line-height:1.45;color:var(--rb-muted)}
.wbi-mini-i .v b{color:var(--rb-text)}
.wbi-thumbrow{display:grid;gap:12px;margin-top:16px}
@media(min-width:720px){.wbi-thumbrow{grid-template-columns:1fr 1fr}}
.wbi-v3 .wbi-nomrow{margin:0 auto;max-width:390px;text-align:center}
@media(max-width:900px){
 .wbi-checkhero{grid-template-columns:1fr;padding:34px 0 24px}
 .wbi-checkside{margin-top:34px;transform:rotate(.7deg)}
}
@media(max-width:680px){
 .wbi-checkside{transform:none;gap:18px}
 .wbi-entry{margin-top:22px;padding:21px 19px 23px;border-radius:20px;box-shadow:6px 6px 0 var(--rb-accent)}
 .wbi-bigcheck{min-height:62px;font-size:18px}
 .wbi-ava{width:52px;height:52px;border-radius:13px}
 .wbi-scan,.wbi-rescue,.wbi-res{padding:20px 18px;border-radius:20px}
 .wbi-scan{min-height:calc(100dvh - 150px);display:flex;flex-direction:column;justify-content:center}
 .wbi-ava.lg{width:60px;height:60px;border-radius:16px}
 .wbi-pcard{padding:14px;gap:12px;flex-wrap:wrap}
 .wbi-pcard .chg{width:100%}
 .wbi-rline{flex-wrap:wrap;row-gap:10px;padding:12px 13px}
 .wbi-rmeta{flex:1 1 calc(100% - 72px)}
 .wbi-rmeta .t{white-space:normal}
 .wbi-rnet{order:5;display:flex;align-items:baseline;gap:6px;text-align:left;font-size:15px}
 .wbi-rnet small{display:inline;font-size:10px}
 .wbi-rbadge{order:6;margin-left:auto}
 .wbi-recheck{padding:22px 18px}
}
@media (prefers-reduced-motion: reduce){
 .wbi-bigfield.idle,.wbi-ava.spin::after,.wbi-scanline.on:not(.done) .m{animation:none !important}
}
`;
