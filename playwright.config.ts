import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Some CI images ship a pre-installed Chromium that does not match the version
 * this Playwright release would download. Point at it when it is there rather
 * than failing, and fall back to Playwright's own managed browser otherwise.
 */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(PREINSTALLED_CHROMIUM)
  ? { executablePath: PREINSTALLED_CHROMIUM }
  : {};

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions,
      },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: baseURL,
    /**
     * Always start a fresh server, never adopt a running one.
     *
     * Reuse cost three confusing debugging sessions here: a suite silently
     * testing the previous build, two concurrent runs racing for the port, and
     * login rate-limit counters carrying over between runs so tests that passed
     * alone failed in sequence. Some seconds of startup is a cheap price for a
     * run that means what it says.
     */
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
