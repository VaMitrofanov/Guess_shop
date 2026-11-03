"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import styles from "./admin-shell.module.css";

export default function AddReviewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ author: "", content: "", rating: 5 });
  const closeRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setIsOpen(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error("Не удалось создать отзыв");
      setIsOpen(false); setForm({ author: "", content: "", rating: 5 }); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка создания"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={styles.primaryButton}><Plus /> Добавить отзыв</button>
      {isOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}>
          <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="new-review-title">
            <div className={styles.modalHandle} />
            <button ref={closeRef} onClick={() => setIsOpen(false)} className={styles.modalClose} aria-label="Закрыть"><X /></button>
            <span className={styles.modalKicker}>Отзывы</span><h2 id="new-review-title">Новый отзыв</h2>
            {error && <div className={styles.noteDanger}>{error}</div>}
            <form onSubmit={handleSubmit} className={styles.modalForm}>
              <div className={styles.modalGrid}>
                <label>Автор<input required maxLength={100} value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} /></label>
                <label>Рейтинг (1–5)<input type="number" min={1} max={5} required value={form.rating} onChange={(event) => setForm({ ...form, rating: Number(event.target.value) || 5 })} /></label>
              </div>
              <label>Отзыв<textarea required maxLength={2000} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} placeholder="Крутой сайт, всё быстро..." /></label>
              <button disabled={loading} className={styles.primaryButton}>{loading ? <Loader2 className={styles.spin} /> : <Plus />} Создать отзыв</button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
