import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests against the LOCAL stack.
 *
 * They need `npm run db:start` (Supabase on 548xx, migrations + seed applied)
 * and the bootstrap auth user from LOCAL_DEV.md. The suite signs in through the
 * local password panel rather than Google, because an OAuth round trip cannot be
 * driven headlessly and is not what these tests are about — the flows are.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000/login',
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
