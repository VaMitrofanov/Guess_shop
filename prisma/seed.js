const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Optional, explicit bootstrap only. A public seed must never create an
  // administrator with predictable credentials. Production normally leaves
  // both variables unset and manages privileged users through an operator.
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (adminEmail || adminPassword) {
    if (!adminEmail || !adminPassword || adminPassword.length < 16) {
      throw new Error("BOOTSTRAP_ADMIN_EMAIL and a 16+ character BOOTSTRAP_ADMIN_PASSWORD are required together");
    }
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { password: hashedPassword, role: 'ADMIN' },
      create: {
        email: adminEmail,
        name: 'Bootstrap Admin',
        password: hashedPassword,
        role: 'ADMIN',
      },
    });
    console.log('Bootstrap admin upserted. Rotate the bootstrap password after first login.');
  }

  // 1. Initial FAQ
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

  // 2. Development-only example reviews. They are never inserted by a normal
  // seed run, so a new production environment cannot accidentally publish
  // synthetic social proof.
  const reviews = [
    { author: "Danil_7", content: "Крутой сайт! Робуксы пришли за неделю как и обещали. Поставил цену на геймпасе сам, все четко рассчитал калькулятор. Рекомендую!", rating: 5, date: "2 дня назад" },
    { author: "RobloxKing_2026", content: "Покупал 4500 робуксов, переживал что не придут. Но в Пул (очередь) встало сразу после оплаты.", rating: 5, date: "4 дня назад" },
    { author: "Sasha_Pro", content: "Самый удобный калькулятор из всех сайтов где я был. Дизайн просто бомба.", rating: 5, date: "Вчера" },
  ];

  if (process.env.SEED_DEMO_CONTENT === 'true') {
    for (const r of reviews) {
      await prisma.review.upsert({
          where: { id: r.author.toLowerCase() },
          update: {},
          create: { ...r, id: r.author.toLowerCase(), isVerified: false }
      });
    }
    console.log('Development-only demo reviews seeded.');
  } else {
    console.log('Demo reviews skipped (set SEED_DEMO_CONTENT=true for local development only).');
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
