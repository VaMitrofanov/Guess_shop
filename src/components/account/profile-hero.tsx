"use client";

/* eslint-disable @next/next/no-img-element -- аватары с tr.rbxcdn.com грузит
   браузер: оптимизатор Next на RF-хосте этот домен не видит (см. roblox-avatar-renders). */

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Check, Pencil, Shield, X } from "lucide-react";

import {
  AVATAR_MODES,
  BACKGROUNDS,
  BACKGROUND_CSS,
  BACKGROUND_LABEL,
  availableNameModes,
  customNameProblem,
  greetingFor,
  shownName,
  type AvatarMode,
  type NameMode,
  type NameSources,
  type ProfileStyle,
} from "@/lib/profile-style";
import Avatar3d from "./avatar-3d";
import css from "./profile-hero.module.css";

/* 🪪 Карточка профиля в кабинете (18.11.2026, мокап владельца).
   Кабинет — как продолжение Roblox: настоящий персонаж игрока «на подиуме»,
   его имя и ник. Имя можно заменить (Telegram / ВК / своё / «Игрок»), вид
   аватара и фон — выбрать. Статично, без анимаций персонажа (владелец: 2D-
   покачивание смотрится так себе). */

export type HeroRoblox = {
  username: string;
  displayName: string;
  createdYear: number | null;
  headshot: string | null;
  full: string | null;
  bust: string | null;
};

export type HeroBadge = { id: string; label: string; tone: "violet" | "mint" | "orange" | "muted" };

type Props = {
  initialStyle: ProfileStyle;
  sources: NameSources;
  roblox: HeroRoblox | null;
  stats: { robux: number; orders: number; discount: number; bonus: number };
  badges: HeroBadge[];
  isAdmin: boolean;
  /** Сервер может отдать 3D-модель (`ROBLOX_AVATAR_COOKIE` задана и жива). */
  has3d?: boolean;
};

const NAME_LABEL: Record<NameMode, string> = {
  roblox: "Имя из Roblox",
  tg: "Имя из Telegram",
  vk: "Имя из ВКонтакте",
  custom: "Своё имя",
  hidden: "Скрыть имя",
};
const AVATAR_LABEL: Record<AvatarMode, string> = { podium: "На подиуме", bust: "По пояс", portrait: "Портрет", badge: "Без фото" };

const noSubscribe = () => () => {};

function Greeting() {
  // Час — с устройства человека: сервер не знает его часовой пояс.
  const text = useSyncExternalStore(noSubscribe, () => greetingFor(new Date().getHours()), () => "Привет");
  return <span className={css.greeting}>{text},</span>;
}

function Avatar({ mode, roblox, letter, alt, has3d }: { mode: AvatarMode; roblox: HeroRoblox | null; letter: string; alt: string; has3d: boolean }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const fail = (url: string) => setFailed((f) => new Set(f).add(url));
  const ok = (url: string | null | undefined): url is string => Boolean(url && !failed.has(url));
  // Нужной картинки нет — берём ближайшую, а не пустоту.
  const order: Record<AvatarMode, ("full" | "bust" | "headshot")[]> = {
    podium: ["full", "bust", "headshot"],
    bust: ["bust", "headshot", "full"],
    portrait: ["headshot", "bust", "full"],
    badge: [],
  };
  const kind = roblox ? order[mode].find((k) => ok(roblox[k])) : undefined;
  if (!roblox || !kind) {
    return <span className={css.badgeAvatar} aria-hidden="true">{letter}</span>;
  }
  const src = roblox[kind]!;
  if (kind === "full") {
    const flat = <PodiumFigure key={src} src={src} alt={alt} onFail={() => fail(src)} />;
    // 3D — только «на подиуме» и только при живой служебной сессии Roblox.
    return has3d ? <Avatar3d fallback={flat} alt={alt} /> : flat;
  }
  return (
    <span className={kind === "bust" ? css.bustFrame : css.portraitFrame}>
      <img src={src} alt={alt} width={240} height={240} decoding="async" onError={() => fail(src)} />
    </span>
  );
}

/* Рамка полного рендера Roblox — по всему телу С аксессуарами: крылья, меч,
   хвост раздвигают её, и сам персонаж становится мелким и уезжает от центра
   (19.11, жалоба владельца). Поэтому кадрируем по видимым пикселям: картинку
   рисуем в маленький canvas и ищем рамку непрозрачного, по ней ставим
   персонажа одной высоты и ногами на подиум. tr.rbxcdn.com отдаёт
   `Access-Control-Allow-Origin: *`, так что canvas не «портится». Не вышло
   (старый браузер, CDN без CORS) — прежние фиксированные отступы. */
type Box = { x: number; y: number; w: number; h: number };

function alphaBox(img: HTMLImageElement): Box | null {
  const side = 160;
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, side, side);
  const { data } = ctx.getImageData(0, 0, side, side);
  let minX = side, minY = side, maxX = -1, maxY = -1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (data[(y * side + x) * 4 + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  // Камера Roblox смотрит на ТЕЛО, оно по центру кадра, а аксессуары торчат
  // несимметрично — кадр делаем симметричным вокруг середины, иначе персонаж
  // съезжает с подиума в сторону короткого крыла.
  const half = Math.max(0.5 - minX / side, (maxX + 1) / side - 0.5);
  // «Пол» — ноги: нижний непрозрачный пиксель в центральной полосе. Кончик
  // крыла или хвоста бывает ниже ног — по нему персонаж повис бы в воздухе.
  let ground = -1;
  for (let y = side - 1; y >= 0 && ground < 0; y--) {
    for (let x = Math.floor(side * 0.4); x <= Math.ceil(side * 0.6); x++) {
      if (data[(y * side + x) * 4 + 3] > 24) { ground = y; break; }
    }
  }
  if (ground <= minY) ground = maxY;
  return { x: 0.5 - half, y: minY / side, w: 2 * half, h: (ground + 1 - minY) / side };
}

function PodiumFigure({ src, alt, onFail }: { src: string; alt: string; onFail: () => void }) {
  const [box, setBox] = useState<Box | null | "none">(null);
  const measure = useCallback((el: HTMLImageElement) => {
    try {
      setBox(alphaBox(el) ?? "none");
    } catch {
      setBox("none"); // canvas «испорчен» — CORS не пришёл
    }
  }, []);
  // Картинка из кэша успевает загрузиться до гидратации — тогда onLoad уже
  // не придёт, меряем сразу по ref.
  const ref = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) measure(el);
  }, [measure]);
  const img = (
    <img src={src} alt={alt} width={720} height={720} crossOrigin="anonymous" decoding="async" ref={ref} onLoad={(e) => measure(e.currentTarget)} onError={onFail}
      className={box && box !== "none" ? css.figureCropped : css.figure}
      style={box && box !== "none" ? { width: `${100 / box.w}%`, left: `${(-box.x / box.w) * 100}%`, top: `${(-box.y / box.h) * 100}%` } : undefined} />
  );
  return (
    <span className={css.podium}>
      {box && box !== "none"
        ? <span className={css.figureBox} style={{ "--ar": box.w / box.h } as CSSProperties}>{img}</span>
        : <span className={box === null ? css.figureLoading : undefined}>{img}</span>}
      <span className={css.podiumBase} aria-hidden="true" />
    </span>
  );
}

export default function ProfileHero({ initialStyle, sources, roblox, stats, badges, isAdmin, has3d = false }: Props) {
  const [saved, setSaved] = useState(initialStyle);
  const [draft, setDraft] = useState(initialStyle);
  const [customInput, setCustomInput] = useState(initialStyle.customName ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const style = editing ? { ...draft, customName: customInput.trim() || null } : saved;
  const shown = shownName(style, sources);
  const modes = availableNameModes(sources);
  const customProblem = draft.nameMode === "custom" ? customNameProblem(customInput) : null;
  const letter = (shown.name.trim()[0] ?? "R").toUpperCase();
  const sub = shown.showsRoblox && roblox
    ? `@${roblox.username}${roblox.createdYear ? ` · в Roblox с ${roblox.createdYear}` : ""}`
    : roblox ? "ник Roblox скрыт" : "ник Roblox ещё не указан";

  const open = () => { setDraft(saved); setCustomInput(saved.customName ?? ""); setMessage(null); setEditing(true); };
  const cancel = () => { setEditing(false); setMessage(null); };
  const save = async () => {
    if (busy || customProblem) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/account/profile-style", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, customName: customInput.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.style) { setMessage(body.error ?? "Не получилось сохранить"); return; }
      setSaved(body.style);
      setEditing(false);
    } catch {
      setMessage("Нет связи. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={css.wrap} aria-label="Профиль">
      <div className={css.card} style={{ background: BACKGROUND_CSS[style.background] }}>
        <span className={css.ringA} aria-hidden="true" />
        <span className={css.ringB} aria-hidden="true" />
        <div className={`${css.avatarSlot} ${style.avatarMode === "podium" && roblox?.full ? css.avatarTall : ""}`}>
          <Avatar mode={style.avatarMode} roblox={roblox} letter={letter} alt={roblox ? `Персонаж Roblox ${roblox.username}` : ""} has3d={has3d && !editing} />
        </div>
        <div className={css.info}>
          <div className={css.head}>
            <div className={css.who}>
              <Greeting />
              <h1 className={css.name}>{shown.name}</h1>
              <span className={css.sub}>
                {shown.showsRoblox && roblox && <span className={css.check} aria-hidden="true"><Check size={11} strokeWidth={3.5} /></span>}
                {sub}
              </span>
            </div>
            <div className={css.headActions}>
              {isAdmin && <Link href="/admin" className={css.ghost}><Shield size={16} /> Админка</Link>}
              {!editing && <button type="button" className={css.ghost} onClick={open}><Pencil size={16} /> Настроить</button>}
            </div>
          </div>
          <div className={css.tiles}>
            <div><b>{stats.robux.toLocaleString("ru-RU")} R$</b><span>получено через нас</span></div>
            <div><b>{stats.orders}</b><span>{stats.orders === 1 ? "заказ" : stats.orders > 1 && stats.orders < 5 ? "заказа" : "заказов"}</span></div>
            {stats.bonus > 0
              ? <div><b className={css.mint}>{stats.bonus} R$</b><span>бонусов</span></div>
              : <div><b className={css.mint}>{stats.discount > 0 ? `−${stats.discount}%` : "0%"}</b><span>скидка за друзей</span></div>}
          </div>
          {badges.length > 0 && (
            <ul className={css.badges} aria-label="Значки">
              {badges.map((b) => <li key={b.id} className={css[`badge_${b.tone}`]}>{b.label}</li>)}
            </ul>
          )}
          {!roblox && <a href="#roblox-accounts" className={css.connect}>Указать ник Roblox — появится ваш персонаж</a>}
        </div>
      </div>

      {editing && (
        <div className={css.editor} role="group" aria-label="Настройка карточки">
          <fieldset className={css.block}>
            <legend>Как вас показывать</legend>
            <div className={css.options}>
              {modes.map((mode) => (
                <label key={mode} className={draft.nameMode === mode ? css.optionOn : css.option}>
                  <input type="radio" name="name-mode" checked={draft.nameMode === mode} onChange={() => setDraft({ ...draft, nameMode: mode })} />
                  <span><strong>{NAME_LABEL[mode]}</strong><small>{mode === "hidden" ? "Покажем просто «Игрок»" : mode === "custom" ? "Например, для родителей" : shownName({ ...draft, nameMode: mode }, sources).name}</small></span>
                </label>
              ))}
            </div>
            {draft.nameMode === "custom" && (
              <label className={css.field}>
                <span>Своё имя</span>
                <input value={customInput} onChange={(e) => setCustomInput(e.target.value)} maxLength={24} autoComplete="nickname" placeholder="Например, Вадим" />
                {customInput && customProblem && <small className={css.err}>{customProblem}</small>}
              </label>
            )}
            <p className={css.hint}>Это имя видно в кабинете. Ник Roblox для заказов не меняется.</p>
          </fieldset>

          <fieldset className={css.block}>
            <legend>Аватар</legend>
            <div className={css.avatars}>
              {AVATAR_MODES.map((mode) => {
                const img = mode === "podium" ? roblox?.full : mode === "bust" ? roblox?.bust : mode === "portrait" ? roblox?.headshot : null;
                if (mode !== "badge" && !img) return null;
                return (
                  <label key={mode} className={draft.avatarMode === mode ? css.thumbOn : css.thumb}>
                    <input type="radio" name="avatar-mode" checked={draft.avatarMode === mode} onChange={() => setDraft({ ...draft, avatarMode: mode })} />
                    {img ? <img src={img} alt="" width={88} height={88} loading="lazy" decoding="async" /> : <span className={css.thumbLetter}>{letter}</span>}
                    <span>{AVATAR_LABEL[mode]}</span>
                  </label>
                );
              })}
            </div>
            {roblox && <p className={css.hint}>Картинки — с вашего аккаунта Roblox. Сменили образ в игре — обновится здесь сам.</p>}
          </fieldset>

          <fieldset className={css.block}>
            <legend>Фон карточки</legend>
            <div className={css.swatches}>
              {BACKGROUNDS.map((bg) => (
                <label key={bg} className={draft.background === bg ? css.swatchOn : css.swatch} style={{ background: BACKGROUND_CSS[bg] }} title={BACKGROUND_LABEL[bg]}>
                  <input type="radio" name="background" checked={draft.background === bg} onChange={() => setDraft({ ...draft, background: bg })} aria-label={BACKGROUND_LABEL[bg]} />
                </label>
              ))}
            </div>
          </fieldset>

          <div className={css.editorActions}>
            {message && <p className={css.err} role="status">{message}</p>}
            <button type="button" className={css.secondaryBtn} onClick={cancel} disabled={busy}><X size={16} /> Отмена</button>
            <button type="button" className={css.primaryBtn} onClick={save} disabled={busy || Boolean(customProblem)}>{busy ? "Сохраняем…" : "Сохранить"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
