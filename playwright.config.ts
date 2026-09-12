import { defineConfig } from "@playwright/test";

const desktop = { viewport: { width: 1366, height: 768 } };

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/privacidade",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium-desktop", use: { browserName: "chromium", ...desktop } },
    { name: "firefox-desktop", use: { browserName: "firefox", ...desktop } },
    { name: "webkit-desktop", use: { browserName: "webkit", ...desktop } },
    {
      name: "webkit-phone-small",
      use: { browserName: "webkit", viewport: { width: 375, height: 667 }, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: "webkit-phone-modern",
      use: { browserName: "webkit", viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 3 },
    },
    {
      name: "chromium-android",
      use: { browserName: "chromium", viewport: { width: 412, height: 915 }, hasTouch: true, deviceScaleFactor: 2.625 },
    },
    {
      name: "webkit-tablet-portrait",
      use: { browserName: "webkit", viewport: { width: 768, height: 1024 }, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      name: "webkit-tablet-landscape",
      use: { browserName: "webkit", viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
});
