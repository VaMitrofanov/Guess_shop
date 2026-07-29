"use client";

import Image from "next/image";
import { useState } from "react";
import { CheckCircle2, ExternalLink, Gamepad2, RefreshCw, Unlink, UserRound } from "lucide-react";

import type { CustomerRobloxProfile } from "@/lib/roblox-profile";
import styles from "@/app/dashboard/dashboard.module.css";

type ProfilePayload = {
  status: string;
  profile: CustomerRobloxProfile | null;
  suggestedUsername?: string | null;
};

function profileDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(value));
}

export default function CustomerRobloxProfileCard({ initial }: { initial: ProfilePayload }) {
  const [payload, setPayload] = useState(initial);
  const [editing, setEditing] = useState(!initial.profile && !initial.suggestedUsername);
  const [username, setUsername] = useState(initial.profile?.username ?? initial.suggestedUsername ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = async () => {
    if (!username.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/roblox-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.profile) {
        setMessage(body.error ?? "Не удалось найти профиль Roblox");
        return;
      }
      setPayload(body);
      setUsername(body.profile.username);
      setEditing(false);
      setMessage("Профиль обновлён");
    } catch {
      setMessage("Roblox временно недоступен");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy || !window.confirm("Отвязать Roblox-профиль? Старые заказы не изменятся.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/roblox-profile", { method: "DELETE" });
      if (!response.ok) throw new Error("disconnect failed");
      setPayload({ status: "missing-username", profile: null, suggestedUsername: null });
      setUsername("");
      setEditing(true);
      setMessage("Профиль отвязан");
    } catch {
      setMessage("Не удалось отвязать профиль");
    } finally {
      setBusy(false);
    }
  };

  const profile = payload.profile;
  return (
    <section className={`${styles.profileCard} ${styles.robloxProfileCard}`} aria-label="Профиль Roblox">
      <div className={styles.sideHead}>
        <span><Gamepad2 size={18} /> Профиль Roblox</span>
        {profile && <CheckCircle2 size={18} />}
      </div>

      {profile ? (
        <>
          <div className={styles.robloxProfileHero}>
            <span className={styles.robloxAvatar}>
              {profile.avatarUrl
                ? <Image src={profile.avatarUrl} width={82} height={82} alt={`Аватар ${profile.username}`} unoptimized />
                : <UserRound size={34} />}
            </span>
            <div>
              <strong>{profile.displayName}</strong>
              <span>@{profile.username}</span>
              <small>{payload.status === "stale" || profile.stale ? "Последняя сохранённая версия" : "Найден в Roblox"}</small>
            </div>
          </div>
          {profile.description && <p className={styles.robloxDescription}>{profile.description}</p>}
          <dl className={styles.profileRows}>
            <div><dt>Roblox ID</dt><dd>{profile.id}</dd></div>
            {profileDate(profile.createdAt) && <div><dt>Аккаунт с</dt><dd>{profileDate(profile.createdAt)}</dd></div>}
          </dl>
          <div className={styles.robloxActions}>
            <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer">Открыть в Roblox <ExternalLink size={14} /></a>
            <button type="button" onClick={() => { setEditing((value) => !value); setMessage(null); }}>Сменить</button>
            <button type="button" onClick={disconnect} disabled={busy} aria-label="Отвязать Roblox"><Unlink size={15} /></button>
          </div>
        </>
      ) : (
        <div className={styles.robloxEmpty}>
          <span><Gamepad2 size={25} /></span>
          <strong>Добавьте Roblox-профиль</strong>
          <p>Покажем аватар, display name и прямую ссылку на профиль.</p>
          {!editing && <button type="button" onClick={() => setEditing(true)}>Найти профиль</button>}
        </div>
      )}

      {editing && (
        <div className={styles.robloxEditor}>
          <label htmlFor="roblox-profile-username">Ник Roblox</label>
          <div>
            <input id="roblox-profile-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Например, Builderman" maxLength={20} autoComplete="off" />
            <button type="button" onClick={save} disabled={busy || username.trim().length < 3}>
              {busy ? <RefreshCw size={16} className={styles.spin} /> : "Найти"}
            </button>
          </div>
          <small>Мы загружаем только публичные данные Roblox. Это не проверка владения аккаунтом.</small>
        </div>
      )}
      {message && <p className={styles.robloxMessage} role="status">{message}</p>}
    </section>
  );
}
