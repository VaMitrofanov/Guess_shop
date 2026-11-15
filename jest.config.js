const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

// Ночные тихие часы уведов (`isQuietHour`, admin-route.ts) зависят от времени
// суток: без этого тесты на звук падали бы только ночью. Воркеры наследуют env.
process.env.ADMIN_QUIET_HOURS = process.env.ADMIN_QUIET_HOURS || "off";

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  moduleNameMapper: {
    // Mirror the Next.js "@/..." path alias (tsconfig paths) so src/ modules
    // and their siblings resolve under ts-jest.
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // Generated standalone output and agent worktrees contain duplicate package
  // manifests; indexing them makes Jest report false haste collisions.
  modulePathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/.claude/worktrees/",
  ],
};
