"use client";

import { useState } from "react";
import { Edit, Trash, Check, X, Loader2, Save } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProductList({ initialProducts }: { initialProducts: any[] }) {
  const [products, setProducts] = useState(initialProducts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const startEdit = (product: any) => {
    setEditingId(product.id);
    setEditForm({ ...product });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (id: string) => {
    if (editForm.rubPrice < 0 || editForm.robuxAmount < 0) {
        alert("Цены и количество не могут быть отрицательными!");
        return;
    }
    setLoading(true);
    try {
        const res = await fetch(`/api/admin/products/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(editForm),
        });
        
        if (res.ok) {
            setProducts(products.map(p => p.id === id ? editForm : p));
            setEditingId(null);
        }
    } catch (err) {
        console.error(err);
    } finally {
        setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Вы уверены, что хотите удалить этот товар?")) return;
    try {
        const res = await fetch(`/api/admin/products/${id}`, {
            method: "DELETE",
        });
        if (res.ok) {
            setProducts(products.filter(p => p.id !== id));
        }
    } catch (err) {
        console.error(err);
    }
  };

  return (
    <div className="space-y-4">
      {products.length === 0 && (
          <div className="text-center py-24 text-zinc-600 font-bold uppercase tracking-widest text-xs">Нет доступных товаров</div>
      )}
      
      {products.map((product) => (
        <div key={product.id} className={cn(
            "p-6 rounded-2xl border transition-all duration-300 group",
            editingId === product.id ? "bg-[#ffb800]/5 border-[#ffb800]/40" : "bg-white/[0.02] border-white/5 hover:border-white/10"
        )}>
            {editingId === product.id ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Название</label>
                        <input 
                            type="text" 
                            className="w-full bg-white/5 border border-white/10 h-10 px-3 rounded-lg text-sm font-bold outline-none"
                            value={editForm.name}
                            onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Robux</label>
                        <input 
                            type="number" 
                            className="w-full bg-white/5 border border-white/10 h-10 px-3 rounded-lg text-sm font-bold outline-none"
                            value={editForm.robuxAmount}
                            onChange={(e) => setEditForm({...editForm, robuxAmount: parseInt(e.target.value)})}
                        />
                    </div>
                     <div className="space-y-2">
                        <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Цена (₽)</label>
                        <input 
                            type="number" 
                            className="w-full bg-white/5 border border-white/10 h-10 px-3 rounded-lg text-sm font-bold outline-none"
                            value={editForm.rubPrice}
                            onChange={(e) => setEditForm({...editForm, rubPrice: parseFloat(e.target.value)})}
                        />
                    </div>
                     <div className="flex items-center gap-2">
                        <button 
                            onClick={() => handleSave(product.id)}
                            disabled={loading}
                            className="h-10 px-4 gold-gradient text-black font-bold rounded-lg text-xs uppercase transition-all"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "СОХРАНИТЬ"}
                        </button>
                        <button 
                            onClick={cancelEdit}
                            className="h-10 px-4 bg-white/5 text-white font-bold rounded-lg text-xs uppercase"
                        >
                            ОТМЕНА
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center font-black text-[#00f2fe]">
                            R$
                        </div>
                        <div>
                            <h3 className="font-bold text-lg tracking-tight">{product.name}</h3>
                            <div className="flex items-center gap-3 mt-1">
                                <span className="text-zinc-500 text-xs font-bold">{product.robuxAmount} RBX</span>
                                <span className="w-1 h-1 rounded-full bg-zinc-700" />
                                <span className="text-zinc-500 text-xs font-bold uppercase tracking-widest border border-white/5 px-2 rounded-full">{product.type}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-12">
                        <div className="text-right">
                             <div className="text-2xl font-black text-[#00f2fe] tracking-tight">{product.rubPrice} ₽</div>
                             <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">ТЕКУЩАЯ СТОИМОСТЬ</div>
                        </div>
                        
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                             <button 
                                onClick={() => startEdit(product)}
                                className="w-9 h-9 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center hover:bg-blue-500 hover:text-white transition-all shadow-xl"
                            >
                                <Edit className="w-4 h-4" />
                            </button>
                             <button 
                                onClick={() => handleDelete(product.id)}
                                className="w-9 h-9 bg-red-500/10 text-red-500 rounded-lg flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-xl"
                            >
                                <Trash className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
      ))}
    </div>
  );
}
