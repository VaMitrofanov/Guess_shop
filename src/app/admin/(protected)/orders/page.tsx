import { prisma } from "@/lib/prisma";
import AdminOrdersClient from "@/components/admin/orders-client";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { product: true },
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">ORDER MANAGEMENT</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Заказы</h1>
        <p className="text-zinc-500 text-sm font-medium mt-1">Всего: {orders.length} заказов</p>
      </div>
      <AdminOrdersClient initialOrders={JSON.parse(JSON.stringify(orders))} />
    </div>
  );
}
