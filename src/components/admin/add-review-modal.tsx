"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";

export default function AddReviewModal() {
  const [isOpen, setIsOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm]       = useState({ author: "", content: "", rating: 5 });
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setIsOpen(false);
        setForm({ author: "", content: "", rating: 5 });
        router.refresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="h-10 px-5 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> Добавить отзыв
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="pixel-card border-2 border-[#1e2a45] w-full max-w-lg p-8 relative">
            <button onClick={() => setIsOpen(false)} className="absolute top-5 right-5 text-zinc-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">REVIEWS</div>
            <h2 className="text-xl font-black uppercase tracking-tight mb-6">Новый отзыв</h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">АВТОР</label>
                  <input
                    required maxLength={100}
                    className="w-full h-12 bg-[#080c18] border-2 border-[#1e2a45] px-4 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm"
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                    placeholder="User_123"
                  />
                </div>
                <div className="space-y-2">
                  <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">РЕЙТИНГ (1–5)</label>
                  <input
                    type="number" min={1} max={5} required
                    className="w-full h-12 bg-[#080c18] border-2 border-[#1e2a45] px-4 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm"
                    value={form.rating}
                    onChange={(e) => setForm({ ...form, rating: parseInt(e.target.value) || 5 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">ОТЗЫВ</label>
                <textarea
                  required maxLength={2000}
                  className="w-full bg-[#080c18] border-2 border-[#1e2a45] px-4 py-3 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm h-28 resize-none"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Крутой сайт, всё быстро..."
                />
              </div>
              <button
                disabled={loading}
                className="w-full h-12 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Создать отзыв"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
