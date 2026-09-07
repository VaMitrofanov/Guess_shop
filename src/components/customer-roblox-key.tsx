"use client";

/**
 * «Ключ для геймпассов» в личном кабинете.
 *
 * Зачем в кабинете, а не только в инструкции. В инструкции ключ просят в самый
 * неудачный момент: заказ уже оплачен, человек торопится, а перед ним внезапно
 * шесть шагов в Creator Hub. В кабинете это делается один раз и заранее — и
 * тогда в следующий заказ ему остаётся только оплатить.
 *
 * Проверка НЕ создаёт геймпасс: заказа ещё нет, и оставлять покупателю пасс,
 * которого он не заказывал, нельзя. Роут проверяет обе операции ключа
 * безопасными запросами — чтение списком, запись PATCH-ем несуществующего
 * пасса, — поэтому «принят» здесь значит «сработает на заказе», а не «строка
 * похожа на ключ».
 *
 * Ключ уходит одним POST и обратно НЕ возвращается: в кабинете живут только
 * метаданные (ник, дата, сколько пассов уже создано).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { keyCreateVerdict } from "@/lib/gamepass-create-messages";
import {
  GUIDE_PLATFORM_KEY,
  platformFromBrowser,
  rememberPlatform,
  storedPlatform,
  type GuidePlatform,
} from "@/lib/device-platform";
import styles from "@/app/dashboard/dashboard.module.css";

export interface KeyAccount {
  id: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Живой заказ, который ключ доделал в момент привязки. */
export interface AppliedOrder {
  ref: string;
  amount: number;
  href: string;
  /** Цены созданных пассов. */
  created: number[];
  error?: string;
}

export interface LinkedKeyView {
  id: string;
  username: string;
  linkedAt: string;
  lastUsedAt: string | null;
  createdPasses: number;
}

/** Анимация проверки: ответ приходит быстрее, чем читается строка. */
const SCAN_MIN_MS = 2200;
const SCAN_STEP_MS = 720;

const fmtDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(value)) : null;

export default function CustomerRobloxKeyCard({
  initialKeys,
  username,
  enabled,
  activeOrderHref = null,
}: {
  initialKeys: LinkedKeyView[];
  /** Ник выбранного профиля — на его аккаунте ключ и работает. */
  username: string | null;
  /** Метод включён флагом `GAMEPASS_AUTOCREATE`. */
  enabled: boolean;
  /** Ссылка «продолжить» у живого заказа: инструкция под ЕГО код. */
  activeOrderHref?: string | null;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [open, setOpen] = useState(initialKeys.length === 0);
  const [value, setValue] = useState("");
  // Ник по умолчанию — из выбранного профиля, но человек может ввести другой:
  // ключ выпускается на том аккаунте, где лежит игра, а он не всегда основной.
  // Значение выводим при рендере, а не синхронизируем эффектом — иначе смена
  // профиля затирала бы уже набранное вручную.
  const [typedNick, setTypedNick] = useState<string | null>(null);
  const nick = typedNick ?? username ?? "";
  const setNick = setTypedNick;
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [scanStep, setScanStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<GuidePlatform>("mobile");
  /** Аккаунт, подтверждённый самим Roblox после приёма ключа (с аватаром). */
  const [confirmed, setConfirmed] = useState<KeyAccount | null>(null);
  /**
   * Что ключ СДЕЛАЛ с живым заказом прямо сейчас.
   *
   * Без этого экран говорил «ключ привязан, пригодится в следующий раз» человеку,
   * у которого заказ висит в эту самую минуту (жалоба владельца 07.09.2026).
   */
  const [applied, setApplied] = useState<AppliedOrder | null>(null);
  /**
   * Поле ника показываем, только когда его негде взять. Ник уже спрашивают
   * выше, в профиле, и второе такое же поле рядом читается как ошибка формы
   * (приёмка владельца 07.09.2026): «зачем два раза?».
   */
  const [nickOpen, setNickOpen] = useState(!username);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  useEffect(() => {
    // Устройство выбирается один раз на весь сайт: тот же ключ, что у инструкции.
    const chosen = storedPlatform();
    if (chosen) { setPlatform(chosen); return; }
    const guess = platformFromBrowser();
    if (guess) setPlatform(guess);
  }, []);

  const choosePlatform = useCallback((next: GuidePlatform) => {
    setPlatform(next);
    rememberPlatform(next);
  }, []);

  const isMob = platform === "mobile";

  const submit = useCallback(async () => {
    const key = value.trim();
    const account = nick.trim().replace(/^@/, "");
    if (!key || phase === "scanning") return;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(account)) {
      setError("no_universe");
      setPhase("done");
      return;
    }
    setError(null);
    setPhase("scanning");
    setScanStep(0);
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setScanStep(1), SCAN_STEP_MS),
      setTimeout(() => setScanStep(2), SCAN_STEP_MS * 2),
    ];

    const started = Date.now();
    try {
      const response = await fetch("/api/account/roblox-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, username: account }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; keys?: LinkedKeyView[]; account?: KeyAccount | null; applied?: AppliedOrder | null }
        | null;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, SCAN_MIN_MS - (Date.now() - started))));

      if (body?.ok && Array.isArray(body.keys)) {
        // Ключ больше не нужен в поле — стираем сразу после удачи.
        setValue("");
        setTypedNick(null);
        setKeys(body.keys);
        setConfirmed(body.account ?? null);
        setApplied(body.applied ?? null);
        setPhase("done");
        setOpen(false);
        setNickOpen(false);
        return;
      }
      setError(body?.error ?? "roblox_error");
      setPhase("done");
    } catch {
      setError("network");
      setPhase("done");
    }
  }, [value, nick, phase]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm("Удалить ключ? Геймпассы, созданные раньше, останутся на месте.")) return;
    const response = await fetch("/api/account/roblox-key", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = (await response.json().catch(() => null)) as { keys?: LinkedKeyView[] } | null;
    if (body?.keys) {
      setKeys(body.keys);
      setOpen(body.keys.length === 0);
    }
  }, []);

  if (!enabled) return null;

  const verdict = error ? keyCreateVerdict(error) : null;
  const linked = keys[0] ?? null;

  return (
    <section className={styles.keyCard} aria-label="Ключ для геймпассов">
      <header className={styles.keyHead}>
        <span className={styles.keyBadge}><KeyRound size={15} /> Ключ для геймпассов</span>
        {!linked && <span className={styles.keyNew}>НОВОЕ</span>}
        {linked && <span className={styles.keyOk}><CheckCircle2 size={15} /> Привязан</span>}
      </header>

      {/* Что ключ сделал с живым заказом — первым, до всего остального: это и
          есть ответ на вопрос «а дальше что». */}
      {applied && (
        <div className={styles.keyApplied} role="status">
          {applied.created.length > 0 ? (
            <>
              <strong>
                Геймпасс{applied.created.length > 1 ? "ы" : ""} для заказа {applied.ref} уже созданы
                {" "}({applied.created.map((price) => `${price} R$`).join(" + ")})
              </strong>
              <small>
                Осталось подтвердить заказ на {applied.amount.toLocaleString("ru-RU")} R$ — проверишь ник и геймпасс и нажмёшь «Подтвердить».
              </small>
              <a href={applied.href}>Подтвердить заказ <ChevronRight size={15} /></a>
            </>
          ) : (
            <>
              <strong>Ключ принят, но геймпасс для заказа {applied.ref} создать не вышло</strong>
              <small>{keyCreateVerdict(applied.error ?? "roblox_error").text}</small>
              <a href={applied.href}>Открыть инструкцию по заказу <ChevronRight size={15} /></a>
            </>
          )}
        </div>
      )}

      {linked ? (
        <div className={styles.keyLinked}>
          {/* Аватар и ник — прямо от Roblox, а не то, что человек напечатал:
              единственный способ убедиться, что привязан ТОТ аккаунт. */}
          {confirmed?.avatarUrl && (
            <img className={styles.keyAva} src={confirmed.avatarUrl} alt={`Аватар ${confirmed.name}`} loading="lazy" />
          )}
          <div>
            <strong>@{confirmed?.name ?? linked.username}</strong>
            <small>
              {confirmed
                ? <>Ключ работает на этом аккаунте — робуксы придут сюда. </>
                : null}
              Привязан {fmtDate(linked.linkedAt)}
              {linked.createdPasses > 0
                ? ` · создано геймпассов: ${linked.createdPasses}`
                : " · ждёт первого заказа"}
            </small>
          </div>
          <div className={styles.keyLinkedActions}>
            <button type="button" onClick={() => { setOpen((v) => !v); setError(null); setPhase("idle"); }}>
              <RefreshCw size={15} /> Заменить
            </button>
            <button type="button" onClick={() => void remove(linked.id)} aria-label="Удалить ключ">
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.keyLead}>
          Привяжи ключ один раз — и в следующий заказ тебе останется <b>только оплатить</b>:
          геймпасс нужной цены мы создадим сами. <b>Пароль от Roblox не нужен</b> и никогда не
          понадобится.
        </p>
      )}

      {open && (
        <div className={styles.keyForm}>
          {username && !nickOpen ? (
            <div className={styles.keyFor}>
              <span>Ключ для аккаунта <b>@{username}</b> — в его игре и создадим геймпасс.</span>
              <button type="button" onClick={() => setNickOpen(true)}>другой аккаунт</button>
            </div>
          ) : (
            <>
              <label htmlFor="roblox-key-nick">
                {username ? "Другой ник Roblox" : "Ник Roblox, на котором работает ключ"}
              </label>
              <input
                id="roblox-key-nick"
                value={nick}
                onChange={(event) => setNick(event.target.value)}
                placeholder="Например, Builderman"
                maxLength={20}
                autoComplete="off"
                spellCheck={false}
              />
              <small className={styles.keyNote}>
                Ник нужен, чтобы найти твою игру: геймпасс создаётся внутри неё. Проверим и покажем
                аккаунт с аватаром — убедишься, что не ошибся.
              </small>
            </>
          )}
          <label htmlFor="roblox-key-value">Ключ из Creator Hub</label>
          <textarea
            id="roblox-key-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Длинная строка из букв и цифр"
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <button
            type="button"
            className={styles.keySubmit}
            onClick={() => void submit()}
            disabled={phase === "scanning" || value.trim().length < 20}
          >
            {phase === "scanning" ? <><Loader2 size={16} className={styles.spin} /> Проверяем…</> : <><ShieldCheck size={16} /> Проверить и сохранить</>}
          </button>

          {phase === "scanning" && (
            <div className={styles.keyScan} role="status">
              {[
                "Проверяем ключ в Roblox",
                `Ищем игру аккаунта ${nick.trim() || "…"}`,
                "Проверяем права: чтение и создание",
              ].map((line, index) => (
                <div key={line} className={scanStep > index ? styles.keyScanDone : scanStep === index ? styles.keyScanOn : styles.keyScanLine}>
                  <i>{scanStep > index ? "✓" : index + 1}</i>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}

          {phase === "done" && verdict && (
            <div className={styles.keyFail} role="alert">
              <strong>{verdict.title}</strong>
              <span>{verdict.text}</span>
            </div>
          )}

          <details className={styles.keyHow}>
            <summary>
              <ChevronRight size={16} /> Как выпустить ключ за минуту
            </summary>
            <div className={styles.keyHowBody}>
              <div className={styles.keyDev} role="group" aria-label="Устройство">
                <button type="button" aria-pressed={isMob} onClick={() => choosePlatform("mobile")}>📱 Телефон</button>
                <button type="button" aria-pressed={!isMob} onClick={() => choosePlatform("pc")}>💻 Компьютер</button>
              </div>
              <ol>
                <li>{isMob
                  ? <>Открой приложение Roblox → три полоски внизу справа → пролистай меню вниз до <b>Create</b>.</>
                  : <>Зайди на roblox.com и нажми <b>Create</b> в верхнем меню.</>}</li>
                <li>Нажми <b>лупу</b> справа вверху, напиши <code>api</code> и выбери первый пункт — <b>API Extensions</b>.</li>
                <li>Синяя кнопка <b>Create API Key</b>. Имя обязательное, но любое — хоть <code>1</code>.</li>
                <li>В поле <b>Select API System</b> напиши <code>pass</code> и выбери <b>game-passes</b>. Соседний <b>legacy-game-passes</b> не подойдёт — с ним ключ не умеет ничего.</li>
                <li>
                  Ниже появится блок <b>game-passes</b>, а {isMob ? <>под названием, ниже ползунка,</> : <>справа от названия</>} — <b>пустая рамка со стрелочкой ▾</b>.
                  Нажми на неё и отметь <b>обе</b> строки: <code>game-pass:read</code> и <code>game-pass:write</code>.
                  Готово выглядит так: в рамке лежат две плашки. Пустая рамка — прав нет.
                </li>
                <li><b>Save &amp; Generate Key</b> → галочка <b>I understand the security risks</b> → <b>Copy Key To Clipboard</b> → вставь сюда.</li>
              </ol>
              <figure className={styles.keyShot}>
                <img
                  src={isMob ? "/guide/wb-key-m-ops.jpg" : "/guide/wb-key-pc-ops.jpg"}
                  alt="Рамка операций ключа с добавленными game-pass:read и game-pass:write"
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>Тот самый шаг с правами: в рамке должно лежать <b>две</b> плашки.</figcaption>
              </figure>
              {/* Без `flow=order`: этот признак включает на странице кнопку
                  «Перейти к оформлению» и уводит в кассу. Читателю справки
                  оформлять нечего, а у покупателя с живым заказом ссылка ведёт
                  в ЕГО коридор — с его кодом и его номиналом. */}
              <a className={styles.keyGuideLink} href={activeOrderHref ?? "/guide?source=site&amount=1000"} target="_blank" rel="noopener noreferrer">
                {activeOrderHref ? "Инструкция по твоему заказу" : "Полная инструкция со скриншотами"} <ChevronRight size={15} />
              </a>
            </div>
          </details>

          <small className={styles.keyNote}>
            Ключ умеет ровно одно — создавать геймпассы на твоём аккаунте: ни робуксов, ни покупок,
            ни входа он не даёт. Хранится зашифрованным, удалить можно здесь же или в Creator Hub.
          </small>
        </div>
      )}
    </section>
  );
}

export { GUIDE_PLATFORM_KEY };
