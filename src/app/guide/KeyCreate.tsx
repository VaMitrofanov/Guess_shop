"use client";

/**
 * «Сделаем пасс за тебя» — ветка инструкции V2 по Open Cloud ключу.
 *
 * Зачем: половина застрявших заказов — это «пасса нет» (28 из 54 в живой
 * диагностике). Ключ решает ровно этот случай: покупатель выпускает его в
 * Creator Hub, вставляет сюда, а пасс нужной цены создаётся сам и сразу встаёт
 * в продажу. Скрытый плейс этим НЕ лечится — там нужна публикация игры.
 *
 * Кадры сняты с экрана владельца 06.09.2026 (`public/guide/wb-key-*`), рамки
 * расставлены по замерам, а не на глаз. Ползунок Experience Restrictions
 * намеренно НЕ обведён: обведённое жмут не читая, а он только всё усложняет.
 *
 * Ключ уходит на наш роут и дальше транзитом на SG-мост. С 06.09.2026 он
 * ХРАНИТСЯ (решение владельца): зашифрованным, чтобы чинить созданный пасс без
 * покупателя и создавать пасс сразу на следующем заказе. Текст поля обязан это
 * говорить — обещание «нигде не сохраняется» перестало быть правдой.
 * Метод живёт под флагом `GAMEPASS_AUTOCREATE` (см. gamepass-autocreate-flag).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GUIDE_PLATFORM_KEY,
  platformFromBrowser,
  rememberPlatform,
  storedPlatform,
  type GuidePlatform,
} from "@/lib/device-platform";
import type { CreateTarget, OwnedPass } from "@/lib/gamepass-plan";
import { keyCreateSuccessText, keyCreateVerdict } from "@/lib/gamepass-create-messages";

/** Шагов выпуска ключа — столько же, сколько экранов у Roblox на этом пути. */
const KEY_STEPS = 5;
/** Анимация проверки: ответ приходит быстрее, чем читается строка. */
const SCAN_MIN_MS = 2200;
const SCAN_STEP_MS = 750;

interface CreatedPass { gamePassId: number; priceInRobux: number; name?: string }

export interface KeyCreateProps {
  /** Что нужно создать: одна цена — один пасс, две — пара под номинал 2000. */
  targets: CreateTarget[];
  /** Ник аккаунта — по нему мост находит опыт, на котором создавать пасс. */
  nick: string;
  /** Код WB: по нему сервер вешает след создания на заказ (события + заметка). */
  code?: string;
  /** Догадка сервера «телефон или компьютер» — только для кадров. */
  initialPlatform?: GuidePlatform;
  /** Созданные пассы уходят в план заказа — дальше человек жмёт «Подтвердить». */
  onCreated: (passes: OwnedPass[]) => void;
}

export default function KeyCreate({ targets, nick, code, initialPlatform = "mobile", onCreated }: KeyCreateProps) {
  const [platform, setPlatform] = useState<GuidePlatform>(initialPlatform);
  useEffect(() => {
    const chosen = storedPlatform();
    if (chosen) { setPlatform(chosen); return; }
    const guess = platformFromBrowser();
    if (guess) setPlatform(guess);
  }, []);
  // Выбор устройства общий с пошаговой инструкцией: ключ GUIDE_PLATFORM_KEY один.
  const choose = useCallback((p: GuidePlatform) => { setPlatform(p); rememberPlatform(p); }, []);
  const isMob = platform === "mobile";

  /** Текущий шаг выпуска ключа. `KEY_STEPS` — сколько их всего. */
  const [kstep, setKstep] = useState(0);
  /** Человек дошёл до поля: шаги свёрнуты, на экране только ввод. */
  const [atField, setAtField] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [scanStep, setScanStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPass[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const prices = targets.map((t) => t.price);

  const run = useCallback(async () => {
    const key = apiKey.trim();
    if (!key) {
      setError("bad_key");
      setPhase("done");
      return;
    }
    setError(null);
    setCreated([]);
    setPhase("scanning");
    setScanStep(0);
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setScanStep(1), SCAN_STEP_MS),
      setTimeout(() => setScanStep(2), SCAN_STEP_MS * 2),
    ];

    const started = Date.now();
    try {
      const res = await fetch("/api/roblox/gamepass-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, nick, code, targets: prices }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; created?: CreatedPass[] }
        | null;
      await new Promise((r) => setTimeout(r, Math.max(0, SCAN_MIN_MS - (Date.now() - started))));

      if (data?.ok && Array.isArray(data.created) && data.created.length > 0) {
        // Ключ больше не нужен — стираем его из поля сразу после удачи.
        setApiKey("");
        setCreated(data.created);
        setPhase("done");
        onCreated(
          data.created.map((p) => ({
            gamepassId: String(p.gamePassId),
            name: p.name || `Пасс ${p.priceInRobux}`,
            price: p.priceInRobux,
            isForSale: true,
          })),
        );
        return;
      }
      setError(data?.error ?? "roblox_error");
      setPhase("done");
    } catch {
      setError("network");
      setPhase("done");
    }
  }, [apiKey, nick, code, prices, onCreated]);

  const verdict = error ? keyCreateVerdict(error) : null;
  /** Всё создано: план уже пересчитан, форма и шаги больше не нужны. */
  const finished = created.length > 0 && targets.length === 0;
  const scanLines = [
    <>Проверяем ключ в Roblox</>,
    <>Ищем игру аккаунта <b>{nick}</b></>,
    <>Создаём {prices.length > 1 ? "пассы" : "пасс"} на {prices.join(" и ")} R$</>,
  ];

  return (
    <section className="wbi-keyzone">
      <span className="k">{finished ? "✅ ГЕЙМПАСС ГОТОВ" : "🔑 СДЕЛАЕМ ЗА ТЕБЯ"}</span>
      <h3>{finished ? "Сделали за тебя" : "Пришли ключ — остальное на нас"}</h3>
      {!finished && (
      <p>
        Нужен один ключ из Roblox — это <b>минута</b>. Ты его выпускаешь, мы создаём геймпасс
        нужной цены сами. <b>Пароль от Roblox не нужен</b> и никогда не понадобится: ключ умеет
        ровно одно — создавать геймпассы на твоём аккаунте, и живёт час.
      </p>
      )}

      {!finished && !atField && (
      <div className="wbi-keysteps">
        <div className="wbi-helper-in">
          <div className="wbi-devbar">
            <div className="wbi-seg" role="group" aria-label="Устройство, с которого делаешь ключ">
              <button type="button" aria-pressed={isMob} onClick={() => choose("mobile")}>📱 Телефон</button>
              <button type="button" aria-pressed={!isMob} onClick={() => choose("pc")}>💻 Компьютер</button>
            </div>
            <span className="wbi-devhint">Кадры под твоё устройство. Не то — переключи.</span>
          </div>

          <div className="wbi-progress">
            <span className="k">Шаг {kstep + 1} из {KEY_STEPS}</span>
            <span className="d">{Array.from({ length: KEY_STEPS }, (_, i) => (
              <i key={i} className={i < kstep ? "done" : i === kstep ? "on" : ""} />
            ))}</span>
          </div>

          <div className="wbi-keyol">
            {/* 1. Вход в Creator Hub */}
            {kstep === 0 && (
            <div className="wbi-keystep">
              <b>{isMob ? "Открой Create в приложении Roblox" : "Зайди в Create на roblox.com"}</b>
              <p className="wbi-t">
                {isMob
                  ? <>Три полоски внизу справа → пролистай меню вниз → <span className="wbi-pill">Create</span>.</>
                  : <>Верхнее меню сайта, пункт <span className="wbi-pill">Create</span> — он открывает Creator Hub.</>}
              </p>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-menu.jpg" : "/guide/wb-key-pc-open.jpg"}
                    alt={isMob ? "Меню приложения Roblox: пункт Create" : "Верхнее меню roblox.com: пункт Create"}
                    loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "5%", top: "81.5%", width: "25%", height: "6.3%" }} />
                    : <span className="wbi-box g" style={{ left: "29.3%", top: "3.5%", width: "5.5%", height: "8.5%" }} />}
                </span>
                <figcaption>
                  {isMob
                    ? <>Пункт <b>Create</b> — под «Learn», перед «Switch Accounts».</>
                    : <>Дальше всё происходит в Creator Hub.</>}
                </figcaption>
              </figure>
            </div>
            )}

            {/* 2. Поиск → API Extensions */}
            {kstep === 1 && (
            <div className="wbi-keystep">
              <b>Нажми лупу и напиши «api»</b>
              <p className="wbi-t">
                В поиске набери <span className="wbi-pill">api</span> и выбери первый пункт —{" "}
                <span className="wbi-pill">API Extensions</span>. Другого пути к этой странице нет:
                в боковом меню её не найти.
              </p>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-hub.jpg" : "/guide/wb-key-pc-hub.jpg"}
                    alt="Creator Hub: иконка поиска" loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "61%", top: "35%", width: "6%", height: "7%" }} />
                    : <span className="wbi-box g" style={{ left: "88.8%", top: "4.5%", width: "3.2%", height: "5.5%" }} />}
                </span>
                <figcaption>Лупа — вверху справа, рядом с колокольчиком.</figcaption>
              </figure>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-search.jpg" : "/guide/wb-key-pc-search.jpg"}
                    alt="Поиск Creator Hub: первая строка API Extensions" loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "3%", top: "59%", width: "36%", height: "14%" }} />
                    : <span className="wbi-box g" style={{ left: "6.2%", top: "22.5%", width: "26%", height: "9.5%" }} />}
                </span>
                <figcaption>Первая строка в разделе <b>Hub</b>.</figcaption>
              </figure>
            </div>
            )}

            {/* 3. Create API Key + имя */}
            {kstep === 2 && (
            <div className="wbi-keystep">
              <b>Синяя кнопка Create API Key</b>
              <p className="wbi-t">
                Дальше — имя ключа: поле <b>обязательное</b>, но что писать — неважно, хоть{" "}
                <span className="wbi-pill">1</span>. На работу ключа имя не влияет.
              </p>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-createkey.jpg" : "/guide/wb-key-pc-createkey.jpg"}
                    alt="Страница API Keys: кнопка Create API Key" loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "27.5%", top: "87.5%", width: "41%", height: "5.5%" }} />
                    : <span className="wbi-box g" style={{ left: "50.7%", top: "63.6%", width: "10.8%", height: "4.3%" }} />}
                </span>
                <figcaption>Ключей у тебя пока нет — так и должно быть.</figcaption>
              </figure>
              {isMob && (
                <figure className="wbi-figure">
                  <span className="wbi-anno">
                    <img src="/guide/wb-key-m-name.jpg" alt="Поле имени ключа" loading="lazy" decoding="async" />
                  </span>
                  <figcaption>Имя <b>обязательное</b>, но любое — на работу ключа оно не влияет.</figcaption>
                </figure>
              )}
            </div>
            )}

            {/* 4. game-passes + read/write */}
            {kstep === 3 && (
            <div className="wbi-keystep">
              <b>Выбери game-passes и включи ему две операции</b>
              <p className="wbi-t">
                В поле <span className="wbi-pill">Select API System</span> напиши <b>pass</b> и выбери{" "}
                <span className="wbi-pill">game-passes</span>. Соседний <b>legacy-game-passes</b> не
                подойдёт — с ним ключ не может вообще ничего.
              </p>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-system.jpg" : "/guide/wb-key-pc-system.jpg"}
                    alt="Список API System: game-passes и legacy-game-passes" loading="lazy" decoding="async"
                  />
                  {isMob ? (
                    <>
                      <span className="wbi-box g" style={{ left: "11%", top: "20%", width: "34%", height: "8.5%" }} />
                      <span className="wbi-box r" style={{ left: "11%", top: "31.5%", width: "42%", height: "8.5%" }} />
                    </>
                  ) : (
                    <>
                      <span className="wbi-box g" style={{ left: "10.5%", top: "70%", width: "25%", height: "7%" }} />
                      <span className="wbi-box r" style={{ left: "10.5%", top: "77.4%", width: "25%", height: "7%" }} />
                    </>
                  )}
                </span>
                <figcaption>Верхний — нужный. Нижний, с приставкой <b>legacy</b>, — нет.</figcaption>
              </figure>
              {/* Самое неочевидное место всей ветки: после выбора системы права
                  НЕ появляются сами — их надо доставить в отдельном пустом поле,
                  которое выглядит просто как рамка со стрелочкой. Владелец на
                  приёмке 07.09.2026: «здесь надо подробнее, где именно вставлять
                  read и write». Поэтому — свой абзац, по шагам, с ориентирами
                  «где искать» отдельно для телефона и компьютера. */}
              <p className="wbi-t">
                Ниже появится блок с названием <span className="wbi-pill">game-passes</span> — прав у
                него пока нет, их надо добавить:
              </p>
              <ol className="wbi-ol">
                <li>
                  Найди <b>пустое поле со стрелочкой ▾</b>{" "}
                  {isMob ? <>— оно под названием <b>game-passes</b>, ниже ползунка</>
                         : <>— оно справа от названия <b>game-passes</b>, в той же строке</>}.
                </li>
                <li>Нажми на него — выпадет список из двух строк.</li>
                <li>
                  Отметь <b>обе</b>: <span className="wbi-pill">game-pass:read</span> и{" "}
                  <span className="wbi-pill">game-pass:write</span>. Первая разрешает смотреть, вторая —
                  создавать; без второй пасс не появится.
                </li>
              </ol>
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-ops.jpg" : "/guide/wb-key-pc-ops.jpg"}
                    alt="Поле операций ключа с добавленными game-pass:read и game-pass:write" loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "14%", top: "62%", width: "74%", height: "25%" }} />
                    : <span className="wbi-box g" style={{ left: "52.5%", top: "71.2%", width: "45%", height: "11.5%" }} />}
                </span>
                <figcaption>
                  <b>Так выглядит готово:</b> в рамке лежат две плашки — <b>game-pass:read</b> и{" "}
                  <b>game-pass:write</b>. Если рамка пустая — права не добавились, нажми на неё ещё раз.
                  Серый ползунок рядом трогать не нужно.
                </figcaption>
              </figure>
            </div>
            )}

            {/* 5. Save & Generate Key → Copy */}
            {kstep === 4 && (
            <div className="wbi-keystep">
              <b>Save &amp; Generate Key → Copy Key To Clipboard</b>
              <p className="wbi-t">
                Roblox спросит подтверждение — поставь галочку <b>I understand the security risks</b> и
                нажми синюю кнопку.
              </p>
              {isMob ? (
                <figure className="wbi-figure">
                  <span className="wbi-anno">
                    <img src="/guide/wb-key-m-warning.jpg" alt="Окно Important Security Warning с галочкой" loading="lazy" decoding="async" />
                    <span className="wbi-box g" style={{ left: "13%", top: "79.5%", width: "63%", height: "5%" }} />
                    <span className="wbi-box g" style={{ left: "40%", top: "87.8%", width: "53%", height: "7%" }} />
                  </span>
                  <figcaption>Без галочки кнопка не сработает.</figcaption>
                </figure>
              ) : (
                <figure className="wbi-figure">
                  <span className="wbi-anno">
                    <img src="/guide/wb-key-pc-save.jpg" alt="Кнопка Save and Generate Key" loading="lazy" decoding="async" />
                    <span className="wbi-box g" style={{ left: "79.7%", top: "50%", width: "17.2%", height: "31%" }} />
                  </span>
                  <figcaption>
                    Кнопка в правом верхнем углу формы. После неё Roblox покажет окно{" "}
                    <b>Important Security Warning</b> — там нужна галочка <b>I understand the security risks</b>.
                  </figcaption>
                </figure>
              )}
              <figure className="wbi-figure">
                <span className="wbi-anno">
                  <img
                    src={isMob ? "/guide/wb-key-m-copy.jpg" : "/guide/wb-key-pc-copy.jpg"}
                    alt="Готовый ключ и кнопка Copy Key To Clipboard" loading="lazy" decoding="async"
                  />
                  {isMob
                    ? <span className="wbi-box g" style={{ left: "8%", top: "86.2%", width: "48%", height: "7.5%" }} />
                    : <span className="wbi-box g" style={{ left: "79%", top: "11.8%", width: "17%", height: "11%" }} />}
                </span>
                <figcaption>
                  Жми <b>Copy Key To Clipboard</b> и сразу возвращайся сюда: ключ живёт час, а повторное{" "}
                  <b>Save &amp; Generate Key</b> убивает уже скопированный.
                </figcaption>
              </figure>
            </div>
            )}
          </div>

          <div className="wbi-stepnav">
            <div className="wbi-stepnav-row">
              {kstep > 0 && (
                <button type="button" className="wbi-ghostbtn" onClick={() => setKstep((s) => s - 1)}>← Назад</button>
              )}
              <button
                type="button"
                className="wbi-bigbtn"
                onClick={() => (kstep < KEY_STEPS - 1 ? setKstep((s) => s + 1) : setAtField(true))}
              >
                {kstep < KEY_STEPS - 1 ? "Дальше →" : "Ключ у меня →"}
              </button>
            </div>
            <button type="button" className="wbi-peek" onClick={() => setAtField(true)}>
              Ключ уже есть — сразу к полю
            </button>
          </div>
        </div>
      </div>
      )}

      {/* ── Поле ключа ───────────────────────────────────────────────── */}
      {!finished && atField && (
      <div className="wbi-keyfield">
        <label htmlFor="rb-apikey">Вставь ключ сюда</label>
        <p className="wbi-keyhint">
          Создадим {prices.length > 1 ? "два пасса" : "пасс"} на <b>{prices.join(" и ")} R$</b> и сразу
          поставим {prices.length > 1 ? "их" : "его"} в продажу. Ключ хранится у нас
          зашифрованным — чтобы поправить геймпасс без тебя и сделать всё сразу в следующий раз.
          Доступа к аккаунту он не даёт.
        </p>
        <textarea
          id="rb-apikey"
          className="wbi-sinput wbi-keyinput"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Длинная строка из букв и цифр"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={3}
        />
        <button className="wbi-bigcheck" onClick={run} disabled={phase === "scanning"}>
          {phase === "scanning" ? "Создаём…" : `🔑 Создать ${prices.length > 1 ? "пассы" : "пасс"} по ключу`}
        </button>
        <button type="button" className="wbi-peek" onClick={() => { setAtField(false); setKstep(0); }}>
          Показать шаги ещё раз
        </button>
      </div>
      )}

      {/* ── Анимация проверки ────────────────────────────────────────── */}
      {phase === "scanning" && (
        <div className="wbi-scan">
          <div className="wbi-scan-h">
            <span className="wbi-ava lg spin" aria-hidden="true">🔑</span>
            <div>
              <div className="t">Проверяем ключ…</div>
              <div className="s">Обычно это пара секунд.</div>
            </div>
          </div>
          <div className="wbi-scanlines">
            {scanLines.map((line, i) => (
              <div key={i} className={`wbi-scanline${scanStep >= i ? " on" : ""}${scanStep > i ? " done" : ""}`}>
                <span className="m">{scanStep > i ? "✓" : i + 1}</span><span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Вердикт ──────────────────────────────────────────────────── */}
      {phase === "done" && created.length > 0 && (
        <div className="wbi-ok">
          <b>Готово — {created.length > 1 ? "пассы созданы" : "пасс создан"}.</b>{" "}
          {keyCreateSuccessText(created.map((c) => c.priceInRobux))} Ничего больше делать не нужно —
          подтверди заказ выше.
        </div>
      )}
      {phase === "done" && verdict && (
        <>
          <div className="wbi-warn">
            <b>{verdict.title}.</b> {verdict.text}
          </div>
          {/* Ошибка называет шаг — кнопка ведёт ровно на него, а не в начало. */}
          {verdict.step !== undefined && (
            <button
              className="wbi-bigbtn"
              style={{ marginTop: 12 }}
              onClick={() => { setAtField(false); setKstep(verdict.step ?? 0); setPhase("idle"); setError(null); }}
            >
              {verdict.action ?? "Показать шаги ещё раз"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Ключ выбора устройства делим с пошаговой инструкцией — на случай рефакторинга. */
export const KEY_CREATE_PLATFORM_KEY = GUIDE_PLATFORM_KEY;
