"use client";
import { C } from "../theme";
import { useEffect, useState, useCallback } from "react";
import { haptic } from "../haptics";

interface ReviewItem {
  id: string;
  type: "feedback" | "question";
  text: string;
  rating?: number;
  date: string;
  article: string;
  answered: boolean;
}

interface FeedbackData {
  unansweredFeedbacks: number;
  unansweredQuestions: number;
  items: ReviewItem[];
}

function stars(n: number): string {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function relDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export default function ReviewsScreen({ token }: { token: string }) {
  const [data, setData] = useState<FeedbackData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<"all" | "feedback" | "question">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/twa/feedback", {
        headers: { Authorization: `twa ${token}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ padding: 16, textAlign: "center", color: C.textSecondary, paddingTop: 60 }}>
        Загрузка отзывов…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <div style={{ color: C.red, marginBottom: 12 }}>Не удалось загрузить отзывы</div>
        <button
          onClick={() => { haptic.select(); load(); }}
          style={{
            background: C.accent, color: "#fff", border: "none",
            borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  const filtered = filter === "all"
    ? data.items
    : data.items.filter(i => i.type === filter);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary */}
      <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" as const }}>
          {[
            { label: "Без ответа",  val: data.unansweredFeedbacks + data.unansweredQuestions, color: data.unansweredFeedbacks + data.unansweredQuestions > 0 ? C.red : C.green },
            { label: "Отзывы",      val: data.unansweredFeedbacks, color: C.yellow },
            { label: "Вопросы",     val: data.unansweredQuestions, color: C.accent },
          ].map(c => (
            <div key={c.label}>
              <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6 }}>
        {([
          { id: "all", label: "Все" },
          { id: "feedback", label: "⭐ Отзывы" },
          { id: "question", label: "❓ Вопросы" },
        ] as const).map(f => (
          <button
            key={f.id}
            onClick={() => { haptic.select(); setFilter(f.id); }}
            style={{
              padding: "6px 14px", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: filter === f.id ? 600 : 400, cursor: "pointer",
              background: filter === f.id ? C.accent : C.card,
              color: filter === f.id ? "#fff" : C.textSecondary,
              transition: "all 0.15s",
            }}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { haptic.select(); load(); }}
          style={{
            padding: "6px 12px", border: "none", borderRadius: 8,
            fontSize: 13, cursor: "pointer",
            background: C.card, color: C.textSecondary,
          }}
        >
          🔄
        </button>
      </div>

      {/* Items */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: C.textSecondary, paddingTop: 30, fontSize: 14 }}>
          {filter === "all" ? "Нет неотвеченных обращений ✅" : "Пусто"}
        </div>
      ) : (
        filtered.map(item => (
          <div
            key={item.id}
            style={{
              background: C.card, borderRadius: 14, padding: "14px 16px",
              borderLeft: `3px solid ${item.type === "feedback" ? C.yellow : C.accent}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: item.type === "feedback" ? C.yellow : C.accent, fontWeight: 600 }}>
                  {item.type === "feedback" ? "⭐ Отзыв" : "❓ Вопрос"}
                </span>
                {item.article && (
                  <span style={{ fontSize: 11, color: C.textSecondary }}>· {item.article}</span>
                )}
              </div>
              <span style={{ fontSize: 11, color: C.textSecondary }}>{relDate(item.date)}</span>
            </div>

            {item.type === "feedback" && item.rating != null && (
              <div style={{ fontSize: 14, color: C.yellow, marginBottom: 6, letterSpacing: 1 }}>
                {stars(item.rating)}
              </div>
            )}

            <div style={{
              fontSize: 14, color: "#fff", lineHeight: 1.45,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {item.text || <span style={{ color: C.textSecondary, fontStyle: "italic" }}>Без текста</span>}
            </div>

            {item.answered && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.green, fontWeight: 600 }}>
                ✅ Ответ опубликован
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
