import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/tooling/**/*.test.ts",
      "tests/unit/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "packages/**/*.spec.ts",
      "apps/**/*.spec.ts",
    ],
    exclude: ["tests/e2e/**"],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
