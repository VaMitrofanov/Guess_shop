'use client';

import { useState } from 'react';
import { Edit, Trash, ChevronUp, ChevronDown, Plus, Save, X, Loader2 } from 'lucide-react';
import AddFAQModal from './add-faq-modal';

export default function FAQList({ initialFaqs }: { initialFaqs: any[] }) {
  const [faqs, setFaqs] = useState(initialFaqs);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const startEdit = (faq: any) => {
    setEditingId(faq.id);
    setEditForm({ ...faq });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (id: string) => {
    setLoading(true);
    try {
        const res = await fetch(`/api/admin/faq/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editForm),
        });
        
        if (res.ok) {
            setFaqs(faqs.map(f => f.id === id ? editForm : f));
            setEditingId(null);
        }
    } catch (err) {
        console.error(err);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
      if (!confirm('Удалить этот вопрос?')) return;
      try {
          const res = await fetch(`/api/admin/faq/${id}`, { method: 'DELETE' });
          if (res.ok) {
              setFaqs(faqs.filter(f => f.id !== id));
          }
      } catch (err) {
          console.error(err);
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
          <AddFAQModal />
      </div>
      
      <div className="space-y-4">
        {faqs.map((faq) => (
        <div key={faq.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl group hover:border-[#ffb800]/20 transition-all">
          {editingId === faq.id ? (
            <div className="space-y-4">
               <div className="space-y-2">
                 <label className="text-[10px] font-bold text-zinc-500 uppercase">Вопрос</label>
                 <input 
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm font-bold outline-none"
                    value={editForm.question}
                    onChange={e => setEditForm({...editForm, question: e.target.value})}
                 />
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-bold text-zinc-500 uppercase">Ответ</label>
                 <textarea 
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm font-bold outline-none h-32"
                    value={editForm.answer}
                    onChange={e => setEditForm({...editForm, answer: e.target.value})}
                 />
               </div>
               <div className="flex gap-2">
                 <button onClick={() => handleSave(faq.id)} disabled={loading} className="h-10 px-4 bg-[#ffb800] text-black font-bold rounded-lg text-xs">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'СОХРАНИТЬ'}
                 </button>
                 <button onClick={cancelEdit} className="h-10 px-4 bg-white/5 text-white font-bold rounded-lg text-xs">ОТМЕНА</button>
               </div>
            </div>
          ) : (
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <h3 className="font-bold text-white uppercase">{faq.question}</h3>
                <p className="text-zinc-500 text-sm">{faq.answer}</p>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => startEdit(faq)} className="w-8 h-8 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center">
                  <Edit className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(faq.id)} className="w-8 h-8 bg-red-500/10 text-red-500 rounded-lg flex items-center justify-center">
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
