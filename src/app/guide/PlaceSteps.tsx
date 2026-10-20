"use client";
/* eslint-disable @next/next/no-img-element -- кадры инструкции: тот же <img>, что у остальных шагов гайда, адреса общие с ботами */

/* ─────────────────────────────────────────────────────────────────────────────
   «Нет игры — создай плейс» (20.10.2026).

   У нового аккаунта Roblox нет ни одного плейса, а без плейса геймпасс не
   создать ни ключом, ни руками. Создаётся он только в Roblox Studio — два
   действия. Тексты и кадры общие с ботами (`bots/shared/no-place.ts`): бот
   шлёт эти же картинки альбомом и ведёт сюда кнопкой (`?stage=place`).
   ───────────────────────────────────────────────────────────────────────── */

import { PLACE_STEPS, STUDIO_DOWNLOAD_URL } from "../../../bots/shared/no-place";

export default function PlaceSteps({ onDone }: { onDone?: () => void }) {
  const [check, step1, step2] = PLACE_STEPS;
  return (
    <section className="wbi-rescue" id="place">
      <span className="k">🆕 Новый аккаунт</span>
      <h3>Нет своей игры? Сделай её за 2 минуты</h3>
      <p>
        Геймпасс живёт внутри игры (плейса). У нового аккаунта её ещё нет — Roblox не создаёт её сам.
        Создать можно только в <b>Roblox Studio</b>, а он работает <b>только на компьютере</b> (Windows или Mac).
      </p>

      <figure className="wbi-figure wbi-shot">
        <img src={check.image} alt="Creator Hub, раздел Creations: карточка плейса обведена" loading="lazy" decoding="async" />
        <figcaption>{check.caption}</figcaption>
      </figure>

      <div className="wbi-how">
        <b>Шаг 1. Скачай Roblox Studio</b>
        <span className="wbi-path">Открой, войди в свой аккаунт Roblox и нажми <b>New Experience</b>.</span>
        <a className="wbi-bigbtn" href={STUDIO_DOWNLOAD_URL} target="_blank" rel="noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, padding: "14px 18px", marginTop: 10, textDecoration: "none" }}>
          ⬇️ Скачать Roblox Studio
        </a>
        <figure className="wbi-figure wbi-shot">
          <img src={step1.image} alt={step1.caption} loading="lazy" decoding="async" />
        </figure>
      </div>

      <div className="wbi-how">
        <b>Шаг 2. Опубликуй</b>
        <span className="wbi-path">Сверху <b>File</b> → <b>Publish to Roblox</b>. Название любое — нажми <b>Create</b>.</span>
        <figure className="wbi-figure wbi-shot">
          <img src={step2.image} alt={step2.caption} loading="lazy" decoding="async" />
        </figure>
      </div>

      <div className="wbi-ok" style={{ marginTop: 12 }}>
        <b>Готово — плейс есть.</b> Вставь ключ ещё раз (тот же самый, новый делать не нужно) — и мы создадим геймпасс.
        Компьютера нет — напиши нам в бот, поможем.
      </div>
      {onDone && (
        <button className="wbi-bigbtn" style={{ marginTop: 12 }} onClick={onDone}>
          🔑 Плейс создан — вставить ключ
        </button>
      )}
    </section>
  );
}
