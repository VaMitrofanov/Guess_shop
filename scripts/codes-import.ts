/**
 * Загрузка кодов активации на склад сайта.
 *
 *   node --import tsx scripts/codes-import.ts <файл> <номинал> [метка-партии] [--dry-run]
 *
 * Файл — по одному коду в строке (пустые строки и строки с # пропускаются).
 * Каждый код шифруется (`ACTIVATION_CODE_ENCRYPTION_KEY`) и ложится в
 * `ActivationCode` со статусом IN_STOCK; дубль (тот же код, уже на складе)
 * отсекается по HMAC. Скрипт НИКОГДА не печатает сами коды — только счётчики.
 * После загрузки файл с кодами удалите: это деньги в открытом виде.
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { isCodeDenomination } from "../bots/shared/codes-pricing";
import { activationCodeHmac, activationCryptoReady, encryptActivationCode, normalizeActivationCode } from "../src/lib/codes/secrets";

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--dry-run");
  const dryRun = process.argv.includes("--dry-run");
  const [file, denominationRaw, batchLabel] = args;
  const denomination = Number(denominationRaw);
  if (!file || !isCodeDenomination(denomination)) {
    console.error("Использование: node --import tsx scripts/codes-import.ts <файл> <номинал> [метка] [--dry-run]");
    process.exit(2);
  }
  if (!activationCryptoReady()) {
    console.error("ACTIVATION_CODE_ENCRYPTION_KEY не задан или неверной длины — загрузка невозможна.");
    process.exit(2);
  }

  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const unique = new Map<string, string>();
  let malformed = 0;
  for (const line of lines) {
    const normalized = normalizeActivationCode(line);
    if (!/^[A-Z0-9]{6,40}$/.test(normalized)) { malformed += 1; continue; }
    // Покупатель получает код в том виде, как его выдал поставщик (с дефисами);
    // нормализованная форма — только ключ поиска дублей.
    unique.set(activationCodeHmac(normalized), line.replace(/\s+/g, " ").trim());
  }

  const existing = await prisma.activationCode.findMany({ where: { codeHmac: { in: [...unique.keys()] } }, select: { codeHmac: true } });
  for (const row of existing) unique.delete(row.codeHmac);

  console.log(`Строк: ${lines.length} · формат не тот: ${malformed} · уже на складе: ${existing.length} · к загрузке: ${unique.size} (номинал ${denomination})`);
  if (dryRun || unique.size === 0) {
    console.log(dryRun ? "Пробный прогон — ничего не записано." : "Загружать нечего.");
    return;
  }
  const created = await prisma.activationCode.createMany({
    data: [...unique.entries()].map(([codeHmac, value]) => ({
      denomination,
      encryptedValue: encryptActivationCode(value),
      codeHmac,
      batchLabel: batchLabel ?? null,
    })),
    skipDuplicates: true,
  });
  console.log(`Загружено: ${created.count}. Удалите исходный файл.`);
}

main()
  .catch((error) => {
    console.error("Загрузка не удалась:", (error as Error)?.message ?? "unknown");
    process.exitCode = 1;
  })
  // Пул `pg` из src/lib/prisma.ts держит процесс живым и после $disconnect.
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
