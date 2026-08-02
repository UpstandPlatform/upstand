import { defineConfig, devices } from "@playwright/test";
import { env } from "@upstand/env/testing";

const baseURL = env.WEB_E2E_BASE_URL;
const webServerCommand =
  process.platform === "win32"
    ? "bun run start -- -p 3001"
    : "node .next/standalone/apps/web/server.js";
type SupportedBrowser = "chromium" | "firefox" | "webkit";

const requestedBrowser = env.PLAYWRIGHT_BROWSER;
const deviceByBrowser = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"],
} as const;
const isSupportedBrowser = (value: string): value is SupportedBrowser =>
  value in deviceByBrowser;

if (!isSupportedBrowser(requestedBrowser)) {
  throw new Error(
    `PLAYWRIGHT_BROWSER must be one of chromium, firefox, or webkit; received ${requestedBrowser}`,
  );
}

const browserName: SupportedBrowser = requestedBrowser;
const device = deviceByBrowser[browserName];

export default defineConfig({
  testDir: "./e2e",
  outputDir: "../../.builds/web-browser-test-results",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  forbidOnly: env.CI,
  retries: env.CI ? 2 : 0,
  reporter: env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...device,
    browserName,
  },
  webServer: {
    command: webServerCommand,
    env: {
      PORT: "3001",
    },
    url: baseURL,
    reuseExistingServer: !env.CI,
    timeout: 120_000,
  },
});
