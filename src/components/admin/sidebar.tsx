"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Package, MessageSquare, HelpCircle,
  ShoppingCart, Users, LogOut, Shield, ExternalLink,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin",          icon: LayoutDashboard, label: "Дашборд"   },
  { href: "/admin/orders",   icon: ShoppingCart,    label: "Заказы"    },
  { href: "/admin/products", icon: Package,         label: "Товары"    },
  { href: "/admin/users",    icon: Users,           label: "Пользователи" },
  { href: "/admin/reviews",  icon: MessageSquare,   label: "Отзывы"    },
  { href: "/admin/faq",      icon: HelpCircle,      label: "FAQ"       },
];

export default function AdminSidebar({ user }: { user: { name?: string | null; email?: string | null } }) {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col border-r border-[#1e2a45] bg-[#080c18] min-h-screen sticky top-0">

      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-[#1e2a45]">
        <div className="w-8 h-8 bg-[#00b06f] flex items-center justify-center flex-shrink-0 relative">
          <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-[#080c18]" />
          <div className="absolute bottom-0 left-0 w-1.5 h-1.5 bg-[#080c18]" />
          <Shield className="w-4 h-4 text-white relative z-10" />
        </div>
        <div className="leading-none">
          <div className="text-[10px] font-black uppercase tracking-widest text-white">Admin</div>
          <div className="text-[9px] font-black uppercase tracking-widest text-[#00b06f]">Panel</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== "/admin" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-xs font-black uppercase tracking-widest transition-colors rounded-none border-l-2",
                active
                  ? "border-[#00b06f] text-[#00b06f] bg-[#00b06f]/8"
                  : "border-transparent text-zinc-500 hover:text-zinc-200 hover:border-zinc-600 hover:bg-white/3"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: user info + links */}
      <div className="border-t border-[#1e2a45] p-3 space-y-1">
        <Link
          href="/"
          target="_blank"
          className="flex items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-widest text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Сайт
        </Link>

        <div className="px-3 py-2 space-y-0.5">
          <p className="text-[10px] font-black text-zinc-400 truncate">{user.name ?? "Admin"}</p>
          <p className="text-[9px] text-zinc-600 truncate">{user.email}</p>
        </div>

        <button
          onClick={() => signOut({ callbackUrl: "/admin/login" })}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-black uppercase tracking-widest text-zinc-600 hover:text-red-400 hover:bg-red-500/5 transition-colors border-l-2 border-transparent hover:border-red-500/30"
        >
          <LogOut className="w-4 h-4" />
          Выйти
        </button>
      </div>
    </aside>
  );
}
