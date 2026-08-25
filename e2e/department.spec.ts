import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, signIn } from './helpers'

/**
 * The department's own view. These need the local demo sign-ins from
 * `npm run db:users`; without them the suite would be testing the planning
 * admin's permissions twice and calling it coverage.
 */
test.describe('a department user', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, DEPARTMENT_EMAIL)
  })

  test('sees its own office, not the city-wide views', async ({ page }) => {
    const sidebar = page.locator('[data-slot="sidebar"]').first()
    await expect(sidebar.getByRole('link', { name: 'Our AIP', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Budget & Obligations' })).toHaveCount(0)
  })

  test('is refused the City Planning settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('reaches a PPA ledger from monitoring instead of being bounced',
    async ({ page }) => {
      // Regression: this link used to point at /budget, which department roles
      // cannot open — it rendered for them and then redirected to the dashboard.
      await page.goto('/monitoring')
      const ledger = page.getByRole('link', { name: 'Ledger' }).first()
      await expect(ledger).toBeVisible()
      await ledger.click()

      await expect(page).toHaveURL(/\/monitoring\/[0-9a-f-]{36}/)
      await expect(page.getByRole('tab', { name: 'Obligations' })).toBeVisible()
    })

  test('can report physical progress but cannot record money', async ({ page }) => {
    await page.goto('/monitoring')
    await page.getByRole('link', { name: 'Ledger' }).first().click()
    await expect(page).toHaveURL(/\/monitoring\/[0-9a-f-]{36}/)

    await page.getByRole('tab', { name: 'Progress' }).click()
    await expect(page.getByRole('button', { name: 'Report progress' })).toBeVisible()

    await page.getByRole('tab', { name: 'Obligations' }).click()
    await expect(page.getByRole('button', { name: 'Record obligation' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Allotments' }).click()
    await expect(page.getByRole('button', { name: 'Record allotment' })).toHaveCount(0)
  })
})
