import { prisma } from "@/lib/prisma";
import ReviewList from "@/components/admin/review-list";
import AddReviewModal from "@/components/admin/add-review-modal";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const reviews = await prisma.review.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">CONTENT MANAGEMENT</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Отзывы</h1>
          <p className="text-zinc-500 text-sm font-medium mt-1">{reviews.length} отзывов</p>
        </div>
        <AddReviewModal />
      </div>
      <ReviewList initialReviews={JSON.parse(JSON.stringify(reviews))} />
    </div>
  );
}
