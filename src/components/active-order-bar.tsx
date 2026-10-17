"use client";

/**
 * Строка «твой заказ» — то, что видно на каждой странице сайта.
 *
 * Решение владельца 07.09.2026: пока заказ не собран, покупателя ведут за руку;
 * как только собран — он ходит где хочет, но заказ и его статус висят перед
 * глазами и в боте, и на сайте. В боте это делает приветствие `/start`, здесь —
 * эта полоса под шапкой.
 *
 * Ссылка «продолжить» приходит с сервера (`@/lib/active-order`) и для заказа
 * коридора всегда ведёт в ЕГО инструкцию с его кодом. Собирать её здесь нельзя:
 * ровно на такой самодельной ссылке (`source=site&flow=order`) 07.09 покупатель
 * с оплаченным заказом WB уехал в кассу и завёл второй, платный заказ.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Clock, Loader2, Package } from "lucide-react";

interface ActiveOrder {
  ref: string;
  amount: number;
  status: string;
  label: string;
  tone: string;
  href: string;
  corridor: boolean;
  needsGamepass: boolean;
}

export default function ActiveOrderBar({ enabled }: { enabled: boolean }) {
  const [order, setOrder] = useState<ActiveOrder | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/account/active-order");
        if (!res.ok) return;
        const data = (await res.json()) as { order: ActiveOrder | null };
        if (alive) setOrder(data.order ?? null);
      } catch {
        // Полоса — подсказка, а не функциональность: молча ничего не показываем.
      }
    })();
    return () => { alive = false; };
    // `pathname` в зависимостях намеренно: статус меняется по ходу заказа, и
    // переход на другую страницу — самый дешёвый повод его перечитать.
  }, [enabled, pathname]);

  if (!enabled || !order) return null;

  const Icon = order.needsGamepass ? Clock : order.status === "IN_PROGRESS" ? Loader2 : Package;
  const cta = order.needsGamepass ? "Продолжить заказ" : "Смотреть заказ";

  return (
    <div
      className="border-t border-[var(--rb-border)] bg-[var(--rb-accent-soft)] text-[var(--rb-text)]"
      role="status"
      aria-label="Твой заказ"
    >
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 md:px-7">
        <Icon size={15} className="shrink-0 text-[var(--rb-accent)]" aria-hidden="true" />
        <span className="text-[13px] font-extrabold tracking-[-0.01em] sm:text-sm">
          Заказ {order.ref} · {order.amount.toLocaleString("ru-RU")} R$
        </span>
        <span className="text-[13px] font-bold text-[var(--rb-muted)] sm:text-sm">{order.label}</span>
        <Link
          href={order.href}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--rb-strong)] px-3 py-1.5 text-[13px] font-extrabold text-white transition-transform hover:-translate-y-0.5 sm:text-sm"
        >
          {cta} <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
