"use client";
import { usePathname } from "next/navigation";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

/* ─────────────────────────────────────────────────────────────────────────────
   Сессию next-auth спрашиваем там, где её кто-то читает.

   Провайдер живёт в корневом layout, то есть накрывает и витрину, и админку,
   и TWA. Витрине он нужен: `Navbar` показывает «Кабинет» и «Админка» по
   `useSession`. А в консоли админа и в TWA `useSession` не вызывает НИКТО —
   личность там приходит с сервера (`resolveAdminFromSession` в layout) или
   Bearer-пропуском TWA. Провайдер всё равно ходил в `/api/auth/session`: один
   раз на монтировании и ещё раз на каждом возврате фокуса во вкладку.

   На проде это стоило дороже, чем выглядит: гейт админки читает базу, база
   в Сингапуре (210 мс за round-trip), и два таких запроса на открытии
   «Заказов» отнимали ядра у самой ленты — при замере 04.09.2026 второй
   `/api/auth/session` шёл 1 653 мс, конкурируя с запросом заказов.

   Приём — штатный для next-auth: если `session` передан, провайдер считает
   себя синхронизированным и не идёт в сеть (ни на монтировании, ни по фокусу,
   пока значение `null`). Отдаём `null` там, где сессия никому не нужна.

   `key` обязателен. Провайдер решает «синхронизирован ли я» ОДИН раз, в
   инициализаторе состояния; без пересоздания уход из админки на витрину
   оставил бы `Navbar` навсегда разлогиненным — без единого запроса, которым
   это можно было бы исправить. Ключ меняется только на переходе между двумя
   мирами, а внутри каждого стабилен.

   Безопасность это не трогает ни в какую сторону: доступ в админку даёт
   серверный гейт (`requireAdmin` / `resolveAdminFromSession`), а клиентская
   сессия управляет только тем, какие ссылки нарисовать. `null` здесь
   fail-closed — «ничего не показывать», а не «показать лишнее».

   То, что консоль и TWA не читают `useSession`, держит тест
   `src/__tests__/session-provider-scope.test.ts`: если новый экран туда его
   принесёт, тест упадёт раньше, чем экран покажет «не авторизован».
   ───────────────────────────────────────────────────────────────────────── */

/** Поверхности со своей оболочкой: сессию next-auth там не читает никто. */
function readsSession(pathname: string | null): boolean {
  if (!pathname) return true;
  if (pathname === "/twa" || pathname.startsWith("/twa/")) return false;
  // `/admin/login` — исключение: там есть `Navbar`, и он спрашивает сессию.
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return true;
  return !(pathname === "/admin" || pathname.startsWith("/admin/"));
}

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const live = readsSession(usePathname());
  return (
    <NextAuthSessionProvider key={live ? "live" : "silent"} session={live ? undefined : null}>
      {children}
    </NextAuthSessionProvider>
  );
}
