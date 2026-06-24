"use client";

/**
 * WBInstructionV2 — redesigned Wildberries instruction (approved mockup port).
 * Self-contained, scoped CSS (all classes prefixed `wbi-`), real assets from
 * /public/guide, dynamic denomination/price/code, lazy media (IntersectionObserver),
 * live price overlay on the Default-Price screenshot. Standard (non-WB) guide path
 * is untouched — this renders only for the WB instruction phase.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import VKAuthButton from "@/components/auth/VKAuthButton";
import { getOrInitSessionId } from "@/lib/wb-session";

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
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const arm = () => {
      const s = v.querySelector("source[data-src]") as HTMLSourceElement | null;
      if (s && !s.src) { s.src = s.dataset.src || ""; v.load(); }
    };
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
  code,
  onReset,
  testMode = false,
}: { denomination?: number; code?: string; onReset?: () => void; testMode?: boolean }) {
  const nomDefault = denomination && denomination > 0 ? denomination : 1000;
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
  // Expected price is keyed off the code's real denomination, NOT the editable
  // calculator `nom`, so the price-match check stays correct even if the user
  // toyed with the calculator in step 6.
  const expectedPrice = calcPrice(nomDefault);
  const [nick, setNick] = useState("");
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
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(n)}`);
      const data = await res.json();
      if (!data?.success) { setSearchErr("Поиск временно недоступен — попробуй ещё раз."); return; }
      const sellable: Pass[] = (data.gamepasses ?? []).filter((g: Pass) => g.isForSale && g.price > 0);
      if (sellable.length === 0) {
        setView(data.userExists === false ? { kind: "user_not_found", nick: n } : { kind: "no_gamepasses", nick: n });
        return;
      }
      const annotated = sellable
        .map((g) => ({ ...g, isPriceMatch: Math.abs(g.price - expectedPrice) <= 2 }))
        .sort((a, b) => Math.abs(a.price - expectedPrice) - Math.abs(b.price - expectedPrice));
      const matches = annotated.filter((g) => g.isPriceMatch);
      if (matches.length === 0) setView({ kind: "wrong_price", nick: n, passes: annotated.slice(0, 5) });
      else setView({ kind: "matches", nick: n, passes: matches.slice(0, 5) });
    } catch {
      setSearchErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setSearching(false);
    }
  }, [nick, expectedPrice]);

  // Which channel did the user pick earlier (TG/VK)? Drives the single CTA button
  // at the bottom. orderPlaced = the order is already materialised (site one-tap
  // or further) → reframe the CTA as "следи за статусом" instead of "оформи".
  const [channel, setChannel] = useState<"TG" | "VK" | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [robloxUsername, setRobloxUsername] = useState<string | null>(null);
  // True when orderPlaced was detected on mount (re-entry), not from a fresh pick.
  const [isReEntry, setIsReEntry] = useState(false);

  const [redirecting, setRedirecting] = useState(false);

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
  useEffect(() => {
    if (!orderPlaced || isReEntry || testMode || !channel) return;
    setRedirecting(true);
    const t = setTimeout(() => { window.location.href = returnHref; }, 1800);
    return () => clearTimeout(t);
  }, [orderPlaced, isReEntry, channel, testMode, returnHref]);

  const pick = useCallback(async (p: Pass, searchedNick: string) => {
    setPicked({ id: String(p.id), name: p.name, price: p.price });
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
  }, [code, testMode]);

  return (
    <div className="wbi-root" ref={root}>
      <style>{CSS}</style>

      <div className="wbi-bgfx"><div className="wbi-blob wbi-b1" /><div className="wbi-blob wbi-b2" /></div>

      <div className="wbi-wrap">
        {/* top bar */}
        <div className="wbi-top">
          <div>
            <div className="wbi-eye">WILDBERRIES × ROBLOXBANK</div>
            <div style={{ fontSize: 13, color: "#fff", marginTop: 2 }}>Инструкция</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="wbi-tag">Номинал {nomDefault} R$</div>
            {onReset && (
              <button className="wbi-reset" onClick={onReset}>‹ Новый код</button>
            )}
          </div>
        </div>

        {/* hero */}
        <div className="wbi-hero wbi-reveal">
          <div className="wbi-kick">ПОЛУЧИ СВОИ ROBUX</div>
          <h1 className="wbi-h1">Это <span className="wbi-g">проще</span><br />чем кажется</h1>
          <p className="wbi-lead">Всего 9 шагов. Всё в браузере, ничего скачивать не нужно.</p>
          <div className="wbi-chips">
            <div className="wbi-chip"><b>5–7 мин</b><span>ВРЕМЯ</span></div>
            <div className="wbi-chip"><b>Легко</b><span>СЛОЖНОСТЬ</span></div>
            <div className="wbi-chip"><b>0 ₽</b><span>КОМИССИЯ</span></div>
          </div>
          <div className="wbi-must">
            <div className="wbi-must-h">✅ ВСЁ ПРОЩЕ, ЧЕМ РАНЬШЕ</div>
            <div className="wbi-must-it"><span className="wbi-n">1</span><span>Главное — создать геймпасс и поставить <b>точную цену</b> (посчитаем её ниже). Остального делать не нужно.</span></div>
            <div className="wbi-must-ft">Просто проверь, что переключатель <b>«Managed pricing»</b> (региональные цены) <b>выключен</b> — у новых геймпассов он выключен по умолчанию (шаг 7).</div>
          </div>
        </div>

        {/* timeline */}
        <div className="wbi-tl">

          <Step n="1">
            <div className="wbi-cols wbi-media">
              <div><div className="wbi-ttl">Открой Creator Hub</div>
                <p className="wbi-t">Это официальный сайт Roblox — где создаётся геймпасс. Кнопка ведёт прямо в нужный раздел.</p>
                <p className="wbi-s" style={{ marginTop: 6 }}>💡 Лучше открыть в обычном браузере (Safari / Chrome), где ты уже вошёл в свой аккаунт Roblox. Если открылось внутри Telegram/ВК и просит вход — нажми «⋯» вверху → «Открыть в браузере».</p>
                <p className="wbi-s" style={{ marginTop: 6 }}>📱 Можно создать геймпасс и прямо в приложении Roblox — скоро добавим пошаговую инструкцию.</p></div>
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
              <li><b>Item for sale</b> уже включён — трогать не нужно.</li>
              <li>Скопируй цену ниже → вставь в поле <b>Price</b>.</li>
              <li>Нажми синюю <b>Save Changes</b>.</li>
            </ol>
            <div className="wbi-checknote">ℹ️ <b>«Managed pricing»</b> (региональные цены) на этой же вкладке оставь <b>выключенным</b> — по умолчанию так и есть.</div>
            <div className="wbi-calc">
              <div className="wbi-lbl">ЦЕНА ПАСА — ВСТАВЬ ЕЁ В ROBLOX</div>
              <div className="wbi-nomrow">Номинал твоей карты: <input className="wbi-input" type="number" min={1} inputMode="numeric" value={nom}
                onChange={(e) => setNom(Math.max(0, parseInt(e.target.value || "0", 10)))} /> R$</div>
              <div className="wbi-v wbi-copy" onClick={copy} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") copy(); }}>
                <span>{price}</span><span className="wbi-ci">{copied ? "✓" : "📋"}</span>
              </div>
              <div className="wbi-copyhint">{copied ? `✓ Скопировано: ${price}` : `Нажми → скопируется. Выстави эту цену, чтобы на руки пришло ${nom} R$`}</div>
            </div>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step6-sales.png" alt="Вкладка Sales: Price, Item for sale включён, Save Changes" loading="lazy" decoding="async" />
                {/* Item for sale already on */}
                <span className="wbi-tip g caret" style={{ left: "70%", top: "10.5%", fontSize: "clamp(8px,2.1cqw,12px)" }}>ВКЛ ✓</span>
                {/* Price field + live price over the example "1715" */}
                <span className="wbi-box g" style={{ left: "3.5%", top: "22.5%", width: "93%", height: "15.5%" }} />
                <span className="wbi-price6" style={{ left: "7.8%", top: "30.5%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{price}</span>
                <span className="wbi-tip g caret" style={{ left: "26%", top: "14.5%", fontSize: "clamp(8px,2.1cqw,12px)" }}>ТВОЯ ЦЕНА ↓</span>
                {/* Save Changes */}
                <span className="wbi-box g" style={{ left: "3.5%", top: "83.5%", width: "93%", height: "15%" }} />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "79%" }}>НАЖМИ — СОХРАНИТЬ</span>
              </span>
              <figcaption>В поле <b>Price</b> — твоя цена. <b>Item for sale</b> уже включён. Внизу нажми <b>Save Changes</b>.</figcaption>
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
            <div className="wbi-kbadge">🏁 ФИНИШ — ОФОРМЛЯЕМ ЗАКАЗ</div>
            <div className="wbi-ttl">Геймпасс готов — оформи заказ</div>
            <p className="wbi-t">🎉 Самое сложное позади! Впиши <b>ник аккаунта Roblox, на который придут робуксы</b> — мы сами найдём твой геймпасс и <b>оформим заказ</b>. Дальше всё в <b>боте</b> (Telegram или ВКонтакте — туда ты перейдёшь ниже): он сам выкупит пасс, там же статус заказа, уведомления и бонусы за отзыв.</p>
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
                  <div className="wbi-picked-h">{orderPlaced ? "✅ ЗАКАЗ ОФОРМЛЕН" : "⏳ ОФОРМЛЯЕМ ЗАКАЗ…"}</div>
                  <div className="wbi-picked-b"><b>{picked.name}</b> · {picked.price} R$</div>
                  <div className="wbi-shint" style={{ marginTop: 8 }}>
                    {orderPlaced
                      ? "Готово! Сейчас вернём тебя в бота — там статус заказа и уведомления. Если не открылось автоматически — нажми кнопку ниже 👇"
                      : "Оформляем твой заказ, подожди немного — затем сами вернём тебя в бота 👌"}
                  </div>
                  <button className="wbi-relink" onClick={() => { setPicked(null); setOrderPlaced(false); }}>Выбрать другой</button>
                </div>
              )}
            </div>}
          </Step>

          <Step n="9">
            <div className="wbi-cols wbi-media wbi-rev">
              <div><div className="wbi-ttl">Зачем нужен бот</div>
                <p className="wbi-t">Бот — это твой личный кабинет заказа. Тебе только нажимать кнопки:</p>
                <ul className="wbi-blist">
                  <li>🔔 <b>Статус заказа</b> — приняли → выкупаем → готово</li>
                  <li>{orderPlaced ? "✅ " : "✅ "}<b>{orderPlaced ? "Заказ уже оформлен" : "Подтвердить выкуп"}</b>{picked && !orderPlaced ? " — в один тап" : ""}</li>
                  <li>🎁 <b>Бонус</b> за короткий отзыв</li>
                </ul>
                <div className="wbi-directnote">💎 <b>Самое главное:</b> в боте можно <b>купить Robux напрямую</b> — без карты WB. Это <b>быстрее, дешевле и выгоднее</b>. Многие об этом не знают — попробуй!</div>
                <div className="wbi-warn">Не меняй цену и не удаляй геймпасс до сообщения «всё готово».</div></div>
              <div className="wbi-mcol"><div className="wbi-icoTile">🤖</div></div>
            </div>
          </Step>

        </div>

        {/* CTA */}
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
                : <>Номинал {nomDefault} R$ · цена пасса {calcPrice(nomDefault)} R$ · бот выкупит и пришлёт бонус за отзыв</>}</div>

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

          <div className="wbi-directcta">💎 В боте можно <b>купить Robux напрямую</b> — без карты WB, быстрее и выгоднее</div>

          {testMode && (
            <div className="wbi-s" style={{ marginTop: 8, color: "#f0a020" }}>testdev: кнопки Telegram/VK отключены — бот и админ-оповещения не дёргаются</div>
          )}
          <a className="wbi-support" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Остались вопросы? Написать живому менеджеру (не боту) →</a>
        </div>

        <div className="wbi-note">Инструкция оформлена для мобильных устройств. Если что-то не получается — пиши менеджеру выше.</div>
      </div>
    </div>
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
.wbi-root{--gold:#c9a84c;--gold2:#f0c040;--grn:#00d484;--bg:#05070f;--panel:#0a0d18;--line:#1c2740;--txt:#e7e9ee;--mut:#aab1c0;position:relative;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;min-height:100vh}
.wbi-root *{box-sizing:border-box}
.wbi-bgfx{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.wbi-blob{position:absolute;border-radius:50%;filter:blur(90px);opacity:.16}
.wbi-b1{width:520px;height:520px;background:#c9a84c;top:-160px;right:-140px;animation:wbi-drift1 22s ease-in-out infinite}
.wbi-b2{width:460px;height:460px;background:#0a6b6b;bottom:-180px;left:-160px;animation:wbi-drift2 26s ease-in-out infinite}
@keyframes wbi-drift1{50%{transform:translate(-40px,60px)}}
@keyframes wbi-drift2{50%{transform:translate(50px,-50px)}}
.wbi-wrap{position:relative;z-index:1;max-width:880px;margin:0 auto;padding:0 18px 70px}
.wbi-top{display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid rgba(201,168,76,.22);gap:12px;flex-wrap:wrap}
.wbi-eye{font-size:11px;letter-spacing:2.5px;color:var(--gold)}
.wbi-tag{font-size:13px;color:var(--gold2);border:1px solid rgba(201,168,76,.4);padding:4px 12px;border-radius:8px;background:rgba(201,168,76,.06);white-space:nowrap}
.wbi-reset{font-size:12px;color:var(--gold);background:transparent;border:1px solid rgba(201,168,76,.3);padding:5px 12px;border-radius:8px;cursor:pointer;transition:border-color .2s}
.wbi-reset:hover{border-color:rgba(201,168,76,.7)}
.wbi-hero{padding:40px 0 30px;text-align:center}
.wbi-kick{font-size:12px;letter-spacing:3px;color:rgba(0,212,132,.8);margin-bottom:14px}
.wbi-h1{font-size:clamp(34px,7vw,58px);font-weight:900;text-transform:uppercase;line-height:.95;letter-spacing:-.02em}
.wbi-g{background:linear-gradient(100deg,#c9a84c,#f7d574,#c9a84c);background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:wbi-shine 5s linear infinite}
@keyframes wbi-shine{to{background-position:200% center}}
.wbi-lead{color:var(--mut);font-size:18px;max-width:560px;margin:18px auto 0}
.wbi-chips{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px}
.wbi-chip{display:flex;flex-direction:column;align-items:center;gap:3px;border:1px solid var(--line);background:rgba(255,255,255,.02);border-radius:12px;padding:12px 18px;min-width:92px}
.wbi-chip b{color:var(--grn);font-size:16px}.wbi-chip span{font-size:10px;letter-spacing:1px;color:var(--mut)}
.wbi-must{max-width:560px;margin:24px auto 0;text-align:left;border:1px solid rgba(245,158,11,.45);background:radial-gradient(circle at 50% 0,rgba(245,158,11,.1),transparent 70%),#0b0d18;border-radius:16px;padding:18px 20px}
.wbi-must-h{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800;letter-spacing:1px;color:#fcd34d;margin-bottom:12px}
.wbi-must-it{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)}
.wbi-must-it .wbi-n{flex-shrink:0;width:26px;height:26px;border-radius:8px;background:rgba(245,158,11,.15);border:1px solid rgba(245,158,11,.5);color:#fcd34d;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.wbi-must-it b{color:#fff}.wbi-must-it span{font-size:16px;color:#e7d4a6;line-height:1.5}
.wbi-must-ft{font-size:12.5px;color:#bba26a;margin-top:10px;font-style:italic}
.wbi-tl{position:relative;margin-top:34px;padding-left:50px}
.wbi-tl::before{content:'';position:absolute;left:17px;top:8px;bottom:40px;width:2px;background:linear-gradient(180deg,rgba(201,168,76,.05),rgba(201,168,76,.55),rgba(0,212,132,.5),rgba(201,168,76,.05))}
.wbi-step{position:relative;margin-bottom:26px}
.wbi-dot{position:absolute;left:-50px;top:2px;width:36px;height:36px;border-radius:50%;background:#0d1120;border:2px solid rgba(201,168,76,.55);display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--gold2);font-size:15px;z-index:2}
.wbi-dot.wbi-pulse{animation:wbi-pulse 2.6s infinite}
@keyframes wbi-pulse{0%{box-shadow:0 0 0 0 rgba(240,192,64,.45)}70%{box-shadow:0 0 0 14px rgba(240,192,64,0)}100%{box-shadow:0 0 0 0 rgba(240,192,64,0)}}
.wbi-card{border:1px solid var(--line);background:linear-gradient(180deg,rgba(18,22,36,.85),rgba(10,13,24,.9));border-radius:16px;padding:22px;transition:transform .3s,border-color .3s,box-shadow .3s}
.wbi-card.wbi-key{border:1px solid rgba(201,168,76,.5);animation:wbi-glow 3.4s ease-in-out infinite}
@keyframes wbi-glow{0%,100%{box-shadow:0 0 0 1px rgba(201,168,76,.25),0 0 22px rgba(201,168,76,.08)}50%{box-shadow:0 0 0 1px rgba(201,168,76,.6),0 0 44px rgba(201,168,76,.2)}}
.wbi-kbadge{display:inline-block;background:linear-gradient(90deg,#c9a84c,#f7d574);color:#1a1405;font-size:11px;font-weight:800;letter-spacing:1px;padding:5px 12px;border-radius:20px;margin-bottom:14px}
/* Finish step — green "finish line" accent so it can't be missed when scrolling fast */
.wbi-card.wbi-finish{border:1px solid rgba(0,224,138,.6);animation:wbi-glow-fin 3s ease-in-out infinite}
@keyframes wbi-glow-fin{0%,100%{box-shadow:0 0 0 1px rgba(0,224,138,.3),0 0 26px rgba(0,224,138,.12)}50%{box-shadow:0 0 0 1px rgba(0,224,138,.72),0 0 54px rgba(0,224,138,.28)}}
.wbi-finish .wbi-kbadge{background:linear-gradient(90deg,#00e08a,#5ef0b0);color:#06210f}
.wbi-step:has(.wbi-finish) .wbi-dot.wbi-pulse{background:#00e08a;color:#06210f;animation:wbi-pulse-fin 2.6s infinite}
@keyframes wbi-pulse-fin{0%{box-shadow:0 0 0 0 rgba(0,224,138,.5)}70%{box-shadow:0 0 0 14px rgba(0,224,138,0)}100%{box-shadow:0 0 0 0 rgba(0,224,138,0)}}
.wbi-ttl{font-size:24px;font-weight:800;color:#fff;margin-bottom:6px}
.wbi-t{color:#c3c9d4;font-size:16.5px;margin:8px 0;line-height:1.65}
.wbi-card b,.wbi-card strong{color:#fff;font-weight:700}
.wbi-cols{display:grid;grid-template-columns:1fr;gap:20px;align-items:center;margin-top:6px}
@media(min-width:660px){.wbi-cols.wbi-media{grid-template-columns:1fr 360px}.wbi-cols.wbi-rev .wbi-mcol{order:-1}}
.wbi-mcol{display:flex;flex-direction:column;align-items:center}
.wbi-figure{width:100%;max-width:440px;margin:0}
.wbi-figure img{width:100%;border-radius:12px;border:1px solid #26314a;display:block;transition:transform .35s}
.wbi-figure:hover img{transform:scale(1.015)}
.wbi-figure.wbi-spot{position:relative;border-radius:12px}
.wbi-figure.wbi-spot::after{content:'';position:absolute;inset:-4px;border-radius:14px;border:2px solid rgba(0,212,132,0);animation:wbi-ring 2.8s ease-in-out infinite;pointer-events:none}
@keyframes wbi-ring{0%,100%{border-color:rgba(0,212,132,0)}50%{border-color:rgba(0,212,132,.55)}}
.wbi-figure video{width:100%;border-radius:12px;border:1px solid #26314a;display:block;background:#070b15}
.wbi-figure figcaption{font-size:15px;color:#d6dbe4;margin-top:10px;background:rgba(0,176,111,.08);border-left:3px solid var(--grn);padding:10px 14px;border-radius:0 8px 8px 0;line-height:1.5}
.wbi-shot{width:100%;max-width:660px;margin:18px auto 0}
.wbi-btnL{display:inline-block;background:linear-gradient(180deg,#2aa8e0,#1f8fc6);border:1px solid rgba(34,158,217,.8);box-shadow:0 5px 0 #14638c,0 10px 22px rgba(34,158,217,.32);color:#fff;font-weight:800;font-size:16px;padding:16px 26px;border-radius:12px;text-decoration:none;text-align:center;transition:transform .12s}
.wbi-btnL:active{transform:translateY(3px);box-shadow:0 2px 0 #14638c}
.wbi-url{text-align:center;font-size:12.5px;color:#71798c;margin-top:9px}
.wbi-ol{list-style:none;counter-reset:s;margin:8px 0;padding:0}
.wbi-ol li{counter-increment:s;position:relative;padding:10px 0 10px 44px;font-size:16.5px;line-height:1.5;border-bottom:1px solid rgba(255,255,255,.05)}
.wbi-ol li:last-child{border-bottom:0}
.wbi-ol li::before{content:counter(s);position:absolute;left:0;top:7px;width:27px;height:27px;border-radius:50%;background:rgba(201,168,76,.12);border:1px solid rgba(201,168,76,.5);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800}
.wbi-pill{display:inline-block;font-weight:800;color:#fff;background:#1d4ed8;padding:2px 11px;border-radius:7px}
.wbi-ok{font-size:15.5px;color:#8ff0bf;background:rgba(0,176,111,.1);padding:12px 15px;border-radius:10px;margin-top:14px;border:1px solid rgba(0,212,132,.25);line-height:1.5}
.wbi-warn{font-size:15.5px;color:#fcd34d;background:rgba(245,158,11,.09);padding:12px 15px;border-radius:10px;margin-top:10px;border:1px solid rgba(245,158,11,.25);line-height:1.5}
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
.wbi-copyhint{font-size:13.5px;color:#8ff0bf;margin-top:10px}
/* ── Annotation overlay layer (highlights/labels live in CSS, screenshots stay clean) ── */
.wbi-anno{position:relative;display:block;line-height:0;container-type:inline-size}
.wbi-anno img{display:block}
.wbi-figure:hover .wbi-anno img{transform:none}
.wbi-box{position:absolute;border:3px solid transparent;border-radius:11px;pointer-events:none;z-index:2}
.wbi-box.pill{border-radius:999px}
.wbi-box.g{border-color:#00e08a;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 0 16px rgba(0,224,138,.5)}
.wbi-box.y{border-color:#f2c14e;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 0 16px rgba(242,193,78,.45)}
.wbi-tip{position:absolute;transform:translate(-50%,-50%);z-index:3;pointer-events:none;line-height:1;font-weight:800;letter-spacing:.4px;white-space:nowrap;font-size:clamp(10px,2.7cqw,15px);padding:.42em .62em;border-radius:7px;box-shadow:0 3px 10px rgba(0,0,0,.35)}
.wbi-tip.g{background:#00c277;color:#06210f}
.wbi-tip.y{background:#f2c14e;color:#241a02}
.wbi-tip.caret{font-size:clamp(9px,2.4cqw,14px)}
.wbi-tip.caret::after{content:"";position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);border:5px solid transparent;border-top-color:#00c277;border-bottom:0}
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
.wbi-checknote{font-size:14px;color:#9aa1b0;line-height:1.5;padding:2px 4px}
.wbi-checknote b{color:#c3c9d4}
.wbi-search{margin-top:16px;transition:opacity .25s}
.wbi-search.locked{opacity:.55}
.wbi-locknote{font-size:14px;color:#fcd34d;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px;padding:11px 14px;margin-bottom:12px;line-height:1.45}
.wbi-sinput:disabled{cursor:not-allowed;opacity:.7}
.wbi-sbtn:disabled{cursor:not-allowed}
.wbi-srow{display:flex;gap:10px;flex-wrap:wrap}
.wbi-sinput{flex:1 1 180px;min-width:0;font-size:17px;background:#0d1424;border:1px solid rgba(201,168,76,.5);color:#fff;border-radius:11px;padding:14px}
.wbi-sinput:focus{outline:none;border-color:var(--gold2)}
.wbi-sinput::placeholder{color:#6b7280}
.wbi-sbtn{flex:0 0 auto;font-size:16px;font-weight:800;color:#06210f;background:linear-gradient(180deg,#00e08a,#00b46f);border:1px solid rgba(0,224,138,.6);border-radius:11px;padding:14px 22px;cursor:pointer;transition:transform .12s,opacity .2s;white-space:nowrap}
.wbi-sbtn:active{transform:translateY(1px)}
.wbi-sbtn:disabled{opacity:.6;cursor:default}
.wbi-shint{font-size:14px;color:var(--mut);margin-top:10px;line-height:1.5}
.wbi-gplist{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.wbi-gpcard{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--line);background:#0d1424;border-radius:12px;padding:12px 14px}
.wbi-gpcard.pick{cursor:pointer;border-color:rgba(0,224,138,.45);transition:transform .12s,border-color .2s,box-shadow .2s}
.wbi-gpcard.pick:hover{transform:translateY(-2px);border-color:#00e08a;box-shadow:0 0 0 1px #00e08a,0 8px 22px rgba(0,224,138,.18)}
.wbi-gpcard.dim{opacity:.85}
.wbi-gpthumb{width:54px;height:54px;border-radius:10px;flex-shrink:0;object-fit:cover;background:#070b15;border:1px solid #26314a}
.wbi-gpmeta{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.wbi-gpmeta b{color:#fff;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wbi-gpmeta span{color:var(--gold2);font-size:14px;font-weight:700}
.wbi-pickbadge{flex-shrink:0;font-size:13px;font-weight:800;color:#06210f;background:#00e08a;border-radius:999px;padding:6px 12px}
.wbi-picked{margin-top:14px;border:1px solid rgba(0,224,138,.5);background:radial-gradient(circle at 50% 0,rgba(0,224,138,.12),transparent 70%),#060f0b;border-radius:14px;padding:18px;text-align:center}
.wbi-picked-h{font-size:13px;font-weight:800;letter-spacing:1.5px;color:#8ff0bf}
.wbi-picked-b{font-size:21px;color:#fff;font-weight:800;margin-top:6px}
.wbi-relink{margin-top:14px;font-size:13px;color:var(--gold);background:transparent;border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:7px 14px;cursor:pointer}
.wbi-relink:hover{border-color:rgba(201,168,76,.7)}
.wbi-blist{list-style:none;margin:10px 0 4px;padding:0;display:flex;flex-direction:column;gap:10px}
.wbi-blist li{position:relative;padding:11px 14px;font-size:15.5px;line-height:1.5;color:#c3c9d4;border:1px solid var(--line);background:rgba(255,255,255,.02);border-radius:11px}
.wbi-blist li b{color:#fff}
.wbi-directnote{margin-top:14px;font-size:15px;line-height:1.55;color:#e7e9ee;border:1px solid rgba(0,224,138,.4);background:radial-gradient(circle at 0 0,rgba(0,224,138,.1),transparent 70%),#0a1410;border-radius:12px;padding:13px 15px}
.wbi-directnote b{color:#7df0b6}
.wbi-icoTile{width:100%;max-width:300px;aspect-ratio:16/10;border-radius:14px;border:1px solid var(--line);background:radial-gradient(circle at 50% 40%,rgba(201,168,76,.1),transparent 70%),#070b15;display:flex;align-items:center;justify-content:center;font-size:64px}
.wbi-cta{border:1px solid rgba(201,168,76,.45);background:radial-gradient(circle at 50% 0,rgba(201,168,76,.12),transparent 70%),#0a0d18;border-radius:18px;padding:26px;margin-top:30px;text-align:center}
.wbi-cta h3{font-size:19px;color:#fff}.wbi-cta .wbi-s{font-size:13px;color:var(--mut);margin-top:5px}
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
.wbi-support{display:inline-block;margin-top:22px;font-size:13px;color:var(--gold);text-decoration:none;border-bottom:1px solid rgba(201,168,76,.3)}
.wbi-note{font-size:12px;color:#5e6678;text-align:center;margin-top:26px;font-style:italic}
.wbi-reveal{opacity:0;transform:translateY(26px);transition:opacity .65s cubic-bezier(.2,.7,.2,1),transform .65s cubic-bezier(.2,.7,.2,1)}
.wbi-reveal.wbi-in{opacity:1;transform:none}
@media(max-width:480px){.wbi-tl{padding-left:42px}.wbi-dot{left:-42px;width:32px;height:32px}.wbi-tl::before{left:15px}}
@media (prefers-reduced-motion: reduce){
 .wbi-blob,.wbi-g,.wbi-dot.wbi-pulse,.wbi-card.wbi-key,.wbi-figure.wbi-spot::after{animation:none !important}
 .wbi-reveal{opacity:1 !important;transform:none !important}
}
`;
