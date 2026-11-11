"use client";

import { useState, useRef, useEffect, useCallback } from "react";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ArrowRight,
  Ticket,
  Lock,
  ShoppingBag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import VKAuthButton from "@/components/auth/VKAuthButton";
import WBInstructionV2 from "./WBInstructionV2";
import type { GuidePlatform } from "@/lib/device-platform";
import GamepassCheck from "./GamepassCheck";
// Visual components imported directly. None of them tug in heavy deps now
// (three.js was dropped in favour of CSS gradients), so dynamic chunk
// splitting just adds round-trips and deploy fragility for zero kB win.
import { ConnectivityAssistant } from "@/components/connectivity-assistant";
import { ThemeToggle } from "@/components/theme-toggle";
import { getOrInitSessionId, loadWBSession, saveWBSession, clearWBSession } from "@/lib/wb-session";
import { tgBotHref, vkBotHref } from "@/lib/bot-links";

// ─── Step definitions ──────────────────────────────────────────────────────────




// ─── Roblox Creator Hub realistic animations ──────────────────────────────────




// ── Anim 01: Open Creator Hub ──────────────────────────────────────────────────

// ── Anim 02: Select game from My Creations ─────────────────────────────────────

// ── Anim 03: Create a Game Pass ────────────────────────────────────────────────

// ── AnimPublicBadge: Creations grid — highlights the "Public" badge ────────────

// ── PublicGameBlock: collapsible "игра должна быть Public" ────────────────────

// ── Anim 04: Set price — accurate Roblox Creator Hub dark UI ──────────────────

// ── Anim 05 Standard: Find gamepass on RobloxBank site ─────────────────────────

// ── Anim 06 Standard: Pay order ────────────────────────────────────────────────


// ── Anim 05 WB: Copy Asset ID via three-dot menu ───────────────────────────────

// ── Platform Switcher ──────────────────────────────────────────────────────────


// ─── Steps Grid ───────────────────────────────────────────────────────────────


// ─── WB Manager done block ─────────────────────────────────────────────────────


// ─── WB-only static header ─────────────────────────────────────────────────────

function WBStaticHeader({ denomination, onReset }: { denomination?: number; onReset?: () => void }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--rb-border)] bg-[var(--rb-nav)] text-[var(--rb-text)] backdrop-blur-xl select-none">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="absolute inset-0 bg-[#7556e8] rounded-[11px] border-2 border-[var(--rb-text)] shadow-[3px_3px_0_#45d6aa]" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white font-black text-[11px] tracking-wider relative z-10">WB</span>
            </div>
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--rb-text)]">Wildberries</span>
            <span className="text-xs font-black uppercase tracking-[0.16em] text-[var(--rb-accent)]">× RobloxBank</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {denomination && denomination > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] px-3 py-1.5">
              <span className="font-pixel text-[10px] text-[var(--rb-muted)] tracking-widest hidden sm:block">НОМИНАЛ</span>
              <span className="font-black text-lg leading-none text-[var(--rb-accent)]">{denomination} R$</span>
            </div>
          )}
          {onReset && (
            <button onClick={onReset} className="flex h-9 items-center gap-1.5 rounded-xl border border-[var(--rb-border)] px-3 text-[var(--rb-muted)] transition-all hover:border-[var(--rb-accent)] hover:text-[var(--rb-accent)] font-black text-xs uppercase tracking-wider">
              <ArrowRight className="w-3 h-3 rotate-180" /><span className="hidden sm:inline">Новый код</span>
            </button>
          )}
          <ThemeToggle compact />
        </div>
      </div>
      <div className="h-[2px] bg-gradient-to-r from-transparent via-[#7556e8]/45 to-transparent" />
    </header>
  );
}

// ─── WB Gate Screen ────────────────────────────────────────────────────────────

// Scoped styles for the gate — mirrors the WB instruction's design language
// (soft -apple-system type, rounded gradient cards, circular gold step badges,
// chunky 3D channel buttons) so the entry screen feels like one product with it.
const WBG_CSS = `
.wbg-root{--gold:#7556e8;--gold2:#a68bff;--grn:#45d6aa;--line:var(--rb-border);--mut:var(--rb-muted);color:var(--rb-text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.wbg-root *{box-sizing:border-box}
.wbg-stage{width:min(1120px,100%);display:grid;grid-template-columns:minmax(0,.92fr) minmax(390px,.78fr);gap:70px;align-items:center}
.wbg-card-column{min-width:0;width:100%}
.wbg-welcome{position:relative;padding:20px 0}
.wbg-badge{width:max-content;display:flex;align-items:center;gap:9px;padding:9px 13px;border:1px solid var(--line);border-radius:999px;background:var(--rb-surface);color:var(--gold2);font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
.wbg-welcome h1{margin:24px 0 19px;font-family:var(--font-display),sans-serif;font-size:clamp(46px,6vw,76px);line-height:.98;letter-spacing:-.065em}
.wbg-welcome h1 span{background:linear-gradient(90deg,#7556e8,#5e83ee);background-clip:text;color:transparent}
.wbg-welcome>p{max-width:560px;margin:0;color:var(--mut);font-size:18px;line-height:1.65}
.wbg-flow{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:28px}
.wbg-flow div{padding:14px;border:1px solid var(--line);border-radius:15px;background:var(--rb-surface)}
.wbg-flow b,.wbg-flow span{display:block}.wbg-flow b{color:var(--grn);font-size:13px}.wbg-flow span{margin-top:4px;color:var(--mut);font-size:12px;line-height:1.35}
.wbg-card{position:relative;min-width:0;width:100%;border:1px solid var(--line);background:var(--rb-surface);border-radius:26px;padding:26px 22px;box-shadow:10px 10px 0 var(--rb-strong),0 28px 70px rgba(15,8,30,.2)}
@media(min-width:640px){.wbg-card{padding:34px 30px}}
.wbg-icon{width:62px;height:62px;border-radius:18px;border:1px solid color-mix(in srgb,var(--gold) 46%,transparent);background:color-mix(in srgb,var(--gold) 12%,transparent);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
.wbg-eye{font-size:11px;letter-spacing:2.5px;color:var(--gold);font-weight:700;text-transform:uppercase}
.wbg-h1{font-size:clamp(27px,6vw,34px);font-weight:900;color:var(--rb-text);line-height:1.05;letter-spacing:-.01em;margin:8px 0 0}
.wbg-lead{color:var(--mut);font-size:15.5px;line-height:1.6;margin:10px auto 0;max-width:330px}
.wbg-hr{height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.32),transparent)}
.wbg-step-h{display:flex;align-items:center;gap:11px;margin-bottom:12px}
.wbg-dot{flex-shrink:0;width:32px;height:32px;border-radius:10px;background:var(--rb-accent-soft);border:1px solid color-mix(in srgb,var(--gold) 55%,transparent);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--gold2);font-size:15px;transition:all .25s}
.wbg-dot.done{background:rgba(0,212,132,.12);border-color:rgba(0,212,132,.6);color:var(--grn)}
.wbg-ttl{font-size:17.5px;font-weight:800;color:var(--rb-text);line-height:1.2}
.wbg-t{color:var(--mut);font-size:14.5px;line-height:1.55;margin:0 0 14px}
.wbg-code-focus{position:relative;margin-top:8px;padding:9px;border-radius:20px;background:color-mix(in srgb,var(--gold) 7%,transparent);isolation:isolate}
.wbg-code-focus::before,.wbg-code-focus::after{content:"";position:absolute;inset:0;border:2px solid color-mix(in srgb,var(--gold) 66%,transparent);border-radius:20px;z-index:-1;animation:wbg-code-radar 2.1s ease-out infinite}
.wbg-code-focus::after{animation-delay:1.05s}
.wbg-code-callout{position:absolute;right:10px;top:-29px;display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;background:var(--gold);color:#fff;font-size:12px;font-weight:950;letter-spacing:.05em;text-transform:uppercase;box-shadow:3px 3px 0 var(--grn);animation:wbg-code-bounce 1.25s ease-in-out infinite}
.wbg-code-callout::after{content:"";width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg) translateY(-1px)}
.wbg-input{width:100%;background:var(--rb-bg);border:1.5px solid color-mix(in srgb,var(--gold) 56%,transparent);color:var(--rb-text);border-radius:14px;padding:16px;font-size:25px;font-weight:800;text-align:center;letter-spacing:.3em;text-indent:.3em;outline:none;transition:border-color .2s,box-shadow .2s}
.wbg-input::placeholder{color:#46506b;font-weight:700}
.wbg-input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.16)}
.wbg-input.ready{border-color:rgba(0,212,132,.6);box-shadow:0 0 0 3px rgba(0,212,132,.14)}
.wbg-meta{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:9px;font-size:12.5px;color:var(--mut)}
.wbg-count{font-weight:800;font-variant-numeric:tabular-nums;color:var(--mut)}
.wbg-count.ready{color:var(--grn)}
.wbg-step2{transition:opacity .3s}
.wbg-step2.locked{opacity:.45}
.wbg-btns{display:flex;flex-direction:column;gap:16px;margin-top:18px}
.wbg-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;border-radius:14px;padding:18px 15px;font-size:16px;font-weight:800;color:#fff;border:none;cursor:pointer;transition:transform .12s,box-shadow .12s,filter .2s}
.wbg-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none!important;transform:none!important;filter:grayscale(.35)}
.wbg-btn:not(:disabled):hover{filter:brightness(1.06)}
.wbg-btn:not(:disabled):active{transform:translateY(3px)}
.wbg-btn.tg{background:linear-gradient(180deg,#2aa8e0,#1f8fc6);box-shadow:0 5px 0 #14638c,0 12px 24px rgba(34,158,217,.3)}
.wbg-btn.tg:not(:disabled):active{box-shadow:0 2px 0 #14638c}
.wbg-btn.vk{background:linear-gradient(180deg,#4a90ff,#0a66e0);box-shadow:0 5px 0 #0a4aa0,0 12px 24px rgba(10,102,224,.3)}
.wbg-btn.vk:not(:disabled):active{box-shadow:0 2px 0 #0a4aa0}
.wbg-spin{width:16px;height:16px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:wbg-spin .7s linear infinite}
@keyframes wbg-spin{to{transform:rotate(360deg)}}
@keyframes wbg-code-radar{0%{opacity:.75;transform:scale(.98)}70%,100%{opacity:0;transform:scale(1.09)}}
@keyframes wbg-code-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
.wbg-err{border:1px solid rgba(239,68,68,.35);background:rgba(239,68,68,.07);border-radius:12px;padding:11px 13px;display:flex;align-items:center;gap:9px}
.wbg-err p{color:#fca5a5;font-size:14px;font-weight:600;margin:0}
.wbg-errhelp{font-size:12px;color:#8a91a3;margin:6px 0 0}
.wbg-errhelp a{color:var(--grn);text-decoration:underline}
.wbg-foot{text-align:center;font-size:12.5px;color:#71798c;margin-top:16px}
.wbg-vkauth{display:flex;flex-direction:column;gap:8px}
.wbg-vkauth p{font-size:13px;color:#7fb0ff;font-weight:700;text-align:center;margin:0}
.wbg-vkstall{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:12px 14px;border:1px solid rgba(127,176,255,.35);border-radius:12px;background:rgba(127,176,255,.08);text-align:center}
.wbg-vkstall b{font-size:14px;color:#e9e4ff}
.wbg-vkstall span{font-size:13px;color:#b8b0c5;line-height:1.5}
.wbg-vkstall a{margin-top:4px;font-size:15px;font-weight:800;color:#7fb0ff;text-decoration:none}
.wbg-vkwrap{border:1px solid rgba(10,102,224,.5);background:rgba(10,102,224,.1);border-radius:14px;padding:12px;display:flex;align-items:center;justify-content:center;min-height:62px}
.wbg-trust{display:flex;flex-wrap:wrap;justify-content:center;gap:7px 18px;margin-top:18px}
.wbg-trust span{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--mut);font-weight:600}
.wbg-help{margin-top:14px;display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:14px;background:rgba(10,13,24,.55);padding:13px 15px;text-decoration:none;transition:border-color .2s,background .2s}
.wbg-help:hover{border-color:rgba(201,168,76,.4);background:rgba(201,168,76,.05)}
.wbg-help-t{display:flex;flex-direction:column;line-height:1.25}
.wbg-help-t b{font-size:13.5px;color:var(--rb-text);font-weight:800}
.wbg-help-t span{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;font-weight:700}
@media(max-width:900px){.wbg-stage{grid-template-columns:1fr;gap:32px;max-width:620px}.wbg-welcome{text-align:center}.wbg-badge{margin-inline:auto}.wbg-welcome>p{margin-inline:auto}.wbg-prefilled .wbg-welcome h1,.wbg-prefilled .wbg-welcome .wbg-flow{display:none}.wbg-prefilled .wbg-welcome{padding:0}.wbg-stage.wbg-prefilled{gap:20px}}
@media(max-width:520px){.wbg-welcome h1{font-size:42px}.wbg-welcome>p{font-size:18px}.wbg-flow{grid-template-columns:1fr}.wbg-flow div{display:flex;align-items:center;gap:8px}.wbg-flow span{margin-top:0}.wbg-card{box-shadow:6px 6px 0 var(--rb-strong)}.wbg-code-callout{right:6px;font-size:11px}.wbg-input{font-size:27px;min-height:68px}}
@media(prefers-reduced-motion:reduce){.wbg-code-focus::before,.wbg-code-focus::after,.wbg-code-callout{animation:none}}
`;

/** Одно место, где «текущий код» записывается на клиенте.
 *
 * Их два — localStorage-сессия (восстановление страницы) и cookie `wb_code`
 * (её читает VKAuthButton, чтобы понять, к какому заказу привязывать вход). У
 * покупателя нескольких карточек они обязаны переезжать вместе: разъехавшись,
 * они открывают один заказ и привязывают другой. */
function persistWbCodeSession(denomination: number, code: string): void {
  saveWBSession(denomination, code);
  document.cookie = `wb_code=${code}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax; Secure`;
}

/** Экран кода и мессенджера.
 *
 * Это же и есть экран контакта: единственные пути дальше — Telegram и
 * ВКонтакте, кнопки «продолжить без привязки» здесь нет и не должно быть
 * (решение владельца О4). Мессенджер и так обязателен, чтобы довести заказ до
 * конца — шаги 05–06 инструкции требуют прислать ссылку на геймпасс в бота, —
 * так что экран не добавляет требование, а переносит его в начало пути, где от
 * него есть польза: если покупатель застрянет, нам будет куда написать.
 *
 * `initialCode` приходит из ссылки в чате WB — покупатель его не вводил, и
 * просить «введи код сюда» было бы враньём. */
function WBGate({ initialCode = "", initialDenomination = 0 }: { initialCode?: string; initialDenomination?: number } = {}) {
  const [code, setCode] = useState(initialCode);
  /** Код подставлен ссылкой: шаг 1 уже пройден, и весь экран — про контакт. */
  const prefilled = Boolean(initialCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickTarget, setQuickTarget] = useState<"tg" | "vk" | null>(null);
  const [showVkAuth, setShowVkAuth] = useState(false);
  const [vkAuthCode, setVkAuthCode] = useState("");
  /** VK ID открыт, но заказ так и не поехал — показываем прямой путь в диалог. */
  const [vkStalled, setVkStalled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Сорок секунд — заведомо больше, чем нужно на живой вход через VK ID, и
  // заведомо меньше, чем терпение человека на экране, где ничего не происходит.
  useEffect(() => {
    if (!showVkAuth) { setVkStalled(false); return; }
    const timer = setTimeout(() => setVkStalled(true), 40_000);
    return () => clearTimeout(timer);
  }, [showVkAuth]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
    setCode(raw);
    setError(null);
  };

  // Validate code on the server (shared by both modes).
  // On success returns the denomination — and persists the WB session so the
  // quick redirects below see a valid wb_code cookie / localStorage entry.
  const validateAndPersist = async (): Promise<number> => {
    const res = await fetch("/api/wb-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, sessionId: getOrInitSessionId() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "Ошибка отправки");
    const denomination: number = data.denomination ?? 0;
    persistWbCodeSession(denomination, code);
    return denomination;
  };

  // Quick TG/VK redirect — guide=true sends wbg_ prefix so bot sends instruction welcome.
  const handleQuickRedirect = async (target: "tg" | "vk", guide = false) => {
    if (code.length < 7) {
      setError("Сначала введите 7-значный код с карточки");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setQuickTarget(target);
    setError(null);
    try {
      await validateAndPersist();
      if (target === "tg") {
        const prefix = guide ? "wbg" : "wb";
        window.location.href = `https://t.me/RobloxBankBot?start=${prefix}_${code}_${getOrInitSessionId()}`;
        return;
      }
      // VK path: guide mode passes GD-prefixed code so bot sends instruction welcome.
      setVkAuthCode(guide ? `GD${code}` : code);
      setShowVkAuth(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(msg);
      setShowVkAuth(false);
    } finally {
      setLoading(false);
      setQuickTarget(null);
    }
  };

  const codeReady = code.length === 7;

  return (
    <main className="min-h-screen flex flex-col relative">
      <WBStaticHeader />

      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-16 bg-[var(--rb-bg)] relative overflow-hidden">
        <div className="pointer-events-none absolute -left-48 top-0 h-[560px] w-[560px] rounded-full bg-[#45d6aa]/10 blur-[100px]" />
        <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-[#7556e8]/15 blur-[100px]" />
        <div className={`wbg-root wbg-stage animate-in fade-in zoom-in${prefilled ? " wbg-prefilled" : ""}`}>
          <style>{WBG_CSS}</style>
          <section className="wbg-welcome animate-in fade-in animate-delay-100">
            <div className="wbg-badge"><ShoppingBag className="w-4 h-4" /> {prefilled ? "Заказ найден — код подставлен" : "Покупка на Wildberries подтверждена"}</div>
            <h1>Спасибо<br />за покупку.<br /><span>Robux уже близко.</span></h1>
            <p>{prefilled
              ? "Остался один шаг — выбери мессенджер. Бот привяжет заказ, откроет инструкцию и будет присылать статус. Без этого мы не сможем связаться с тобой, если что-то пойдёт не так."
              : "Активируй код с карточки и выбери удобный мессенджер. Бот сохранит заказ, покажет инструкцию и сообщит, когда всё готово."}</p>
            <div className="wbg-flow" aria-label="Что будет дальше">
              <div><b>01 · Код</b><span>{prefilled ? "уже подставлен" : "7 символов с карточки"}</span></div>
              <div><b>02 · Бот</b><span>Telegram или VK</span></div>
              <div><b>03 · Robux</b><span>Статус всегда под рукой</span></div>
            </div>
          </section>

          <div className="wbg-card-column">
          <div className="wbg-card animate-in fade-in zoom-in animate-delay-200">
            {/* Header */}
            <div style={{ textAlign: "center" }}>
              <div className="wbg-icon">
                <Ticket className="w-7 h-7" style={{ color: "#f0c040" }} />
              </div>
              <div className="wbg-eye">Wildberries × RobloxBank</div>
              <h1 className="wbg-h1">{prefilled ? "Куда прислать заказ?" : "Спасибо за\u00a0покупку!"}</h1>
              <p className="wbg-lead">{prefilled
                ? `Выбери мессенджер — там откроется инструкция${initialDenomination ? ` и твои ${initialDenomination.toLocaleString("ru-RU")} R$` : ""}. Займёт пару минут.`
                : "Два шага — и робуксы у тебя. Это займёт пару минут."}</p>
            </div>

            <div className="wbg-hr" style={{ margin: "22px 0" }} />

            <form onSubmit={(e) => e.preventDefault()}>
              {/* ── Step 1 — code ─────────────────────────────────── */}
              <div className="wbg-step-h">
                <span className={`wbg-dot${codeReady ? " done" : ""}`} aria-hidden>{codeReady ? "✓" : "1"}</span>
                <span className="wbg-ttl">{prefilled ? "Твой код заказа" : "Код с карточки"}</span>
              </div>
              <div className="wbg-code-focus">
                {!codeReady && <span className="wbg-code-callout">Введи код сюда</span>}
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="text"
                  value={code}
                  onChange={handleInput}
                  placeholder="ABC1234"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoFocus={!prefilled}
                  spellCheck={false}
                  className={`wbg-input${codeReady ? " ready" : ""}`}
                  aria-label="Уникальный код с карточки"
                />
              </div>
              <div className="wbg-meta">
                <span>
                  {prefilled
                    ? <>Код из чата Wildberries — вводить ничего не нужно. <b>Сохраните его:</b> если напишете нам, назовите код — так мы сразу найдём заказ.</>
                    : "7 символов с обратной стороны карточки"}
                </span>
                <span className={`wbg-count${codeReady ? " ready" : ""}`}>{code.length}/7</span>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    key="error-block"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    style={{ marginTop: 14 }}
                  >
                    <div className="wbg-err">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#f87171" }} />
                      <p>{error}</p>
                    </div>
                    <p className="wbg-errhelp">
                      Нужна помощь?{" "}
                      <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">
                        Написать живому менеджеру →
                      </a>
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Step 2 — channel ──────────────────────────────── */}
              <div className={`wbg-step2${codeReady ? "" : " locked"}`} style={{ marginTop: 26 }}>
                <div className="wbg-step-h">
                  <span className="wbg-dot" aria-hidden>2</span>
                  <span className="wbg-ttl">{prefilled ? "Куда присылать статус заказа" : "Твой бот для заказов и робуксов"}</span>
                </div>
                <p className="wbg-t">
                  Выбери мессенджер — бот проведёт по шагам, примет геймпасс и будет присылать статус. В следующий раз можно заказать прямо в нём — быстрее и без карты WB.
                </p>
                <ConnectivityAssistant />

                <div className="wbg-btns">
                  <button
                    type="button"
                    onClick={() => handleQuickRedirect("tg", true)}
                    disabled={loading || !codeReady}
                    className="wbg-btn tg"
                  >
                    {loading && quickTarget === "tg" ? (
                      <><span className="wbg-spin" />Открываем Telegram…</>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z"/>
                        </svg>
                        Получить в Telegram
                      </>
                    )}
                  </button>

                  {!showVkAuth ? (
                    <button
                      type="button"
                      onClick={() => handleQuickRedirect("vk", true)}
                      disabled={loading || !codeReady}
                      className="wbg-btn vk"
                    >
                      {loading && quickTarget === "vk" ? (
                        <><span className="wbg-spin" />Открываем VK…</>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 flex-shrink-0">
                            <path d="M12.785 16.241s.288-.032.435-.194c.135-.149.13-.43.13-.43s-.019-1.306.572-1.497c.582-.188 1.331 1.252 2.124 1.806.6.42 1.056.328 1.056.328l2.122-.03s1.111-.07.585-.957c-.043-.073-.306-.658-1.578-1.853-1.331-1.252-1.153-1.049.451-3.224.977-1.323 1.367-2.13 1.245-2.474-.116-.328-.834-.241-.834-.241l-2.387.015s-.177-.024-.308.056c-.128.078-.21.262-.21.262s-.378 1.022-.882 1.892c-1.062 1.834-1.487 1.931-1.661 1.816-.405-.267-.304-1.069-.304-1.638 0-1.778.267-2.519-.51-2.711-.258-.064-.448-.106-1.108-.113-.847-.009-1.564.003-1.97.207-.27.136-.479.439-.351.456.157.022.514.099.703.363.244.341.236 1.108.236 1.108s.14 2.083-.328 2.342c-.32.178-.76-.185-1.706-1.85-.484-.853-.85-1.795-.85-1.795s-.07-.176-.196-.27c-.152-.114-.365-.15-.365-.15l-2.268.015s-.34.01-.466.16c-.111.135-.009.412-.009.412s1.776 4.221 3.787 6.349c1.844 1.95 3.938 1.822 3.938 1.822h.949z"/>
                          </svg>
                          Получить в ВКонтакте
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="wbg-vkauth">
                      <p>Авторизуйся через VK ID — и мы откроем твой заказ</p>
                      <div className="wbg-vkwrap">
                        <VKAuthButton mode="order" wbCode={vkAuthCode} />
                      </div>
                      {/* Страховка на случай, когда окно VK ID не вернулось.
                          Покупателю, который уже заплатил на Wildberries, нельзя
                          оставаться на экране, где «ничего не происходит», —
                          21.08 такой человек ушёл бродить по сайту и упёрся в
                          оплату. Прямой диалог сообщества с `?ref=` доводит
                          заказ и без VK ID: привязка случится на первом
                          сообщении боту, как в Telegram. */}
                      {vkStalled && (
                        <div className="wbg-vkstall">
                          <b>Окно ВКонтакте не вернулось?</b>
                          <span>Ничего не потерялось — открой диалог, заказ продолжится там.</span>
                          <a
                            // `vkAuthCode` как есть, с префиксом GD: ровно то же
                            // значение, что подставляет VKAuthButton в штатном
                            // пути. Префикс снимают и бот, и `src/auth.ts`.
                            href={vkBotHref(vkAuthCode)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Открыть диалог ВКонтакте →
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </form>

            <div className="wbg-hr" style={{ margin: "22px 0 0" }} />
            <p className="wbg-foot">Код одноразовый · хранить не нужно</p>
          </div>

          {/* Trust badges */}
          <div className="wbg-trust animate-in fade-in animate-delay-300">
            {[
              { label: "Защита данных",  icon: Lock },
              { label: "Проверка заказа", icon: CheckCircle2 },
              { label: "Живой менеджер",  icon: ShoppingBag },
            ].map(({ label, icon: Icon }) => (
              <span key={label}><Icon className="w-3.5 h-3.5" />{label}</span>
            ))}
          </div>

          {/* Direct manager contact — fallback if anything goes wrong */}
          <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer" className="wbg-help">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#aab1c0" }} />
            <span className="wbg-help-t">
              <span>Нет ни Telegram, ни ВКонтакте? Напиши нам — оформим вручную</span>
              <b>Живой менеджер → @RobloxBank_PA или прямо в чат Wildberries по заказу</b>
            </span>
            <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ marginLeft: "auto", color: "#71798c" }} />
          </a>
          </div>
        </div>
      </div>
    </main>
  );
}


/** Шаг «нажми «Начать» в чате ВКонтакте» (11.10.2026).
 *
 * Вход через VK ID забирает код, но не открывает диалог с сообществом: пока
 * человек сам не написал боту, VK не даёт нам ему ответить (ошибка 901). Так
 * за месяц 37 покупателей DBS остались без статуса и «заказ выполнен» — им
 * писали уже только в чат WB. Экран не пускает к инструкции, пока VK не
 * подтвердит разрешение: опрос `needsVkMessages` ниже снимает его сам, как
 * только человек нажмёт «Начать». Выход без VK — Telegram или менеджер. */
function WBVkMessagesStep({ code, denomination }: { code: string; denomination: number }) {
  return (
    <main className="min-h-screen flex flex-col relative">
      <WBStaticHeader />
      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-16 bg-[var(--rb-bg)] relative overflow-hidden">
        <div className="pointer-events-none absolute -left-48 top-0 h-[560px] w-[560px] rounded-full bg-[#45d6aa]/10 blur-[100px]" />
        <div className="pointer-events-none absolute -right-40 bottom-0 h-[520px] w-[520px] rounded-full bg-[#7556e8]/15 blur-[100px]" />
        <div className="wbg-root wbg-stage wbg-prefilled animate-in fade-in zoom-in">
          <style>{WBG_CSS}</style>
          <section className="wbg-welcome animate-in fade-in animate-delay-100">
            <div className="wbg-badge"><CheckCircle2 className="w-4 h-4" /> Вход через ВКонтакте выполнен</div>
            <h1>Последний<br />шаг.<br /><span>Напиши боту.</span></h1>
            <p>ВКонтакте не даёт сообществу писать тому, кто ещё ни разу не писал ему сам. Без этого шага мы не сможем прислать статус заказа и сообщить, когда робуксы придут.</p>
          </section>
          <div className="wbg-card-column">
            <div className="wbg-card animate-in fade-in zoom-in animate-delay-200">
              <div style={{ textAlign: "center" }}>
                <div className="wbg-icon"><Ticket className="w-7 h-7" style={{ color: "#f0c040" }} /></div>
                <div className="wbg-eye">Заказ {code}{denomination ? ` · ${denomination.toLocaleString("ru-RU")} R$` : ""}</div>
                <h1 className="wbg-h1">Нажми «Начать» в чате</h1>
                <p className="wbg-lead">Откроется диалог с нашим сообществом — нажми «Начать» или отправь любое сообщение. Эта страница сама откроет инструкцию, как только ВКонтакте это подтвердит.</p>
              </div>
              <div className="wbg-hr" style={{ margin: "22px 0" }} />
              <div className="wbg-btns">
                <a href={vkBotHref(code)} target="_blank" rel="noopener noreferrer" className="wbg-btn vk">
                  Открыть чат ВКонтакте →
                </a>
                <a href={tgBotHref(code, getOrInitSessionId())} target="_blank" rel="noopener noreferrer" className="wbg-btn tg">
                  Лучше в Telegram
                </a>
              </div>
              <p className="wbg-foot" role="status" aria-live="polite" style={{ fontSize: 14 }}>
                <span className="wbg-spin" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 8 }} />
                Ждём сообщение в чате…
              </p>
            </div>
            <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer" className="wbg-help">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#aab1c0" }} />
              <span className="wbg-help-t">
                <span>Не получается? Напиши нам — доведём заказ вручную</span>
                <b>Живой менеджер → @RobloxBank_PA или прямо в чат Wildberries по заказу</b>
              </span>
              <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ marginLeft: "auto", color: "#71798c" }} />
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Interactive Formula Calculator ──────────────────────────────────────────


// ─── Instruction page ──────────────────────────────────────────────────────────


// ─── WB full-screen intro splash ───────────────────────────────────────────────

function WBIntro({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);

  const handleDone = useCallback(() => {
    if (fading) return;
    setFading(true);
    setTimeout(onDone, 750);
  }, [fading, onDone]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(handleDone, 6500);
    return () => window.clearTimeout(timer);
  }, [handleDone]);

  return (
    <div
      className="wb-intro fixed inset-0 z-[9999] flex flex-col overflow-hidden"
      style={{
        transition: "opacity 0.75s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <div className="wb-intro-orbit wb-intro-orbit-one" aria-hidden="true" />
      <div className="wb-intro-orbit wb-intro-orbit-two" aria-hidden="true" />
      <div className="flex flex-1 items-center justify-center px-5 py-12 relative z-10">
        <motion.div initial={{ opacity: 0, y: 28, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .8, ease: [0.16,1,0.3,1] }} className="w-full max-w-[920px] text-center">
          <div className="mx-auto mb-8 grid h-20 w-20 -rotate-6 place-items-center rounded-[24px] border-[3px] border-[var(--rb-text)] bg-[#7556e8] text-xl font-black text-white shadow-[7px_7px_0_#45d6aa]">R$</div>
          <div className="mb-5 text-xs font-black uppercase tracking-[.22em] text-[var(--rb-accent)]">Wildberries × RobloxBank</div>
          <h1 className="font-[var(--font-display)] text-[clamp(48px,9vw,104px)] font-bold leading-[.94] tracking-[-.075em] text-[var(--rb-text)]">Спасибо<br />за покупку!</h1>
          <p className="mx-auto mt-7 max-w-[620px] text-[clamp(16px,2.2vw,20px)] font-medium leading-relaxed text-[var(--rb-muted)]">Сейчас активируем код, откроем понятную инструкцию и доведём заказ до готовых Robux.</p>
          <button onClick={handleDone} className="mt-9 inline-flex min-h-14 items-center gap-3 rounded-2xl bg-[#7556e8] px-7 text-sm font-black text-white shadow-[5px_5px_0_#45d6aa] transition-transform hover:-translate-y-1">
            Активировать код <ArrowRight className="h-5 w-5" />
          </button>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-bold text-[var(--rb-muted)]"><Lock className="h-4 w-4" /> Пароль Roblox не понадобится</div>
        </motion.div>
      </div>

      <div className="relative z-10 flex items-center justify-between border-t border-[var(--rb-border)] px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#45d6aa] animate-pulse" />
          <span className="font-pixel text-[10px] text-[var(--rb-muted)] tracking-widest">
            БЕЗОПАСНАЯ АКТИВАЦИЯ
          </span>
        </div>
        <button
          onClick={handleDone}
          className="font-pixel text-[10px] text-[var(--rb-muted)] hover:text-[var(--rb-accent)] tracking-widest uppercase transition-colors"
        >
          Пропустить →
        </button>
      </div>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export default function GuideClient({
  isWB,
  guideMode = "SITE",
  skipGate = false,
  wbCodeFromUrl,
  testMode = false,
  previewMode = false,
  testNom,
  initialAmount = 1000,
  sitePayAmount,
  siteUseBonus = true,
  initialUsername = "",
  orderFlow = false,
  initialPlatform = "mobile",
  keyAutoEnabled = false,
  initialStage,
}: {
  isWB: boolean;
  guideMode?: "WB" | "SITE" | "BOT";
  skipGate?: boolean;
  wbCodeFromUrl?: string;
  testMode?: boolean;
  previewMode?: boolean;
  testNom?: number;
  initialAmount?: number;
  /** Оплачиваемая часть заказа сайта, когда `initialAmount` уже включает бонус. */
  sitePayAmount?: number;
  /** Покупатель на кассе отказался от бонуса (`bonus=0`) — вернуть это в кассу. */
  siteUseBonus?: boolean;
  initialUsername?: string;
  /** Человек пришёл с заказом (оформляет покупку), а не просто читает инструкцию. */
  orderFlow?: boolean;
  /** «Телефон или компьютер» по User-Agent — влияет только на кадры инструкции. */
  initialPlatform?: GuidePlatform;
  /** Метод «пасс по ключу» включён (флаг GAMEPASS_AUTOCREATE, читается на сервере). */
  keyAutoEnabled?: boolean;
  /** `?stage=key` — открыть ветку ключа сразу после проверки аккаунта. */
  initialStage?: "key" | "passid" | "place" | "sale";
}) {
  // Both modes open the instruction directly (no gate/intro/bot/DB/session).
  // Difference: testMode renders the Telegram/VK buttons inert (silent QA),
  // previewMode keeps them working — "as if a code was already activated".
  const directInstruction = testMode || previewMode;
  const [phase, setPhase] = useState<"intro" | "gate" | "vk-messages" | "instruction">(
    !isWB ? "instruction" : directInstruction ? "instruction" : skipGate ? "gate" : "intro"
  );
  const [denomination, setDenomination] = useState<number>(directInstruction ? (testNom && testNom > 0 ? testNom : 1000) : 0);
  const [activeCode, setActiveCode] = useState<string>(testMode ? "TESTDEV" : "");
  /** Код из ссылки, который покупатель не вводил руками: гейт подставляет его
   * сам и просит только выбрать мессенджер. */
  const [prefilledCode, setPrefilledCode] = useState<string>("");
  const [isRestoring, setIsRestoring] = useState(isWB && !directInstruction);

  /* 👀 «Открыл инструкцию» для «Пути покупателя» в карточке заказа
     (28.10.2026). Один раз на открытие личной ссылки; сервер сам режет
     повторы до раза в час. Тестовые и превью-заходы не считаем. */
  useEffect(() => {
    if (!wbCodeFromUrl || testMode || previewMode) return;
    void fetch("/api/wb-code/opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: wbCodeFromUrl, stage: initialStage ?? null }),
      keepalive: true,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbCodeFromUrl]);

  useEffect(() => {
    if (!isWB || directInstruction) return;
    const restoreSession = async () => {
      const saved = loadWBSession();
      // wbCodeFromUrl is passed by the bot link (?code=...) — works even in Telegram WebView
      // where localStorage is isolated from the regular browser session.
      //
      // Ссылка адресует КОНКРЕТНЫЙ заказ, сохранённая сессия — тот, что открывали
      // прошлый раз (живёт 7 дней). Пока приоритет был у сессии, покупатель двух
      // карточек не мог открыть вторую: ссылка из второго чата WB показывала
      // первый заказ вместе с ником из первого заказа (кейс 21.08, заказы
      // 5547803025/5547803029). Код из ссылки всегда главнее, а разошедшаяся
      // сессия стирается, чтобы не всплыть на следующем заходе без `?code`.
      const codeToCheck = wbCodeFromUrl || saved?.code;
      if (wbCodeFromUrl && saved?.code && saved.code !== wbCodeFromUrl) clearWBSession();
      if (!codeToCheck) {
        setIsRestoring(false);
        return;
      }
      try {
        const statusRes = await fetch(`/api/wb-code?code=${encodeURIComponent(codeToCheck)}`);
        const statusData = await statusRes.json().catch(() => ({}));
        if (statusRes.ok && statusData.claimed) {
          // Фолбэк на номинал из сессии — только если открываем именно её заказ:
          // у второй карточки номинал может быть другим, и подставить чужой
          // значит показать неверную цену геймпасса.
          const savedDenom = saved?.code === codeToCheck ? saved?.denomination : undefined;
          const denom = statusData.denomination ?? savedDenom ?? 0;
          setDenomination(denom);
          setActiveCode(codeToCheck);
          setPhase(statusData.needsVkMessages ? "vk-messages" : "instruction");
          // Сессия и cookie переезжают на открытый сейчас заказ: следующий заход
          // без `?code` (или кнопка ВКонтакте, которая читает cookie `wb_code`)
          // должен продолжать его, а не предыдущий.
          if (denom > 0) persistWbCodeSession(denom, codeToCheck);
        } else if (statusRes.ok && !statusData.claimed && wbCodeFromUrl && statusData.denomination) {
          // Код есть, но за ним ещё нет ни Telegram, ни ВКонтакте.
          //
          // Раньше здесь инструкция открывалась всё равно — «гонка, пользователь
          // успел раньше бота». Для карточных кодов это и правда гонка, а для
          // DBS — нормальное состояние: код выпускает наш же воркер и присылает
          // ссылку в чат WB, так что непривязанным он бывает всегда. В итоге
          // покупатель проходил девять шагов инструкции, вводил ник и выбирал
          // геймпасс, и только в самом конце оставлял контакт — а до тех пор
          // связаться с ним было нельзя ничем, кроме чата WB.
          //
          // Экран гейта и есть экран контакта: код там уже подставлен, а дальше
          // ведут только Telegram и ВКонтакте. Инструкция открывается, когда
          // мессенджер выбран (`claimed`), и это проверяет опрос ниже.
          setDenomination(statusData.denomination);
          setPrefilledCode(codeToCheck);
          setPhase("gate");
        }
        // If not claimed and no wbCodeFromUrl: stay in gate
      } catch {
        // Network error — stay in gate
      } finally {
        setIsRestoring(false);
      }
    };
    const timeout = setTimeout(() => setIsRestoring(false), 10_000);
    restoreSession().finally(() => clearTimeout(timeout));
  }, [isWB, wbCodeFromUrl]);

  const handleWBReset = () => {
    clearWBSession();
    setDenomination(0);
    setActiveCode("");
    setPrefilledCode("");
    setPhase("gate");
  };

  /** Покупатель уходит в Telegram или ВКонтакте и возвращается на эту же
   * вкладку. Опрос замечает, что бот забрал код, и открывает инструкцию сам —
   * без второй ссылки и без «нажмите здесь, чтобы продолжить». */
  useEffect(() => {
    if (phase !== "gate" || !prefilledCode) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/wb-code?code=${encodeURIComponent(prefilledCode)}`);
        const data = await res.json().catch(() => ({}));
        if (!stopped && res.ok && data.claimed) {
          setDenomination(data.denomination ?? 0);
          setActiveCode(prefilledCode);
          setPhase(data.needsVkMessages ? "vk-messages" : "instruction");
        }
      } catch {
        // Сеть моргнула — следующий тик попробует снова.
      }
    };
    const timer = setInterval(check, 4_000);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [phase, prefilledCode]);

  /** Шаг «напиши боту»: ждём, пока VK подтвердит разрешение на сообщения. */
  useEffect(() => {
    if (phase !== "vk-messages" || !activeCode) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/wb-code?code=${encodeURIComponent(activeCode)}`);
        const data = await res.json().catch(() => ({}));
        if (!stopped && res.ok && data.claimed && !data.needsVkMessages) setPhase("instruction");
      } catch {
        // Сеть моргнула — следующий тик попробует снова.
      }
    };
    const timer = setInterval(check, 4_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [phase, activeCode]);

  if (isRestoring) {
    // Этот экран — SSR-разметка: если JS-чанки не догрузились (обрывы сети у
    // российских провайдеров), гидрация не случится и 10-сек таймаут не тикнет —
    // спиннер завис бы навсегда. Фолбэк ниже всплывает чистым CSS через 12 с и
    // работает без JS: перезагрузка страницы + продолжение в боте (бот-коридор
    // от сайта не зависит).
    const tgFallbackHref = tgBotHref(wbCodeFromUrl);
    return (
      <div className="guideRestoreRoot">
        <style>{`
          @keyframes guideStallIn{to{opacity:1;visibility:visible}}
          @keyframes guideVaultTurn{50%{transform:rotate(28deg)}100%{transform:rotate(0)}}
          @keyframes guideVaultGlow{50%{box-shadow:0 0 0 9px rgba(69,214,170,.1),0 24px 70px rgba(117,86,232,.32)}}
          .guideRestoreRoot{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#f4f0ff;background:radial-gradient(circle at 50% 18%,rgba(117,86,232,.28),transparent 28rem),#0b0912;text-align:center}
          .guideRestoreVault{position:relative;width:174px;height:174px;border:14px solid #7556e8;border-radius:50%;background:#151120;box-shadow:0 0 0 7px #45d6aa,0 24px 70px rgba(117,86,232,.22);animation:guideVaultGlow 2.4s ease-in-out infinite}
          .guideRestoreVault::before{content:"";position:absolute;inset:22px;border:4px solid #45375f;border-radius:50%}
          .guideRestoreWheel{position:absolute;left:50%;top:50%;width:72px;height:72px;margin:-36px;border:8px solid #c2b2ff;border-radius:50%;animation:guideVaultTurn 2.4s ease-in-out infinite}
          .guideRestoreWheel::before,.guideRestoreWheel::after{content:"";position:absolute;left:50%;top:50%;width:112px;height:7px;margin:-3.5px -56px;border-radius:99px;background:#c2b2ff}
          .guideRestoreWheel::after{transform:rotate(90deg)}
          .guideRestoreMark{position:absolute;left:50%;top:50%;z-index:2;transform:translate(-50%,-50%);display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#45d6aa;color:#173c31;font-weight:950;font-size:17px}
          .guideRestoreKicker{margin-top:28px;color:#9f8cff;font-size:14px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
          .guideRestoreTitle{margin:8px 0 0;font-size:clamp(28px,6vw,42px);line-height:1.05;letter-spacing:-.04em}
          .guideRestoreText{max-width:430px;margin:12px auto 0;color:#b8b0c5;font-size:17px;line-height:1.6}
          .guideRestoreEgg{margin-top:14px;padding:8px 12px;border:1px dashed rgba(69,214,170,.38);border-radius:999px;color:#88e8c9;font-size:14px}
          .guideRestoreFallback{margin-top:28px;display:flex;flex-direction:column;align-items:center;gap:12px;color:#b8b0c5;font-size:15px}
          .guideRestoreReload{padding:12px 20px;border-radius:12px;background:#7556e8;color:#fff;font-size:16px;font-weight:850;box-shadow:4px 4px 0 #45d6aa;text-decoration:none}
          .guideRestoreLinks{display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
          .guideRestoreLinks a{color:#bbaaff;text-decoration:underline;text-underline-offset:4px}
          @media(prefers-reduced-motion:reduce){.guideRestoreVault,.guideRestoreWheel{animation:none}}
        `}</style>
        <div className="guideRestoreVault" aria-hidden="true">
          <div className="guideRestoreWheel" />
          <div className="guideRestoreMark">R$</div>
        </div>
        <div className="guideRestoreKicker">Личный сейф RobloxBank</div>
        <h1 className="guideRestoreTitle">Восстанавливаем твою сессию</h1>
        <p className="guideRestoreText">Проверяем код и возвращаем тебя к нужному шагу. Обычно это занимает пару секунд.</p>
        <div className="guideRestoreEgg">Пасхалка: ищем тот самый R$, который закатился за дверцу сейфа.</div>
        <div
          className="guideRestoreFallback"
          style={{ opacity: 0, visibility: "hidden", animation: "guideStallIn .5s ease 12s forwards" }}
        >
          <div>Загрузка затянулась?</div>
          <a href="" className="guideRestoreReload">
            Обновить страницу
          </a>
          <div className="guideRestoreLinks">
            <a href={tgFallbackHref}>
              Продолжить в Telegram
            </a>
            <a href={vkBotHref(wbCodeFromUrl)}>
              Продолжить в VK
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "intro") {
    return <WBIntro onDone={() => setPhase("gate")} />;
  }

  if (phase === "gate") {
    return (
      <WBGate initialCode={prefilledCode} initialDenomination={denomination} />
    );
  }

  if (phase === "vk-messages") {
    return <WBVkMessagesStep code={activeCode} denomination={denomination} />;
  }

  // Кто пришёл С ЗАКАЗОМ — тому сначала проверка аккаунта: у половины нужный
  // пасс уже выставлен, и создавать ничего не надо. Кто просто открыл
  // «Инструкцию» из меню — тому пошаговая страница: проверять нечего.
  if (isWB) {
    return (
      <GamepassCheck
        mode="WB"
        amount={denomination || 1000}
        code={activeCode || undefined}
        /* Ник из ссылки бота (`guideUrlFor` кладёт `&username=`). Он сюда не
           передавался вовсе, и «персональная» кнопка из бота приводила
           покупателя в пустое поле «как тебя зовут в Roblox» — на шаг, который
           он в боте только что прошёл. */
        initialUsername={initialUsername}
        onReset={directInstruction ? undefined : handleWBReset}
        testMode={testMode}
        initialPlatform={initialPlatform}
        keyAutoEnabled={keyAutoEnabled}
        initialStage={initialStage}
      />
    );
  }

  if (guideMode === "BOT" || orderFlow) {
    return (
      <GamepassCheck
        mode={guideMode === "BOT" ? "BOT" : "SITE"}
        amount={guideMode === "SITE" ? initialAmount : denomination || 1000}
        sitePayAmount={guideMode === "SITE" ? sitePayAmount : undefined}
        siteUseBonus={siteUseBonus}
        code={activeCode || undefined}
        initialUsername={initialUsername}
        initialPlatform={initialPlatform}
        keyAutoEnabled={keyAutoEnabled}
        initialStage={initialStage}
      />
    );
  }

  return (
    <WBInstructionV2
      denomination={guideMode === "SITE" ? initialAmount : denomination || 1000}
      initialUsername={initialUsername}
      code={activeCode || undefined}
      mode={guideMode}
      initialPlatform={initialPlatform}
    />
  );
}
