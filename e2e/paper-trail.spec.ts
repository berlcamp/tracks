import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test.describe('the paper trail', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/consolidated')
  })

  test('opens from the header rather than sitting down the page', async ({ page }) => {
    // Not on the screen until asked for: the trail is consulted a few times a
    // year, and it used to sit between the finalise panel and the grid.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await page.getByRole('button', { name: 'Paper Trail' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Scoped to the dialog: "Mayor's Office" also appears in the grid below,
    // as part of "City Mayor's Office (CMO)".
    await expect(dialog.getByText('Local Development Council')).toBeVisible()
    await expect(dialog.getByText("Mayor's Office", { exact: true })).toBeVisible()
    await expect(dialog.getByText('City Council', { exact: true })).toBeVisible()
    // The gap is the information: an empty stage says the folder is still out.
    await expect(dialog.getByText('Not yet returned').first()).toBeVisible()
  })

  test('records a council resolution with its reference number', async ({ page }) => {
    const reference = `Resolution No. E2E-${Date.now()}`

    await page.getByRole('button', { name: 'Paper Trail' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Record what came back' }).click()

    await dialog.getByLabel('Date on the paper').fill('2026-11-20')
    await dialog.getByLabel(/Resolution \/ ordinance no\./).fill(reference)
    await dialog.getByLabel('Remarks').fill('Approved as submitted.')
    await dialog.getByRole('button', { name: 'Record' }).click()

    // The same dialog goes back to the trail rather than closing, because the
    // entry just recorded is the thing you want to see land.
    await expect(dialog.getByText(reference)).toBeVisible({ timeout: 30_000 })
  })
})
