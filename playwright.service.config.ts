import { defineConfig, devices } from '@playwright/test';

const python = process.env.CALENDAR_PIE_PYTHON || (process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');

export default defineConfig({
  testDir: './tests/service_browser',
  workers: 1,
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:8766', timezoneId: 'UTC', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
  webServer: {
    command: `"${python}" tests/service_browser/server.py`,
    url: 'http://127.0.0.1:8766/api/health',
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
