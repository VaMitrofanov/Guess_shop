"use client";

/**
 * Шаги создания геймпасса — единственный экземпляр инструкции.
 *
 * Читают его обе поверхности: пошаговая страница `/guide` (там дальше идут свои
 * шаги «найди пасс» и «зачем бот») и проверка аккаунта `GamepassCheck`, которая
 * показывает эти же шаги ТОЛЬКО на недостающие пассы. Тексты, скриншоты и
 * разметка живут здесь, чтобы «как создать пасс» не разъехалось между экранами.
 *
 * `targets` — что именно надо создать (цена + сколько придёт на руки). Один
 * элемент — обычный сценарий; два — номинал, который выдаётся парой пассов
 * (`SPLIT_PLANS`). При паре пасс называется своей ценой: название совпадает с
 * числом, которое надо вставить в Price, и его же видно в результатах поиска.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateTarget } from "@/lib/gamepass-plan";

// ─── Lazy, on-screen-only video ────────────────────────────────────────────────
export function LazyVideo({ src, poster, alt }: { src: string; poster: string; alt?: string }) {
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

export function Step({ n, pulse, cls, children }: { n: string; pulse?: boolean; cls?: string; children: React.ReactNode }) {
  return (
    <div className="wbi-step wbi-reveal">
      <div className={`wbi-dot${pulse ? " wbi-pulse" : ""}`}>{n}</div>
      <div className={`wbi-card${cls ? " " + cls : ""}`}>{children}</div>
    </div>
  );
}

/** Копируемая цена — единственное, что человек переносит в Roblox руками. */
function PriceCard({ target, badge, tone }: { target: CreateTarget; badge?: string; tone?: "b" }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    try { navigator.clipboard?.writeText(String(target.price)); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [target.price]);
  return (
    <div className={`wbi-calc${tone === "b" ? " wbi-calc-b" : ""}`}>
      {badge && <div className="wbi-calc-badge">{badge}</div>}
      <div className="wbi-lbl">ЦЕНА ПАССА — ВСТАВЬ ЕЁ В ROBLOX</div>
      <div className="wbi-v wbi-copy" onClick={copy} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") copy(); }}>
        <span>{target.price}</span><span className="wbi-ci">{copied ? "✓" : "📋"}</span>
      </div>
      <div className="wbi-copyhint">
        {copied
          ? `✓ Скопировано: ${target.price}`
          : `Нажми → скопируется. С этой цены на руки придёт ${target.amount.toLocaleString("ru-RU")} R$`}
      </div>
    </div>
  );
}

export interface GuideStepsProps {
  /** Что нужно создать. Один элемент — обычный пасс, два — пара под номинал 2000. */
  targets: CreateTarget[];
  /**
   * Строка «сколько робуксов ты получаешь» над ценой. На пошаговой странице там
   * живёт редактируемая сумма, в проверке аккаунта — фиксированный номинал.
   */
  nomRow?: React.ReactNode;
  /** Показывать подсказки про второй пасс на шагах 3–4 (только когда их два). */
  mode?: "WB" | "SITE" | "BOT";
}

export default function GuideSteps({ targets, nomRow, mode = "WB" }: GuideStepsProps) {
  const pair = targets.length > 1;
  const first = targets[0];
  const second = targets[1];
  /** При паре пасс называется своей ценой — так его не перепутать ни здесь, ни в поиске. */
  const firstName = pair ? String(first.price) : null;

  return (
    <>
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
            </ol>
            {pair && <div className="wbi-ok">📌 Эту страницу держи под рукой: пассов нужно два, и сюда ты вернёшься за вторым.</div>}
          </div>
          <div className="wbi-mcol"><figure className="wbi-figure wbi-spot"><LazyVideo src="/guide/wb-step3-passesnav.mp4" poster="/guide/wb-step3-passesnav-poster.jpg" alt="☰ → Monetization → Passes" /><figcaption>☰ → <b>Monetization</b> → <b>Passes</b> — как на видео.</figcaption></figure></div>
        </div>
      </Step>

      <Step n="4">
        <div className="wbi-ttl">Нажми «Create Pass»</div>
        <p className="wbi-t">На странице <b>Passes</b> нажми синюю кнопку <b>Create Pass</b> (вверху слева) — откроется форма создания.</p>
        {pair && <p className="wbi-t">Сейчас делаем <b>первый</b> пасс из двух. Второй — предпоследним шагом, той же кнопкой.</p>}
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
        <div className="wbi-ttl">{firstName ? <>Назови пасс <b>{firstName}</b></> : "Заполни форму пасса"}</div>
        <p className="wbi-t">{firstName
          ? <>Название — это <b>подсказка самому себе</b>: впиши в него ту цену, которую поставишь на следующем шаге. Тогда пассы не перепутаются — ни у тебя, ни у нас.</>
          : "Откроется форма создания. Заполни её:"}</p>
        <ol className="wbi-ol">
          <li>{firstName ? <>В поле названия напиши <b>{firstName}</b>.</> : <>Напиши <b>любое название</b> (например «VIP» или «Pop»).</>}</li>
          <li>Картинку и описание добавлять <b>не нужно</b>.</li>
          <li>Нажми синюю кнопку <b>Create pass</b> внизу.</li>
        </ol>
        <figure className="wbi-figure wbi-shot">
          <span className="wbi-anno">
            <img src="/guide/wb-step5-create.png" alt="Форма создания пасса: название и кнопка Create pass" loading="lazy" decoding="async" />
            <span className="wbi-tip g caret" style={{ left: "50%", top: "16.5%" }}>{firstName ? `НАЗВАНИЕ: ${firstName}` : "ЛЮБОЕ НАЗВАНИЕ"}</span>
            <span className="wbi-box g" style={{ left: "4.5%", top: "21.3%", width: "91%", height: "11.4%" }} />
            <span className="wbi-tip g caret" style={{ left: "50%", top: "83%" }}>НАЖМИ — СОЗДАТЬ</span>
            <span className="wbi-box g" style={{ left: "3.8%", top: "88.2%", width: "92.5%", height: "10%" }} />
          </span>
          <figcaption>{firstName ? <>В названии — <b>{firstName}</b> (верхняя рамка)</> : <>Напиши <b>любое название</b> (верхняя рамка)</>} → нажми синюю <b>Create pass</b> внизу.</figcaption>
        </figure>
      </Step>

      <Step n="6">
        <div className="wbi-ttl">Открой пасс → ☰ → Sales</div>
        <p className="wbi-t">После создания ты вернёшься в список <b>Passes</b>. Чтобы задать цену:</p>
        <ol className="wbi-ol">
          <li>{firstName ? <>Нажми на пасс <b>{firstName}</b> — он внизу списка.</> : <>Нажми на свой <b>новый пасс</b> (он внизу списка).</>}</li>
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
        <div className="wbi-ttl">{pair ? <>Цена первого пасса: <b>{first.price}</b></> : "Впиши цену и сохрани"}</div>
        <p className="wbi-t">Ты на вкладке <b>Sales</b>. Дальше:</p>
        <ol className="wbi-ol">
          <li>Включи <b>Item for sale</b> — без этого нельзя вписать цену.</li>
          <li>Скопируй цену ниже → вставь в поле <b>Price</b>.</li>
          <li>Убедись, что <b>Managed pricing</b> — <b>ОТКЛЮЧЁН</b> (переключатель ниже на этой же вкладке).</li>
          <li>Нажми синюю <b>Save Changes</b>.</li>
        </ol>
        <div className="wbi-checknote" style={{ background: "rgba(255,60,60,0.12)", borderColor: "#ff4444" }}>⚠️ <b>ВАЖНО: «Managed pricing»</b> (региональные цены) должен быть <b>ОТКЛЮЧЁН</b>. Если он включён — Roblox автоматически изменит цену и мы <b>не сможем</b> выкупить геймпасс, пока ты не исправишь. По умолчанию он отключён, но обязательно проверь!</div>
        {nomRow}
        <PriceCard target={first} badge={pair ? "ПАСС А · 1 ИЗ 2" : undefined} />
        <figure className="wbi-figure wbi-shot">
          <span className="wbi-anno">
            <img src="/guide/wb-step6-sales.png" alt="Вкладка Sales: Price, Item for sale, Managed pricing отключён, Save Changes" loading="lazy" decoding="async" />
            {/* Item for sale — user must turn it ON */}
            <span className="wbi-tip g caret" style={{ left: "78%", top: "12%" }}>ВКЛЮЧИ ✓</span>
            {/* Price field + live price */}
            <span className="wbi-box g" style={{ left: "3.5%", top: "24%", width: "93%", height: "15%" }} />
            <span className="wbi-price6" style={{ left: "7.8%", top: "30%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{first.price}</span>
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
        {pair && <div className="wbi-ok">✅ Первый пасс готов. Осталось повторить то же самое для второго — он короче, всё уже знакомо.</div>}
      </Step>

      {pair && second && (
        <Step n="8" cls="wbi-key">
          <div className="wbi-ttl">Второй пасс: <b>{second.price}</b></div>
          <p className="wbi-t">Всё то же самое, что ты уже сделал, только цена другая. Вернись на страницу <b>Passes</b> своей игры — и по кругу:</p>
          <div className="wbi-mini">
            <div className="wbi-mini-i"><div className="k">Ещё раз</div><div className="v">Нажми <b>Create Pass</b> — как на шаге 4.</div></div>
            <div className="wbi-mini-i"><div className="k">Название</div><div className="v">Напиши <b>{second.price}</b> → <b>Create pass</b>.</div></div>
            <div className="wbi-mini-i"><div className="k">Открой пасс</div><div className="v">Новый пасс → <b>☰</b> → <b>Sales</b>.</div></div>
            <div className="wbi-mini-i"><div className="k">Цена</div><div className="v"><b>Item for sale</b> ✓, цена <b>{second.price}</b>, <b>Save Changes</b>.</div></div>
          </div>
          <PriceCard target={second} badge="ПАСС Б · 2 ИЗ 2" tone="b" />
          <div className="wbi-warn">⚠️ Ставь <b>{second.price}</b>, а не {first.price}. Если у обоих пассов будет одна цена, выкупить получится только половину заказа.</div>
          <div className="wbi-thumbrow">
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src="/guide/wb-step5-create.png" alt="Форма создания второго пасса" loading="lazy" decoding="async" />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "16.5%" }}>НАЗВАНИЕ: {second.price}</span>
                <span className="wbi-box g" style={{ left: "4.5%", top: "21.3%", width: "91%", height: "11.4%" }} />
              </span>
              <figcaption>Второй раз — то же окно, другое название.</figcaption>
            </figure>
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src="/guide/wb-step6-sales.png" alt="Вкладка Sales второго пасса" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "3.5%", top: "24%", width: "93%", height: "15%" }} />
                <span className="wbi-price6" style={{ left: "7.8%", top: "30%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{second.price}</span>
                <span className="wbi-box" style={{ left: "3.5%", top: "42%", width: "93%", height: "9%", borderColor: "#ff4444" }} />
                <span className="wbi-tip r caret" style={{ left: "72%", top: "44%" }}>⚠️ ОТКЛЮЧЁН ✓</span>
              </span>
              <figcaption>Цена <b>{second.price}</b>, <b>Managed pricing</b> снова отключён.</figcaption>
            </figure>
          </div>
          <div className="wbi-ok">✅ Теперь у тебя два пасса: <b>{first.price}</b> и <b>{second.price}</b>. Дальше — проверка.</div>
        </Step>
      )}
    </>
  );
}
