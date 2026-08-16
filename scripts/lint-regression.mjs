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
// 2026-08-04 (1109 → 1109): единый ADMIN_TIME_ZONE устранил hydration mismatch
// дат в четырёх client-компонентах админки. Новых предупреждений нет; импорты
// сдвинули только строки двух уже известных buyout useEffect warnings.

// 2026-08-04 (1109 → 1096): performance batch удалил мёртвые product CRUD и
// фиксированный PageLoader, а Economics/Buyout/Anton получили server-first
// initial data. Убраны 13 старых warning (включая initial-load effects), новых
// предупреждений в затронутом admin-коде нет; полный formatter проверен.

// 2026-08-09 (1096 → 1088): payment reliability batch включил bot-side
// order-benefits в zero-warning critical corridor (совместимый Prisma boundary
// имеет локальный documented disable), удалил stale dependency в WB search и
// мёртвую cache-invalidation заглушку. После Next 16.3/Auth/Prisma upgrade и
// замены SheetJS полный formatter проверен: новых warning-классов нет.
//
// 2026-08-09 (1088 → 1085): bot hybrid checkout удалил три ставших мёртвыми
// legacy-импорта из TG/VK handlers. Новые HMAC/payment domain и route-файлы
// проходят scoped ESLint без warnings; остальной сдвиг — номера строк handlers.
//
// 2026-08-09 (1085 → 1084): canonical manual confirmation теперь уведомляет
// клиента только через durable outbox. Удалён второй прямой DB lookup через
// legacy `any`; остальные изменения fingerprint — сдвиг строк payment handlers.

// 2026-08-11 (1084 → 1084): DBS-worker подключён к существующему TG cron,
// из-за чего сдвинулись номера строк его legacy warnings. Новый WB delivery
// corridor отдельно проходит `lint:critical` с max-warnings=0; состав и число
// общего legacy debt не изменились. Обязательный donor-account guard также
// сдвинул только существующие warning-строки большого TWA orders route.
//
// 2026-08-16 (1084 → 1086): the recorded 1084 was already stale — a clean
// checkout of `main` at `ae59a3e` measures 1086, so the two extra warnings come
// from the DBS admin-visibility batch (`74ae55b`…`ae59a3e`), which changed the
// gate's inputs without re-recording them. Verified by lint-diffing this branch
// against a stashed working tree: the per-file/per-rule multiset is byte-for-byte
// identical, so the WB_DBS order source adds zero debt. Its own new files
// (`wb-order-source.ts`, `wb-activation-code.ts` and their tests) are clean; the
// rest of the fingerprint shift is line numbers in the files it touched.
//
// 2026-08-17 (1086 → 1086): состав и число legacy debt не изменились; отпечаток
// сдвинулся только из-за новых строк в admin/TG/VK карточках заказа, куда добавлена
// пометка источника WB DBS, и в worker'е DBS. Новые файлы проходят scoped ESLint
// без warnings.
//
// Unlike --max-warnings, this has no spare capacity: adding, moving,
// replacing or changing even one warning fails the gate. Reduce the baseline
// only in a dedicated cleanup change after reviewing the full formatter output.
const BASELINE_WARNING_COUNT = 1086;
const BASELINE_SHA256 = "d3ee89167d3bcd333e92fbef47436f0f6a73f15812aa7fb0b37e241449a22c18";

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
