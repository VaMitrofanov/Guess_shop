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
}: {
  initialKeys: LinkedKeyView[];
  /** Ник выбранного профиля — на его аккаунте ключ и работает. */
  username: string | null;
  /** Метод включён флагом `GAMEPASS_AUTOCREATE`. */
  enabled: boolean;
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
        | { ok?: boolean; error?: string; keys?: LinkedKeyView[] }
        | null;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, SCAN_MIN_MS - (Date.now() - started))));

      if (body?.ok && Array.isArray(body.keys)) {
        // Ключ больше не нужен в поле — стираем сразу после удачи.
        setValue("");
        setTypedNick(null);
        setKeys(body.keys);
        setPhase("done");
        setOpen(false);
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

      {linked ? (
        <div className={styles.keyLinked}>
          <div>
            <strong>@{linked.username}</strong>
            <small>
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
          <label htmlFor="roblox-key-nick">Ник Roblox, на котором работает ключ</label>
          <input
            id="roblox-key-nick"
            value={nick}
            onChange={(event) => setNick(event.target.value)}
            placeholder="Например, Builderman"
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
          />
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
              <a className={styles.keyGuideLink} href="/guide?source=site&flow=order&amount=1000" target="_blank" rel="noopener noreferrer">
                Полная инструкция со скриншотами <ChevronRight size={15} />
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
