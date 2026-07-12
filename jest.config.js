const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

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
};