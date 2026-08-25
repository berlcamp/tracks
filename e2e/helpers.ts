import type { Page } from '@playwright/test'

export const DEV_EMAIL = 'planning@tracks.local'
export const DEPARTMENT_EMAIL = 'cmo.head@tracks.local'
export const OTHER_DEPARTMENT_EMAIL = 'cho.head@tracks.local'
export const BUDGET_EMAIL = 'budget@tracks.local'
export const ACCOUNTING_EMAIL = 'accounting@tracks.local'
export const VIEWER_EMAIL = 'viewer@tracks.local'
export const DEV_PASSWORD = 'localdev12345'

/**
 * Signs in through the local password panel and waits for the dashboard.
 *
 * The local Supabase can be slow when several stacks share the machine, so this
 * retries the sign-in once rather than failing the whole suite on a cold auth
 * container.
 */
export async function signIn(page: Page, email = DEV_EMAIL): Promise<void> {
  // Drop any existing session first. Without this, /login redirects a signed-in
  // visitor straight to /dashboard and the form is never rendered — so a test
  // that switches roles mid-run would silently keep the previous identity.
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(DEV_PASSWORD)
  await page.getByRole('button', { name: 'Sign in locally' }).click()

  try {
    await page.waitForURL('**/dashboard', { timeout: 25_000 })
  } catch {
    await page.goto('/dashboard')
    await page.waitForURL('**/dashboard', { timeout: 25_000 })
  }
}

/** The first AIP in the submissions table. */
export async function openFirstAip(page: Page): Promise<void> {
  await page.goto('/aip')
  await page.getByRole('link', { name: 'Open' }).first().click()
  await page.waitForURL(/\/aip\/[0-9a-f-]{36}/)
}
