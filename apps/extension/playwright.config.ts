import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  use: {
    // Extensions only load in headed Chromium (headless ignores --load-extension).
    headless: false,
  },
  webServer: [
    {
      command: "npm run start --workspace @signaltap/backend",
      url: "http://localhost:8787/health",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: "node tests/e2e/static-server.mjs",
      url: "http://localhost:8099/",
      reuseExistingServer: true,
      timeout: 15_000,
    },
  ],
});
