import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import Navbar from "@/components/navbar";
import { Star, Plus, ChevronLeft } from "lucide-react";
import ReviewList from "@/components/admin/review-list";

export default async function AdminReviewsPage() {
  const session = await getServerSession(authOptions);

  if (!session || (session.user as any).role !== "ADMIN") {
    return <div className="p-8">Доступ запрещен</div>;
  }

  const reviews = await prisma.review.findMany({
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
                <h1 className="text-2xl font-black uppercase italic gold-text">Управление Отзывами</h1>
            </div>

            <div className="bg-[#0d1117] border border-white/5 rounded-[2rem] shadow-2xl">
                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-lg font-bold tracking-tight uppercase flex items-center gap-3">
                        <Star className="w-5 h-5 text-[#00f2fe]" />
                        Список отзывов
                    </h2>
                    <button className="h-10 px-6 bg-white/5 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-2">
                        <Plus className="w-4 h-4" /> Добавить отзыв
                    </button>
                </div>
                <div className="p-8">
                    <ReviewList initialReviews={JSON.parse(JSON.stringify(reviews))} />
                </div>
            </div>
        </div>
    </main>
  );
}
