import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/optical',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:1422', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run build:receiver && npm run preview -- --host 127.0.0.1 --port 1422 --outDir dist-receiver',
    url: 'http://127.0.0.1:1422/receiver/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
