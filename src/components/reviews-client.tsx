"use client";

import { motion } from "framer-motion";
import { BadgeCheck, Star, UserRound } from "lucide-react";
import styles from "@/app/public-sections.module.css";

type PublicReview = {
  id: string;
  author: string;
  date: string;
  rating: number;
  content: string;
  isVerified: boolean;
};

export default function ReviewsClient({ initialReviews }: { initialReviews: PublicReview[] }) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: .07 } } }} className={styles.reviewGrid}>
      {initialReviews.map((review) => (
        <motion.article key={review.id} variants={{ hidden: { y: 18, opacity: 0 }, show: { y: 0, opacity: 1 } }} className={styles.reviewCard}>
          <div className={styles.reviewTop}>
            <div className={styles.author}><span className={styles.avatar}><UserRound size={22} /></span><span><strong>{review.author}</strong><span>{review.date}</span></span></div>
            <div className={styles.stars} aria-label={`${review.rating} из 5`}>{Array.from({ length: 5 }).map((_, index) => <Star key={index} size={16} fill={index < review.rating ? "currentColor" : "none"} opacity={index < review.rating ? 1 : .25} />)}</div>
          </div>
          <p className={styles.reviewText}>«{review.content}»</p>
          {review.isVerified && <span className={styles.verified}><BadgeCheck size={18} /> Покупка подтверждена</span>}
        </motion.article>
      ))}
    </motion.div>
  );
}
