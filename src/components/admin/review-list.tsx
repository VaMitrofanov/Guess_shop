"use client";

import { useState } from "react";
import { CheckCircle2, Edit, Loader2, Star, Trash, User } from "lucide-react";
import styles from "./admin-shell.module.css";

type Review = {
  id: string;
  author: string;
  content: string;
  rating: number;
  date: string;
  isVerified: boolean;
};

export default function ReviewList({ initialReviews }: { initialReviews: Review[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (review: Review) => { setEditingId(review.id); setEditForm({ ...review }); setError(null); };
  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const handleSave = async (id: string) => {
    if (!editForm) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      if (!res.ok) throw new Error("Не удалось сохранить отзыв");
      setReviews((current) => current.map((review) => review.id === id ? editForm : review));
      cancelEdit();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка сохранения"); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Не удалось удалить отзыв");
      setReviews((current) => current.filter((review) => review.id !== id));
      setDeletingId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка удаления"); }
    finally { setLoading(false); }
  };

  return (
    <div className={styles.contentStack}>
      {error && <div className={styles.noteDanger}>{error}</div>}
      <div className={styles.contentGrid}>
        {reviews.map((review) => (
          <article key={review.id} className={styles.contentCard}>
            {editingId === review.id && editForm ? (
              <div className={styles.editForm}>
                <label>Автор<input value={editForm.author} onChange={(event) => setEditForm({ ...editForm, author: event.target.value })} /></label>
                <label>Рейтинг<input type="number" min="1" max="5" value={editForm.rating} onChange={(event) => setEditForm({ ...editForm, rating: Number(event.target.value) })} /></label>
                <label>Отзыв<textarea value={editForm.content} onChange={(event) => setEditForm({ ...editForm, content: event.target.value })} /></label>
                <div className={styles.formActions}><button className={styles.primaryButton} onClick={() => void handleSave(review.id)} disabled={loading}>{loading ? <Loader2 className={styles.spin} /> : "Сохранить"}</button><button className={styles.secondaryButton} onClick={cancelEdit}>Отмена</button></div>
              </div>
            ) : (
              <>
                <div className={styles.contentCardHeader}>
                  <div className={styles.contentIdentity}><User /><span><strong>{review.author}</strong><small>{review.date}</small></span></div>
                  <div className={styles.contentRating}>{Array.from({ length: review.rating }, (_, index) => <Star key={index} />)}</div>
                </div>
                <p className={styles.contentCopy}>«{review.content}»</p>
                {review.isVerified && <span className={styles.verifiedBadge}><CheckCircle2 /> Верифицирован</span>}
                {deletingId === review.id ? (
                  <div className={styles.inlineConfirm}><span>Точно удалить отзыв?</span><button onClick={() => void handleDelete(review.id)} disabled={loading}>Удалить</button><button onClick={() => setDeletingId(null)}>Отмена</button></div>
                ) : (
                  <div className={styles.contentActions}><button onClick={() => startEdit(review)}><Edit /> Редактировать</button><button className={styles.dangerAction} onClick={() => setDeletingId(review.id)}><Trash /> Удалить</button></div>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      {reviews.length === 0 && <div className={styles.empty}>Отзывов пока нет</div>}
    </div>
  );
}
