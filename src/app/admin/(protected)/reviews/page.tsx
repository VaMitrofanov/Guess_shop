import { prisma } from "@/lib/prisma";
import ReviewList from "@/components/admin/review-list";
import AddReviewModal from "@/components/admin/add-review-modal";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const reviews = await prisma.review.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Контент · социальное доказательство</span>
          <h1>Отзывы</h1>
          <p>{reviews.length} отзывов на витрине</p>
        </div>
        <AddReviewModal />
      </header>
      <ReviewList initialReviews={JSON.parse(JSON.stringify(reviews))} />
    </div>
  );
}
