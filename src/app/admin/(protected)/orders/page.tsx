import OrdersWorkspace from "@/components/admin/orders/orders-workspace";
import { SLICE_KEYS } from "@/lib/order-slices";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Срезы ряда + всё, что доступно из шторки фильтров. */
const ALLOWED_SLICES = new Set<string>([
  ...SLICE_KEYS,
  "ALL", "WORK", "NEW", "DIRECT", "AVITO", "FAVORITES", "ATTENTION", "STALE_LINK", "HELD", "REJECTED",
]);

/**
 * Заказы — рабочее место, а не страница-таблица: состояние живёт в адресе,
 * поэтому серверный компонент только разбирает ссылку и отдаёт её экрану.
 * Старые ссылки вида `?source=WB&q=…` продолжают работать: источник
 * разворачивается в срез «Все» с поисковым запросом.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const requested = pick("slice").toUpperCase();
  const legacySource = pick("source").toUpperCase();
  const slice = ALLOWED_SLICES.has(requested)
    ? requested
    : legacySource && legacySource !== "ALL"
      ? "ALL"
      : "BUYOUT";

  return (
    <OrdersWorkspace
      initialSlice={slice}
      initialMode={pick("mode") === "table" ? "table" : "split"}
      initialOrderId={/^[a-z0-9_-]{8,40}$/i.test(pick("order")) ? pick("order") : null}
      initialQuery={pick("q").slice(0, 120)}
    />
  );
}
