const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Прямое подключение через HTTP (самое надежное)
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('❌ Укажи файл: node scripts/push-wb-codes.js codes.csv');
    process.exit(1);
  }

  try {
    const csvPath = path.resolve(process.cwd(), filePath);
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const dataLines = lines.slice(1); // убираем заголовок

    console.log(`🚀 Начинаем загрузку ${dataLines.length} кодов через HTTP...`);

    let added = 0;
    for (const line of dataLines) {
      const [code, denomination, batch] = line.split(',');
      if (!code || !denomination) continue;

      try {
        // Прямой SQL запрос в Neon
        await sql`
          INSERT INTO "WbCode" (id, code, denomination, batch, "isUsed", "createdAt")
          VALUES (
            concat('wb_', replace(cast(gen_random_uuid() as text), '-', '')), 
            ${code.trim()}, 
            ${parseInt(denomination)}, 
            ${batch ? batch.trim() : 'batch-01'},
            false,
            now()
          )
          ON CONFLICT (code) DO NOTHING
        `;
        added++;
        if (added % 100 === 0) console.log(`⏳ Загружено: ${added}...`);
      } catch (e) {
        // игнорируем ошибки дубликатов
      }
    }

    console.log(`\n✅ ГОТОВО! Успешно добавлено кодов: ${added}`);
  } catch (err) {
    console.error('\n❌ Ошибка:', err.message);
  }
}

main();