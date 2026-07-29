"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Gamepad2,
  Gift,
  Pencil,
  RefreshCw,
  Shield,
  ShoppingCart,
  Unlink,
  UserRound,
} from "lucide-react";

import type { CustomerRobloxProfile } from "@/lib/roblox-profile";
import styles from "@/app/dashboard/dashboard.module.css";

type ProfilePayload = {
  status: string;
  profile: CustomerRobloxProfile | null;
  suggestedUsername?: string | null;
};

type CustomerRobloxProfileCardProps = {
  initial: ProfilePayload;
  fallbackName: string;
  bonusAmount: number;
  bonusCaption: string;
  isAdmin: boolean;
  activeOrderHref: string | null;
};

function profileDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(value));
}

export default function CustomerRobloxProfileCard({
  initial,
  fallbackName,
  bonusAmount,
  bonusCaption,
  isAdmin,
  activeOrderHref,
}: CustomerRobloxProfileCardProps) {
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
  const checkoutHref = profile ? `/checkout?username=${encodeURIComponent(profile.username)}` : "/checkout";
  return (
    <div className={styles.robloxHeroShell} aria-label="Профиль Roblox">
      <section className={styles.robloxHeroMain}>
        <span className={styles.robloxHeroBadge}>
          {profile ? <CheckCircle2 size={16} /> : <Gamepad2 size={16} />}
          {profile ? "Мой Roblox" : "Личный кабинет"}
        </span>
        <div className={styles.robloxHeroIdentity}>
          <span className={styles.robloxHeroAvatar}>
            {profile?.avatarUrl
              ? <Image src={profile.avatarUrl} width={108} height={108} alt={`Аватар ${profile.username}`} unoptimized />
              : <UserRound size={42} />}
          </span>
          <div className={styles.robloxHeroCopy}>
            {!profile && <small className={styles.robloxHeroGreeting}>Привет, {fallbackName}</small>}
            <h1 className={styles.robloxHeroTitle}>{profile?.displayName ?? "Подключи Roblox-профиль"}</h1>
            <span className={styles.robloxHeroUsername}>{profile ? `@${profile.username}` : "Один профиль — быстрые покупки без повторного ввода ника"}</span>
            <small className={styles.robloxHeroStatus}>
              {profile
                ? payload.status === "stale" || profile.stale ? "Последняя сохранённая версия" : "Публичные данные подтверждены Roblox"
                : "Ник из старого заказа можно предложить, но привязка происходит только после твоего подтверждения"}
            </small>
          </div>
        </div>
        {profile?.description && <p className={styles.robloxHeroDescription}>{profile.description}</p>}
        <div className={styles.actions}>
          <Link href={checkoutHref} className={styles.primary}>
            <ShoppingCart size={18} /> {profile ? "Купить на этот аккаунт" : "Купить Robux"}
          </Link>
          {profile && (
            <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer" className={styles.secondary}>
              Открыть профиль <ExternalLink size={16} />
            </a>
          )}
          {activeOrderHref && <Link href={activeOrderHref} className={styles.secondary}>Активный заказ <ArrowRight size={17} /></Link>}
          {isAdmin && <Link href="/admin" className={styles.adminAction}><Shield size={18} /> Админка <ArrowRight size={17} /></Link>}
        </div>
      </section>

      <aside className={styles.robloxHeroRail} aria-label="Данные профиля и бонусы">
        <div className={styles.robloxBonusCompact}>
          <span><Gift size={18} /> Бонусы</span>
          <strong>{bonusAmount}<small> R$</small></strong>
          <p>{bonusCaption}</p>
          <i aria-hidden="true"><b style={{ width: bonusAmount > 0 ? "72%" : "12%" }} /></i>
        </div>
        <div className={styles.robloxMetaCard}>
          <div className={styles.sideHead}>
            <span><Gamepad2 size={18} /> Профиль Roblox</span>
            {profile && <CheckCircle2 size={18} />}
          </div>
          {profile ? (
            <>
              <dl className={styles.profileRows}>
                <div><dt>Roblox ID</dt><dd>{profile.id}</dd></div>
                {profileDate(profile.createdAt) && <div><dt>Аккаунт с</dt><dd>{profileDate(profile.createdAt)}</dd></div>}
              </dl>
              <div className={styles.robloxProfileControls}>
                <button type="button" onClick={() => { setEditing((value) => !value); setMessage(null); }}><Pencil size={15} /> Сменить</button>
                <button type="button" onClick={disconnect} disabled={busy} aria-label="Отвязать Roblox"><Unlink size={15} /></button>
              </div>
            </>
          ) : (
            <div className={styles.robloxConnectPrompt}>
              <p>Добавь ник — покажем настоящий аватар и будем подставлять аккаунт в покупку.</p>
              {!editing && <button type="button" onClick={() => setEditing(true)}>Подключить профиль</button>}
            </div>
          )}
        </div>
      </aside>

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
    </div>
  );
}
