import { expect, test } from '@playwright/test'
import { ACCOUNTING_EMAIL, BUDGET_EMAIL, VIEWER_EMAIL, signIn } from './helpers'

test.describe('execution and reference data', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('the monitoring report measures utilisation against the allotment', async ({ page }) => {
    await page.goto('/monitoring')
    await expect(page.getByRole('heading', { name: 'Monitoring' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Programmed' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Allotment' })).toBeVisible()
    // A PPA with no allotment shows no rate rather than a misleading 0%.
    await expect(page.getByRole('columnheader', { name: /Oblig\. %/ })).toBeVisible()
  })

  test('records an obligation against a PPA', async ({ page }) => {
    // Budget's job, not Planning's. Signing in as the planning admin here would
    // pass only if that account were a super admin bypassing the role check —
    // which is exactly what this separation exists to prevent.
    await signIn(page, BUDGET_EMAIL)
    await page.goto('/budget')
    await page.locator('a[href*="/budget?ppa="]').first().click()
    await expect(page.getByRole('tab', { name: 'Obligations' })).toBeVisible()

    const reference = `OBR-E2E-${Date.now()}`
    await page.getByRole('button', { name: 'Record obligation' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.locator('input[name="date"]').fill('2027-03-01')
    await dialog.locator('input[name="amount"]').fill('250000')
    await dialog.locator('input[name="reference"]').fill(reference)
    await dialog.getByRole('button', { name: 'Record' }).click()

    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(reference)).toBeVisible({ timeout: 30_000 })
  })

  test('settings show all three names a sector prints under', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'PUBLIC SERVICES Sector' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'GENERAL PUBLIC SECTOR' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'GOVERNANCE SECTOR' })).toBeVisible()
  })

  test('the consolidated view exports the whole programme', async ({ page }) => {
    await page.goto('/consolidated')
    await expect(page.getByRole('heading', { name: 'Consolidated AIP' })).toBeVisible()

    const result = await page.evaluate(async () => {
      const href = document.querySelector<HTMLAnchorElement>('a[href*="/api/periods/"]')?.href
      if (!href) return null
      const response = await fetch(href)
      return {
        status: response.status,
        disposition: response.headers.get('content-disposition'),
      }
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe(200)
    expect(result!.disposition).toContain('Consolidated')
  })
})

test.describe('the separation between Budget and Accounting', () => {
  test('City Planning cannot record money against a PPA', async ({ page }) => {
    await signIn(page)   // planning administrator
    await page.goto('/budget')
    await page.locator('a[href*="/budget?ppa="]').first().click()

    await expect(page.getByRole('tab', { name: 'Obligations' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record obligation' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record allotment' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record disbursement' })).toHaveCount(0)
  })

  test('Budget records obligations but not disbursements', async ({ page }) => {
    await signIn(page, BUDGET_EMAIL)
    await page.goto('/budget')
    await page.locator('a[href*="/budget?ppa="]').first().click()

    await expect(page.getByRole('button', { name: 'Record obligation' })).toBeVisible()
    await page.getByRole('tab', { name: 'Disbursements' }).click()
    await expect(page.getByRole('button', { name: 'Record disbursement' })).toHaveCount(0)
  })

  test('Accounting records disbursements but not obligations', async ({ page }) => {
    await signIn(page, ACCOUNTING_EMAIL)
    await page.goto('/budget')
    await page.locator('a[href*="/budget?ppa="]').first().click()

    await page.getByRole('tab', { name: 'Disbursements' }).click()
    await expect(page.getByRole('button', { name: 'Record disbursement' })).toBeVisible()
    await page.getByRole('tab', { name: 'Obligations' }).click()
    await expect(page.getByRole('button', { name: 'Record obligation' })).toHaveCount(0)
  })

  test('a viewer is offered nothing to write anywhere', async ({ page }) => {
    await signIn(page, VIEWER_EMAIL)
    await page.goto('/aip')
    await expect(page.getByRole('button', { name: 'Add row' })).toHaveCount(0)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
