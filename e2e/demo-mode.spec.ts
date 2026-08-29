import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, signIn } from './helpers'

/**
 * Demo mode: a whole pretend programme year that can be shown to people and
 * handed back to its starting state afterwards.
 *
 * The assertions that matter are about the SWITCH, not the seed: that the year
 * appears badged where somebody could otherwise pick it up by mistake, and that
 * turning it off removes it from a department account's screens as well as from
 * the administrator's own.
 */
test.describe('demo mode', () => {
  test('the administrator builds the demo year, and it is badged everywhere',
    async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Demo' }).click()

    const toggle = page.getByRole('switch', { name: 'Demo mode' })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('data-state')) === 'unchecked') {
      await toggle.click()
      await expect(page.getByText(/Demo mode is on/)).toBeVisible({ timeout: 30_000 })
    }

    // The year picker is the one place a demo year could be picked up by
    // somebody meaning to encode real work.
    await page.goto('/consolidated')
    await page.getByLabel('Programme year').click()
    await expect(page.getByRole('option').filter({ hasText: 'DEMO' }).first())
      .toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
  })

  test('the demo year carries a worked programme, not empty documents',
    async ({ page }) => {
    await signIn(page)
    await page.goto('/aip')

    await page.getByLabel('Programme year').click()
    await page.getByRole('option').filter({ hasText: 'DEMO' }).first().click()
    await page.waitForURL(/period=/)

    // Submitted and accepted offices, which is what the office wants to show.
    const table = page.getByRole('table')
    await expect(table.getByText('Accepted').first()).toBeVisible({ timeout: 30_000 })
  })

  test('turning it off hides the year from everybody', async ({ page }) => {
    await signIn(page)
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Demo' }).click()

    const toggle = page.getByRole('switch', { name: 'Demo mode' })
    if ((await toggle.getAttribute('data-state')) === 'checked') {
      await toggle.click()
      await expect(page.getByText(/Demo mode is off/)).toBeVisible({ timeout: 30_000 })
    }

    // Gone for the administrator, whose policy on aips is FOR ALL and therefore
    // governs SELECT too — the case a predicate on aips_read alone would miss.
    await page.goto('/consolidated')
    await expect(page.getByRole('main').getByText('DEMO')).toHaveCount(0)

    // And gone for a department account.
    await signIn(page, DEPARTMENT_EMAIL)
    await page.goto('/aip')
    await expect(page.getByRole('main').getByText('DEMO')).toHaveCount(0)
  })
})
