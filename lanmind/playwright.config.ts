import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/theme',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:1421',
    viewport: { width: 1440, height: 1000 },
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1421',
    url: 'http://127.0.0.1:1421/tests/theme/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
