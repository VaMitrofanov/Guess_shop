"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import styles from "./admin-shell.module.css";

export default function AddFAQModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", answer: "" });
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
      const res = await fetch("/api/admin/faq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error("Не удалось создать вопрос");
      setIsOpen(false); setForm({ question: "", answer: "" }); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка создания"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={styles.primaryButton}><Plus /> Добавить вопрос</button>
      {isOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => event.target === event.currentTarget && setIsOpen(false)}>
          <section className={styles.modalSheet} role="dialog" aria-modal="true" aria-labelledby="new-faq-title">
            <div className={styles.modalHandle} />
            <button ref={closeRef} onClick={() => setIsOpen(false)} className={styles.modalClose} aria-label="Закрыть"><X /></button>
            <span className={styles.modalKicker}>FAQ</span><h2 id="new-faq-title">Новый вопрос</h2>
            {error && <div className={styles.noteDanger}>{error}</div>}
            <form onSubmit={handleSubmit} className={styles.modalForm}>
              <label>Вопрос<input required maxLength={500} value={form.question} onChange={(event) => setForm({ ...form, question: event.target.value })} placeholder="Как долго ждать?" /></label>
              <label>Ответ<textarea required maxLength={5000} value={form.answer} onChange={(event) => setForm({ ...form, answer: event.target.value })} placeholder="Заказ обрабатывается до 24 часов..." /></label>
              <button disabled={loading} className={styles.primaryButton}>{loading ? <Loader2 className={styles.spin} /> : <Plus />} Создать вопрос</button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
