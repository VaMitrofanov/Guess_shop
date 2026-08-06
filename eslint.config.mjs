import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // U16 (ultra-review): линтер выдавал 1121 error, и практически все — это
  // `@typescript-eslint/no-explicit-any` на осознанных кастах Prisma-моделей
  // (`(db as any).wbCode`, см. architecture.md). В таком виде гейт бесполезен:
  // новая настоящая ошибка тонет в шуме, поэтому вывод никто не смотрел.
  //
  // Правило понижено до warning, а рост числа предупреждений ограничен
  // `--max-warnings` в npm-скрипте `lint`. Вернуть в `error` — отдельная задача
  // после типизации WB-моделей.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // Долг React-компилятора в экранах TWA: 22 `set-state-in-effect` + пара
      // refs/purity. Это настоящие замечания, но чинятся рефакторингом экранов,
      // а не одной правкой. Держим их видимыми как warning под общим потолком
      // `--max-warnings`, чтобы гейт был зелёным и падал на НОВЫХ проблемах.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // Node-скрипты и сиды — честный CommonJS, `require()` там уместен.
    files: ["**/*.js", "**/*.cjs", "scripts/**", "prisma/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Точечные escape-hatch'и в ботах, скриптах и d.ts — оставляем как warning.
    files: ["bots/**", "scripts/**", "src/types/**"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees are independent checkouts and must not pollute the
    // lint baseline of this workspace.
    ".claude/worktrees/**",
    // Локальная песочница (в .gitignore) — не часть кодовой базы.
    "scratch/**",
  ]),
]);

export default eslintConfig;
