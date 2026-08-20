"use client";

import Link from "next/link";
import Image from "next/image";
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
  accounts: CustomerRobloxProfile[];
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

function profileAvatarSrc(avatarUrl: string | null | undefined) {
  return avatarUrl || null;
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
  const [editing, setEditing] = useState(!initial.profile);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedAvatarUrls, setFailedAvatarUrls] = useState<Set<string>>(() => new Set());

  const markAvatarFailed = (avatarUrl: string) => {
    setFailedAvatarUrls((failed) => {
      if (failed.has(avatarUrl)) return failed;
      return new Set(failed).add(avatarUrl);
    });
  };

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
      setUsername("");
      setEditing(false);
      setMessage("Профиль обновлён");
    } catch {
      setMessage("Roblox временно недоступен");
    } finally {
      setBusy(false);
    }
  };

  const selectAccount = async (accountId: string) => {
    if (busy || payload.profile?.accountId === accountId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account/roblox-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "select", accountId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.profile) throw new Error("select failed");
      setPayload(body);
      setMessage(`Выбран @${body.profile.username}`);
    } catch {
      setMessage("Не удалось выбрать аккаунт");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!payload.profile || busy || !window.confirm("Скрыть этот Roblox-аккаунт из личного кабинета? Старые заказы не изменятся.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/roblox-profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: payload.profile.accountId }),
      });
      if (!response.ok) throw new Error("disconnect failed");
      const body = await response.json();
      setPayload(body);
      setUsername("");
      setEditing(!body.profile);
      setMessage("Аккаунт скрыт");
    } catch {
      setMessage("Не удалось отвязать профиль");
    } finally {
      setBusy(false);
    }
  };

  const profile = payload.profile;
  const checkoutHref = profile
    ? `/checkout?accountId=${encodeURIComponent(profile.accountId)}&username=${encodeURIComponent(profile.username)}`
    : "/checkout";
  // Картинку тянет браузер, а не мы. `tr.rbxcdn.com` с RF-хоста не резолвится
  // вовсе — CNAME обрывается на `trns1.rbxcdn.com` без A-записи, — так что и
  // оптимизатор Next (500), и прежний серверный прокси (502) были обречены.
  // У покупателя тот же адрес резолвится нормально.
  const mainAvatarUrl = profileAvatarSrc(profile?.avatarUrl);
  const visibleMainAvatarUrl = mainAvatarUrl && !failedAvatarUrls.has(mainAvatarUrl)
    ? mainAvatarUrl
    : null;
  return (
    <div className={styles.robloxHeroShell} aria-label="Профиль Roblox">
      <section className={styles.robloxHeroMain}>
        <span className={styles.robloxHeroBadge}>
          {profile ? <CheckCircle2 size={16} /> : <Gamepad2 size={16} />}
          {profile ? "Мой Roblox" : "Личный кабинет"}
        </span>
        <div className={styles.robloxHeroIdentity}>
          <span className={styles.robloxHeroAvatar}>
            {visibleMainAvatarUrl
              ? <Image src={visibleMainAvatarUrl} width={108} height={108} alt={`Аватар ${profile!.username}`} unoptimized onError={() => markAvatarFailed(visibleMainAvatarUrl)} />
              : <UserRound size={42} />}
          </span>
          <div className={styles.robloxHeroCopy}>
            {!profile && <small className={styles.robloxHeroGreeting}>Привет, {fallbackName}</small>}
            <h1 className={styles.robloxHeroTitle}>{profile?.displayName ?? "Подключи Roblox-профиль"}</h1>
            <span className={styles.robloxHeroUsername}>{profile ? `@${profile.username}` : "Быстрые покупки без повторного ввода ника"}</span>
            <small className={styles.robloxHeroStatus}>
              {profile
                ? profile.source === "ORDER_HISTORY"
                  ? `Подтверждён заказом${profile.orderCount > 1 ? ` · покупок: ${profile.orderCount}` : ""}. Это не проверка владения аккаунтом.`
                  : payload.status === "stale" || profile.stale ? "Добавлен вручную · последняя сохранённая версия" : "Добавлен вручную · публичные данные Roblox"
                : "Если раньше уже покупал, аккаунты появятся автоматически. Новый ник можно добавить отдельно."}
            </small>
          </div>
        </div>
        {payload.accounts.length > 1 && (
          <div className={styles.robloxAccountSwitcher} aria-label="Roblox-аккаунты из ваших заказов">
            <span>Аккаунт для покупки</span>
            <div>
              {payload.accounts.map((item) => {
                const avatarUrl = profileAvatarSrc(item.avatarUrl);
                const visibleAvatarUrl = avatarUrl && !failedAvatarUrls.has(avatarUrl) ? avatarUrl : null;
                return (
                  <button
                    key={item.accountId}
                    type="button"
                    className={item.selected ? styles.robloxAccountActive : styles.robloxAccountChoice}
                    onClick={() => void selectAccount(item.accountId)}
                    disabled={busy}
                    aria-pressed={item.selected}
                  >
                    {visibleAvatarUrl
                      ? <Image src={visibleAvatarUrl} width={30} height={30} alt="" unoptimized onError={() => markAvatarFailed(visibleAvatarUrl)} />
                      : <UserRound size={16} />}
                    <span><strong>{item.displayName}</strong><small>@{item.username}</small></span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {profile?.description && <p className={styles.robloxHeroDescription}>{profile.description}</p>}
        <div className={styles.actions}>
          <Link href={checkoutHref} className={styles.primary}>
            <ShoppingCart size={18} /> {profile ? "Купить на этот аккаунт" : "Купить Robux"}
          </Link>
          {profile?.profileUrl && (
            <a
              href={profile.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.secondary} ${styles.robloxExternalAction}`}
              aria-label={`Открыть официальный профиль ${profile.username} в Roblox`}
            >
              <Gamepad2 size={18} />
              <span><strong>Открыть в Roblox</strong><small>Официальный профиль Roblox</small></span>
              <ExternalLink size={16} />
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
                <button type="button" onClick={() => { setEditing((value) => !value); setMessage(null); }}><Pencil size={15} /> Добавить ник</button>
                <button type="button" onClick={disconnect} disabled={busy} aria-label="Скрыть Roblox-аккаунт"><Unlink size={15} /></button>
              </div>
            </>
          ) : (
            <div className={styles.robloxConnectPrompt}>
              <p>Аккаунты из оплаченных и выполненных заказов появятся здесь сами. Другой ник можно добавить вручную.</p>
              {!editing && <button type="button" onClick={() => setEditing(true)}>Добавить новый ник</button>}
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
          <small>Новый ник добавляется отдельно. Мы загружаем только публичные данные Roblox — это не проверка владения аккаунтом.</small>
        </div>
      )}
      {message && <p className={styles.robloxMessage} role="status">{message}</p>}
    </div>
  );
}
