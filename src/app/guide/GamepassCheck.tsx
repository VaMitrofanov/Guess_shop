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
import { tgBotHref, vkBotHref } from "@/lib/bot-links";
import { parseGamepassRef } from "@/lib/gamepass-id";
import {
  coveredRobux,
  createTargetsFor,
  idealTargetsFor,
  planFromOwned,
  targetsToCreate,
  type CheckPlan,
  type CreateTarget,
  type OwnedPass,
} from "@/lib/gamepass-plan";
import { keyCreateVerdict } from "@/lib/gamepass-create-messages";
import { GUIDE_CSS } from "./guide-css";
import GuideSteps from "./guide-steps";
import KeyCreate from "./KeyCreate";
import type { GuidePlatform } from "@/lib/device-platform";

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
/** Анимация проверки не должна мигать: ответ приходит быстрее, чем читается строка. */
const SCAN_MIN_MS = 2000;

interface RobloxAccount { id: string; username: string; avatarUrl: string | null }

type Phase = "entry" | "scanning" | "result";
/**
 * Где человек находится после проверки.
 *
 * `result` — что нашли; `fork` — экран выбора способа; дальше одна из трёх
 * веток. Выбор вынесен на СВОЙ экран намеренно: пока три способа лежали
 * секциями под результатом, до них просто не долистывали.
 */
type Stage = "result" | "fork" | "manual" | "key" | "passid";

export default function GamepassCheck({
  mode,
  amount,
  code,
  initialUsername = "",
  testMode = false,
  onReset,
  initialPlatform = "mobile",
  keyAutoEnabled = false,
  initialStage,
}: {
  mode: "WB" | "SITE" | "BOT";
  amount: number;
  code?: string;
  initialUsername?: string;
  testMode?: boolean;
  onReset?: () => void;
  /** Догадка сервера «телефон или компьютер» — только для кадров инструкции. */
  initialPlatform?: GuidePlatform;
  /** Метод «пасс по ключу» включён (флаг GAMEPASS_AUTOCREATE). */
  keyAutoEnabled?: boolean;
  /** `?stage=key` — человек пришёл по ссылке, которая ключ и просит. */
  initialStage?: "key";
}) {
  const router = useRouter();
  const isSite = mode === "SITE";
  /** На сайте заказ несёт ОДИН `gamepassId` — набор из нескольких там был бы тупиком. */
  const planOptions = useMemo(
    () => (isSite ? { maxParts: 1, splitPlan: false } : {}),
    [isSite],
  );

  const [phase, setPhase] = useState<Phase>("entry");
  const [stage, setStage] = useState<Stage>("result");
  const [nick, setNick] = useState(initialUsername.trim().replace(/^@/, ""));
  const [touched, setTouched] = useState(false);
  const [account, setAccount] = useState<RobloxAccount | null>(null);
  const [owned, setOwned] = useState<OwnedPass[]>([]);
  const [plan, setPlan] = useState<CheckPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [peek, setPeek] = useState(false);

  /** Пасс уже создан по ключу: план пересчитан, но блок должен остаться на месте
   *  — иначе сообщение «готово» исчезает вместе с ним, и человек не понимает,
   *  что произошло. */
  const [keyDone, setKeyDone] = useState(false);

  const [manualRef, setManualRef] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);

  /**
   * У покупателя уже привязан ключ на этот ник.
   *
   * Ровно это боты умеют с 07.09 (`hasStoredKeyFor` → дверь «создать сейчас»),
   * а сайт до сих пор просил ключ заново — у человека, который привязал его в
   * кабинете десять минут назад. Ответ даёт сервер по коду заказа: ключ —
   * креденшл, и «по нику» его брать нельзя.
   */
  const [storedKey, setStoredKey] = useState(false);
  const [storedBusy, setStoredBusy] = useState(false);
  const [storedErr, setStoredErr] = useState<string | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [channel, setChannel] = useState<"TG" | "VK" | null>(null);

  const scanRef = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const stepsRef = useRef<HTMLDivElement | null>(null);
  const rescueRef = useRef<HTMLElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  /**
   * Ссылка привела прямо в ветку ключа (`?stage=key`).
   *
   * Открыть её на входе нельзя: до проверки ника нет ни аккаунта, ни плана —
   * блок ключа не на чем рисовать. Поэтому намерение ждёт первого результата
   * проверки и тратится ОДИН раз: иначе возврат к проверке после созданного
   * пасса каждый раз выбрасывал бы человека обратно в форму ключа.
   */
  const keyWanted = useRef(initialStage === "key");
  useEffect(() => {
    // Кнопки живут в переписке дольше кода: разосланные до этой правки ссылки
    // несут якорь `#key`. Принимаем и его, чтобы старые сообщения не вели в пустоту.
    if (window.location.hash.toLowerCase() === "#key") keyWanted.current = true;
  }, []);

  const tgHref = tgBotHref(code, code ? getOrInitSessionId() : null);
  const returnHref = channel === "VK" ? vkBotHref(code) : tgHref;

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

  // Есть ли привязанный ключ на этот ник — спрашиваем один раз на результат.
  useEffect(() => {
    if (!keyAutoEnabled || !code || testMode || phase !== "result") return;
    const value = (account?.username ?? nick).trim();
    if (!NICK_RE.test(value)) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/roblox/gamepass-create?code=${encodeURIComponent(code)}&nick=${encodeURIComponent(value)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setStoredKey(data?.stored === true);
      } catch {
        // Не фатально: покупателю просто не покажем самую короткую дверь.
      }
    })();
    return () => { alive = false; };
  }, [keyAutoEnabled, code, testMode, phase, account, nick]);

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
    setStage("result");
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
      if (keyWanted.current) {
        keyWanted.current = false;
        // Флаг мог выключиться, пока сообщение с ссылкой лежало в чате: тогда
        // человек просто остаётся на результате — обещать выключённый метод нельзя.
        if (keyAutoEnabled) setStage("key");
      }
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
      setPhase("entry");
    }
  }, [nick, code, replan, keyAutoEnabled]);

  /**
   * Ник пришёл ссылкой — проверяем сами, не заставляя вводить его второй раз.
   *
   * Персональная кнопка бота несёт `&username=`: там ник уже спросили и
   * проверили. Пустое поле «как тебя зовут в Roblox» на этом шаге читается как
   * «всё сначала» и обнуляет ощущение, что человека ведут за руку.
   */
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current) return;
    const value = initialUsername.trim().replace(/^@/, "");
    if (!NICK_RE.test(value)) return;
    autoChecked.current = true;
    // Следующим тиком, а не прямо здесь: проверка начинается с трёх setState
    // подряд, и в теле эффекта это лишний каскадный рендер на первом кадре.
    const timer = setTimeout(() => void runCheck(value), 0);
    return () => clearTimeout(timer);
  }, [initialUsername, runCheck]);

  /**
   * Запасной вход: пасс есть, но поиск по нику его не видит (скрытый плейс, свежий пасс).
   *
   * Просим **Pass ID**, а не ссылку: публичной ссылки у скрытого плейса может не
   * быть вовсе, а Pass ID лежит отдельной колонкой в таблице Passes и копируется
   * кнопкой `Copy Pass ID` — это одно движение вместо разбора адресной строки.
   * Вставленный адрес принимаем по-прежнему, но двух видов путаницы ждём заранее:
   * адрес СПИСКА пассов (`/monetization/passes` — номера в нём нет) и номер ИГРЫ
   * (он идёт после `/experiences/`).
   */
  const runManual = useCallback(async () => {
    const raw = manualRef.trim();
    const id = parseGamepassRef(raw);
    if (!id) {
      setManualErr(
        /^\d+$/.test(raw)
          ? `В Pass ID 9–10 цифр, а здесь ${raw.length}. Похоже, это цена или номинал — Pass ID стоит в отдельной колонке, справа от названия пасса.`
          : /passes\b/i.test(raw)
            ? "Это адрес страницы, а не номер. Pass ID стоит отдельной колонкой в таблице Passes — скопируй число оттуда."
            : /experiences?\/\d+/i.test(raw)
              ? "Это номер игры, а не пасса. Нужное число — в колонке Pass ID, напротив названия пасса."
              : "Не похоже на Pass ID. Это число из колонки Pass ID — 9–10 цифр, без пробелов.",
      );
      return;
    }
    setManualErr(null);
    setManualBusy(true);
    try {
      const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(id)}${code ? `&code=${encodeURIComponent(code)}` : ""}`);
      const data = await res.json();
      const gp = (data?.gamepasses ?? [])[0] as Record<string, unknown> | undefined;
      if (!data?.success || !gp) {
        setManualErr("Не нашли пасс с таким номером. Проверь, что взял его из колонки Pass ID, а не номер игры.");
        return;
      }
      // Робуксы уходят ВЛАДЕЛЬЦУ пасса, а не тому, кого назвал покупатель.
      // Вставленный чужой номер (или свой, но от другого аккаунта) иначе тихо
      // уехал бы в заказ и оставил человека без робуксов.
      const owner = typeof gp.creatorName === "string" ? gp.creatorName.trim() : "";
      const claimed = (account?.username ?? nick).trim();
      if (owner && claimed && owner.toLowerCase() !== claimed.toLowerCase()) {
        setManualErr(`Этот пасс принадлежит аккаунту ${owner}, а робуксы ты просишь на ${claimed}. Робуксы придут владельцу пасса — проверь номер или вернись и смени ник.`);
        return;
      }
      const pass = toOwned(gp);
      const next = [...owned.filter((p) => p.gamepassId !== pass.gamepassId), pass];
      replan(next);
      if (!account && owner && NICK_RE.test(owner)) {
        setNick(owner);
        setAccount({ id: "", username: owner, avatarUrl: null });
      }
      setManualRef("");
      setPhase("result");
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setManualErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setManualBusy(false);
    }
  }, [manualRef, code, owned, account, nick, replan]);

  /**
   * «Создать сейчас» привязанным ключом — одно нажатие вместо похода в Roblox.
   *
   * Набор берём ЭТАЛОННЫЙ (`createTargetsFor`), а не «чего не хватает»: руками
   * тут никто ничего не делает, и подстраиваться под мелочь на аккаунте значит
   * получать пассы, неудобные для выкупа. То же правило у ботов и у ветки ключа.
   */
  const runStoredKey = useCallback(async () => {
    if (!code || storedBusy) return;
    const value = (account?.username ?? nick).trim();
    const targets = createTargetsFor(amount, !isSite);
    if (targets.length === 0) return;
    setStoredBusy(true);
    setStoredErr(null);
    try {
      const res = await fetch("/api/roblox/gamepass-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useStored: true, code, nick: value, targets: targets.map((t) => t.price) }),
      });
      const data = await res.json().catch(() => ({}));
      const created = (Array.isArray(data?.created) ? data.created : []) as Array<Record<string, unknown>>;
      if (created.length > 0) {
        setKeyDone(true);
        replan([
          ...owned,
          ...created.map((pass) => ({
            gamepassId: String(pass.gamePassId ?? ""),
            name: typeof pass.name === "string" && pass.name ? pass.name : `Пасс ${Number(pass.priceInRobux)}`,
            price: Number(pass.priceInRobux ?? 0),
            image: null,
            isForSale: true,
          })),
        ]);
        setStage("result");
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
      if (!data?.ok) {
        // Ключ мог протухнуть или потерять права — человека не бросаем в тупик,
        // а возвращаем на развилку с обычными способами.
        setStoredErr(keyCreateVerdict(typeof data?.error === "string" ? data.error : "roblox_error").text);
        if (created.length === 0) {
          setStoredKey(data?.error !== "no_stored_key");
          setStage("fork");
        }
      }
    } catch {
      setStoredErr("Не удалось связаться с Roblox. Попробуй ещё раз через минуту.");
    } finally {
      setStoredBusy(false);
    }
  }, [code, storedBusy, account, nick, amount, isSite, owned, replan]);

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
  /** Справочный показ инструкции: создавать нечего, человек просто смотрит. */
  const reference = toCreate.length === 0;
  // Условие «и создавать есть что» отсюда убрано: в ветку ключа теперь можно
  // прийти по ссылке с планом, в котором создавать нечего, а из неё открыта
  // дверь «создам сам». С прежним условием эта дверь вела в пустой экран;
  // теперь показывается справочный вариант шагов (`reference`).
  const showSteps = stage === "manual" || peek;
  /**
   * Ветка ключа открыта, а пасс ещё не создан.
   *
   * По `?stage=key` сюда приходят и с планом, где создавать нечего: так
   * выглядит заказ, который не выкупается ИМЕННО из-за одного крупного пасса.
   * Карточку результата в этот момент показывать нельзя — «создавать ничего не
   * нужно» прямо над формой ключа читается как спор страницы с самой собой.
   * После создания (`keyDone`) карточка возвращается: в ней кнопка
   * «Подтвердить заказ», ради которой человек сюда и шёл.
   */
  const keyPending = stage === "key" && !keyDone;

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

          {/* ── Пройденное: строкой сверху, а не экраном ─────────────────── */}
          {phase === "result" && (
            <div className="wbi-crumbs">
              <div className="wbi-crumb">
                <i>✓</i>
                <span>Ник · <b>{account?.username ?? nick}</b></span>
                {!orderPlaced && (
                  <button type="button" onClick={() => { setPhase("entry"); setPlan(null); setAccount(null); setTouched(false); setKeyDone(false); setStage("result"); }}>
                    сменить
                  </button>
                )}
              </div>
              {stage !== "result" && toCreate.length > 0 && (
                <div className="wbi-crumb">
                  <i>✓</i>
                  <span>
                    Нужен {toCreate.length > 1 ? "два геймпасса" : <>геймпасс за <b>{toCreate[0].price} R$</b></>}
                  </span>
                  <button type="button" onClick={() => setStage("fork")}>другой способ</button>
                </div>
              )}
            </div>
          )}

          {/* ── Экран входа ─────────────────────────────────────────────── */}
          {phase !== "result" && (
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
          )}

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
          {/* Внутри ветки карточка результата сворачивается в строку-крошку
              сверху: держать её на экране целиком — значит заставлять человека
              прокручивать мимо неё каждый шаг инструкции. */}
          {phase === "result" && plan && (stage === "result" || orderPlaced || (toCreate.length === 0 && !keyPending)) && (
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
                storedKey={keyAutoEnabled && storedKey}
                storedBusy={storedBusy}
                onStoredKey={() => void runStoredKey()}
                onConfirm={confirm}
                onOpenFork={() => {
                  setStage("fork");
                  requestAnimationFrame(() => stepsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
                onChangeNick={() => { setPhase("entry"); setPlan(null); setAccount(null); setTouched(false); setKeyDone(false); }}
              />
            </div>
          )}

          {/* ── Экран выбора способа ────────────────────────────────────── */}
          {phase === "result" && plan && toCreate.length > 0 && !orderPlaced && stage === "fork" && (
            <section ref={stepsRef}>
              <div className="wbi-forkhead">
                <div className="k">ВЫБЕРИ, КАК СДЕЛАЕМ</div>
                <h3>{toCreate.length > 1 ? "Нужно два геймпасса" : "Как сделаем геймпасс?"}</h3>
                <p>
                  {toCreate.length > 1
                    ? <>Нужны два: на <b>{toCreate[0].price}</b> и <b>{toCreate[1].price} R$</b>. Способ один на оба — выбирай любой, результат одинаковый.</>
                    : <>Нужен один геймпасс за <b>{toCreate[0].price} R$</b>. {keyAutoEnabled && storedKey ? "Быстрее всего — первым способом: ключ у нас уже есть." : `Сделать его можно ${keyAutoEnabled ? "тремя способами" : "двумя способами"} — результат одинаковый, но первый быстрее всех.`}</>}
                </p>
              </div>
              {storedErr && <div className="wbi-warn" style={{ marginBottom: 12 }}>{storedErr}</div>}
              <div className="wbi-opts">
                {/* Ключ уже привязан — самая короткая дверь идёт первой: ради
                    этого ключи и хранятся. Тот же порядок, что у ботов. */}
                {keyAutoEnabled && storedKey && (
                  <button className="wbi-opt key" onClick={() => void runStoredKey()} disabled={storedBusy}>
                    <span className="i">✨</span>
                    <span>
                      <span className="t">{storedBusy ? "Создаём…" : <>Создать сейчас<span className="wbi-new">КЛЮЧ ПРИВЯЗАН</span></>}</span>
                      <span className="s">Ключ от твоего аккаунта уже у нас — сделаем геймпасс сами, делать ничего не нужно.</span>
                      <span className="chip">одно нажатие</span>
                    </span>
                    <span className="a" aria-hidden="true">›</span>
                  </button>
                )}
                {/* Порядок путей: сначала ключ, потом ручная инструкция, потом
                    «пасс уже есть» (решение владельца 08.09.2026). Раньше первым
                    стоял самый долгий путь, а самый быстрый читался как экзотика. */}
                {keyAutoEnabled && !storedKey && (
                  <button className="wbi-opt key" onClick={() => setStage("key")}>
                    <span className="i">🔑</span>
                    <span>
                      <span className="t">Сделайте за меня<span className="wbi-new">НОВОЕ</span></span>
                      <span className="s">Пришлёшь один ключ из Roblox — создадим сами. Пароль не нужен. Настроил один раз — и про геймпассы можно забыть.</span>
                      <span className="chip">минута</span>
                    </span>
                    <span className="a" aria-hidden="true">›</span>
                  </button>
                )}
                <button className="wbi-opt usual" onClick={() => setStage("manual")}>
                  <span className="i">📖</span>
                  <span>
                    <span className="t">Создам сам <em>(инструкция)</em></span>
                    <span className="s">Покажем каждое нажатие с картинкой. Ничего сложного, просто по шагам.</span>
                    <span className="chip">3–5 минут</span>
                  </span>
                  <span className="a" aria-hidden="true">›</span>
                </button>
                <button className="wbi-opt" onClick={() => setStage("passid")}>
                  <span className="i">🔢</span>
                  <span>
                    <span className="t">Он у меня уже есть</span>
                    <span className="s">Геймпасс создан, но мы его не видим — найдём по номеру, даже скрытый.</span>
                    <span className="chip">10 секунд</span>
                  </span>
                  <span className="a" aria-hidden="true">›</span>
                </button>
              </div>
              <div className="wbi-note" style={{ marginTop: 14, textAlign: "center" }}>
                {keyAutoEnabled
                  ? "Не знаешь, что выбрать? Жми первый — это самый быстрый путь, и он же избавит от возни в следующий раз."
                  : "Не знаешь, что выбрать? Жми первый — это обычный путь."}
              </div>
            </section>
          )}

          {/* ── Запасной вход по Pass ID — ровно там, где поиск подвёл ──── */}
          {phase === "result" && plan && toCreate.length > 0 && !orderPlaced && stage === "passid" && (
            <section className="wbi-rescue" ref={rescueRef}>
              <span className="k">🔢 Пасс уже создан?</span>
              <h3>{plan.kind === "empty" ? "Вставь его Pass ID — найдём даже скрытый" : "Есть ещё один пасс? Вставь его Pass ID"}</h3>
              <p>Если игра скрыта из поиска или пасс создан только что, по нику мы его не находим — <b>по Pass ID находим всегда</b>.</p>
              <div className="wbi-srow">
                <input
                  className="wbi-sinput"
                  type="text"
                  placeholder="Например: 1969680833"
                  aria-label="Pass ID геймпасса"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runManual(); }}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                />
                <button className="wbi-sbtn" onClick={runManual} disabled={manualBusy}>
                  {manualBusy ? "Ищем…" : "Найти пасс"}
                </button>
              </div>
              {manualErr && <div className="wbi-warn" style={{ marginTop: 12 }}>{manualErr}</div>}
              <div className="wbi-how">
                <b>Где взять Pass ID:</b>
                <span className="wbi-path">Creator Hub → твоя игра → <b>Monetization</b> → <b>Passes</b> → колонка <b>Pass ID</b>.</span>
                <figure className="wbi-figure wbi-shot">
                  <span className="wbi-anno">
                    <img src="/guide/wb-passid.png" alt="Таблица Passes в Creator Hub: колонка Pass ID и кнопка Copy Pass ID" loading="lazy" decoding="async" />
                    <span className="wbi-box y" style={{ left: "59.5%", top: "5.9%", width: "11%", height: "8.2%" }} />
                    <span className="wbi-box g nodot" style={{ left: "59.5%", top: "22.4%", width: "19%", height: "11.7%" }} />
                  </span>
                  <figcaption>Число из колонки <b>Pass ID</b> (синяя рамка) — его и вставь. Рядом есть кнопка <b>Copy Pass ID</b>.</figcaption>
                </figure>
              </div>
              <div className="wbi-escape">
                <div className="wbi-escape-h">ГЕЙМПАССА ВСЁ-ТАКИ НЕТ?</div>
                <button className="wbi-opt usual" onClick={() => setStage("manual")}>
                  <span className="i">📖</span>
                  <span>
                    <span className="t">Создать геймпасс <em>(инструкция)</em></span>
                    <span className="s">Четыре шага, каждое нажатие с картинкой</span>
                  </span>
                  <span className="a" aria-hidden="true">›</span>
                </button>
                {keyAutoEnabled && (
                  <button className="wbi-opt key" onClick={() => setStage("key")}>
                    <span className="i">🔑</span>
                    <span>
                      <span className="t">Сделаем за тебя</span>
                      <span className="s">Пришли ключ из Roblox — создадим сами, минута</span>
                    </span>
                    <span className="a" aria-hidden="true">›</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {/* ── Пасс по ключу: альтернатива ручному созданию ────────────── */}
          {keyAutoEnabled && phase === "result" && plan && (stage === "key" || keyDone) && !orderPlaced && (
            <KeyCreate
              /* По ключу создаём ЭТАЛОННЫЙ набор под номинал, а не «чего не
                 хватает»: руками тут никто ничего не делает, и подстраиваться
                 под то, что уже лежит на аккаунте, значит получать неудобные
                 для выкупа пассы (см. `createTargetsFor`). */
              targets={createTargetsFor(amount, !isSite)}
              nick={account?.username ?? nick}
              code={code}
              initialPlatform={initialPlatform}
              onCreated={(passes) => {
                setKeyDone(true);
                // Созданный пасс сразу уходит в план: человек жмёт «Подтвердить»,
                // как после обычной проверки ника, и второй раз ничего не ищет.
                replan([...owned.filter((p) => !passes.some((n) => n.gamepassId === p.gamepassId)), ...passes]);
                requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }}
            />
          )}

          {/* Из ключа всегда открыта дверь в обычную инструкцию: метод новый,
              и упереться в него человек не должен. */}
          {keyAutoEnabled && phase === "result" && plan && stage === "key" && !keyDone && !orderPlaced && (
            <div className="wbi-escape">
              <div className="wbi-escape-h">ПЕРЕДУМАЛ ИЛИ НЕ ИДЁТ</div>
              <button className="wbi-opt usual" onClick={() => setStage("manual")}>
                <span className="i">📖</span>
                <span>
                  <span className="t">Создам сам <em>(инструкция)</em></span>
                  <span className="s">Обычный путь: четыре шага, каждое нажатие с картинкой</span>
                </span>
                <span className="a" aria-hidden="true">›</span>
              </button>
              <div className="wbi-note">
                Или <a className="wbi-supportlink" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">напиши менеджеру</a> — поможем руками.
              </div>
            </div>
          )}

          {/* ── Инструкция: только на то, чего не хватает ───────────────── */}
          {phase === "result" && plan && showSteps && !orderPlaced && (
            <>
              <div className="wbi-sechead" ref={stepsRef}>
                <b>{reference
                  ? (stepTargets.length > 1 ? "Как создаются два пасса" : "Как создаётся геймпасс")
                  : (toCreate.length > 1 ? "Создаём два геймпасса" : "Создаём геймпасс")}</b>
              </div>
              {reference && (
                <div className="wbi-ok" style={{ margin: "0 0 18px" }}>
                  📖 Это справка «на будущее» — тебе прямо сейчас <b>создавать ничего не нужно</b>, всё уже готово.
                </div>
              )}
              <Goals plan={plan} toCreate={stepTargets} reference={reference} />
              <div className="wbi-tl">
                <GuideSteps
                  targets={stepTargets}
                  mode={mode}
                  initialPlatform={initialPlatform}
                  // Внутри заказа шаги идут по одному: человек делает, а не читает.
                  // Справка «на будущее» остаётся списком — её именно читают.
                  layout={reference ? "list" : "paged"}
                  onDone={() => runCheck()}
                />
              </div>
              {reference && (
                <section className="wbi-recheck">
                  <h3>Что-то поменял?</h3>
                  <p>Нажми — мы заново посмотрим твой аккаунт. Если пассы на месте, заказ соберётся сразу, вводить ник ещё раз не нужно.</p>
                  <div className="row">
                    <button className="wbi-bigbtn" onClick={() => runCheck()} disabled={phase !== "result"}>🔄 Проверить мой аккаунт</button>
                  </div>
                </section>
              )}
              {!reference && (
                <div className="wbi-escape">
                  <div className="wbi-escape-h">ЕСЛИ НЕ ПОЛУЧИЛОСЬ</div>
                  {keyAutoEnabled && (
                    <button className="wbi-opt key" onClick={() => setStage("key")}>
                      <span className="i">🔑</span>
                      <span>
                        <span className="t">Сделаем за тебя</span>
                        <span className="s">Пришли ключ из Roblox — геймпасс создадим сами, минута</span>
                      </span>
                      <span className="a" aria-hidden="true">›</span>
                    </button>
                  )}
                  <button className="wbi-opt" onClick={() => setStage("passid")}>
                    <span className="i">🔢</span>
                    <span>
                      <span className="t">Создал, но его не видно</span>
                      <span className="s">Вставь Pass ID — найдём даже скрытый</span>
                    </span>
                    <span className="a" aria-hidden="true">›</span>
                  </button>
                  <div className="wbi-note">
                    Совсем не выходит?{" "}
                    <a className="wbi-supportlink" href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Напиши живому менеджеру</a>.
                  </div>
                </div>
              )}
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
  plan, amount, account, nick, orderPlaced, confirming, confirmErr, isSite, peek, onPeek,
  storedKey, storedBusy, onStoredKey, onConfirm, onChangeNick, onOpenFork,
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
  /** Ключ этого покупателя уже привязан — можно создать пасс одним нажатием. */
  storedKey: boolean;
  storedBusy: boolean;
  onStoredKey: () => void;
  onConfirm: () => void;
  onChangeNick: () => void;
  /** Открыть экран выбора способа — единственная дверь из «чего не хватает». */
  onOpenFork: () => void;
}) {
  const covered = coveredRobux(plan);
  const done = plan.kind === "ready" || plan.kind === "assembled";
  const rows = plan.kind === "empty" ? [] : plan.parts;
  const create = targetsToCreate(plan);

  const head = {
    ready: { k: "✅ всё уже готово", h: "Создавать ничего не нужно", s: <>У тебя уже выставлены геймпассы с нужными ценами. Мы подставили их сами — остаётся подтвердить.</> },
    assembled: { k: "🧩 собрали из твоих", h: "Создавать ничего не нужно", s: <>Твои геймпассы складываются в <b>ровно {amount.toLocaleString("ru-RU")} R$</b> без остатка — один из них мы выкупим несколько раз, покупки идут с разных аккаунтов. Тебе делать ничего не надо.</> },
    build: { k: "➕ берём твой и добавляем", h: "Твой геймпасс подходит — нужен ещё один", s: <>Твой закрывает <b>{covered.toLocaleString("ru-RU")} R$</b> из {amount.toLocaleString("ru-RU")} — его выкупим столько раз, сколько нужно. Ровно этим не добрать, поэтому под остаток нужен ещё один геймпасс.</> },
    empty: { k: "🔍 подходящего не нашли", h: "На аккаунте нет геймпасса, который мы можем купить", s: <><b>Геймпасс — это платная вещь внутри твоей игры в Roblox.</b> Ты её выставляешь, мы покупаем — Roblox переводит тебе робуксы. Такой вещи у тебя пока нет.</> },
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
      </div>

      {/* Того, чего НЕТ, в списке найденного быть не должно: строка «Пасс на
          1429 R$ · создать» читалась как «пасс уже есть». Недостающее — это
          задача, и выглядеть она должна как задача. */}
      {!done && create.length > 0 && (
        <div className="wbi-target">
          <span className="k">ЧТО НУЖНО СДЕЛАТЬ</span>
          {create.length === 1 ? (
            <div className="wbi-tgoal">
              <span className="v">{create[0].price}<small>R$</small></span>
              <span className="d">
                Выставить <b>{rows.length > 0 ? "ещё один геймпасс" : "один геймпасс"}</b> с такой ценой.
                <br />С него придёт{rows.length > 0 ? " недостающие" : ""} <b>{create[0].amount.toLocaleString("ru-RU")} R$</b>.
              </span>
            </div>
          ) : (
            <>
              <div className="wbi-tgoal">
                <span className="v">{create[0].price}<small>R$</small></span>
                <span className="d">Первый геймпасс — с него придёт <b>{create[0].amount.toLocaleString("ru-RU")} R$</b></span>
              </div>
              <div className="wbi-tgoal">
                <span className="v">{create[1].price}<small>R$</small></span>
                <span className="d">
                  Второй — с него <b>{create[1].amount.toLocaleString("ru-RU")} R$</b>.
                  <br />Вместе — <b>{amount.toLocaleString("ru-RU")} R$</b>.
                </span>
              </div>
              <span className="wbi-tnote">Два геймпасса вместо одного дорогого: так заказ выкупается быстрее, а ты получаешь ровно ту же сумму.</span>
            </>
          )}
          <span className="wbi-tnote">Цену скопируешь на следующем шаге — набирать руками не придётся.</span>
        </div>
      )}

      {done && (
        <>
          <div className="wbi-total">
            <span className="l">Итого на руки</span>
            <span className="r">{amount.toLocaleString("ru-RU")} R$</span>
          </div>
          {/* Последний экран обязан отвечать на три вопроса разом: сколько, за
              что и КОМУ. Робуксы Roblox переводит владельцу геймпасса, а не
              тому, кого назвали в заказе, — и это последнее место, где
              расхождение ещё можно поймать глазами. */}
          {!orderPlaced && (
            <div className="wbi-confirmsum">
              <div><span>Сколько</span><b>{amount.toLocaleString("ru-RU")} R$</b></div>
              <div><span>Кому</span><b>{account?.username ?? nick}</b></div>
              <div>
                <span>За что</span>
                <b>{rows.length > 1 ? `${rows.length} геймпасса` : `Геймпасс ${rows[0]?.gamepassId ?? "—"}`}</b>
              </div>
            </div>
          )}
        </>
      )}

      {confirmErr && <div className="wbi-warn" style={{ marginTop: 14 }}>{confirmErr}</div>}

      {!done && !orderPlaced && (
        <>
          <div className="wbi-actions">
            {storedKey ? (
              <>
                <button className="wbi-bigbtn" onClick={onStoredKey} disabled={storedBusy}>
                  {storedBusy ? "Создаём геймпасс…" : "✨ Создать за меня — ключ уже привязан"}
                </button>
                <button className="wbi-ghostbtn" onClick={onOpenFork}>Другой способ</button>
              </>
            ) : (
              <button className="wbi-bigbtn" onClick={onOpenFork}>Выбрать, как это сделать →</button>
            )}
          </div>
          <div className="wbi-note" style={{ marginTop: 10, textAlign: "center" }}>
            {storedKey
              ? "Ключ от твоего аккаунта у нас уже есть — идти в Roblox не нужно."
              : "Три способа — выбери любой, результат одинаковый."}
          </div>
        </>
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
