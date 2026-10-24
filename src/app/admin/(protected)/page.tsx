import { redirect } from "next/navigation";
import OverviewScreen from "@/components/admin/overview/overview-screen";
import { resolveAdminFromSession } from "@/lib/admin-access";
import { getAdminOverview } from "@/lib/admin-overview";
import { touchAdminPresence } from "@/lib/admin-presence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Обзор» — начало смены (этапы Г1–Г4).
 *
 * Серверный компонент делает ровно две вещи: отмечает заход админа и отдаёт
 * экрану первый снимок данных. Отметка присутствия ставится ЗДЕСЬ и только
 * здесь — клиентское обновление её не двигает, иначе окно «Пока вас не было»
 * схлопывалось бы само (см. `admin-presence.ts`).
 *
 * Прежний дашборд был витриной: первым числом стоял «Чистый оборот» —
 * эквайринг сайта, доли процента от оборота, который идёт через WB. Витринные
 * метрики никуда не делись, они уехали в нижнюю полосу экрана.
 */
export default async function AdminOverviewPage() {
  const admin = await resolveAdminFromSession();
  if (!admin) redirect("/admin/login");

  /* Отметка присутствия — два запроса подряд (прочитать прошлый заход,
     записать нынешний), и до 04.09.2026 она держала ВЕСЬ экран: девять из
     одиннадцати загрузок про окно ничего не знают, но ждали его. С базой в
     Сингапуре это стоило ~0,4 с на каждом открытии смены. Отдаём обещание —
     ждут его только диф и лента, остальное стартует сразу. */
  const presencePromise = touchAdminPresence(admin);
  const overview = await getAdminOverview(presencePromise.then((p) => p.windowStartAt));
  const presence = await presencePromise;

  return (
    <OverviewScreen
      initial={overview}
      since={presence.windowStartAt.toISOString()}
      adminName={admin.displayName}
      firstVisit={presence.firstVisit}
    />
  );
}
