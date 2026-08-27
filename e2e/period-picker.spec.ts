import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

/**
 * Reaching a year that is not the current one.
 *
 * Every screen used to take the latest period and offer no way back, so last
 * year's programme — readable all along, nothing in RLS hides it — could not be
 * opened at all. The year lives in the URL, which is also what makes a link to
 * CY 2026's consolidated programme a link somebody can send.
 *
 * These adapt to whatever the local stack holds: with one period the picker is
 * not offered, and there is nothing to switch to.
 */
test.describe('the programme year', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('a year that does not exist falls back to the current programme',
    async ({ page }) => {
      // A bookmark from a period somebody deleted should land on this year's
      // work, not on a dead end.
      await page.goto('/consolidated')
      const subtitle = page.locator('h1 ~ p').first()
      const current = (await subtitle.innerText()).trim()
      expect(current).not.toBe('')

      await page.goto('/consolidated?period=00000000-0000-0000-0000-000000000000')
      await expect(page.getByRole('heading', { name: 'Consolidated AIP' })).toBeVisible()
      expect((await page.locator('h1 ~ p').first().innerText()).trim()).toBe(current)
    })

  test('switching year carries through to the submissions list', async ({ page }) => {
    await page.goto('/aip')
    const picker = page.getByLabel('Programme year', { exact: true })
    test.skip(await picker.count() === 0, 'Only one AIP period on this stack')

    await picker.click()
    const options = page.getByRole('option')
    await options.last().click()

    await expect(page).toHaveURL(/[?&]period=[0-9a-f-]{36}/)
    await expect(page.getByLabel('Programme year', { exact: true })).toBeVisible()
  })

  test('supplementals are consolidated as their own document', async ({ page }) => {
    await page.goto('/consolidated')
    const toggle = page.getByRole('link', { name: 'Supplementals' })
    test.skip(await toggle.count() === 0, 'No supplemental AIPs on this stack')

    await toggle.click()
    await expect(page).toHaveURL(/kind=supplemental/)
    // Finalising is the annual programme's act; it is not offered over the
    // supplementals, though their rows still count towards it.
    await expect(page.getByRole('button', { name: 'Finalise and lock' })).toHaveCount(0)
  })
})
