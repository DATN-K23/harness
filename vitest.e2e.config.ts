import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@audit-harness/contracts": path.resolve(
        __dirname,
        "packages/contracts/src/index.ts",
      ),
      "@audit-harness/sdk": path.resolve(
        __dirname,
        "packages/sdk/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.spec.ts", "tests/e2e/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
