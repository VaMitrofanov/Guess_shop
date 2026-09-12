"use client";

import { useState } from "react";
import { Edit, Loader2, Trash } from "lucide-react";
import styles from "./admin-shell.module.css";

type FAQ = { id: string; question: string; answer: string; order: number };

export default function FAQList({ initialFaqs }: { initialFaqs: FAQ[] }) {
  const [faqs, setFaqs] = useState(initialFaqs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FAQ | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (id: string) => {
    if (!editForm) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/faq/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      if (!res.ok) throw new Error("Не удалось сохранить вопрос");
      setFaqs((current) => current.map((faq) => faq.id === id ? editForm : faq));
      setEditingId(null); setEditForm(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка сохранения"); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/admin/faq/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Не удалось удалить вопрос");
      setFaqs((current) => current.filter((faq) => faq.id !== id)); setDeletingId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ошибка удаления"); }
    finally { setLoading(false); }
  };

  return (
    <div className={styles.contentStack}>
      {error && <div className={styles.noteDanger}>{error}</div>}
      {faqs.map((faq) => (
        <article key={faq.id} className={styles.contentCard}>
          {editingId === faq.id && editForm ? (
            <div className={styles.editForm}>
              <label>Вопрос<input value={editForm.question} onChange={(event) => setEditForm({ ...editForm, question: event.target.value })} /></label>
              <label>Ответ<textarea value={editForm.answer} onChange={(event) => setEditForm({ ...editForm, answer: event.target.value })} /></label>
              <div className={styles.formActions}><button className={styles.primaryButton} onClick={() => void handleSave(faq.id)} disabled={loading}>{loading ? <Loader2 className={styles.spin} /> : "Сохранить"}</button><button className={styles.secondaryButton} onClick={() => { setEditingId(null); setEditForm(null); }}>Отмена</button></div>
            </div>
          ) : (
            <>
              <h2 className={styles.contentQuestion}>{faq.question}</h2>
              <p className={styles.contentCopy}>{faq.answer}</p>
              {deletingId === faq.id ? (
                <div className={styles.inlineConfirm}><span>Точно удалить вопрос?</span><button onClick={() => void handleDelete(faq.id)} disabled={loading}>Удалить</button><button onClick={() => setDeletingId(null)}>Отмена</button></div>
              ) : (
                <div className={styles.contentActions}><button onClick={() => { setEditingId(faq.id); setEditForm({ ...faq }); setError(null); }}><Edit /> Редактировать</button><button className={styles.dangerAction} onClick={() => setDeletingId(faq.id)}><Trash /> Удалить</button></div>
              )}
            </>
          )}
        </article>
      ))}
      {faqs.length === 0 && <div className={styles.empty}>Вопросов пока нет</div>}
    </div>
  );
}
