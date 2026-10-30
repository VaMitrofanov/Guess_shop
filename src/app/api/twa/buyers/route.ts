/** Мобильная админка ходит сюда; логика и гейт — в `/api/admin/buyers`. */
export { GET, POST } from "@/app/api/admin/buyers/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
