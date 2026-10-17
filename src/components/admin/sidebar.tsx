"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Ellipsis,
  ExternalLink,
  Handshake,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Shield,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import styles from "./admin-shell.module.css";

const PRIMARY_NAV = [
  { href: "/admin", icon: LayoutDashboard, label: "Обзор" },
  { href: "/admin/orders", icon: ShoppingCart, label: "Заказы" },
  { href: "/admin/buyout", icon: ShoppingBasket, label: "Выкуп" },
];

const SECONDARY_NAV = [
  { href: "/admin/wildberries/delivery", icon: Truck, label: "WB Доставка" },
  { href: "/admin/economics", icon: Wallet, label: "Экономика" },
  { href: "/admin/partners/anton", icon: Handshake, label: "Антон" },
  { href: "/admin/activity", icon: Activity, label: "Журнал" },
  { href: "/admin/users", icon: Users, label: "Пользователи" },
  { href: "/admin/reviews", icon: MessageSquare, label: "Отзывы" },
  { href: "/admin/faq", icon: HelpCircle, label: "FAQ" },
];

const NAV = [...PRIMARY_NAV, ...SECONDARY_NAV];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/admin" && pathname.startsWith(href));
}

export default function AdminSidebar({ user }: { user: { name?: string | null; via?: "telegram" | "break-glass" } }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const current = NAV.find((item) => isActive(pathname, item.href));
  const initials = (user.name ?? "Admin")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!moreOpen) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [moreOpen]);

  function closeMore() {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  }

  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><Shield size={18} /></div>
          <div><strong>RobloxBank</strong><small>Control Center</small></div>
        </div>
        <div className={styles.sectionLabel}>Управление</div>
        <nav className={styles.nav} aria-label="Разделы админки">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(styles.navLink, active && styles.navLinkActive)}
              >
                <Icon aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.navSpacer} />
        <section className={styles.ecosystem}>
          <strong>Единая экосистема</strong>
          <p>Те же заказы, платежи и возвраты доступны в мобильной TWA.</p>
          <Link href="/twa" target="_blank"><Smartphone size={13} /> Открыть TWA <ExternalLink size={11} /></Link>
        </section>
        <div className={styles.profile}>
          <strong>{user.name ?? "Admin"}</strong>
          <small>{user.via === "break-glass" ? "Запасной вход" : "Вход через Telegram"}</small>
          <button onClick={() => signOut({ callbackUrl: "/admin/login" })}>
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </aside>

      <header className={styles.mobileTopbar}>
        <div className={styles.mobileBrandMark}><Shield aria-hidden="true" /></div>
        <div className={styles.mobileTitle}>
          <span>{current?.label ?? "Control Center"}</span>
          <small><i /> Production</small>
        </div>
        <button
          type="button"
          className={styles.mobileAccount}
          onClick={() => setMoreOpen(true)}
          aria-label="Открыть меню профиля"
        >
          {initials}
        </button>
      </header>

      <nav className={styles.mobileBottomNav} aria-label="Основная навигация">
        {PRIMARY_NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(styles.mobileBottomLink, active && styles.mobileBottomLinkActive)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          type="button"
          className={cn(
            styles.mobileBottomLink,
            SECONDARY_NAV.some((item) => isActive(pathname, item.href)) && styles.mobileBottomLinkActive,
          )}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-controls="admin-more-menu"
        >
          <Ellipsis aria-hidden="true" />
          <span>Ещё</span>
        </button>
      </nav>

      {moreOpen && (
        <div className={styles.mobileMoreBackdrop} onMouseDown={(event) => event.target === event.currentTarget && closeMore()}>
          <section id="admin-more-menu" className={styles.mobileMoreSheet} role="dialog" aria-modal="true" aria-labelledby="admin-more-title">
            <div className={styles.mobileMoreHandle} />
            <div className={styles.mobileMoreHeader}>
              <div><span id="admin-more-title">Все разделы</span><small>{user.name ?? "Admin"}</small></div>
              <button ref={closeButtonRef} type="button" onClick={closeMore} aria-label="Закрыть меню"><X /></button>
            </div>
            <nav className={styles.mobileMoreGrid} aria-label="Дополнительные разделы">
              {SECONDARY_NAV.map(({ href, icon: Icon, label }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(styles.mobileMoreLink, active && styles.mobileMoreLinkActive)}
                  >
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                );
              })}
              <Link className={styles.mobileMoreLink} href="/twa" target="_blank" onClick={() => setMoreOpen(false)}>
                <Smartphone aria-hidden="true" /><span>TWA</span>
              </Link>
            </nav>
            <button className={styles.mobileSignOut} onClick={() => signOut({ callbackUrl: "/admin/login" })}>
              <LogOut aria-hidden="true" /> Выйти из админки
            </button>
          </section>
        </div>
      )}
    </>
  );
}
