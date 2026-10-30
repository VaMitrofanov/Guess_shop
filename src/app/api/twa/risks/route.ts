/** Мобильная админка ходит сюда; логика и гейт — в `/api/admin/risks`. */
export { GET, POST } from "@/app/api/admin/risks/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
