/**
 * U17: у `bots/` не было ни tsc, ни тестов — 9000+ строк самого нагруженного
 * кода проверялись только в бою. Отдельный конфиг, потому что боты собираются
 * своим tsconfig (CommonJS, свои node_modules) и не знают про алиас `@/`.
 */
const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/bots"],
  testMatch: ["<rootDir>/bots/**/__tests__/**/*.test.ts"],
  transform: {
    ...tsJestTransformCfg,
  },
  modulePathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/.claude/worktrees/",
  ],
};
