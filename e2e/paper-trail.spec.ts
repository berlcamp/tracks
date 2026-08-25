import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test.describe('the paper trail', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/consolidated')
  })

  test('shows all three bodies, including the ones that have not returned', async ({ page }) => {
    // Scoped to the landmark: "Mayor's Office" also appears in the grid below,
    // as part of "City Mayor's Office (CMO)".
    const trail = page.getByRole('region', { name: 'Paper trail' })
    await expect(trail).toBeVisible()
    await expect(trail.getByText('Local Development Council')).toBeVisible()
    await expect(trail.getByText("Mayor's Office", { exact: true })).toBeVisible()
    await expect(trail.getByText('City Council', { exact: true })).toBeVisible()
    // The gap is the information: an empty stage says the folder is still out.
    await expect(trail.getByText('Not yet returned').first()).toBeVisible()
  })

  test('records a council resolution with its reference number', async ({ page }) => {
    const reference = `Resolution No. E2E-${Date.now()}`

    await page.getByRole('button', { name: 'Record what came back' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Date on the paper').fill('2026-11-20')
    await dialog.getByLabel(/Resolution \/ ordinance no\./).fill(reference)
    await dialog.getByLabel('Remarks').fill('Approved as submitted.')
    await dialog.getByRole('button', { name: 'Record' }).click()

    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(reference)).toBeVisible({ timeout: 30_000 })
  })
})
