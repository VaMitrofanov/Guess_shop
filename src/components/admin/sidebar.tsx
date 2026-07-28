"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, MessageSquare, HelpCircle,
  ShoppingCart, Users, LogOut, Shield, ExternalLink, Activity, Smartphone,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import styles from "./admin-shell.module.css";

// A0.1: пункт «Legacy-каталог» вёл на `/admin/products` — страницу удалили при
// чистке legacy 26.07, а ссылку забыли, и она отдавала 404 в проде.
const NAV = [
  { href: "/admin",          icon: LayoutDashboard, label: "Дашборд"   },
  { href: "/admin/orders",   icon: ShoppingCart,    label: "Заказы"    },
  { href: "/admin/activity", icon: Activity,        label: "Журнал"    },
  { href: "/admin/users",    icon: Users,           label: "Пользователи" },
  { href: "/admin/reviews",  icon: MessageSquare,   label: "Отзывы"    },
  { href: "/admin/faq",      icon: HelpCircle,      label: "FAQ"       },
];

export default function AdminSidebar({ user }: { user: { name?: string | null; via?: "telegram" | "break-glass" } }) {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandMark}><Shield size={18} /></div>
        <div><strong>RobloxBank</strong><small>Control Center</small></div>
      </div>
      <div className={styles.sectionLabel}>Управление</div>
      <nav className={styles.nav}>
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                styles.navLink,
                active && styles.navLinkActive,
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
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
        <button
          onClick={() => signOut({ callbackUrl: "/admin/login" })}
        >
          <LogOut size={15} /> Выйти
        </button>
      </div>
    </aside>
  );
}
