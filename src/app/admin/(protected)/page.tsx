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

  const presence = await touchAdminPresence(admin);
  const overview = await getAdminOverview(presence.windowStartAt);

  return (
    <OverviewScreen
      initial={overview}
      since={presence.windowStartAt.toISOString()}
      adminName={admin.displayName}
      firstVisit={presence.firstVisit}
    />
  );
}
