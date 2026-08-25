import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test.describe('access', () => {
  test('the landing page is public and offers sign-in', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('AIP')
    await expect(page.getByRole('link', { name: /Sign in with Google/i })).toBeVisible()
  })

  test('an unauthenticated visitor cannot reach the app', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/)
  })

  test('every app route bounces an unauthenticated visitor to login', async ({ page }) => {
    for (const path of ['/aip', '/consolidated', '/monitoring', '/budget', '/settings']) {
      await page.goto(path)
      await expect(page, `${path} must be gated`).toHaveURL(/\/login/)
    }
  })

  test('signing in lands on the dashboard', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('heading', { name: /Annual Investment Program/ })).toBeVisible()
  })

  test('the sidebar offers no department-only page to a city-wide role', async ({ page }) => {
    await signIn(page)
    // "Our AIP" only makes sense inside a department; "Submissions" is the
    // city-wide view of the same route.
    const sidebar = page.getByRole('navigation').or(page.locator('[data-slot="sidebar"]')).first()
    await expect(sidebar.getByRole('link', { name: 'Submissions', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Our AIP', exact: true })).toHaveCount(0)
  })
})
