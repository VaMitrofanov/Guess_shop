'use client';

import { motion } from 'framer-motion';
import Navbar from '@/components/navbar';
import { ShieldCheck, Zap, Users, Star, Lock, HeartHandshake } from 'lucide-react';

const guarantees = [
  {
    title: "100% БЕЗОПАСНЫЕ ПЛАТЕЖИ",
    description: "Все транзакции проходят через официальный шлюз Тинькофф. Мы не храним данные ваших карт, и все операции защищены 3D-Secure протоколами.",
    icon: <Lock className="w-8 h-8 text-cyan-400" />
  },
  {
    title: "МГНОВЕННАЯ ДОСТАВКА",
    description: "Наш бот автоматически покупает ваш геймпас сразу после оплаты. Никаких ожиданий — робуксы уходят в 'Pending' моментально.",
    icon: <Zap className="w-8 h-8 text-[#00f2fe]" />
  },
  {
    title: "ЧЕСТНЫЙ КУРС",
    description: "Мы работаем напрямую с поставщиками и крупными биржами, поэтому предлагаем один из самых выгодных курсов на рынке СНГ.",
    icon: <HeartHandshake className="w-8 h-8 text-blue-400" />
  },
  {
    title: "ТЕХПОДДЕРЖКА 24/7",
    description: "Наша команда всегда онлайн. Если у вас возникла проблема — мы ответим в течение нескольких минут и поможем разобраться.",
    icon: <ShieldCheck className="w-8 h-8 text-emerald-400" />
  },
  {
    title: "ОПЫТ РАБОТЫ",
    description: "Мы на рынке уже более двух лет и обработали свыше 10,000 заказов. Ваша покупка в надежных руках.",
    icon: <Users className="w-8 h-8 text-cyan-500" />
  },
  {
    title: "РЕАЛЬНЫЕ ОТЗЫВЫ",
    description: "Тысячи довольных клиентов в нашем Telegram и VK. Вы можете убедиться в этом сами, почитав реальные истории покупателей.",
    icon: <Star className="w-8 h-8 text-[#00f2fe]" />
  }
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { scale: 0.95, opacity: 0 },
  show: { scale: 1, opacity: 1 }
};

export default function GuaranteesPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <Navbar />

      <section className="pt-32 pb-48 px-4">
        <div className="container mx-auto">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6 mb-24 max-w-4xl"
          >
            <span className="text-[#00f2fe] font-black tracking-widest text-sm uppercase">Надежность прежде всего</span>
            <h1 className="text-5xl md:text-8xl font-black uppercase leading-tight tracking-tighter">
                МЫ ДАЕМ <br/> <span className="gold-text">100% ГАРАНТИЙ</span>
            </h1>
          </motion.div>

          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {guarantees.map((g, index) => (
              <motion.div 
                key={index}
                variants={item}
                className="bg-[#05070a] border border-white/5 p-10 rounded-3xl hover:border-[#00f2fe]/50 transition-all flex flex-col gap-10 group shadow-lg"
              >
                <div className="p-4 bg-white/5 w-fit rounded-sm group-hover:scale-110 transition-transform">
                    {g.icon}
                </div>
                <div className="space-y-4">
                  <h3 className="text-xl font-bold uppercase tracking-tight">{g.title}</h3>
                  <p className="text-zinc-500 leading-relaxed font-medium">
                    {g.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-32 p-16 gold-gradient text-black rounded-[2.5rem] text-center space-y-8 overflow-hidden relative shadow-2xl"
          >
            <div className="relative z-10 space-y-4">
                <h2 className="text-4xl md:text-6xl font-black uppercase italic leading-none">Тысячи игроков уже <br/> выбирают нас каждый день</h2>
                <p className="text-black/70 max-w-xl mx-auto font-bold uppercase tracking-widest text-sm">Присоединяйся к самому надежному магазину в СНГ</p>
            </div>
            
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[200px] font-black opacity-5 pointer-events-none select-none tracking-tighter italic">
                GUESS
            </div>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
