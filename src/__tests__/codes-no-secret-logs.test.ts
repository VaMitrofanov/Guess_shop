import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Контракт: код активации и адреса покупателя не попадают в журналы.
 * Ловим любой console.* в контуре кодов, которому передают значение кода,
 * конверт, email или токен ссылки.
 */
const ROOTS = ["src/lib/codes", "src/app/api/codes", "src/app/pay", "scripts/codes-import.ts"];
const FORBIDDEN = /\b(code|value|normalized|envelope|encryptedValue|recipientEmail|receiptEmail|email|token|to)\b(?!\s*:)/;

function files(entry: string): string[] {
  const absolute = path.resolve(process.cwd(), entry);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute).flatMap((name) => files(path.join(entry, name)));
}

test("no console call in the codes contour receives a code, an email or a pay token", () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap(files).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/console\.(log|error|warn|info)\(([\s\S]*?)\);/g)) {
      const args = match[2].replace(/"[^"]*"|`[^`]*`/g, "\"\"");
      if (FORBIDDEN.test(args)) offenders.push(`${path.relative(process.cwd(), file)}: ${match[0].slice(0, 120)}`);
    }
  }
  expect(offenders).toEqual([]);
});
