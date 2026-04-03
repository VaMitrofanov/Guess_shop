const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  // 1. Admin User
  await prisma.user.upsert({
    where: { email: 'admin@vadi.robux' },
    update: {},
    create: {
      email: 'admin@vadi.robux',
      name: 'Vadi Admin',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  // 2. Initial FAQ
  const faqs = [
    { question: "ЧТО ТАКОЕ РОБУКСЫ ГЕЙМПАСОМ?", answer: "Это самый популярный способ покупки. Вы создаете бесплатный предмет (Gamepass) в своей игре на Roblox, а наш бот покупает его. Ровно та сумма, которую вы выбрали, придет на ваш аккаунт.", order: 0 },
    { question: "КАК ПРАВИЛЬНО ВЫСТАВИТЬ ЦЕНУ?", answer: "Roblox забирает комиссию 30%. На нашем сайте калькулятор автоматически рассчитывает цену, которую вам нужно поставить в поле 'Price'.", order: 1 },
    { question: "КОГДА ПРИДУТ РОБУКСЫ?", answer: "После покупки геймпасом робуксы попадают в статус 'Pending' (в ожидании). По правилам Roblox, они зачисляются на баланс ровно через 5-7 дней.", order: 2 },
  ];

  for (const f of faqs) {
    await prisma.fAQ.upsert({
        where: { id: f.question.toLowerCase().replace(/\s+/g, '-') },
        update: {},
        create: { ...f, id: f.question.toLowerCase().replace(/\s+/g, '-') }
    });
  }

  // 3. Initial Reviews
  const reviews = [
    { author: "Danil_7", content: "Крутой сайт! Робуксы пришли за неделю как и обещали. Поставил цену на геймпасе сам, все четко рассчитал калькулятор. Рекомендую!", rating: 5, date: "2 дня назад" },
    { author: "RobloxKing_2026", content: "Покупал 4500 робуксов, переживал что не придут. Но в Пул (очередь) встало сразу после оплаты.", rating: 5, date: "4 дня назад" },
    { author: "Sasha_Pro", content: "Самый удобный калькулятор из всех сайтов где я был. Дизайн просто бомба.", rating: 5, date: "Вчера" },
  ];

  for (const r of reviews) {
    await prisma.review.upsert({
        where: { id: r.author.toLowerCase() },
        update: {},
        create: { ...r, id: r.author.toLowerCase(), isVerified: true }
    });
  }

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
