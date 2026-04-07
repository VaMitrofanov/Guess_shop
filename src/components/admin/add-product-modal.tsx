"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Loader2 } from "lucide-react";

export default function AddProductModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", robuxAmount: "", rubPrice: "", type: "Gamepass" });
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          robuxAmount: Number(form.robuxAmount),
          rubPrice: Number(form.rubPrice),
          type: form.type,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setIsOpen(false);
        setForm({ name: "", robuxAmount: "", rubPrice: "", type: "Gamepass" });
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
        <Plus className="w-4 h-4" /> Добавить товар
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-full max-w-lg glass p-10 rounded-[2.5rem] border border-white/5 shadow-2xl relative">
            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-8 right-8 text-zinc-500 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <h2 className="text-2xl font-black uppercase italic gold-text mb-8">Новый товар</h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Название отображения</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({...form, name: e.target.value})}
                  className="w-full h-14 bg-white/5 border border-white/5 rounded-xl px-6 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                  placeholder="Напр., 1000 Robux (Мгновенно)"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Кол-во Robux</label>
                  <input
                    type="number"
                    required
                    value={form.robuxAmount}
                    onChange={(e) => setForm({...form, robuxAmount: e.target.value})}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-xl px-6 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                    placeholder="1000"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Цена (RUB)</label>
                  <input
                    type="number"
                    required
                    value={form.rubPrice}
                    onChange={(e) => setForm({...form, rubPrice: e.target.value})}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-xl px-6 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                    placeholder="850"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Тип доставки</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({...form, type: e.target.value})}
                  className="w-full h-14 bg-white/5 border border-white/5 rounded-xl px-6 outline-none focus:border-[#00f2fe]/40 transition-all font-bold appearance-none cursor-pointer"
                >
                  <option value="Gamepass">Gamepass</option>
                  <option value="Group Funds">Group Funds</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-16 gold-gradient rounded-2xl flex items-center justify-center gap-3 font-black text-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "СОЗДАТЬ ТОВАР"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
