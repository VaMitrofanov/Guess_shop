import type { Metadata } from "next";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import AnoAI from "@/components/ui/animated-shader-background";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Roblox Bank",
  description: "Политика конфиденциальности и условия использования данных пользователей сервиса Roblox Bank.",
};

export default function PrivacyPage() {
  const lastUpdated = "11 апреля 2026 г.";

  return (
    <main className="min-h-screen relative bg-[#080c18]">
      {/* 1. Background Shader */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-30">
        <AnoAI />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar />

        <div className="flex-grow container mx-auto px-4 py-20 max-w-4xl">
          <section className="fade-up mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-[#00b06f]/20 bg-[#00b06f]/5 text-[#00b06f] text-[10px] font-black uppercase tracking-widest mb-6">
              <span className="w-1.5 h-1.5 bg-[#00b06f] rounded-none" />
              Legal Document
            </div>
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight mb-4">
              Политика <span className="gold-text">конфиденциальности</span>
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest">
              Последнее обновление: {lastUpdated}
            </p>
          </section>

          <div className="accent-line mb-16" />

          <div className="space-y-16 text-zinc-300">
            {/* 1. Общие положения */}
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-3">
                <span className="text-[#00b06f]">01</span> Общие положения
              </h2>
              <p className="leading-relaxed">
                Использование сайта Roblox Bank (далее — «Сайт») означает безоговорочное согласие пользователя с настоящей Политикой и указанными в ней условиями обработки его персональной информации. В случае несогласия с этими условиями пользователь должен воздержаться от использования сервиса.
              </p>
            </section>

            {/* 2. Собираемые данные */}
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-3">
                <span className="text-[#00b06f]">02</span> Какие данные мы собираем
              </h2>
              <p className="leading-relaxed">
                При авторизации через VK ID наш сервис запрашивает доступ только к следующим данным вашего профиля:
              </p>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {[
                  { label: "ID пользователя", desc: "Уникальный идентификатор VK" },
                  { label: "Имя и Фамилия", desc: "Для обращения в поддержке" },
                  { label: "Аватар", desc: "Для отображения в личном кабинете" },
                  { label: "Email", desc: "Для уведомлений о заказах" },
                ].map((item) => (
                  <li key={item.label} className="p-4 bg-[#0f1528] border border-[#1e2a45] space-y-1">
                    <div className="text-[#00b06f] text-xs font-black uppercase tracking-widest">{item.label}</div>
                    <div className="text-zinc-500 text-xs uppercase tracking-tighter">{item.desc}</div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 p-4 border-l-2 border-[#00b06f] bg-[#00b06f]/5 text-sm italic">
                Мы <span className="text-white font-bold">никогда</span> не запрашиваем ваш пароль от VK, доступ к сообщениям, друзьям или другим приватным данным.
              </div>
            </section>

            {/* 3. Цели использования */}
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-3">
                <span className="text-[#00b06f]">03</span> Цели обработки данных
              </h2>
              <p className="leading-relaxed">
                Мы используем ваши данные исключительно для обеспечения работы сервиса Roblox Bank:
              </p>
              <ul className="list-disc list-inside space-y-2 ml-4">
                <li>Привязка купленных на Wildberries кодов к вашему аккаунту.</li>
                <li>Отображение истории заказов и статусов доставки.</li>
                <li>Идентификация пользователя при обращении в службу поддержки.</li>
                <li>Предотвращение мошеннических действий и обеспечение безопасности.</li>
              </ul>
            </section>

            {/* 4. Безопасность и хранение */}
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-3">
                <span className="text-[#00b06f]">04</span> Хранение и безопасность
              </h2>
              <p className="leading-relaxed">
                Ваши данные хранятся в защищенной базе данных в зашифрованном виде. Мы не передаем вашу персональную информацию третьим лицам, за исключением случаев, предусмотренных законодательством РФ. Мы применяем современные стандарты безопасности для защиты вашей информации от несанкционированного доступа.
              </p>
            </section>

            {/* 5. Удаление данных */}
            <section className="space-y-4">
              <h2 className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-3">
                <span className="text-[#00b06f]">05</span> Удаление данных и отзыв согласия
              </h2>
              <p className="leading-relaxed">
                Пользователь имеет право в любой момент отозвать свое согласие на обработку данных и запросить их полное удаление из нашей системы.
              </p>
              <p className="leading-relaxed">
                Для удаления данных или отзыва доступа к приложению вы можете:
              </p>
              <div className="p-6 bg-[#0f1528] border border-dashed border-[#00b06f]/30 space-y-4">
                <p className="text-sm">
                  1. Отозвать доступ приложению «RobloxBank» в настройках вашего профиля VK (раздел «Настройки» → «Приложения»).
                </p>
                <p className="text-sm">
                  2. Написать прямое сообщение в наше официальное сообщество ВК для полного удаления аккаунта из базы данных:
                </p>
                <a 
                  href="https://vk.ru/bankroblox" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-3 bg-[#00b06f] text-white font-black uppercase tracking-widest text-xs hover:opacity-90 transition-opacity"
                >
                  Написать в VK Community →
                </a>
              </div>
            </section>
          </div>

          <div className="mt-20 pt-10 border-t border-[#1e2a45] text-center">
            <p className="text-zinc-600 text-xs uppercase tracking-widest">
              Используя сервис Roblox Bank, вы подтверждаете свое согласие с данными условиями.
            </p>
          </div>
        </div>

        <Footer />
      </div>
    </main>
  );
}
