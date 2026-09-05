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
 * В обычном сценарии название любое — оно ни на что не влияет.
 *
 * ── Короткий путь (сентябрь 2026) ──────────────────────────────────────────
 * В Creator Hub есть поиск, и он ведёт прямо на форму создания пасса. Поэтому
 * инструкция больше НЕ водит человека через «найди свою игру → ☰ → Monetization
 * → Passes → Create Pass»: вместо четырёх экранов один запрос `pass`. Старый
 * путь остался свёрнутым блоком на шаге 2 — он спасает тех, у кого в поиске
 * ярлыка нет (строка приходит из недавно открытого в Creations).
 *
 * ── Телефон и компьютер ────────────────────────────────────────────────────
 * Вход в Creator Hub на этих устройствах разный, поэтому шаги 1–4 показывают
 * разные кадры. Догадка приходит с сервера (`initialPlatform` из `User-Agent`),
 * уточняется в браузере и перекрывается переключателем. От платформы зависят
 * ТОЛЬКО подписи и картинки: цена, заказ и возврат в бота/на сайт — общие.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateTarget } from "@/lib/gamepass-plan";
import {
  platformFromBrowser,
  rememberPlatform,
  storedPlatform,
  type GuidePlatform,
} from "@/lib/device-platform";

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
  }, [src]);
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

/**
 * Сколько шагов занимает создание пасса. Нужно тем, кто рисует шаги ПОСЛЕ
 * инструкции (финиш на `/guide`) — чтобы нумерация не разъезжалась.
 */
export function guideStepCount(targets: CreateTarget[]): number {
  return targets.length > 1 ? 5 : 4;
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

/** Переключатель «Телефон / Компьютер». Выбор человека главнее любой догадки. */
function PlatformSwitch({ value, onChange }: { value: GuidePlatform; onChange: (p: GuidePlatform) => void }) {
  return (
    <div className="wbi-devbar wbi-reveal">
      <div className="wbi-seg" role="group" aria-label="Устройство, с которого создаёшь геймпасс">
        <button type="button" aria-pressed={value === "mobile"} onClick={() => onChange("mobile")}>📱 Телефон</button>
        <button type="button" aria-pressed={value === "pc"} onClick={() => onChange("pc")}>💻 Компьютер</button>
      </div>
      <span className="wbi-devhint">Показываем кадры под твоё устройство. Не то — переключи.</span>
    </div>
  );
}

/**
 * Старый путь до формы: он нужен, когда поиск не отдаёт «Create Pass».
 * Свёрнут, потому что у большинства ярлык работает и лишние четыре экрана
 * только путают.
 */
function LongWayFallback() {
  return (
    <details className="wbi-helper wbi-longway">
      <summary>Не нашёл «Create Pass» в поиске? Длинный путь</summary>
      <div className="wbi-helper-in">
        <p>Так было раньше и так работает всегда — просто дольше:</p>
        <ol className="wbi-ol">
          <li>Открой раздел <b>Creations</b> — там твоя игра, названа по твоему нику.</li>
          <li>Нажми на карточку игры, чтобы открыть её.</li>
          <li>Слева вверху <b>☰</b> → пролистай до <span className="wbi-pill">Monetization</span> → <span className="wbi-pill">Passes</span>.</li>
          <li>На странице Passes нажми синюю <b>Create Pass</b>.</li>
        </ol>
        <div className="wbi-thumbrow">
          <figure className="wbi-figure">
            <span className="wbi-anno">
              <img src="/guide/wb-step2-place.png" alt="Creations: нажми на свою игру" loading="lazy" decoding="async" />
              <span className="wbi-box g" style={{ left: "9.5%", top: "20%", width: "76%", height: "50.5%" }} />
            </span>
            <figcaption>Карточка твоей игры в <b>Creations</b>.</figcaption>
          </figure>
          <figure className="wbi-figure">
            <span className="wbi-anno">
              <img src="/guide/wb-step5-createbtn.png" alt="Страница Passes: синяя кнопка Create Pass" loading="lazy" decoding="async" />
              <span className="wbi-box g" style={{ left: "3.6%", top: "20.4%", width: "24%", height: "6.8%" }} />
            </span>
            <figcaption>Синяя <b>Create Pass</b> вверху страницы Passes.</figcaption>
          </figure>
        </div>
        <figure className="wbi-figure wbi-shot wbi-spot">
          <LazyVideo src="/guide/wb-step3-passesnav.mp4" poster="/guide/wb-step3-passesnav-poster.jpg" alt="☰ → Monetization → Passes" />
          <figcaption>☰ → <b>Monetization</b> → <b>Passes</b> — как на видео.</figcaption>
        </figure>
        <p>Дальше — тот же шаг 3: заполняешь форму и жмёшь <b>Create pass</b>.</p>
      </div>
    </details>
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
  /** Показывать подсказки про второй пасс (только когда их два). */
  mode?: "WB" | "SITE" | "BOT";
  /** Догадка сервера по `User-Agent`. Дальше уточняется в браузере. */
  initialPlatform?: GuidePlatform;
}

export default function GuideSteps({ targets, nomRow, mode = "WB", initialPlatform = "mobile" }: GuideStepsProps) {
  const pair = targets.length > 1;
  const first = targets[0];
  const second = targets[1];
  /** При паре пасс называется своей ценой — так его не перепутать ни здесь, ни в поиске. */
  const firstName = pair ? String(first.price) : null;

  const [platform, setPlatform] = useState<GuidePlatform>(initialPlatform);
  useEffect(() => {
    const chosen = storedPlatform();
    if (chosen) { setPlatform(chosen); return; }
    const guess = platformFromBrowser();
    if (guess) setPlatform(guess);
  }, []);
  const choose = useCallback((p: GuidePlatform) => { setPlatform(p); rememberPlatform(p); }, []);
  const isMob = platform === "mobile";

  return (
    <>
      <PlatformSwitch value={platform} onChange={choose} />

      {/* ── 1. Вход в Creator Hub ─────────────────────────────────────── */}
      <Step n="1">
        <div className="wbi-cols wbi-media wbi-intro-step">
          <div><div className="wbi-ttl">Открой Creator Hub</div>
            <p className="wbi-t">Это официальный раздел Roblox, где создаются геймпассы. Ты уже вошёл в свой аккаунт — логин вводить не придётся.</p>
            {isMob ? (
              <ol className="wbi-ol">
                <li>Открой приложение <b>Roblox</b>.</li>
                <li>Нажми <span className="wbi-pill">☰</span> слева вверху.</li>
                <li>Пролистай меню в самый низ → <span className="wbi-pill">Create</span>.</li>
              </ol>
            ) : (
              <ol className="wbi-ol">
                <li>Зайди на <b>roblox.com</b>.</li>
                <li>В верхнем меню нажми <span className="wbi-pill">Create</span> — между «Marketplace» и «Robux».</li>
                <li>Откроется <b>create.roblox.com</b> — это он и есть.</li>
              </ol>
            )}
            <div className="wbi-quicknotes">
              <span>✓ Можно и просто открыть ссылку справа — попадёшь туда же.</span>
              {/* Актуально только для WB-гейта: туда приходят из карточки внутри
                  мессенджера. На сайте страницу и так открывают в браузере. */}
              {mode === "WB" && isMob && <span>↗ Открылось внутри Telegram или VK? Нажми «⋯» → «Открыть в браузере».</span>}
            </div></div>
          <div className="wbi-mcol">
            <a className="wbi-btnL" href="https://create.roblox.com/dashboard/creations" target="_blank" rel="noopener noreferrer">🔗 Открыть Creator Hub</a>
            <div className="wbi-url">create.roblox.com/dashboard/creations</div>
          </div>
        </div>

        {isMob ? (
          <figure className="wbi-figure wbi-shot">
            <span className="wbi-anno">
              <img src="/guide/wb-m-menu.jpg" alt="Меню приложения Roblox: пункт Create внизу списка" loading="lazy" decoding="async" />
              <span className="wbi-box g pill" style={{ left: "2.5%", top: "85.4%", width: "34%", height: "5%" }} />
              <span className="wbi-tip g" style={{ left: "56%", top: "87.9%" }}>← НАЖМИ</span>
            </span>
            <figcaption>В приложении: <b>☰</b> → в самом низу меню <b>Create</b>.</figcaption>
          </figure>
        ) : (
          <>
            <figure className="wbi-figure wbi-wide wbi-spot">
              <LazyVideo src="/guide/wb-pc-create.mp4" poster="/guide/wb-pc-create-poster.jpg" alt="Клик по Create на roblox.com" />
              <figcaption><b>Как это выглядит целиком:</b> клик по <b>Create</b> → загружается Creator Hub.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-nav-zoom.jpg" alt="Верхнее меню roblox.com крупно: пункт Create" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "32%", top: "22%", width: "33.3%", height: "47%" }} />
                <span className="wbi-tip g" style={{ left: "11%", top: "45.5%" }}>НАЖМИ →</span>
              </span>
              <figcaption>Крупно: <b>Create</b> в верхнем меню roblox.com.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-nav-full.jpg" alt="roblox.com целиком: верхнее меню с пунктом Create" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "27.3%", top: "0.6%", width: "9.3%", height: "5.4%" }} />
                <span className="wbi-tip g" style={{ left: "44%", top: "3.2%" }}>← ЗДЕСЬ</span>
              </span>
              <figcaption>Та же кнопка на всей странице — <b>вверху по центру</b>.</figcaption>
            </figure>
          </>
        )}
      </Step>

      {/* ── 2. Ярлык: поиск ведёт прямо на форму ──────────────────────── */}
      <Step n="2">
        <div className="wbi-cols wbi-media wbi-rev">
          <div><div className="wbi-ttl">Найди «Create Pass» через поиск</div>
            <p className="wbi-t">Искать свою игру и лазить по меню не нужно. Поиск в Creator Hub отведёт прямо на форму создания:</p>
            <ol className="wbi-ol">
              <li>Нажми <span className="wbi-pill">🔍</span> справа вверху — рядом с колокольчиком.</li>
              <li>Напиши <span className="wbi-pill">pass</span>.</li>
              <li>В разделе <b>Hub</b> нажми первую строку — <b>Create Pass</b>.</li>
            </ol>
            <div className="wbi-ok">✓ Строка подписана твоим ником — значит, пасс создастся в твоей игре. Выбирать её отдельно не нужно.</div>
            {pair && <div className="wbi-ok">📌 Запомни этот путь: пассов нужно два, и сюда ты вернёшься за вторым.</div>}
            <LongWayFallback />
          </div>
          <div className="wbi-mcol">
            {isMob ? (
              <figure className="wbi-figure wbi-spot">
                <LazyVideo src="/guide/wb-m-search.mp4" poster="/guide/wb-m-search-poster.jpg" alt="Поиск в Creator Hub: pass → Create Pass" />
                <figcaption>Целиком: <b>🔍</b> → <b>pass</b> → <b>Create Pass</b> → форма.</figcaption>
              </figure>
            ) : null}
          </div>
        </div>

        {isMob ? (
          <div className="wbi-thumbrow">
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src="/guide/wb-m-hub.jpg" alt="Creator Hub на телефоне: иконка поиска в шапке" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "59.4%", top: "9%", width: "8%", height: "4%" }} />
                <span className="wbi-tip g" style={{ left: "62%", top: "15.4%" }}>↑ ЛУПА</span>
              </span>
              <figcaption>Лупа — <b>справа вверху</b>, между заголовком и колокольчиком.</figcaption>
            </figure>
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src="/guide/wb-m-results.jpg" alt="Поиск Creator Hub: набрано Pass, первая строка Create Pass" loading="lazy" decoding="async" />
                <span className="wbi-box g nodot" style={{ left: "2%", top: "15.2%", width: "96%", height: "5%" }} />
                <span className="wbi-tip g caret" style={{ left: "32%", top: "12%" }}>НАПИШИ: PASS</span>
                <span className="wbi-box g" style={{ left: "2.5%", top: "25.2%", width: "93%", height: "5.6%" }} />
                <span className="wbi-tip g caret" style={{ left: "78%", top: "23%" }}>ЖМИ</span>
              </span>
              <figcaption>Верхняя рамка — что напечатать. Нижняя — что нажать: <b>Create Pass</b> под заголовком <b>Hub</b>.</figcaption>
            </figure>
          </div>
        ) : (
          <>
            <figure className="wbi-figure wbi-wide wbi-spot">
              <LazyVideo src="/guide/wb-pc-search.mp4" poster="/guide/wb-pc-search-poster.jpg" alt="Поиск в Creator Hub на компьютере" />
              <figcaption><b>Как это выглядит целиком:</b> <b>🔍</b> → <b>pass</b> → <b>Create Pass</b> → форма.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-hub-zoom.jpg" alt="Шапка Creator Hub крупно: иконка поиска" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "35.2%", top: "13%", width: "27.5%", height: "69%" }} />
                <span className="wbi-tip g" style={{ left: "13%", top: "47%" }}>НАЖМИ →</span>
              </span>
              <figcaption>Крупно: <b>лупа</b> в шапке Creator Hub, левее колокольчика.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-hub-full.jpg" alt="Creator Hub целиком: иконка поиска справа вверху" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "88.4%", top: "1.9%", width: "3.6%", height: "6.4%" }} />
                <span className="wbi-tip g" style={{ left: "78%", top: "9.5%" }}>↑ ЛУПА ЗДЕСЬ</span>
              </span>
              <figcaption>Она же на всей странице — <b>правый верхний угол</b>.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-results.jpg" alt="Поиск Creator Hub на компьютере: набрано pass, первая строка Create Pass" loading="lazy" decoding="async" />
                <span className="wbi-box g nodot" style={{ left: "27.1%", top: "8%", width: "45.8%", height: "4.1%" }} />
                <span className="wbi-tip g" style={{ left: "81%", top: "10.1%" }}>← НАПИШИ: PASS</span>
                <span className="wbi-box g" style={{ left: "27.1%", top: "17%", width: "45.8%", height: "5.2%" }} />
                <span className="wbi-tip g" style={{ left: "81%", top: "19.5%" }}>← ЭТО НАЖМИ</span>
              </span>
              <figcaption>Верхняя рамка — что напечатать. Нижняя — <b>Create Pass</b> в разделе <b>Hub</b>.</figcaption>
            </figure>
          </>
        )}
      </Step>

      {/* ── 3. Форма: имя и Create pass ───────────────────────────────── */}
      <Step n="3">
        <div className="wbi-ttl">{firstName ? <>Назови пасс <b>{firstName}</b></> : "Заполни форму пасса"}</div>
        <p className="wbi-t">{firstName
          ? <>Название — это <b>подсказка самому себе</b>: впиши в него ту цену, которую поставишь на следующем шаге. Тогда пассы не перепутаются — ни у тебя, ни у нас.</>
          : <>Откроется форма <b>Create a Pass</b>. Название <b>любое</b> — оно ни на что не влияет, мы находим пасс по цене и твоему нику.</>}</p>
        <ol className="wbi-ol">
          <li>{firstName ? <>В поле <b>Name</b> напиши <b>{firstName}</b>.</> : <>В поле <b>Name</b> напиши <b>любое название</b> (например «VIP» или «Pop»).</>}</li>
          <li>Картинку, описание и категорию заполнять <b>не нужно</b>.</li>
          <li>Внизу нажми синюю кнопку <b>Create pass</b>.</li>
        </ol>
        <div className="wbi-ok">✓ Кнопка серая, пока поле пустое. Впишешь название — станет активной.</div>

        {isMob ? (
          <figure className="wbi-figure wbi-shot">
            <span className="wbi-anno">
              <img src="/guide/wb-m-form.jpg" alt="Форма Create a Pass: поле Name и кнопка Create pass" loading="lazy" decoding="async" />
              <span className="wbi-box g nodot" style={{ left: "3.5%", top: "35.2%", width: "92%", height: "5.3%" }} />
              <span className="wbi-tip g caret" style={{ left: "50%", top: "31.6%" }}>{firstName ? `НАЗВАНИЕ: ${firstName}` : "ЛЮБОЕ НАЗВАНИЕ"}</span>
              <span className="wbi-box g" style={{ left: "3.5%", top: "90.7%", width: "92%", height: "5.6%" }} />
              <span className="wbi-tip g caret" style={{ left: "50%", top: "87.2%" }}>СОЗДАТЬ</span>
            </span>
            <figcaption>Одно поле — <b>Name</b>. Остальное пропускай и жми <b>Create pass</b>.</figcaption>
          </figure>
        ) : (
          <>
            <figure className="wbi-figure wbi-wide wbi-spot">
              <LazyVideo src="/guide/wb-pc-form.mp4" poster="/guide/wb-pc-form-poster.jpg" alt="Заполнение формы Create a Pass" />
              <figcaption><b>Как это выглядит целиком:</b> вписать название → нажать <b>Create pass</b>.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-form.jpg" alt="Форма Create a Pass на компьютере: поле Name и кнопка Create pass" loading="lazy" decoding="async" />
                <span className="wbi-box g nodot" style={{ left: "28.1%", top: "51.5%", width: "70.1%", height: "5.1%" }} />
                <span className="wbi-tip g caret" style={{ left: "45%", top: "47.5%" }}>{firstName ? `НАЗВАНИЕ: ${firstName}` : "ЛЮБОЕ НАЗВАНИЕ"}</span>
                <span className="wbi-box g" style={{ left: "33.9%", top: "92.8%", width: "7.5%", height: "5.2%" }} />
                <span className="wbi-tip g" style={{ left: "49%", top: "95.4%" }}>← СОЗДАТЬ</span>
              </span>
              <figcaption>Одно поле — <b>Name</b>. Остальное пропускай и жми <b>Create pass</b> внизу.</figcaption>
            </figure>
          </>
        )}
      </Step>

      {/* ── 4. Цена: без неё пасс не выкупить ─────────────────────────── */}
      <Step n="4" cls="wbi-key">
        <div className="wbi-ttl">{pair ? <>Цена первого пасса: <b>{first.price}</b></> : "Впиши цену и сохрани"}</div>
        <p className="wbi-t">Пасс создан, но пока не продаётся — в списке у него написано <b>Offsale</b>. Открой его и задай цену:</p>
        <ol className="wbi-ol">
          <li>Нажми на <b>новый пасс</b> — он внизу списка.</li>
          {isMob
            ? <li>Слева вверху <span className="wbi-pill">☰</span> → выбери <span className="wbi-pill">Sales</span>.</li>
            : <li>В меню слева выбери <span className="wbi-pill">Sales</span>.</li>}
          <li>Включи <b>Item for sale</b> — без этого нельзя вписать цену.</li>
          <li>Скопируй цену ниже → вставь в поле <b>Price</b>.</li>
          <li>Убедись, что <b>Managed pricing</b> — <b>ОТКЛЮЧЁН</b>.</li>
          <li>Нажми синюю <b>Save Changes</b>.</li>
        </ol>
        <div className="wbi-checknote" style={{ background: "rgba(255,60,60,0.12)", borderColor: "#ff4444" }}>⚠️ <b>ВАЖНО: «Managed pricing»</b> (региональные цены) должен быть <b>ОТКЛЮЧЁН</b>. Если он включён — Roblox автоматически изменит цену и мы <b>не сможем</b> выкупить геймпасс, пока ты не исправишь. По умолчанию он отключён, но обязательно проверь!</div>
        {nomRow}
        <PriceCard target={first} badge={pair ? "ПАСС А · 1 ИЗ 2" : undefined} />

        {isMob ? (
          <>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step7-menu.png" alt="Боковое меню пасса: выбери Sales" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "18.5%", top: "29.6%", width: "23%", height: "6%" }} />
                <span className="wbi-tip g" style={{ left: "54%", top: "32.4%" }}>← ВЫБЕРИ</span>
              </span>
              <figcaption>В боковом меню пасса выбери <b>Sales</b> (обведено).</figcaption>
            </figure>
            <figure className="wbi-figure wbi-shot">
              <span className="wbi-anno">
                <img src="/guide/wb-step6-sales.png" alt="Вкладка Sales: Price, Item for sale, Managed pricing отключён, Save Changes" loading="lazy" decoding="async" />
                <span className="wbi-tip g caret" style={{ left: "78%", top: "12%" }}>ВКЛЮЧИ ✓</span>
                <span className="wbi-box g nodot" style={{ left: "3.5%", top: "24%", width: "93%", height: "15%" }} />
                <span className="wbi-price6" style={{ left: "7.8%", top: "30%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{first.price}</span>
                <span className="wbi-tip g caret" style={{ left: "26%", top: "17%" }}>ТВОЯ ЦЕНА ↓</span>
                <span className="wbi-box" style={{ left: "3.5%", top: "42%", width: "93%", height: "9%", borderColor: "#ff4444" }} />
                <span className="wbi-tip r caret" style={{ left: "72%", top: "44%" }}>⚠️ ОТКЛЮЧЁН ✓</span>
                <span className="wbi-box g" style={{ left: "3.5%", top: "85%", width: "93%", height: "13%" }} />
                <span className="wbi-tip g caret" style={{ left: "50%", top: "81%" }}>НАЖМИ — СОХРАНИТЬ</span>
              </span>
              <figcaption>Включи <b>Item for sale</b>. В поле <b>Price</b> — твоя цена. <b>Managed pricing — ОТКЛЮЧЁН</b>. Внизу нажми <b>Save Changes</b>.</figcaption>
            </figure>
          </>
        ) : (
          <>
            <figure className="wbi-figure wbi-wide wbi-spot">
              <LazyVideo src="/guide/wb-pc-sales.mp4" poster="/guide/wb-pc-sales-poster.jpg" alt="Выбор пасса, вкладка Sales, цена и сохранение" />
              <figcaption><b>Как это выглядит целиком:</b> нажать на пасс → <b>Sales</b> → <b>Item for sale</b> → цена → <b>Save Changes</b>.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-passes.jpg" alt="Список Passes: новый пасс внизу со статусом Offsale" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "28.2%", top: "82.4%", width: "70.1%", height: "7.4%" }} />
                <span className="wbi-tip g caret" style={{ left: "45%", top: "78.6%" }}>← ТВОЙ НОВЫЙ ПАСС</span>
              </span>
              <figcaption>Новый пасс — <b>внизу списка</b>, в колонке цены у него <b>Offsale</b>.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-passmenu.jpg" alt="Страница пасса: в меню слева пункт Sales" loading="lazy" decoding="async" />
                <span className="wbi-box g" style={{ left: "13.4%", top: "20%", width: "17.3%", height: "4.2%" }} />
                <span className="wbi-tip g" style={{ left: "38%", top: "22.1%" }}>← ВЫБЕРИ</span>
              </span>
              <figcaption>Открылись <b>Settings</b> пасса — в меню слева выбери <b>Sales</b>.</figcaption>
            </figure>
            <figure className="wbi-figure wbi-wide">
              <span className="wbi-anno">
                <img src="/guide/wb-pc-salestab.jpg" alt="Вкладка Sales на компьютере: Item for sale, Price, Managed pricing, Save Changes" loading="lazy" decoding="async" />
                <span className="wbi-box g pill" style={{ left: "64.7%", top: "14.6%", width: "3.4%", height: "5.4%" }} />
                <span className="wbi-tip g" style={{ left: "84%", top: "17.1%" }}>ВКЛЮЧИ ✓</span>
                <span className="wbi-box g nodot" style={{ left: "33.3%", top: "20.3%", width: "39.4%", height: "5.4%" }} />
                <span className="wbi-price6" style={{ left: "35.4%", top: "23.1%", fontSize: "1.9cqw", background: "#0e0e10", padding: "0.2em 1.4em 0.2em 0.45em" }}>{first.price}</span>
                <span className="wbi-tip g" style={{ left: "84%", top: "23.2%" }}>ТВОЯ ЦЕНА</span>
                <span className="wbi-box" style={{ left: "33.3%", top: "26.8%", width: "39.4%", height: "6%", borderColor: "#ff4444" }} />
                <span className="wbi-tip r" style={{ left: "84%", top: "29.8%" }}>⚠️ ОТКЛЮЧЁН</span>
                <span className="wbi-box g" style={{ left: "39.3%", top: "45.7%", width: "8.5%", height: "5.4%" }} />
                <span className="wbi-tip g caret" style={{ left: "43.5%", top: "41.8%" }}>НАЖМИ — СОХРАНИТЬ</span>
              </span>
              <figcaption><b>Item for sale</b> включён, в <b>Price</b> — твоя цена, <b>Managed pricing</b> отключён, внизу <b>Save Changes</b>.</figcaption>
            </figure>
          </>
        )}
        {pair && <div className="wbi-ok">✅ Первый пасс готов. Осталось повторить то же самое для второго — он короче, всё уже знакомо.</div>}
      </Step>

      {/* ── 5. Второй пасс: только у пары ─────────────────────────────── */}
      {pair && second && (
        <Step n="5" cls="wbi-key">
          <div className="wbi-ttl">Второй пасс: <b>{second.price}</b></div>
          <p className="wbi-t">Всё то же самое, что ты уже сделал, только цена другая. И искать снова ничего не надо — тем же поиском:</p>
          <div className="wbi-mini">
            <div className="wbi-mini-i"><div className="k">Ещё раз</div><div className="v"><b>🔍</b> → <b>pass</b> → <b>Create Pass</b> — как на шаге 2.</div></div>
            <div className="wbi-mini-i"><div className="k">Название</div><div className="v">Напиши <b>{second.price}</b> → <b>Create pass</b>.</div></div>
            <div className="wbi-mini-i"><div className="k">Открой пасс</div><div className="v">Новый пасс → {isMob ? <><b>☰</b> → </> : <>меню слева → </>}<b>Sales</b>.</div></div>
            <div className="wbi-mini-i"><div className="k">Цена</div><div className="v"><b>Item for sale</b> ✓, цена <b>{second.price}</b>, <b>Save Changes</b>.</div></div>
          </div>
          <PriceCard target={second} badge="ПАСС Б · 2 ИЗ 2" tone="b" />
          <div className="wbi-warn">⚠️ Ставь <b>{second.price}</b>, а не {first.price}. Если у обоих пассов будет одна цена, выкупить получится только половину заказа.</div>
          <div className="wbi-thumbrow">
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src={isMob ? "/guide/wb-m-form.jpg" : "/guide/wb-pc-form.jpg"} alt="Форма создания второго пасса" loading="lazy" decoding="async" />
                {isMob ? (
                  <>
                    <span className="wbi-tip g caret" style={{ left: "50%", top: "31.6%" }}>НАЗВАНИЕ: {second.price}</span>
                    <span className="wbi-box g nodot" style={{ left: "3.5%", top: "35.2%", width: "92%", height: "5.3%" }} />
                  </>
                ) : (
                  <>
                    <span className="wbi-tip g caret" style={{ left: "45%", top: "47.5%" }}>НАЗВАНИЕ: {second.price}</span>
                    <span className="wbi-box g nodot" style={{ left: "28.1%", top: "51.5%", width: "70.1%", height: "5.1%" }} />
                  </>
                )}
              </span>
              <figcaption>Второй раз — то же окно, другое название.</figcaption>
            </figure>
            <figure className="wbi-figure">
              <span className="wbi-anno">
                <img src={isMob ? "/guide/wb-step6-sales.png" : "/guide/wb-pc-salestab.jpg"} alt="Вкладка Sales второго пасса" loading="lazy" decoding="async" />
                {isMob ? (
                  <>
                    <span className="wbi-box g nodot" style={{ left: "3.5%", top: "24%", width: "93%", height: "15%" }} />
                    <span className="wbi-price6" style={{ left: "7.8%", top: "30%", fontSize: "3.7cqw", background: "#131215", padding: "0.1em 1.1em 0.1em 0.3em" }}>{second.price}</span>
                    <span className="wbi-box" style={{ left: "3.5%", top: "42%", width: "93%", height: "9%", borderColor: "#ff4444" }} />
                    <span className="wbi-tip r caret" style={{ left: "72%", top: "44%" }}>⚠️ ОТКЛЮЧЁН ✓</span>
                  </>
                ) : (
                  <>
                    <span className="wbi-box g nodot" style={{ left: "33.3%", top: "20.3%", width: "39.4%", height: "5.4%" }} />
                    <span className="wbi-price6" style={{ left: "35.4%", top: "23.1%", fontSize: "1.9cqw", background: "#0e0e10", padding: "0.2em 1.4em 0.2em 0.45em" }}>{second.price}</span>
                    <span className="wbi-box" style={{ left: "33.3%", top: "26.8%", width: "39.4%", height: "6%", borderColor: "#ff4444" }} />
                    <span className="wbi-tip r" style={{ left: "84%", top: "29.8%" }}>⚠️ ОТКЛЮЧЁН</span>
                  </>
                )}
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
