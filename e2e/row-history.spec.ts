import { expect, test } from '@playwright/test'
import { BUDGET_EMAIL, signIn } from './helpers'

/**
 * City Planning corrects a line where it reads it — on the consolidated
 * programme — and the correction is on the record.
 *
 * The two halves belong in one test because neither is safe alone: an
 * overwrite of a department's figure is acceptable exactly because the office
 * whose figure it was can see who changed it, from what, to what.
 */
test.describe('editing the consolidated programme', () => {
  test('City Planning edits a row and the change lands in its history',
    async ({ page }) => {
    await signIn(page, 'planstaff@tracks.local')
    await page.goto('/consolidated')

    // Narrow to one row so the assertions are about that row and not the
    // first of two thousand.
    const filter = page.getByPlaceholder(/Filter by description/)
    await filter.fill('Travelling')
    const row = page.getByRole('row').filter({ hasText: /Travelling/ }).first()
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Edit row' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const amount = `${7_000_000 + (Date.now() % 1000)}`
    await dialog.getByLabel(/^MOOE/).fill(amount)
    await dialog.getByRole('button', { name: /Save/ }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    // The trail is written by trigger, so it is there whether or not anything
    // in the application remembered to write it.
    await filter.fill('Travelling')
    const edited = page.getByRole('row').filter({ hasText: /Travelling/ }).first()
    await edited.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'History' }).click()

    const history = page.getByRole('dialog')
    await expect(history.getByText('Changed MOOE (9)')).toBeVisible({ timeout: 30_000 })
    await expect(history.getByText('Sonia Staff')).toBeVisible()
    await expect(history.getByText('City Planning Sector Officer').first()).toBeVisible()
  })

  test('the office whose figure it was can read who changed it', async ({ page }) => {
    await signIn(page, 'cmo.head@tracks.local')
    await page.goto('/aip')
    await page.getByRole('link', { name: 'Open' }).first().click()
    await page.waitForURL(/\/aip\/[0-9a-f-]{36}/)

    const row = page.getByRole('row').filter({ hasText: /Travelling/ }).first()
    await row.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('menuitem', { name: 'History' }).click()

    const history = page.getByRole('dialog')
    await expect(history.getByRole('heading', { name: /^History of item/ })).toBeVisible()
    await expect(history.getByText('City Planning Sector Officer').first())
      .toBeVisible({ timeout: 30_000 })
  })

  // Reading the consolidated programme is not editing it. Budget and
  // Accounting see the trail — they are provisioned — and no way to change a row.
  test('a reader who is not City Planning is offered the trail and nothing else',
    async ({ page }) => {
    await signIn(page, BUDGET_EMAIL)
    await page.goto('/consolidated')

    const row = page.getByRole('row').filter({ hasText: /Travelling/ }).first()
    await row.getByRole('button', { name: /^Actions for/ }).click()
    await expect(page.getByRole('menuitem', { name: 'History' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Edit row' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Delete row' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /^Add row/ })).toHaveCount(0)
  })
})
