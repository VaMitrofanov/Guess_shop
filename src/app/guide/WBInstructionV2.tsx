"use client";

/**
 * GamepassGuide — the single current gamepass instruction for WB, site and bot.
 * Self-contained, scoped CSS (all classes prefixed `wbi-`), real assets from
 * /public/guide, dynamic denomination/price/code, lazy media (IntersectionObserver),
 * live price overlay on the Default-Price screenshot. Channel-specific labels
 * and handoff behavior are data, while the nine instructional steps stay shared.
 *
 * Visual skin `.wbi-v3` (storefront design language) is applied in all three
 * modes; `isSite` keeps driving *behavior* only — Navbar/Footer, theme toggle,
 * price tolerance, checkout vs bot handoff.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import VKAuthButton from "@/components/auth/VKAuthButton";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { getOrInitSessionId } from "@/lib/wb-session";
import { ThemeToggle } from "@/components/theme-toggle";
import { gamepassPriceMatches, rankSellableGamepasses } from "@/lib/gamepass-search-view";
import { CUSTOM_MAX, CUSTOM_MIN } from "@/lib/retail-pricing";

const RATE = 0.7; // Roblox keeps 30%
const calcPrice = (n: number) => (n > 0 ? Math.ceil(n / RATE) : 0);

// VK community deep-link used to bounce the user back into the bot once the order
// is placed (the code is already bound to their VK id — no re-auth needed).
const VK_RETURN_HREF = "https://vk.me/club237309399";

// ─── Step-7 nick search types ───────────────────────────────────────────────
const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

interface Pass {
  id: number | string;
  name: string;
  price: number;
  productId: number;
  placeId: number;
  sellerName: string;
  isForSale: boolean;
  image: string;
}

type SearchView =
  | { kind: "idle" }
  | { kind: "user_not_found"; nick: string }
  | { kind: "no_gamepasses"; nick: string }
  | { kind: "wrong_price"; nick: string; passes: Pass[] }
  | { kind: "matches"; nick: string; passes: Pass[] };

// ─── Lazy, on-screen-only video ────────────────────────────────────────────────
function LazyVideo({ src, poster, alt }: { src: string; poster: string; alt?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const arm = () => {
      const s = v.querySelector("source[data-src]") as HTMLSourceElement | null;
      if (s && !s.src) { s.src = s.dataset.src || ""; v.load(); }
    };
    if (typeof IntersectionObserver === "undefined") {
      arm();
      return;
    }
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (e.isIntersecting) {
          arm();
          if (!reduce) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        } else {
          try { v.pause(); } catch {}
        }
      });
    }, { threshold: 0.35 });
    io.observe(v);
    const onVis = () => { if (document.hidden) { try { v.pause(); } catch {} } };
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return (
    <video ref={ref} className="wbi-vlazy" muted loop playsInline preload="none" poster={poster} aria-label={alt}>
      <source data-src={src} type="video/mp4" />
    </video>
  );
}

// ─── Scroll reveal ──────────────────────────────────────────────────────────────
function useReveal() {
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const els = Array.from(r.querySelectorAll(".wbi-reveal"));
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("wbi-in"));
      return;
    }
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("wbi-in"); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    els.forEach((el, i) => { (el as HTMLElement).style.transitionDelay = `${(i % 3) * 70}ms`; io.observe(el); });
    return () => io.disconnect();
  }, []);
  return root;
}

export default function WBInstructionV2({
  denomination,
  initialUsername = "",
  code,
  onReset,
  testMode = false,
  mode = "WB",
}: { denomination?: number; initialUsername?: string; code?: string; onReset?: () => void; testMode?: boolean; mode?: "WB" | "SITE" | "BOT" }) {
  const nomDefault = denomination && denomination > 0 ? denomination : 1000;
  const isSite = mode === "SITE";
  const [nom, setNom] = useState<number>(nomDefault);
  const [copied, setCopied] = useState(false);
  const price = calcPrice(nom);
  const root = useReveal();

  const tgHref = code
    ? `https://t.me/RobloxBankBot?start=wb_${code}_${getOrInitSessionId()}`
    : "https://t.me/RobloxBankBot";

  const copy = useCallback(() => {
    const v = String(price);
    try { navigator.clipboard?.writeText(v); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [price]);

  // ── Step 7: live gamepass search by Roblox nick (one-tap handoff to bot) ──
  // WB is fixed by the activated card. SITE/BOT can edit the desired amount at
  // the calculation step, therefore their expected gamepass price follows `nom`.
  const expectedPrice = calcPrice(mode === "WB" ? nomDefault : nom);
  const [nick, setNick] = useState(initialUsername.trim().replace(/^@/, ""));
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [view, setView] = useState<SearchView>({ kind: "idle" });
  const [picked, setPicked] = useState<{ id: string; name: string; price: number } | null>(null);

  const runSearch = useCallback(async () => {
    const n = nick.trim().replace(/^@/, "");
    if (!NICK_RE.test(n)) {
      setSearchErr("Ник Roblox: 3–20 символов — латинские буквы, цифры или _");
      setView({ kind: "idle" });
      return;
    }
    setSearchErr(null);
    setPicked(null);
    setView({ kind: "idle" });
    setSearching(true);
    try {
      // `code` lets the server stamp the nick on the order right away (early
      // nick capture) — even if the user never finishes the one-tap.
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(n)}${code ? `&code=${encodeURIComponent(code)}` : ""}`);
      const data = await res.json();
      if (!data?.success) { setSearchErr("Поиск временно недоступен — попробуй ещё раз."); return; }
      const sellable = rankSellableGamepasses<Pass>(data.gamepasses ?? [], expectedPrice);
      if (sellable.length === 0) {
        setView(data.userExists === false ? { kind: "user_not_found", nick: n } : { kind: "no_gamepasses", nick: n });
        return;
      }
      const annotated = sellable.map((g) => ({ ...g, isPriceMatch: gamepassPriceMatches(g.price, expectedPrice, isSite ? 0 : undefined) }));
      const matches = annotated.filter((g) => g.isPriceMatch);
      if (matches.length === 0) setView({ kind: "wrong_price", nick: n, passes: annotated.slice(0, 5) });
      else setView({ kind: "matches", nick: n, passes: matches.slice(0, 5) });
    } catch {
      setSearchErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setSearching(false);
    }
  }, [nick, expectedPrice, isSite, code]);

  // Which channel did the user pick earlier (TG/VK)? Drives the single CTA button
  // at the bottom. orderPlaced = the order is already materialised (site one-tap
  // or further) → reframe the CTA as "следи за статусом" instead of "оформи".
  const [channel, setChannel] = useState<"TG" | "VK" | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [robloxUsername, setRobloxUsername] = useState<string | null>(null);
  // True when orderPlaced was detected on mount (re-entry), not from a fresh pick.
  const [isReEntry, setIsReEntry] = useState(false);

  useEffect(() => {
    if (!code || testMode) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/wb-code?code=${encodeURIComponent(code)}`);
        if (!res.ok) return;
        const d = await res.json();
        if (!alive) return;
        if (d.platform === "TG" || d.platform === "VK") setChannel(d.platform);
        if (d.robloxUsername) setRobloxUsername(d.robloxUsername);
        if (["PENDING", "IN_PROGRESS", "COMPLETED"].includes(d.orderStatus)) {
          setOrderPlaced(true);
          setIsReEntry(true);
        }
      } catch { /* non-fatal — CTA falls back to showing both channels */ }
    })();
    return () => { alive = false; };
  }, [code, testMode]);

  const returnHref = channel === "VK"
    ? (code ? `${VK_RETURN_HREF}?ref=${code}` : VK_RETURN_HREF)
    : tgHref;

  // Auto-redirect only on fresh picks (not re-entries — let the user see their nick).
  const redirecting = orderPlaced && !isReEntry && !testMode && !!channel;
  useEffect(() => {
    if (!redirecting) return;
    const t = setTimeout(() => { window.location.href = returnHref; }, 1800);
    return () => clearTimeout(t);
  }, [redirecting, returnHref]);

  const pick = useCallback(async (p: Pass, searchedNick: string) => {
    setPicked({ id: String(p.id), name: p.name, price: p.price });
    if (isSite) return;
    // Materialise the order on the server (promote provisional → PENDING + fire
    // the admin card). Advisory/idempotent — the bot one-tap stays a fallback.
    // Skipped in test/preview or without a code.
    if (!testMode && code) {
      try {
        const res = await fetch("/api/wb-code/select-gamepass", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, gamepassId: String(p.id), nick: searchedNick }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data?.ordered || data?.alreadyOrdered)) setOrderPlaced(true);
      } catch { /* non-blocking: bot nick-search remains as fallback */ }
    }
  }, [code, isSite, testMode]);

  return (
    <>
      {isSite && <Navbar />}
      <div className={`wbi-root wbi-v3${isSite ? " wbi-site-mode" : ""}`} ref={root}>
        <style>{CSS}</style>

      <div className="wbi-bgfx"><div className="wbi-blob wbi-b1" /><div className="wbi-blob wbi-b2" /></div>

      <div className="wbi-wrap">
        {/* top bar */}
        <div className="wbi-top">
          <div>
            <div className="wbi-eye">{mode === "WB" ? "WILDBERRIES × ROBLOXBANK" : mode === "SITE" ? "ROBLOXBANK · ПОКУПКА НА САЙТЕ" : "ROBLOXBANK · ЗАКАЗ В БОТЕ"}</div>
            <div className="wbi-top-sub">Инструкция</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="wbi-tag">{isSite ? "Желаемая сумма" : "Номинал"} {isSite ? nom : nomDefault} R$</div>
            {onReset && (
              <button className="wbi-reset" onClick={onReset}>‹ Новый код</button>
            )}
            {!isSite && <ThemeToggle compact />}
          </div>
        </div>

        {/* hero */}
        <div className="wbi-hero wbi-reveal">
          <div className="wbi-kick">{isSite ? "ГЕЙМПАСС · ПОШАГОВО" : "ПОЛУЧИ СВОИ ROBUX"}</div>
          <h1 className="wbi-h1">{isSite ? <>Robux.<br />Без лишней <span className="wbi-g">сложности.</span></> : <>Это <span className="wbi-g">проще</span><br />чем кажется</>}</h1>
          <p className="wbi-lead">{isSite ? "Проведём через Creator Hub, рассчитаем точную цену и сразу найдём готовый геймпасс." : "Всего 9 шагов. Всё в браузере, ничего скачивать не нужно."}</p>
          <div className="wbi-chips">
            <div className="wbi-chip"><b>5–7 мин</b><span>ВРЕМЯ</span></div>
            <div className="wbi-chip"><b>Легко</b><span>СЛОЖНОСТЬ</span></div>
            <div className="wbi-chip"><b>0 ₽</b><span>КОМИССИЯ</span></div>
          </div>
          <div className="wbi-must">
            <div className="wbi-must-h">✅ ВСЁ ПРОЩЕ, ЧЕМ РАНЬШЕ</div>
            <div className="wbi-must-it"><span className="wbi-n">1</span><span>Создай геймпасс, поставь <b>точную цену</b> и убедись, что <b>«Managed pricing» отключён</b> (шаг 7).</span></div>
            <div className="wbi-must-ft">⚠️ <b>«Managed pricing»</b> (региональные цены) автоматически меняет цену геймпасса — из-за этого мы <b>не сможем</b> его выкупить. Галочка должна быть <b>отключена</b>! У новых геймпассов она отключена по умолчанию, но обязательно проверь (шаг 7).</div>
          </div>
        </div>

        {/* Обзор этапов — часть общего дизайна инструкции (все три режима). */}
        <div className="wbi-roadmap wbi-reveal" aria-label="Этапы инструкции">
          <div className="wbi-roadmap-card">
            <span>01—05</span><b>Создай</b><small>Открываем Creator Hub и делаем геймпасс</small>
          </div>
          <div className="wbi-roadmap-card wbi-roadmap-accent">
            <span>06—07</span><b>Настрой</b><small>Ставим точную цену без региональных скидок</small>
          </div>
          <div className="wbi-roadmap-card wbi-roadmap-dark">
            <span>08—09</span><b>Проверь</b><small>{isSite ? "Находим геймпасс и переходим к оформлению" : "Находим геймпасс и оформляем заказ"}</small>
          </div>
        </div>

        {/* timeline */}
        <div className="wbi-tl">

          <Step n="1">
            <div className="wbi-cols wbi-media wbi-intro-step">
              <div><div className="wbi-ttl">Открой Creator Hub</div>
                <p className="wbi-t">Перейди на официальный сайт Roblox, где создаются геймпассы. Лучше открыть его в Safari или Chrome.</p>
                <div className="wbi-quicknotes">
                  <span>✓ Если ты уже вошёл в Roblox, нужный раздел откроется сразу.</span>
                  {/* Актуально только для WB-гейта: туда приходят из карточки внутри
                      мессенджера. На сайте страницу и так открывают в браузере. */}
                  {mode === "WB" && <span>↗ Открылось внутри Telegram или VK? Нажми «⋯» → «Открыть в браузере».</span>}
                </div></div>
              <div className="wbi-mcol">
                <a className="wbi-btnL" href="https://create.roblox.com/dashboard/creations" target="_blank" rel="noopener noreferrer">🔗 Открыть Creator Hub</a>
                <div className="wbi-url">create.roblox.com/dashboard/creations</div>
              </div>
            </div>
          </Step>

          <Step n="2">
            <div className="wbi-cols wbi-media wbi-rev">
              <div><div className="wbi-ttl">Найди свою игру и открой её</div>
                <p className="wbi-t">Открой раздел <b>Creations</b> — там твоя игра, названа по твоему нику. Даже если ты ничего не создавал, одна игра уже есть.</p>
                <ol className="wbi-ol">
                  <li>Найди карточку своей игры.</li>
                  <li><b>Нажми на неё</b>, чтобы открыть.</li>
                </ol></div>
              <div className="wbi-mcol"><figure className="wbi-figure">
                <span className="wbi-anno">
                  <img src="/guide/wb-step2-place.png" alt="Creations: нажми на свою игру" loading="lazy" decoding="async" />
                  <span className="wbi-box g" style={{ left: "9.5%", top: "20%", width: "76%", height: "50.5%" }} />
                  <span className="wbi-tip g" style={{ left: "48%", top: "44%" }}>НАЖМИ</span>
                </span>
                <figcaption>Нажми на карточку своей игры (обведено).</figcaption>
              </figure></div>
            </div>
          </Step>

          <Step n="3">
            <div className="wbi-cols wbi-media">
              <div><div className="wbi-ttl">Открой раздел Passes</div>
                <p className="wbi-t">Геймпасс — это товар внутри игры, который мы у тебя купим. Открой раздел, где он создаётся (просто повтори за видео):</p>
                <ol className="wbi-ol">
                  <li>Нажми <b>☰</b> — три полоски слева вверху.</li>
                  <li>В меню пролистай до <span className="wbi-pill">Monetization</span>.</li>
                  <li>Нажми <span className="wbi-pill">Passes</span>.</li>
                </ol></div>
              <div className="wbi-mcol"><figure className="wbi-figure wbi-spot"><LazyVideo src="/guide/wb-step3-passesnav.mp4" poster="/guide/wb-step3-passesnav-poster.jpg" alt="☰ → Monetization → Passes" /><figcaption>☰ → <b>Monetization</b> → <b>Passes</b> — как на видео.</figcaption></figure></div>
            </div>
          </Step>

          <Step n="4">
            <div className="wbi-ttl">Нажми «Create Pass»</div>
            <p className="wbi-t">На странице <b>Passes</b> нажми синюю кнопку <b>Create Pass</b> (вверху слева) — откроется форма создания.</p>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step5-createbtn.png" alt="Страница Passes: синяя кнопка Create Pass" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "3.6%", top: "20.4%", width: "24%", height: "6.8%" }} />
                <span className="wbi-tip g" style={{ left: "42%", top: "23.8%" }}>← НАЖМИ</span>
              </span>
              <figcaption>Синяя <b>Create Pass</b> (обведена) — вверху страницы Passes.</figcaption>
            </figure>
          </Step>

          <Step n="5">
            <div className="wbi-ttl">Заполни форму пасса</div>
            <p className="wbi-t">Откроется форма создания. Заполни её:</p>
            <ol className="wbi-ol">
              <li>Напиши <b>любое название</b> (например «VIP» или «Pop»).</li>
              <li>Картинку и описание добавлять <b>не нужно</b>.</li>
              <li>Нажми синюю кнопку <b>Create pass</b> внизу.</li>
            </ol>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step5-create.png" alt="Форма создания пасса: название и кнопка Create pass" loading="lazy" decoding="async" />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "16.5%" }}>ЛЮБОЕ НАЗВАНИЕ</span>
                <span className="wbi-box g" style={{ left: "4.5%", top: "21.3%", width: "91%", height: "11.4%" }} />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "83%" }}>НАЖМИ — СОЗДАТЬ</span>
                <span className="wbi-box g" style={{ left: "3.8%", top: "88.2%", width: "92.5%", height: "10%" }} />
              </span>
              <figcaption>Напиши <b>любое название</b> (верхняя рамка) → нажми синюю <b>Create pass</b> внизу.</figcaption>
            </figure>
          </Step>

          <Step n="6">
            <div className="wbi-ttl">Открой пасс → ☰ → Sales</div>
            <p className="wbi-t">После создания ты вернёшься в список <b>Passes</b>. Чтобы задать цену:</p>
            <ol className="wbi-ol">
              <li>Нажми на свой <b>новый пасс</b> (он внизу списка).</li>
              <li>Слева вверху нажми <b>☰</b> (три полоски).</li>
              <li>В боковом меню выбери <b>Sales</b>.</li>
            </ol>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step7-menu.png" alt="Боковое меню пасса: выбери Sales" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "18.5%", top: "29.6%", width: "23%", height: "6%" }} />
                <span className="wbi-tip g" style={{ left: "52%", top: "32.4%" }}>← ВЫБЕРИ</span>
              </span>
              <figcaption>В боковом меню пасса выбери <b>Sales</b> (обведено).</figcaption>
            </figure>
          </Step>

          <Step n="7" cls="wbi-key">
            <div className="wbi-ttl">Впиши цену и сохрани</div>
            <p className="wbi-t">Ты на вкладке <b>Sales</b>. Дальше:</p>
            <ol className="wbi-ol">
              <li>Включи <b>Item for sale</b> — без этого нельзя вписать цену.</li>
              <li>Скопируй цену ниже → вставь в поле <b>Price</b>.</li>
              <li>Убедись, что <b>Managed pricing</b> — <b>ОТКЛЮЧЁН</b> (переключатель ниже на этой же вкладке).</li>
              <li>Нажми синюю <b>Save Changes</b>.</li>
            </ol>
            <div className="wbi-checknote" style={{ background: "rgba(255,60,60,0.12)", borderColor: "#ff4444" }}>⚠️ <b>ВАЖНО: «Managed pricing»</b> (региональные цены) должен быть <b>ОТКЛЮЧЁН</b>. Если он включён — Roblox автоматически изменит цену и мы <b>не сможем</b> выкупить геймпасс, пока ты не исправишь. По умолчанию он отключён, но обязательно проверь!</div>
            <div className="wbi-calc">
              <div className="wbi-lbl">ЦЕНА ПАСА — ВСТАВЬ ЕЁ В ROBLOX</div>
              <div className="wbi-nomrow">{mode === "WB" ? "Номинал твоей карты" : "Сколько R$ ты получаешь"}:{mode === "WB" ? <strong> {nomDefault.toLocaleString("ru-RU")} R$</strong> : <><input className="wbi-input" type="number" min={CUSTOM_MIN} max={CUSTOM_MAX} inputMode="numeric" value={nom}
                onChange={(e) => { setNom(Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, parseInt(e.target.value || String(CUSTOM_MIN), 10)))); setPicked(null); setView({ kind: "idle" }); }} /> R$</>}</div>
              <div className="wbi-v wbi-copy" onClick={copy} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") copy(); }}>
                <span>{price}</span><span className="wbi-ci">{copied ? "✓" : "📋"}</span>
              </div>
              <div className="wbi-copyhint">{copied ? `✓ Скопировано: ${price}` : `Нажми → скопируется. Выстави эту цену, чтобы на руки пришло ${nom} R$`}</div>
            </div>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step6-sales.png" alt="Вкладка Sales: Price, Item for sale, Managed pricing отключён, Save Changes" loading="lazy" decoding="async" />
                {/* Item for sale — user must turn it ON */}
                <span className="wbi-tip g caret" style={{ left: "78%", top: "12%" }}>ВКЛЮЧИ ✓</span>
                {/* Price field + live price */}
                <span className="wbi-box g" style={{ left: "3.5%", top: "24%", width: "93%", height: "15%" }} />
                <span className="wbi-price6" style={{ left: "7.8%", top: "30%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{price}</span>
                <span className="wbi-tip g caret" style={{ left: "26%", top: "17%" }}>ТВОЯ ЦЕНА ↓</span>
                {/* Managed pricing — highlight it must be OFF */}
                <span className="wbi-box" style={{ left: "3.5%", top: "42%", width: "93%", height: "9%", borderColor: "#ff4444" }} />
                <span className="wbi-tip r caret" style={{ left: "72%", top: "44%" }}>⚠️ ОТКЛЮЧЁН ✓</span>
                {/* Save Changes */}
                <span className="wbi-box g" style={{ left: "3.5%", top: "85%", width: "93%", height: "13%" }} />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "81%" }}>НАЖМИ — СОХРАНИТЬ</span>
              </span>
              <figcaption>Включи <b>Item for sale</b>. В поле <b>Price</b> — твоя цена. <b>Managed pricing — ОТКЛЮЧЁН</b>. Внизу нажми <b>Save Changes</b>.</figcaption>
            </figure>
          </Step>

          <Step n="8" pulse cls="wbi-key wbi-finish">
            {isReEntry && robloxUsername ? (
              <>
                <div className="wbi-kbadge" style={{ background: "linear-gradient(135deg,#1a7a3a,#2ecc71)" }}>✅ ЗАКАЗ ОФОРМЛЕН</div>
                <div className="wbi-ttl">Твой заказ в работе</div>
                <div className="wbi-picked" style={{ marginTop: 12 }}>
                  <div className="wbi-picked-h">🎮 Робуксы придут на ник:</div>
                  <div className="wbi-picked-b" style={{ fontSize: "1.3em" }}><b>{robloxUsername}</b></div>
                  <div className="wbi-shint" style={{ marginTop: 8 }}>
                    Статус и уведомления — в боте. Не меняй цену и не удаляй геймпасс до сообщения «всё готово».
                  </div>
                  <button className="wbi-relink" style={{ color: "#e74c3c", borderColor: "#e74c3c", marginTop: 12 }} onClick={() => { setIsReEntry(false); setOrderPlaced(false); setPicked(null); setRobloxUsername(null); }}>
                    ⚠️ Ошибся с ником? Изменить заказ
                  </button>
                </div>
              </>
            ) : (
              <>
            <div className="wbi-kbadge">🏁 ФИНИШ — {isSite ? "ПРОВЕРЯЕМ ГЕЙМПАСС" : "ОФОРМЛЯЕМ ЗАКАЗ"}</div>
            <div className="wbi-ttl">{isSite ? "Найди готовый геймпасс" : "Геймпасс готов — оформи заказ"}</div>
            <p className="wbi-t">{isSite
              ? <>Впиши <b>ник аккаунта Roblox</b>. Мы покажем подходящий геймпасс и передадим его в оформление на сайте — повторно искать по играм не придётся.</>
              : <>🎉 Самое сложное позади! Впиши <b>ник аккаунта Roblox, на который придут робуксы</b> — мы сами найдём твой геймпасс и <b>оформим заказ</b>. Дальше всё в <b>боте</b> (Telegram или ВКонтакте — туда ты перейдёшь ниже): он сам выкупит пасс, покажет статус и предложит бонус за отзыв к следующей прямой покупке.</>}</p>
            <div className="wbi-shint" style={{ margin: "2px 0 10px" }}>💡 Это <b>твой</b> ник Roblox — именно на этот аккаунт зачислятся робуксы.</div>
              </>
            )}

            {!(isReEntry && robloxUsername) && <div className="wbi-search">
              <div className="wbi-srow">
                <input
                  className="wbi-sinput"
                  type="text"
                  placeholder="Ник Roblox — сюда придут робуксы"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  aria-label="Ник Roblox — аккаунт получателя робуксов"
                />
                <button className="wbi-sbtn" onClick={runSearch} disabled={searching}>
                  {searching ? "Ищем…" : "🔎 Найти"}
                </button>
              </div>

              {searchErr && <div className="wbi-warn" style={{ marginTop: 10 }}>{searchErr}</div>}
              {searching && <div className="wbi-shint">🔎 Ищем геймпассы у <b>{nick.trim()}</b>…</div>}

              {view.kind === "user_not_found" && (
                <div className="wbi-warn" style={{ marginTop: 12 }}>
                  🤷 Пользователя <b>{view.nick}</b> нет на Roblox. Скорее всего опечатка — скопируй ник прямо со страницы профиля и попробуй снова.
                </div>
              )}

              {view.kind === "no_gamepasses" && (
                <div className="wbi-warn" style={{ marginTop: 12 }}>
                  🙈 У <b>{view.nick}</b> не нашли геймпассов на продажу. Скорее всего пасс ещё не создан или не выставлен на продажу — вернись к шагам <b>3–7</b>, затем нажми «Найти» снова.
                </div>
              )}

              {view.kind === "wrong_price" && (
                <div style={{ marginTop: 12 }}>
                  <div className="wbi-warn">У <b>{view.nick}</b> есть геймпассы, но ни один не за <b>{expectedPrice} R$</b>:</div>
                  <div className="wbi-gplist">
                    {view.passes.map((p) => (
                      <div className="wbi-gpcard dim" key={String(p.id)}>
                        <img className="wbi-gpthumb" src={p.image} alt="" loading="lazy" />
                        <div className="wbi-gpmeta"><b>{p.name}</b><span>{p.price} R$</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="wbi-shint">Нужен геймпасс ровно на <b>{expectedPrice} R$</b> — поправь цену (шаг <b>7</b>) и нажми «Найти» снова.</div>
                </div>
              )}

              {view.kind === "matches" && !picked && (
                <div style={{ marginTop: 12 }}>
                  <div className="wbi-ok">🎯 {view.passes.length === 1 ? "Нашли твой геймпасс. Это он?" : "Нашли подходящие геймпассы. Выбери нужный:"}</div>
                  <div className="wbi-gplist">
                    {view.passes.map((p) => (
                      <button className="wbi-gpcard pick" key={String(p.id)} onClick={() => pick(p, view.nick)}>
                        <img className="wbi-gpthumb" src={p.image} alt="" loading="lazy" />
                        <div className="wbi-gpmeta"><b>{p.name}</b><span>{p.price} R$</span></div>
                        <span className="wbi-pickbadge">Это мой ✓</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {picked && (
                <div className="wbi-picked">
                  <div className="wbi-picked-h">{isSite ? "✅ ГЕЙМПАСС ВЫБРАН" : orderPlaced ? "✅ ЗАКАЗ ОФОРМЛЕН" : "⏳ ОФОРМЛЯЕМ ЗАКАЗ…"}</div>
                  <div className="wbi-picked-b"><b>{picked.name}</b> · {picked.price} R$</div>
                  <div className="wbi-shint" style={{ marginTop: 8 }}>
                    {isSite
                      ? "Готово. Ниже откроется оформление с уже выбранными суммой, ником и геймпассом."
                      : orderPlaced
                      ? "Готово! Сейчас вернём тебя в бота — там статус заказа и уведомления. Если не открылось автоматически — нажми кнопку ниже 👇"
                      : "Оформляем твой заказ, подожди немного — затем сами вернём тебя в бота 👌"}
                  </div>
                  <button className="wbi-relink" onClick={() => { setPicked(null); setOrderPlaced(false); }}>Выбрать другой</button>
                </div>
              )}
            </div>}
          </Step>

          <Step n="9">
            {isSite ? (
              <div className="wbi-cols wbi-media wbi-rev">
                <div><div className="wbi-ttl">Проверь и перейди к оплате</div>
                  <p className="wbi-t">На следующем экране мы ещё раз сверим цену, зафиксируем рублёвую сумму и покажем состав заказа до оплаты.</p>
                  <ul className="wbi-blist">
                    <li>✅ <b>Ник и геймпасс</b> уже перенесены</li>
                    <li>🧾 <b>Email нужен только для чека</b></li>
                    <li>🔒 <b>Пароль Roblox не требуется</b></li>
                  </ul>
                  <div className="wbi-warn">Не меняй цену и не удаляй геймпасс до сообщения «всё готово».</div></div>
                <div className="wbi-mcol"><div className="wbi-icoTile">🔐</div></div>
              </div>
            ) : (
              <div className="wbi-cols wbi-media wbi-rev">
                <div><div className="wbi-ttl">Зачем нужен бот</div>
                  <p className="wbi-t">Бот — это твой личный кабинет заказа. Тебе только нажимать кнопки:</p>
                  <ul className="wbi-blist">
                    <li>🔔 <b>Статус заказа</b> — приняли → выкупаем → готово</li>
                    <li>✅ <b>{orderPlaced ? "Заказ уже оформлен" : "Подтвердить выкуп"}</b>{picked && !orderPlaced ? " — в один тап" : ""}</li>
                    <li>🎁 <b>Бонус</b> за короткий отзыв</li>
                  </ul>
                  <div className="wbi-directnote">💎 <b>Самое главное:</b> в боте можно <b>купить Robux напрямую</b> — без карты WB. Это <b>быстрее, дешевле и выгоднее</b>. Многие об этом не знают — попробуй!</div>
                  <div className="wbi-warn">Не меняй цену и не удаляй геймпасс до сообщения «всё готово».</div></div>
                <div className="wbi-mcol"><div className="wbi-icoTile">🤖</div></div>
              </div>
            )}
          </Step>

        </div>

        {/* Channel-specific handoff after the shared instruction. */}
        {isSite ? (
          <div className="wbi-cta wbi-reveal">
            <h3>{picked ? "Геймпасс готов к оформлению" : "Сначала найди и выбери геймпасс"}</h3>
            <div className="wbi-s">Желаемая сумма {nom.toLocaleString("ru-RU")} R$ · цена пасса {expectedPrice.toLocaleString("ru-RU")} R${picked ? <> · <b>{picked.name}</b></> : null}</div>
            {picked ? (
              <a
                className="wbi-sitepay"
                href={`/checkout?amount=${nom}&username=${encodeURIComponent(nick.trim().replace(/^@/, ""))}&gamepassId=${encodeURIComponent(picked.id)}`}
              >
                Перейти к оформлению →
              </a>
            ) : (
              <span className="wbi-sitepay disabled" aria-disabled="true">Выбери геймпасс на шаге 8</span>
            )}
            <a className="wbi-support" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Остались вопросы? Написать живому менеджеру →</a>
          </div>
        ) : (
        <div className="wbi-cta wbi-reveal">
          <h3>{isReEntry && orderPlaced
            ? "Заказ оформлен — статус в боте"
            : orderPlaced
              ? "Заказ оформлен — возвращаем в бота"
              : picked
                ? "Почти готово — открой бота и подтверди"
                : "Геймпасс готов? Открой бота"}</h3>
          <div className="wbi-s">{isReEntry && orderPlaced
            ? <>✅ Заказ уже у менеджера. Статус и уведомления — в боте.</>
            : orderPlaced
              ? <>✅ <b>{picked?.name ?? "Геймпасс"}</b> · {picked?.price ?? calcPrice(nomDefault)} R$ — заказ уже у менеджера. Сейчас вернём тебя в бота — там статус и уведомления.</>
              : picked
                ? <>✅ <b>{picked.name}</b> · {picked.price} R$ — бот подтвердит выкуп в один тап</>
                : <>Номинал {nomDefault} R$ · цена пасса {calcPrice(nomDefault)} R$ · после выкупа бот предложит бонус за отзыв к следующей прямой покупке</>}</div>

          {(() => {
            const tgBtn = (disabled: boolean) => disabled ? (
              <button className="wbi-tg" disabled aria-disabled="true" style={{ opacity: 0.5, cursor: "not-allowed" }}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z" /></svg>
                <span>Вернуться в Telegram</span>
              </button>
            ) : (
              <a className="wbi-tg" href={tgHref} target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z" /></svg>
                <span>Вернуться в Telegram</span>
              </a>
            );
            const vkDisabledBtn = (
              <button className="wbi-tg" disabled aria-disabled="true" style={{ opacity: 0.5, cursor: "not-allowed", background: "linear-gradient(180deg,#3d8bff,#0a66e0)" }}>
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.785 16.241s.288-.032.435-.194c.135-.149.13-.43.13-.43s-.019-1.306.572-1.497c.582-.188 1.331 1.252 2.124 1.806.6.42 1.056.328 1.056.328l2.122-.03s1.111-.07.585-.957c-.043-.073-.306-.658-1.578-1.853-1.331-1.252-1.153-1.049.451-3.224.977-1.323 1.367-2.13 1.245-2.474-.116-.328-.834-.241-.834-.241l-2.387.015s-.177-.024-.308.056c-.128.078-.21.262-.21.262s-.378 1.022-.882 1.892c-1.062 1.834-1.487 1.931-1.661 1.816-.405-.267-.304-1.069-.304-1.638 0-1.778.267-2.519-.51-2.711-.258-.064-.448-.106-1.108-.113-.847-.009-1.564.003-1.97.207-.27.136-.479.439-.351.456.157.022.514.099.703.363.244.341.236 1.108.236 1.108s.14 2.083-.328 2.342c-.32.178-.76-.185-1.706-1.85-.484-.853-.85-1.795-.85-1.795s-.07-.176-.196-.27c-.152-.114-.365-.15-.365-.15l-2.268.015s-.34.01-.466.16c-.111.135-.009.412-.009.412s1.776 4.221 3.787 6.349c1.844 1.95 3.938 1.822 3.938 1.822h.949z" /></svg>
                <span>ВКонтакте</span>
              </button>
            );
            const vkBtn = <div className="wbi-vkwrap"><VKAuthButton mode="order" wbCode={code} label="Вернуться в ВКонтакте" /></div>;

            // testMode: inert buttons (silent QA). Otherwise show ONE channel the
            // user already chose (TG/VK); fall back to both if unknown.
            if (testMode) return <div className="wbi-row">{tgBtn(true)}{vkDisabledBtn}</div>;
            if (channel === "TG") return <div className="wbi-row">{tgBtn(false)}</div>;
            if (channel === "VK") return <div className="wbi-row">{vkBtn}</div>;
            return <div className="wbi-row">{tgBtn(false)}{vkBtn}</div>;
          })()}

          {redirecting && (
            <div className="wbi-redirect">↩︎ Возвращаем тебя в {channel === "VK" ? "ВКонтакте" : "Telegram"}… Если не открылось — нажми кнопку выше.</div>
          )}

          {/* Самая частая точка залипания на этом экране: покупатель уверен, что
              геймпасс создал, а поиск его не находит — почти всегда потому, что
              плейс закрыт настройками. В боте этот разбор написан давно, а на
              странице его не было, и человек просто ждал: один такой случай
              стоил пяти с половиной часов переписки в чате WB за два дня.
              Кнопки «проверить ещё раз» здесь быть не может — поиск живёт в
              боте, а кнопка-обманка хуже честной ссылки (решение владельца). */}
          {!orderPlaced && !picked && (
            <details className="wbi-gphelp">
              <summary>🙈 Не видим твой геймпасс?</summary>
              <ul>
                <li>Плейс закрыт настройками приватности — открой его и сделай Public</li>
                <li>Пасс создан, но не выставлен на продажу (For Sale)</li>
                <li>Цена пасса должна быть ровно <b>{calcPrice(nomDefault)} R$</b> — иначе выкуп не сойдётся</li>
                <li>После изменения настроек Roblox обновляет витрину не мгновенно — подожди пару минут</li>
              </ul>
              <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">
                Не помогло? Пиши в поддержку — разберёмся вместе →
              </a>
            </details>
          )}

          <div className="wbi-directcta">💎 В боте можно <b>купить Robux напрямую</b> — без карты WB, быстрее и выгоднее</div>

          {testMode && (
            <div className="wbi-s" style={{ marginTop: 8, color: "#f0a020" }}>testdev: кнопки Telegram/VK отключены — бот и админ-оповещения не дёргаются</div>
          )}
          <a className="wbi-support" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Остались вопросы? Написать живому менеджеру (не боту) →</a>
        </div>
        )}

        <div className="wbi-note">Инструкция оформлена для мобильных устройств. Если что-то не получается — пиши менеджеру выше.</div>
      </div>
      </div>
      {isSite && <Footer />}
    </>
  );
}

function Step({ n, pulse, cls, children }: { n: string; pulse?: boolean; cls?: string; children: React.ReactNode }) {
  return (
    <div className="wbi-step wbi-reveal">
      <div className={`wbi-dot${pulse ? " wbi-pulse" : ""}`}>{n}</div>
      <div className={`wbi-card${cls ? " " + cls : ""}`}>{children}</div>
    </div>
  );
}

const CSS = `
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
`;
