"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";

export default function AddFAQModal() {
  const [isOpen, setIsOpen]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm]       = useState({ question: "", answer: "" });
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setIsOpen(false);
        setForm({ question: "", answer: "" });
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
        <Plus className="w-4 h-4" /> Добавить вопрос
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="pixel-card border-2 border-[#1e2a45] w-full max-w-lg p-8 relative">
            <button onClick={() => setIsOpen(false)} className="absolute top-5 right-5 text-zinc-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">FAQ</div>
            <h2 className="text-xl font-black uppercase tracking-tight mb-6">Новый вопрос</h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">ВОПРОС</label>
                <input
                  required maxLength={500}
                  className="w-full h-12 bg-[#080c18] border-2 border-[#1e2a45] px-4 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm"
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  placeholder="Как долго ждать?"
                />
              </div>
              <div className="space-y-2">
                <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">ОТВЕТ</label>
                <textarea
                  required maxLength={5000}
                  className="w-full bg-[#080c18] border-2 border-[#1e2a45] px-4 py-3 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm h-28 resize-none"
                  value={form.answer}
                  onChange={(e) => setForm({ ...form, answer: e.target.value })}
                  placeholder="Заказ обрабатывается до 24 часов..."
                />
              </div>
              <button
                disabled={loading}
                className="w-full h-12 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Создать вопрос"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
