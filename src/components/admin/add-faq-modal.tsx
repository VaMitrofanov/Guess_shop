'use client';

import { useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';

export default function AddFAQModal({ onAdd }: { onAdd: (faq: any) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
        const res = await fetch('/api/admin/faq', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form)
        });
        if (res.ok) {
            const newFaq = await res.json();
            onAdd(newFaq);
            setIsOpen(false);
            setForm({ question: '', answer: '' });
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
        <Plus className="w-4 h-4" /> Добавить вопрос
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-[#141416] border border-white/5 w-full max-w-lg p-8 rounded-[2rem] shadow-2xl relative">
            <button onClick={() => setIsOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-black uppercase italic gold-gradient bg-clip-text text-transparent mb-8">Новый вопрос</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase">Вопрос</label>
                    <input 
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-bold outline-none"
                        value={form.question}
                        onChange={e => setForm({...form, question: e.target.value})}
                    />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase">Ответ</label>
                    <textarea 
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm font-bold outline-none h-32"
                        value={form.answer}
                        onChange={e => setForm({...form, answer: e.target.value})}
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
