import { expect, test } from '@playwright/test'
import { DEV_EMAIL, signIn } from './helpers'

/**
 * Where the printed programme has got to.
 *
 * The control used to sit in Settings → AIP periods, a page only the
 * administrator can open at all. It now sits on the consolidated AIP itself,
 * which everyone in City Planning can read — so the gate has to be on the
 * control, not on the page.
 */
test.describe('the period’s place on the paper trail', () => {
  test('the administrator moves it from the consolidated AIP', async ({ page }) => {
    await signIn(page, DEV_EMAIL)
    await page.goto('/consolidated')

    await expect(page.getByLabel('Programme status', { exact: true })).toBeVisible()

    // And no longer from Settings, where the status is now read-only.
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'AIP periods' }).click()
    await expect(page.getByRole('combobox')).toHaveCount(0)
  })

  test('a Sector Officer sees where it is but cannot move it', async ({ page }) => {
    await signIn(page, 'planstaff@tracks.local')
    await page.goto('/consolidated')

    await expect(page.getByLabel('Programme status', { exact: true })).toHaveCount(0)
    // Still told where it is — as a badge, whatever the period's status is today.
    await expect(page.locator('[data-slot="badge"]').first()).toBeVisible()
  })
})
