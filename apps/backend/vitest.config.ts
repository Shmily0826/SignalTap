import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const schemas = fileURLToPath(
  new URL("../../packages/schemas/src/index.ts", import.meta.url)
);
const analysis = fileURLToPath(
  new URL("../../packages/analysis/src/index.ts", import.meta.url)
);

export default defineConfig({
  resolve: {
    alias: {
      "@signaltap/schemas": schemas,
      "@signaltap/analysis": analysis,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_PER_MIN: "3",
    },
  },
});
