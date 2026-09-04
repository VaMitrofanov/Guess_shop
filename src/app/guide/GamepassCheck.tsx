"use client";

/**
 * Проверка аккаунта перед инструкцией.
 *
 * Страница больше не начинается со слов «создай геймпасс». Она начинается с
 * ника: мы смотрим, что у покупателя уже выставлено, и в половине случаев на
 * этом всё и заканчивается — заказ собирается из готового. Инструкция
 * появляется ниже и ровно на то, чего не хватает (`targetsToCreate`).
 *
 * Кому этот экран показывается, решает `GuideClient`: WB-гейт, заказ из бота и
 * покупка на сайте. Тем, кто просто открыл «Инструкцию» из меню, по-прежнему
 * показывается пошаговая страница — там нечего проверять.
 *
 * Разбор «что делать с этим заказом» живёт в `@/lib/gamepass-plan` и общий с
 * сервером: тот же файл читает роут оформления, когда пишет разбивку.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import VKAuthButton from "@/components/auth/VKAuthButton";
import { ThemeToggle } from "@/components/theme-toggle";
import { getOrInitSessionId } from "@/lib/wb-session";
import { parseGamepassRef } from "@/lib/gamepass-id";
import {
  coveredRobux,
  idealTargetsFor,
  planFromOwned,
  targetsToCreate,
  type CheckPlan,
  type CreateTarget,
  type OwnedPass,
} from "@/lib/gamepass-plan";
import { GUIDE_CSS } from "./guide-css";
import GuideSteps from "./guide-steps";

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
const VK_RETURN_HREF = "https://vk.me/club237309399";
/** Анимация проверки не должна мигать: ответ приходит быстрее, чем читается строка. */
const SCAN_MIN_MS = 2000;

interface RobloxAccount { id: string; username: string; avatarUrl: string | null }

type Phase = "entry" | "scanning" | "result";

export default function GamepassCheck({
  mode,
  amount,
  code,
  initialUsername = "",
  testMode = false,
  onReset,
}: {
  mode: "WB" | "SITE" | "BOT";
  amount: number;
  code?: string;
  initialUsername?: string;
  testMode?: boolean;
  onReset?: () => void;
}) {
  const router = useRouter();
  const isSite = mode === "SITE";
  /** На сайте заказ несёт ОДИН `gamepassId` — набор из нескольких там был бы тупиком. */
  const planOptions = useMemo(
    () => (isSite ? { maxParts: 1, splitPlan: false } : {}),
    [isSite],
  );

  const [phase, setPhase] = useState<Phase>("entry");
  const [nick, setNick] = useState(initialUsername.trim().replace(/^@/, ""));
  const [touched, setTouched] = useState(false);
  const [account, setAccount] = useState<RobloxAccount | null>(null);
  const [owned, setOwned] = useState<OwnedPass[]>([]);
  const [plan, setPlan] = useState<CheckPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [peek, setPeek] = useState(false);

  const [manualRef, setManualRef] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [channel, setChannel] = useState<"TG" | "VK" | null>(null);

  const scanRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const tgHref = code
    ? `https://t.me/RobloxBankBot?start=wb_${code}_${getOrInitSessionId()}`
    : "https://t.me/RobloxBankBot";
  const returnHref = channel === "VK" ? (code ? `${VK_RETURN_HREF}?ref=${code}` : VK_RETURN_HREF) : tgHref;

  // Канал (TG/VK) и уже оформленный заказ — чтобы повторный вход на страницу не
  // предлагал оформить то, что оформлено, и вёл в тот мессенджер, где человек уже есть.
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
        if (["PENDING", "IN_PROGRESS", "COMPLETED"].includes(d.orderStatus)) setOrderPlaced(true);
        if (d.robloxUsername && !initialUsername) setNick(String(d.robloxUsername));
      } catch { /* не фатально: экран просто покажет обе кнопки */ }
    })();
    return () => { alive = false; };
  }, [code, testMode, initialUsername]);

  const replan = useCallback((passes: OwnedPass[]) => {
    setOwned(passes);
    setPlan(planFromOwned(amount, passes, planOptions));
  }, [amount, planOptions]);

  const runCheck = useCallback(async (rawNick?: string) => {
    const value = (rawNick ?? nick).trim().replace(/^@/, "");
    if (!NICK_RE.test(value)) {
      setError("Ник Roblox: 3–20 символов — латинские буквы, цифры или _. Это не отображаемое имя с пробелами.");
      setPhase("entry");
      return;
    }
    setError(null);
    setConfirmErr(null);
    setNick(value);
    setPhase("scanning");
    setScanStep(0);
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setScanStep(1), 700),
      setTimeout(() => setScanStep(2), 1400),
    ];
    // Экран уводится на анимацию: кнопка стоит выше, и без прокрутки человек не
    // видит, что вообще что-то происходит.
    requestAnimationFrame(() => scanRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    const started = Date.now();
    try {
      const res = await fetch(
        `/api/roblox/gamepasses?query=${encodeURIComponent(value)}${code ? `&code=${encodeURIComponent(code)}` : ""}`,
      );
      const data = await res.json();
      const wait = Math.max(0, SCAN_MIN_MS - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (!data?.success) {
        setError("Проверка временно недоступна — попробуй ещё раз через минуту.");
        setPhase("entry");
        return;
      }
      if (data.userExists === false) {
        setAccount(null);
        replan([]);
        setError(`Пользователя ${value} нет на Roblox. Скорее всего опечатка — скопируй ник прямо со страницы профиля.`);
        setPhase("entry");
        return;
      }
      setAccount(data.account ?? { id: "", username: data.detectedUsername ?? value, avatarUrl: null });
      replan(((data.gamepasses ?? []) as Array<Record<string, unknown>>).map(toOwned));
      setPhase("result");
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
      setPhase("entry");
    }
  }, [nick, code, replan]);

  /** Запасной вход: пасс есть, но поиск по нику его не видит (скрытый плейс, свежий пасс). */
  const runManual = useCallback(async () => {
    const id = parseGamepassRef(manualRef.trim());
    if (!id) {
      setManualErr("Не похоже на ссылку или номер геймпасса. Скопируй адрес страницы пасса целиком.");
      return;
    }
    setManualErr(null);
    setManualBusy(true);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(id)}${code ? `&code=${encodeURIComponent(code)}` : ""}`);
      const data = await res.json();
      const gp = (data?.gamepasses ?? [])[0] as Record<string, unknown> | undefined;
      if (!data?.success || !gp) {
        setManualErr("Не нашли такой геймпасс. Проверь, что ссылка ведёт на сам Game Pass, а не на игру.");
        return;
      }
      const pass = toOwned(gp);
      const next = [...owned.filter((p) => p.gamepassId !== pass.gamepassId), pass];
      replan(next);
      if (!account && typeof gp.creatorName === "string" && NICK_RE.test(gp.creatorName)) {
        setNick(gp.creatorName);
        setAccount({ id: "", username: gp.creatorName, avatarUrl: null });
      }
      setManualRef("");
      setPhase("result");
    } catch {
      setManualErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setManualBusy(false);
    }
  }, [manualRef, code, owned, account, replan]);

  const confirm = useCallback(async () => {
    if (!plan || (plan.kind !== "ready" && plan.kind !== "assembled")) return;
    const parts = plan.parts;
    const recipient = account?.username ?? nick;
    if (isSite) {
      const params = new URLSearchParams({
        amount: String(amount),
        username: recipient,
        gamepassId: parts[0].gamepassId,
      });
      router.push(`/checkout?${params.toString()}`);
      return;
    }
    if (testMode || !code) { setOrderPlaced(true); return; }
    setConfirming(true);
    setConfirmErr(null);
    try {
      const res = await fetch("/api/wb-code/select-gamepass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          gamepassId: parts[0].gamepassId,
          nick: recipient,
          parts: parts.length > 1 ? parts.map((p) => ({ gamepassId: p.gamepassId, amount: p.amount })) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data?.ordered || data?.alreadyOrdered)) {
        setOrderPlaced(true);
        return;
      }
      setConfirmErr(typeof data?.error === "string" && data.error
        ? data.error
        : "Не удалось оформить заказ. Проверь цену пасса и что он выставлен на продажу.");
    } catch {
      setConfirmErr("Не удалось связаться с сервером. Попробуй ещё раз — или пришли ссылку на геймпасс прямо в бот.");
    } finally {
      setConfirming(false);
    }
  }, [plan, account, nick, isSite, amount, testMode, code, router]);

  const toCreate = plan ? targetsToCreate(plan) : [];
  const peekTargets: CreateTarget[] = useMemo(
    () => idealTargetsFor(amount, !isSite).map((net) => ({ amount: net, price: Math.ceil(net / 0.7) })),
    [amount, isSite],
  );
  const stepTargets = toCreate.length > 0 ? toCreate : peekTargets;
  const showSteps = toCreate.length > 0 || peek;

  return (
    <>
      {isSite && <Navbar />}
      <div className={`wbi-root wbi-v3${isSite ? " wbi-site-mode" : ""}`}>
        <style>{GUIDE_CSS}</style>
        <div className="wbi-bgfx"><div className="wbi-blob wbi-b1" /><div className="wbi-blob wbi-b2" /></div>

        <div className="wbi-wrap">
          <div className="wbi-top">
            <div>
              <div className="wbi-eye">{mode === "WB" ? "WILDBERRIES × ROBLOXBANK" : mode === "SITE" ? "ROBLOXBANK · ПОКУПКА НА САЙТЕ" : "ROBLOXBANK · ЗАКАЗ В БОТЕ"}</div>
              <div className="wbi-top-sub">Проверка аккаунта</div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="wbi-tag">{isSite ? "Желаемая сумма" : "Номинал"} {amount.toLocaleString("ru-RU")} R$</div>
              {onReset && <button className="wbi-reset" onClick={onReset}>‹ Новый код</button>}
              {!isSite && <ThemeToggle compact />}
            </div>
          </div>

          {/* ── Экран входа ─────────────────────────────────────────────── */}
          <section className="wbi-hero wbi-checkhero">
            <div>
              <div className="wbi-kick">ПОЛУЧИ СВОИ ROBUX</div>
              <h1 className="wbi-h1">Впиши свой ник —<br /><span className="wbi-g">остальное сделаем мы</span></h1>
              <p className="wbi-lead">Часто нужный геймпасс уже есть на аккаунте. Тогда создавать ничего не придётся: подтвердил — и заказ ушёл.</p>

              <div className="wbi-entry">
                <span className="wbi-entry-step">Шаг 1 — он же единственный</span>
                <h3>Как тебя зовут в Roblox?</h3>
                <p className="wbi-say">Впиши сюда <b>ник аккаунта, на который придут робуксы</b>.</p>

                <div className={`wbi-bigfield${touched ? "" : " idle"}`}>
                  <span className="wbi-ava" aria-hidden="true">
                    <RemoteImg src={account?.avatarUrl} fallback="?" />
                  </span>
                  <input
                    type="text"
                    value={nick}
                    placeholder="Например: RobloxKid2011"
                    aria-label="Ник Roblox"
                    autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    onFocus={() => setTouched(true)}
                    onChange={(e) => setNick(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") runCheck(); }}
                  />
                </div>
                <button className="wbi-bigcheck" onClick={() => runCheck()} disabled={phase === "scanning"}>
                  {phase === "scanning" ? "Проверяем…" : "🔎 Проверить мой аккаунт"}
                </button>

                {error && <div className="wbi-warn" style={{ marginTop: 12 }}>{error}</div>}

                <details className="wbi-helper">
                  <summary>Не помнишь свой ник? Покажем, где он</summary>
                  <div className="wbi-helper-in">
                    Открой <b>roblox.com</b> или приложение Roblox и нажми на свою аватарку в правом верхнем углу — ник написан прямо под ней.
                    Это <b>не</b> отображаемое имя с эмодзи и пробелами, а короткий ник латиницей: буквы, цифры и <b>_</b>.
                  </div>
                </details>
              </div>
            </div>

            <div className="wbi-checkside">
              <aside className="wbi-must">
                <div className="wbi-must-h">🔍 ЧТО МЫ СМОТРИМ</div>
                <div className="wbi-must-it"><span className="wbi-n">1</span><span>Что такой аккаунт вообще <b>существует</b> — покажем его аватар, чтобы ты убедился.</span></div>
                <div className="wbi-must-it"><span className="wbi-n">2</span><span>Есть ли геймпассы, <b>выставленные на продажу</b>, и складываются ли их цены в твой номинал.</span></div>
                <div className="wbi-must-it"><span className="wbi-n">3</span><span>Не включён ли <b>Managed pricing</b> — с ним Roblox сам меняет цену, и выкупить пасс мы не можем.</span></div>
                <div className="wbi-must-ft">🔒 Пароль от Roblox не нужен и никогда не понадобится. Мы просто покупаем твой геймпасс — как обычный игрок.</div>
              </aside>
              <div className="wbi-watch-ex">
                <div className="wbi-watch-h">Так выглядит подходящий пасс</div>
                <div className="wbi-rline">
                  <span className="wbi-rtile"><span>{peekTargets[0].price}</span><small>R$</small></span>
                  <span className="wbi-rmeta">
                    <span className="t">Пасс «{peekTargets[0].price}»</span>
                    <span className="s"><b>{peekTargets[0].price} R$</b> · выставлен на продажу</span>
                  </span>
                  <span className="wbi-rbadge">подходит</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── Анимация проверки ───────────────────────────────────────── */}
          {phase === "scanning" && (
            <div className="wbi-scan" ref={scanRef}>
              <div className="wbi-scan-h">
                <span className="wbi-ava lg spin" aria-hidden="true">?</span>
                <div>
                  <div className="t">Смотрим твой аккаунт…</div>
                  <div className="s">Обычно это пара секунд.</div>
                </div>
              </div>
              <div className="wbi-scanlines">
                {[
                  <>Ищем аккаунт <b>{nick}</b> в Roblox</>,
                  <>Смотрим геймпассы и их цены</>,
                  <>Считаем, что из них подходит под твой номинал</>,
                ].map((line, i) => (
                  <div key={i} className={`wbi-scanline${scanStep >= i ? " on" : ""}${scanStep > i ? " done" : ""}`}>
                    <span className="m">{scanStep > i ? "✓" : i + 1}</span><span>{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Результат ───────────────────────────────────────────────── */}
          {phase === "result" && plan && (
            <div ref={resultRef}>
              <div className="wbi-sechead"><b>Результат проверки</b></div>
              <ResultCard
                plan={plan}
                amount={amount}
                account={account}
                nick={nick}
                orderPlaced={orderPlaced}
                confirming={confirming}
                confirmErr={confirmErr}
                isSite={isSite}
                peek={peek}
                onPeek={() => setPeek((v) => !v)}
                onConfirm={confirm}
                onOpenGuide={() => stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                onChangeNick={() => { setPhase("entry"); setPlan(null); setAccount(null); setTouched(false); }}
              />
            </div>
          )}

          {/* ── Запасной вход по ссылке — ровно там, где поиск подвёл ───── */}
          {phase === "result" && plan && toCreate.length > 0 && !orderPlaced && (
            <section className="wbi-rescue">
              <span className="k">🔗 Пасс есть, а мы его не видим</span>
              <h3>{plan.kind === "empty" ? "Уверен, что геймпасс уже создан? Дай на него ссылку" : "Есть ещё один пасс, которого мы не увидели? Дай ссылку"}</h3>
              <p>Так бывает: если игра скрыта из поиска или пасс создан только что, наш поиск по нику его не находит — <b>а по прямой ссылке находит всегда</b>. Это быстрее, чем создавать пасс заново.</p>
              <div className="wbi-srow">
                <input
                  className="wbi-sinput"
                  type="text"
                  placeholder="https://www.roblox.com/game-pass/1234567"
                  aria-label="Ссылка на геймпасс"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runManual(); }}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                />
                <button className="wbi-sbtn" onClick={runManual} disabled={manualBusy}>
                  {manualBusy ? "Проверяем…" : "Проверить ссылку"}
                </button>
              </div>
              {manualErr && <div className="wbi-warn" style={{ marginTop: 12 }}>{manualErr}</div>}
              <div className="wbi-how">
                <b>Где взять ссылку:</b> Creator Hub → <b>Creations</b> → твоя игра → <b>Passes</b> → нажми на пасс → скопируй адрес из строки браузера. Подойдёт и просто номер пасса.
              </div>
            </section>
          )}

          {/* ── Инструкция: только на то, чего не хватает ───────────────── */}
          {phase === "result" && plan && showSteps && !orderPlaced && (
            <>
              <div className="wbi-sechead" ref={stepsRef}>
                <b>{toCreate.length === 0
                  ? (stepTargets.length > 1 ? "Как создаются два пасса" : "Как создаётся геймпасс")
                  : (toCreate.length > 1 ? "Нужно создать два пасса" : "Нужно создать один пасс")}</b>
              </div>
              {toCreate.length === 0 && (
                <div className="wbi-ok" style={{ margin: "0 0 18px" }}>
                  📖 Это справка «на будущее» — тебе прямо сейчас <b>создавать ничего не нужно</b>, всё уже готово.
                </div>
              )}
              <Goals plan={plan} toCreate={stepTargets} reference={toCreate.length === 0} />
              <div className="wbi-tl">
                <GuideSteps targets={stepTargets} mode={mode} />
              </div>
              <section className="wbi-recheck">
                <h3>{toCreate.length === 0 ? "Что-то поменял?" : "Сделал? Проверим ещё раз"}</h3>
                <p>Нажми — мы заново посмотрим твой аккаунт. Если пассы на месте, заказ соберётся сразу, вводить ник ещё раз не нужно.</p>
                <div className="row">
                  <button className="wbi-bigbtn" onClick={() => runCheck()} disabled={phase !== "result"}>🔄 Проверить мой аккаунт</button>
                </div>
              </section>
            </>
          )}

          {/* ── Хендофф: бот или оформление на сайте ────────────────────── */}
          {orderPlaced && !isSite && (
            <div className="wbi-cta">
              <h3>Заказ оформлен — вернись в бота</h3>
              <div className="wbi-s">Там статус заказа, уведомления и бонус за отзыв. Не меняй цену и не удаляй геймпассы до сообщения «всё готово».</div>
              <div className="wbi-row">
                {channel !== "VK" && (
                  <a className="wbi-tg" href={returnHref} target="_blank" rel="noopener noreferrer">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z" /></svg>
                    <span>Вернуться в Telegram</span>
                  </a>
                )}
                {channel !== "TG" && (
                  <div className="wbi-vkwrap"><VKAuthButton mode="order" wbCode={code} label="Вернуться в ВКонтакте" /></div>
                )}
              </div>
              <div className="wbi-directcta">💎 В боте можно <b>купить Robux напрямую</b> — без карты WB, быстрее и выгоднее</div>
              <a className="wbi-support" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Остались вопросы? Написать живому менеджеру →</a>
            </div>
          )}

          {/* Поддержка — последняя дверь, а не первая: пока она стояла кнопкой
              рядом с «проверить», в неё жали раньше, чем пробовали сделать пасс. */}
          <div className="wbi-note">
            Совсем не выходит?{" "}
            <a className="wbi-supportlink" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Напиши живому менеджеру</a>{" "}
            — разберёмся вместе.
          </div>
        </div>
      </div>
      {isSite && <Footer />}
    </>
  );
}

/**
 * Картинка с CDN Roblox. Аватар и превью пасса грузятся напрямую с
 * `*.rbxcdn.com`, и у части покупателей он не открывается (провайдер, блокировки,
 * протухшая ссылка). Сломанная иконка вместо аватара читается как «сервис не
 * работает», поэтому на ошибке возвращаем подпись, которая была бы и без картинки.
 */
function RemoteImg({ src, fallback }: { src: string | null | undefined; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- remote Roblox CDN thumbnail
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/** Ответ Roblox → форма, которую понимает планировщик. */
function toOwned(gp: Record<string, unknown>): OwnedPass {
  return {
    gamepassId: String(gp.id ?? ""),
    name: String(gp.name ?? "Геймпасс"),
    price: Number(gp.price ?? 0),
    image: typeof gp.image === "string" ? gp.image : null,
    isForSale: gp.isForSale !== false,
  };
}

const TONE: Record<CheckPlan["kind"], string> = { ready: "ok", assembled: "mix", build: "half", empty: "none" };

function ResultCard({
  plan, amount, account, nick, orderPlaced, confirming, confirmErr, isSite, peek, onPeek, onConfirm, onChangeNick, onOpenGuide,
}: {
  plan: CheckPlan;
  amount: number;
  account: RobloxAccount | null;
  nick: string;
  orderPlaced: boolean;
  confirming: boolean;
  confirmErr: string | null;
  isSite: boolean;
  peek: boolean;
  onPeek: () => void;
  onConfirm: () => void;
  onChangeNick: () => void;
  onOpenGuide: () => void;
}) {
  const covered = coveredRobux(plan);
  const done = plan.kind === "ready" || plan.kind === "assembled";
  const rows = plan.kind === "empty" ? [] : plan.parts;
  const create = targetsToCreate(plan);

  const head = {
    ready: { k: "✅ всё уже готово", h: "Создавать ничего не нужно", s: <>У тебя уже выставлены геймпассы с нужными ценами. Мы подставили их сами — остаётся подтвердить.</> },
    assembled: { k: "🧩 собрали из твоих", h: "Ровных пассов нет — собрали из того, что есть", s: <>Твои цены складываются в <b>ровно {amount.toLocaleString("ru-RU")} R$</b> без остатка. Один и тот же пасс можно купить несколько раз: части выкупаются с разных аккаунтов.</> },
    build: { k: "➕ достроим одним пассом", h: "Почти сходится — нужен ещё один пасс", s: <>То, что уже выставлено, закрывает <b>{covered.toLocaleString("ru-RU")} R$</b>. Точной суммы из этого не собрать, поэтому создай <b>один</b> пасс — инструкция ниже показывает ровно его.</> },
    empty: { k: "🆕 пассов не нашли", h: "Сделаем с нуля — это 5–7 минут", s: <>На аккаунте нет геймпассов, выставленных на продажу. Ниже — что именно создать.</> },
  }[plan.kind];

  return (
    <section className={`wbi-res ${TONE[plan.kind]}`}>
      <span className="wbi-res-k">{head.k}</span>
      <h3>{orderPlaced ? "Заказ оформлен" : head.h}</h3>
      <p className="wbi-said">{orderPlaced ? <>Заказ уже у менеджера. Не меняй цену и не удаляй геймпассы, пока не придут робуксы.</> : head.s}</p>

      <div className="wbi-pcard">
        <span className="wbi-ava lg" aria-hidden="true">
          <RemoteImg src={account?.avatarUrl} fallback="?" />
        </span>
        <span className="m">
          <span className="k">Аккаунт найден</span>
          <span className="n">{account?.username ?? nick}</span>
          <span className="i">Робуксы придут на этот аккаунт</span>
        </span>
        {!orderPlaced && <button className="chg" onClick={onChangeNick}>Не тот аккаунт?</button>}
      </div>

      <div className="wbi-rows">
        {rows.map((part, i) => (
          <div className="wbi-rline" key={`${part.gamepassId}-${i}`}>
            <span className="wbi-rtile">
              <RemoteImg src={part.image} fallback={<><span>{part.price}</span><small>R$</small></>} />
            </span>
            <span className="wbi-rmeta">
              <span className="t">Пасс «{part.name}»{part.repeat ? " — ещё один выкуп" : ""}</span>
              <span className="s"><b>{part.price} R$</b> · {part.repeat ? "тот же пасс, купим с другого аккаунта" : "выставлен на продажу"}</span>
            </span>
            <span className="wbi-rnet">{part.amount.toLocaleString("ru-RU")} R$<small>НА РУКИ</small></span>
            <span className={`wbi-rbadge${part.repeat ? " warn2" : ""}`}>{part.repeat ? "повтор" : "подходит"}</span>
          </div>
        ))}
        {create.map((t, i) => (
          <div className="wbi-rline dim" key={`todo-${i}`}>
            <span className="wbi-rtile todo"><span>{t.price}</span><small>R$</small></span>
            <span className="wbi-rmeta">
              <span className="t">Пасс на {t.price} R$</span>
              <span className="s">его нужно создать — инструкция ниже</span>
            </span>
            <span className="wbi-rnet">{t.amount.toLocaleString("ru-RU")} R$<small>НА РУКИ</small></span>
            <span className="wbi-rbadge todo">создать</span>
          </div>
        ))}
      </div>

      <div className={`wbi-total${done ? "" : " short"}`}>
        <span className="l">{done ? "Итого на руки" : `Собрано из ${amount.toLocaleString("ru-RU")}`}</span>
        <span className="r">{(done ? amount : covered).toLocaleString("ru-RU")} R$</span>
      </div>

      {confirmErr && <div className="wbi-warn" style={{ marginTop: 14 }}>{confirmErr}</div>}

      {!done && !orderPlaced && (
        <div className="wbi-actions">
          <button className="wbi-bigbtn" onClick={onOpenGuide}>
            📖 {create.length > 1 ? "Как создать оба пасса" : "Как создать пасс"} ↓
          </button>
          <button className="wbi-ghostbtn" onClick={onChangeNick}>Это не мой аккаунт</button>
        </div>
      )}

      {done && !orderPlaced && (
        <>
          <div className="wbi-actions">
            <button className="wbi-bigbtn" onClick={onConfirm} disabled={confirming}>
              {confirming ? "Оформляем…" : isSite ? "Перейти к оформлению →" : "Подтвердить заказ"}
            </button>
            <button className="wbi-ghostbtn" onClick={onChangeNick}>Это не мои пассы</button>
          </div>
          <button className="wbi-peek" onClick={onPeek}>
            {peek ? "✕ Свернуть инструкцию" : "📖 Просто посмотреть, как создаётся геймпасс — на будущее"}
          </button>
        </>
      )}
    </section>
  );
}

function Goals({ plan, toCreate, reference }: { plan: CheckPlan; toCreate: CreateTarget[]; reference: boolean }) {
  const have = plan.kind === "empty" ? [] : plan.parts;
  return (
    <div className="wbi-goals">
      {have.map((part, i) => (
        <div className="wbi-goal have" key={`have-${i}`}>
          <span className="g-t">
            <RemoteImg src={part.image} fallback={<><span>{part.price}</span><small>R$</small></>} />
          </span>
          <span className="g-m">
            <span className="k">уже есть</span>
            <span className="v">Пасс «{part.name}» · {part.price} R$</span>
            <span className="s">даёт {part.amount.toLocaleString("ru-RU")} R$</span>
          </span>
        </div>
      ))}
      {toCreate.map((t, i) => (
        <div className="wbi-goal todo" key={`todo-${i}`}>
          <span className="g-t"><span>{t.price}</span><small>R$</small></span>
          <span className="g-m">
            <span className="k">{reference ? "пасс" : "создать"}{toCreate.length > 1 ? ` · ${i + 1} из ${toCreate.length}` : ""}</span>
            <span className="v">Пасс на {t.price} R$</span>
            <span className="s">даст {t.amount.toLocaleString("ru-RU")} R$ на руки</span>
          </span>
        </div>
      ))}
    </div>
  );
}
