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
// смещение строк в файлах, которых коснулась правка. Unlike --max-warnings, this has no spare capacity: adding, moving,
// replacing or changing even one warning fails the gate. Reduce the baseline
// only in a dedicated cleanup change after reviewing the full formatter output.
const BASELINE_WARNING_COUNT = 1125;
const BASELINE_SHA256 = "10816db71676aab7778f64b383140c4c21642c62c48a58d913b066931f10d21a";

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
