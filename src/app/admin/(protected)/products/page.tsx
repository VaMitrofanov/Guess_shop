import { prisma } from "@/lib/prisma";
import ProductList from "@/components/admin/product-list";
import AddProductModal from "@/components/admin/add-product-modal";
import { Package } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">PRODUCT MANAGEMENT</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Товары</h1>
          <p className="text-zinc-500 text-sm font-medium mt-1">{products.length} позиций</p>
        </div>
        <AddProductModal />
      </div>

      <ProductList initialProducts={JSON.parse(JSON.stringify(products))} />
    </div>
  );
}
