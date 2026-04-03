const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

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

  // 2. Initial Products (if not exist)
  const products = [
    { name: 'НАБОР НОВИЧКА', robuxAmount: 400, rubPrice: 340, type: 'Gamepass' },
    { name: 'НАБОР ГЕЙМЕРА', robuxAmount: 800, rubPrice: 680, type: 'Gamepass' },
    { name: 'ПРО-ПАКЕТ', robuxAmount: 1700, rubPrice: 1445, type: 'Group Funds' },
    { name: 'ЛЕГЕНДАРНЫЙ НАБОР', robuxAmount: 4500, rubPrice: 3825, type: 'Group Funds' },
  ];

  for (const p of products) {
    await prisma.product.upsert({
      where: { id: p.name }, // Using name as a safe pseudo-key for seeding
      update: {},
      create: { ...p, id: p.name.toLowerCase().replace(/\s+/g, '-') },
    });
  }

  // 3. Initial FAQs
  const faqs = [
    { question: "ЧТО ТАКОЕ РОБУКСЫ ГЕЙМПАСОМ?", answer: "Это самый популярный способ покупки. Вы создаете бесплатный предмет (Gamepass) в своей игре на Roblox, а наш бот покупает его. Ровно та сумма, которую вы выбрали, придет на ваш аккаунт.", order: 0 },
    { question: "КАК ПРАВИЛЬНО ВЫСТАВИТЬ ЦЕНУ?", answer: "Roblox забирает комиссию 30%. На нашем сайте калькулятор автоматически рассчитывает цену, которую вам нужно поставить в поле 'Price'.", order: 1 },
    { question: "КОГДА ПРИДУТ РОБУКСЫ?", answer: "После покупки геймпасом робуксы попадают в статус 'Pending' (в ожидании). По правилам Roblox, они зачисляются на баланс ровно через 5-7 дней.", order: 2 },
  ];

  for (const f of faqs) {
    await prisma.fAQ.create({ data: f });
  }

  // 4. Initial Reviews
  const reviews = [
    { author: "Danil_7", content: "Крутой сайт! Робуксы пришли за неделю как и обещали. Поставил цену на геймпасе сам, все четко рассчитал калькулятор. Рекомендую!", rating: 5, date: "2 дня назад" },
    { author: "RobloxKing_2026", content: "Покупал 4500 робуксов, переживал что не придут. Но в Пул (очередь) встало сразу после оплаты.", rating: 5, date: "4 дня назад" },
    { author: "Sasha_Pro", content: "Самый удобный калькулятор из всех сайтов где я был. Дизайн просто бомба.", rating: 5, date: "Вчера" },
  ];

  for (const r of reviews) {
    await prisma.review.create({ data: r });
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
  });
