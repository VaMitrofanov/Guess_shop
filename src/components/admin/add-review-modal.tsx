'use client';

import { useState } from 'react';
import { Plus, X, Loader2, Star } from 'lucide-react';

export default function AddReviewModal({ onAdd }: { onAdd: (review: any) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ author: '', content: '', rating: 5 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
        const res = await fetch('/api/admin/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form)
        });
        if (res.ok) {
            const newReview = await res.json();
            onAdd(newReview);
            setIsOpen(false);
            setForm({ author: '', content: '', rating: 5 });
        }
    } catch (err) {
        console.error(err);
    } finally {
        setLoading(false);
    }
  };

  if (!isOpen) return (
    <button 
        onClick={() => setIsOpen(true)}
        className="h-10 px-6 bg-white/5 border border-white/5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center gap-2"
    >
        <Plus className="w-4 h-4" /> Добавить отзыв
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-[#141416] border border-white/5 w-full max-w-lg p-8 rounded-[2rem] shadow-2xl relative">
            <button onClick={() => setIsOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-black uppercase italic gold-gradient bg-clip-text text-transparent mb-8">Новый отзыв</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Автор</label>
                        <input 
                            required
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-bold outline-none"
                            value={form.author}
                            onChange={e => setForm({...form, author: e.target.value})}
                            placeholder="User_123"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-bold text-zinc-500 uppercase">Рейтинг (1-5)</label>
                        <input 
                            type="number" min="1" max="5"
                            required
                            className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-bold outline-none"
                            value={form.rating}
                            onChange={e => setForm({...form, rating: parseInt(e.target.value)})}
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase">Отзыв</label>
                    <textarea 
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-bold outline-none h-32"
                        value={form.content}
                        onChange={e => setForm({...form, content: e.target.value})}
                        placeholder="Крутой сайт..."
                    />
                </div>
                <button 
                    disabled={loading}
                    className="w-full h-12 bg-[#ffb800] text-black font-black uppercase rounded-xl flex items-center justify-center gap-2"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'СОЗДАТЬ'}
                </button>
            </form>
        </div>
    </div>
  );
}
