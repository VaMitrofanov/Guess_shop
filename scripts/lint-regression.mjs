import crypto from "node:crypto";
import process from "node:process";
import { ESLint } from "eslint";

// Exact fingerprint of the documented legacy debt outside the launch-critical
// corridor.
//
// 2026-07-29 (1123 → 1125): разделы «Выкуп» и «Экономика» в веб-админке.
// Дельта — ровно два `react-hooks/set-state-in-effect` на загрузке данных при
// монтировании `buyout-client.tsx`; тот же паттерн уже лежит в базовой линии по
// экранам TWA. Правило срабатывает на любой transitive-setState, поэтому убрать
// предупреждение можно только disable-комментарием. Остальной сдвиг отпечатка —
// смещение строк в файлах, которых коснулась правка.
//
// 2026-07-29 (1125 → 1124): синхронизация профиля VK типизировала ответ
// `users.get` вместо прежнего `any`; отпечаток также учитывает сдвиг строк в
// `bots/shared/db.ts`, `notify.ts`, `tg/bot.ts` и `vk/bot.ts`.
//
// 2026-07-29 (1124 → 1122): Telegram bridge теперь типизирует и входной JSON,
// и ответ Bot API вместо двух `any`; сдвиг строк в `bots/shared/bridge.ts`
// проверен вместе с новым минимальным контрактом read-only результата.
//
// 2026-07-29 (1122 → 1122): количество и состав legacy debt не изменились;
// отпечаток обновлён только из-за смещения существующих warning-строк после
// добавления NET/DIRTY-экономики в `BossrobuxScreen.tsx`. Новый admin client
// имеет точечный disable для известного initial-load паттерна и baseline не растит.
//
// 2026-07-30 (1122 → 1122): состав debt снова не изменился; чтение курса заказа
// из Sheets F и точная gross-формула сдвинули существующие строки предупреждений
// в `BossrobuxScreen.tsx` и partner notification tests.
//
// 2026-07-31 (1122 → 1122): SITE-редизайн общей инструкции не добавил новых
// предупреждений; новые hero/roadmap-узлы сдвинули существующие `no-img-element`
// строки в `WBInstructionV2.tsx`. WB/BOT-сценарии и состав baseline не менялись.
//
// 2026-08-01 (1122 → 1122): скин витрины включён на WB/BOT-режимах инструкции.
// Состав debt не изменился; сдвинулись строки существующих `no-img-element`
// в `WBInstructionV2.tsx` (комментарии в CSS + блок channel-UI).
//
// 2026-08-04 (1122 → 1109): мобильный Control Center заменил legacy CRUD
// отзывов/FAQ с `any` и неиспользуемыми импортами на типизированные карточки;
// предупреждений стало на 13 меньше. Остальной сдвиг отпечатка — новые
// data-label/подтверждения и mobile shell в admin-компонентах.
//
// Unlike --max-warnings, this has no spare capacity: adding, moving,
// replacing or changing even one warning fails the gate. Reduce the baseline
// only in a dedicated cleanup change after reviewing the full formatter output.
const BASELINE_WARNING_COUNT = 1109;
const BASELINE_SHA256 = "375cc094e022035b52efb90374c2c154de88e019fd645a849e0e5b5c974dbb79";

const eslint = new ESLint();
const results = await eslint.lintFiles(["."]);
const cwd = `${process.cwd()}/`;
const errors = results.flatMap((result) => result.messages.filter((message) => message.severity === 2));
const warnings = results.flatMap((result) => {
  const file = result.filePath.startsWith(cwd) ? result.filePath.slice(cwd.length) : result.filePath;
  return result.messages
    .filter((message) => message.severity === 1)
    .map((message) => [file, message.ruleId, message.line, message.column, message.message].join("|"));
}).sort();
const digest = crypto.createHash("sha256").update(warnings.join("\n")).digest("hex");

if (errors.length > 0 || warnings.length !== BASELINE_WARNING_COUNT || digest !== BASELINE_SHA256) {
  const formatter = await eslint.loadFormatter("stylish");
  process.stderr.write(await formatter.format(results));
  process.stderr.write(
    `\nLint regression gate failed: errors=${errors.length}, warnings=${warnings.length}, sha256=${digest}\n` +
    `Expected: errors=0, warnings=${BASELINE_WARNING_COUNT}, sha256=${BASELINE_SHA256}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Lint regression baseline unchanged: ${warnings.length} legacy warnings, exact fingerprint ${digest.slice(0, 12)}.\n`);
}
