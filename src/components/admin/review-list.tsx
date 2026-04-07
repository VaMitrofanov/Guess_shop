'use client';

import { useState } from 'react';
import { Edit, Trash, Star, CheckCircle2, User, Save, X, Loader2 } from 'lucide-react';
import AddReviewModal from './add-review-modal';

export default function ReviewList({ initialReviews }: { initialReviews: any[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const startEdit = (review: any) => {
    setEditingId(review.id);
    setEditForm({ ...review });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (id: string) => {
    setLoading(true);
    try {
        const res = await fetch(`/api/admin/reviews/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editForm),
        });
        
        if (res.ok) {
            setReviews(reviews.map(r => r.id === id ? editForm : r));
            setEditingId(null);
        }
    } catch (err) {
        console.error(err);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
      if (!confirm('Удалить этот отзыв?')) return;
      try {
          const res = await fetch(`/api/admin/reviews/${id}`, { method: 'DELETE' });
          if (res.ok) {
              setReviews(reviews.filter(r => r.id !== id));
          }
      } catch (err) {
          console.error(err);
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
          <AddReviewModal />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reviews.map((review) => (
        <div key={review.id} className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl group hover:border-[#ffb800]/20 transition-all">
          {editingId === review.id ? (
            <div className="space-y-4">
               <div>
                 <label className="text-[10px] font-bold text-zinc-500 uppercase">Автор</label>
                 <input 
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm font-bold"
                    value={editForm.author}
                    onChange={e => setEditForm({...editForm, author: e.target.value})}
                 />
               </div>
               <div>
                 <label className="text-[10px] font-bold text-zinc-500 uppercase">Рейтинг</label>
                 <input 
                    type="number" min="1" max="5"
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm font-bold"
                    value={editForm.rating}
                    onChange={e => setEditForm({...editForm, rating: parseInt(e.target.value)})}
                 />
               </div>
               <div>
                 <label className="text-[10px] font-bold text-zinc-500 uppercase">Отзыв</label>
                 <textarea 
                    className="w-full bg-white/5 border border-white/10 rounded-lg p-2 text-sm font-bold outline-none h-20"
                    value={editForm.content}
                    onChange={e => setEditForm({...editForm, content: e.target.value})}
                 />
               </div>
               <div className="flex gap-2">
                 <button onClick={() => handleSave(review.id)} disabled={loading} className="h-8 px-4 bg-[#ffb800] text-black font-bold rounded-lg text-[10px]">
                    {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'СОХРАНИТЬ'}
                 </button>
                 <button onClick={cancelEdit} className="h-8 px-4 bg-white/5 text-white font-bold rounded-lg text-[10px]">ОТМЕНА</button>
               </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <User className="w-4 h-4 text-zinc-500" />
                    <div>
                        <div className="font-bold text-sm">{review.author}</div>
                        <div className="text-[10px] text-zinc-600 font-bold uppercase">{review.date}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                        {[...Array(review.rating)].map((_, i) => <Star key={i} className="w-3 h-3 fill-[#ffb800] text-[#ffb800]" />)}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all ml-4">
                        <button onClick={() => startEdit(review)} className="w-6 h-6 text-blue-500 hover:text-white transition-colors">
                            <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(review.id)} className="w-6 h-6 text-red-500 hover:text-white transition-colors">
                            <Trash className="w-3.5 h-3.5" />
                        </button>
                    </div>
                  </div>
              </div>
              <p className="text-zinc-500 text-sm italic">&quot;{review.content}&quot;</p>
              {review.isVerified && <div className="text-[9px] font-black uppercase text-green-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Верифицирован</div>}
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
