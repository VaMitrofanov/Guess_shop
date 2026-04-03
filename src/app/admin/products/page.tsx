import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import Navbar from "@/components/navbar";
import { Package, Plus, ChevronLeft } from "lucide-react";
import ProductList from "@/components/admin/product-list";

export default async function ProductsPage() {
  const session = await getServerSession(authOptions);

  if (!session || (session.user as any).role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">Доступ запрещен</div>
      </div>
    );
  }

  const products = await prisma.product.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="min-h-screen bg-[#05070a]">
        <Navbar />
        <div className="container mx-auto px-4 py-12">
            <div className="flex items-center gap-4 mb-8">
                <Link href="/admin" className="p-2 glass rounded-lg text-zinc-500 hover:text-white transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                </Link>
                <div className="space-y-1">
                    <h1 className="text-2xl font-black uppercase italic gold-text">Товары и Цены</h1>
                </div>
            </div>

            <div className="bg-[#0d1117] border border-white/5 rounded-[2rem] overflow-hidden shadow-2xl">
                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-lg font-bold tracking-tight uppercase flex items-center gap-3">
                        <Package className="w-5 h-5 text-[#00f2fe]" />
                        Список товаров
                    </h2>
                    {/* Add Product trigger could be here */}
                    <button className="h-10 px-6 gold-gradient text-black font-bold uppercase tracking-widest hover:scale-[1.02] transition-all rounded-xl flex items-center gap-2">
                        <Plus className="w-4 h-4" /> Добавить товар
                    </button>
                </div>
                <div className="overflow-x-auto p-4">
                    <ProductList initialProducts={JSON.parse(JSON.stringify(products))} />
                </div>
            </div>
        </div>
    </main>
  );
}
