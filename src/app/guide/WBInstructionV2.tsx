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
import { parseGamepassRef, parseGamepassUrl } from "@/lib/gamepass-id";
import { CUSTOM_MAX, CUSTOM_MIN } from "@/lib/retail-pricing";
import { GUIDE_CSS } from "./guide-css";
import GuideSteps, { Step } from "./guide-steps";

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
  /** Приходит только из прямого поиска по ссылке/ID — ник владельца геймпасса. */
  creatorName?: string;
}

type SearchView =
  | { kind: "idle" }
  | { kind: "user_not_found"; nick: string }
  | { kind: "no_gamepasses"; nick: string }
  | { kind: "wrong_price"; nick: string; passes: Pass[] }
  | { kind: "matches"; nick: string; passes: Pass[] };

/**
 * Превью геймпасса. Картинка живёт на CDN Roblox и меняется на каждый пасс, так
 * что `next/image` здесь не применим — превью рисует обычный `<img>`.
 * Отдельный компонент, чтобы это исключение было ровно одно на файл.
 */
function GpThumb({ src }: { src: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- remote Roblox CDN thumbnail
  return <img className="wbi-gpthumb" src={src} alt="" loading="lazy" />;
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
  const root = useReveal();

  const tgHref = code
    ? `https://t.me/RobloxBankBot?start=wb_${code}_${getOrInitSessionId()}`
    : "https://t.me/RobloxBankBot";

  // ── Step 7: live gamepass search by Roblox nick (one-tap handoff to bot) ──
  // WB is fixed by the activated card. SITE/BOT can edit the desired amount at
  // the calculation step, therefore their expected gamepass price follows `nom`.
  const expectedPrice = calcPrice(mode === "WB" ? nomDefault : nom);
  const [nick, setNick] = useState(initialUsername.trim().replace(/^@/, ""));
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [view, setView] = useState<SearchView>({ kind: "idle" });
  const [picked, setPicked] = useState<{ id: string; name: string; price: number } | null>(null);
  // Ник получателя, с которым заказ реально ушёл. При ручном вводе ссылки он
  // берётся у владельца геймпасса и может отличаться от набранного в поле.
  const [pickedNick, setPickedNick] = useState<string | null>(null);
  // Сервер отвечает 422 (цена/снят с продажи) — раньше эти ответы молча
  // терялись, и карточка навсегда застывала на «⏳ Оформляем твой заказ…».
  const [pickErr, setPickErr] = useState<string | null>(null);

  // ── Запасной вход: ссылка на геймпасс вместо поиска по нику ───────────────
  // Поиск живёт на публичных списках Roblox (`accessFilter=Public` + перебор
  // игр) и регулярно молчит при живом геймпассе: скрытый плейс (треть
  // застрявших заказов по разбору 22.08), только что созданный пасс, лаг API.
  // Ссылку на свой геймпасс покупатель при этом видит в браузере.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRef, setManualRef] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);
  const [manualPass, setManualPass] = useState<(Pass & { isPriceMatch: boolean }) | null>(null);

  const runManualLookup = useCallback(async (rawInput?: string) => {
    const raw = (rawInput ?? manualRef).trim();
    const id = parseGamepassRef(raw);
    setManualPass(null);
    if (!id) {
      setManualErr("Не похоже на ссылку или номер геймпасса. Скопируй адрес страницы геймпасса целиком — например roblox.com/game-pass/1234567.");
      return;
    }
    setManualErr(null);
    setManualBusy(true);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(id)}${code ? `&code=${encodeURIComponent(code)}` : ""}`);
      const data = await res.json();
      const gp = (data?.gamepasses ?? [])[0] as Pass | undefined;
      if (!data?.success || !gp) {
        setManualErr("Не нашли такой геймпасс на Roblox. Проверь, что ссылка ведёт на сам Game Pass (а не на игру) и что он опубликован.");
        return;
      }
      setManualPass({ ...gp, isPriceMatch: gamepassPriceMatches(gp.price, expectedPrice, isSite ? 0 : undefined) });
    } catch {
      setManualErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setManualBusy(false);
    }
  }, [manualRef, code, expectedPrice, isSite]);

  const runSearch = useCallback(async () => {
    const raw = nick.trim();
    // Вставили ссылку в поле ника — это не опечатка, а готовый ответ: у человека
    // уже есть всё, что нам нужно. Раньше это упиралось в «Ник Roblox: 3–20
    // символов», хотя рядом лежал прямой путь к заказу.
    if (parseGamepassUrl(raw)) {
      setSearchErr(null);
      setView({ kind: "idle" });
      setPicked(null);
      setPickErr(null);
      setManualOpen(true);
      setManualRef(raw);
      // Ссылка переезжает в своё поле целиком: два одинаковых инпута подряд
      // читаются как сбой, а поле ника должно остаться полем ника.
      setNick("");
      await runManualLookup(raw);
      return;
    }
    const n = raw.replace(/^@/, "");
    if (!NICK_RE.test(n)) {
      setSearchErr("Ник Roblox: 3–20 символов — латинские буквы, цифры или _. Или вставь сюда ссылку на геймпасс.");
      setView({ kind: "idle" });
      return;
    }
    setSearchErr(null);
    setPicked(null);
    setPickErr(null);
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
  }, [nick, expectedPrice, isSite, code, runManualLookup]);

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

  const pick = useCallback(async (p: Pass, searchedNick: string, opts: { manualLink?: boolean } = {}) => {
    // Робуксы уходят создателю геймпасса, поэтому при ручном вводе ссылки его
    // ник (пришёл вместе с пассом) точнее набранного в поле — им и оформляем.
    const creator = (p.creatorName ?? "").trim();
    const recipient = NICK_RE.test(creator) ? creator : searchedNick.trim().replace(/^@/, "");
    setPicked({ id: String(p.id), name: p.name, price: p.price });
    setPickedNick(NICK_RE.test(recipient) ? recipient : null);
    setPickErr(null);
    if (isSite) {
      // Оформление на сайте требует ник в ссылке на /checkout — без него
      // следующий экран не соберётся, честнее сказать об этом здесь.
      if (!NICK_RE.test(recipient)) {
        setPickErr("Не удалось определить ник владельца геймпасса. Впиши свой ник Roblox в поле выше и нажми «Найти».");
        setPicked(null);
      }
      return;
    }
    // Materialise the order on the server (promote provisional → PENDING + fire
    // the admin card). Advisory/idempotent — the bot one-tap stays a fallback.
    // Skipped in test/preview or without a code.
    if (!testMode && code) {
      try {
        const res = await fetch("/api/wb-code/select-gamepass", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            gamepassId: String(p.id),
            nick: NICK_RE.test(recipient) ? recipient : "",
            manualLink: opts.manualLink === true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data?.ordered || data?.alreadyOrdered)) {
          setOrderPlaced(true);
          return;
        }
        // Отказ сервера (цена, снят с продажи, ник не определён) больше не
        // прячется: без этого карточка навсегда зависала на «⏳ Оформляем…».
        setPickErr(
          typeof data?.error === "string" && data.error
            ? data.error
            : "Не удалось оформить заказ по этому геймпассу. Проверь цену и то, что он выставлен на продажу.",
        );
        setPicked(null);
      } catch {
        // Сеть отвалилась — заказ можно дооформить в боте, там тот же геймпасс.
        setPickErr("Не удалось связаться с сервером. Попробуй ещё раз — или пришли ссылку на геймпасс прямо в бот.");
        setPicked(null);
      }
    }
  }, [code, isSite, testMode]);

  return (
    <>
      {isSite && <Navbar />}
      <div className={`wbi-root wbi-v3${isSite ? " wbi-site-mode" : ""}`} ref={root}>
        <style>{GUIDE_CSS}</style>

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

          <GuideSteps
            targets={[{ price: expectedPrice, amount: mode === "WB" ? nomDefault : nom }]}
            mode={mode}
            nomRow={
              <div className="wbi-nomrow">{mode === "WB" ? "Номинал твоей карты" : "Сколько R$ ты получаешь"}:{mode === "WB" ? <strong> {nomDefault.toLocaleString("ru-RU")} R$</strong> : <><input className="wbi-input" type="number" min={CUSTOM_MIN} max={CUSTOM_MAX} inputMode="numeric" value={nom}
                onChange={(e) => { setNom(Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, parseInt(e.target.value || String(CUSTOM_MIN), 10)))); setPicked(null); setView({ kind: "idle" }); }} /> R$</>}</div>
            }
          />

          <Step n="8" pulse cls="wbi-key wbi-finish">
            {isReEntry && robloxUsername ? (
              <>
                <div className="wbi-kbadge" style={{ background: "linear-gradient(135deg,#1a7a3a,#2ecc71)" }}>✅ ЗАКАЗ ОФОРМЛЕН</div>
                <div className="wbi-ttl">Твой заказ в работе</div>
                <div className="wbi-picked" style={{ marginTop: 12 }}>
                  <div className="wbi-picked-h">🎮 Робуксы придут на ник:</div>
                  <div className="wbi-picked-b" style={{ fontSize: "1.3em" }}><b>{robloxUsername}</b></div>
                  {mode === "WB" && code && (
                    <div className="wbi-shint" style={{ marginTop: 8 }}>🔑 Заказ по коду <b>{code}</b></div>
                  )}
                  <div className="wbi-shint" style={{ marginTop: 8 }}>
                    Статус и уведомления — в боте. Не меняй цену и не удаляй геймпасс до сообщения «всё готово».
                  </div>
                  {/* Покупателю нескольких карточек надо сказать вслух, что этот
                      экран — про ОДИН заказ. Иначе «уже оформлено на такой-то
                      ник» читается как «остальные оформить нельзя» (кейс 21.08). */}
                  {mode === "WB" && (
                    <div className="wbi-shint" style={{ marginTop: 8 }}>
                      📦 Купили несколько карточек? Заказы независимы: у каждого <b>свой код и свой ник</b>.
                      Откройте ссылку из <b>того чата Wildberries</b>, где пришёл нужный код, и укажите ник там.
                    </div>
                  )}
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
                  placeholder="Ник Roblox или ссылка на геймпасс"
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  aria-label="Ник Roblox — аккаунт получателя робуксов, либо ссылка на геймпасс"
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
                  <br />Либо вставь <b>ссылку на сам геймпасс</b> — этого тоже достаточно 👇
                </div>
              )}

              {view.kind === "no_gamepasses" && (
                <div className="wbi-warn" style={{ marginTop: 12 }}>
                  🙈 У <b>{view.nick}</b> не нашли геймпассов на продажу.
                  <br /><br />✅ <b>Геймпасс уже создан?</b> Поиск иногда его не видит — например, когда плейс скрыт. Вставь <b>ссылку на геймпасс</b> ниже, и мы оформим заказ по ней 👇
                  <br /><br />⚠️ Ещё не создан — вернись к шагам <b>3–7</b>, затем нажми «Найти» снова.
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
                  <div className="wbi-shint">Нужен геймпасс ровно на <b>{expectedPrice} R$</b> — поправь цену (шаг <b>7</b>) и нажми «Найти» снова. Нужный геймпасс есть, но его нет в списке? Вставь <b>ссылку</b> на него ниже.</div>
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

              {/* ── Запасной вход: ссылка на геймпасс ──────────────────────
                  Раскрыт сам, когда поиск по нику зашёл в тупик; в остальное
                  время — тихая ссылка под результатами, чтобы не спорить с
                  основным сценарием. */}
              {!picked && (() => {
                const deadEnd = view.kind === "user_not_found" || view.kind === "no_gamepasses" || view.kind === "wrong_price";
                if (!manualOpen && !deadEnd) {
                  return (
                    <button className="wbi-manualtoggle" onClick={() => setManualOpen(true)}>
                      🔗 Не находит геймпасс? Вставить ссылку вручную
                    </button>
                  );
                }
                return (
                  <div className="wbi-manual">
                    <div className="wbi-manual-h">🔗 Ссылка на геймпасс</div>
                    <div className="wbi-shint" style={{ marginTop: 0 }}>
                      Открой геймпасс в браузере (Creator Hub → <b>Creations</b> → игра → <b>Passes</b> → нажми на пасс) и скопируй адрес.
                      Подойдёт и просто <b>номер</b> геймпасса.
                    </div>
                    <div className="wbi-srow" style={{ marginTop: 10 }}>
                      <input
                        className="wbi-sinput"
                        type="text"
                        placeholder="https://www.roblox.com/game-pass/…"
                        value={manualRef}
                        onChange={(e) => setManualRef(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") runManualLookup(); }}
                        autoCapitalize="off" autoCorrect="off" spellCheck={false}
                        aria-label="Ссылка на геймпасс или его номер"
                      />
                      <button className="wbi-sbtn" onClick={() => runManualLookup()} disabled={manualBusy}>
                        {manualBusy ? "Проверяем…" : "✓ Проверить"}
                      </button>
                    </div>

                    {manualErr && <div className="wbi-warn" style={{ marginTop: 10 }}>{manualErr}</div>}

                    {manualPass && (() => {
                      // Одна карточка на все три исхода — берётся она или нет,
                      // решают цена и «выставлен на продажу»; отказ объясняем
                      // словами, чтобы человек знал, что именно чинить.
                      const offsale = manualPass.isForSale === false;
                      const ready = !offsale && manualPass.isPriceMatch;
                      const thumb = <GpThumb src={manualPass.image} />;
                      const meta = <div className="wbi-gpmeta"><b>{manualPass.name}</b><span>{manualPass.price} R$</span></div>;
                      return (
                        <div style={{ marginTop: 10 }}>
                          {offsale && (
                            <div className="wbi-warn">
                              ⚠️ Геймпасс найден, но он <b>не выставлен на продажу</b>. Включи <b>Item for sale</b> (шаг <b>7</b>) и нажми «Проверить» снова.
                            </div>
                          )}
                          {!offsale && !manualPass.isPriceMatch && (
                            <div className="wbi-warn">
                              ⚠️ Цена геймпасса <b>{manualPass.price} R$</b>, а нужна ровно <b>{expectedPrice} R$</b>. Поправь цену (шаг <b>7</b>) и нажми «Проверить» снова.
                            </div>
                          )}
                          {ready && (
                            <div className="wbi-ok">🎯 Нашли геймпасс по ссылке{manualPass.creatorName ? <> — владелец <b>{manualPass.creatorName}</b></> : null}. Это он?</div>
                          )}
                          <div className="wbi-gplist">
                            {ready ? (
                              <button className="wbi-gpcard pick" onClick={() => pick(manualPass, manualPass.creatorName ?? nick.trim(), { manualLink: true })}>
                                {thumb}{meta}
                                <span className="wbi-pickbadge">Это мой ✓</span>
                              </button>
                            ) : (
                              <div className="wbi-gpcard dim">{thumb}{meta}</div>
                            )}
                          </div>
                          {ready && (
                            <div className="wbi-shint">💡 Робуксы придут на аккаунт <b>владельца этого геймпасса</b> — проверь, что это твой аккаунт.</div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {pickErr && <div className="wbi-warn" style={{ marginTop: 12 }}>{pickErr}</div>}

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
                  <button className="wbi-relink" onClick={() => { setPicked(null); setPickedNick(null); setPickErr(null); setManualPass(null); setOrderPlaced(false); }}>Выбрать другой</button>
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
                href={`/checkout?amount=${nom}&username=${encodeURIComponent(pickedNick ?? nick.trim().replace(/^@/, ""))}&gamepassId=${encodeURIComponent(picked.id)}`}
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

