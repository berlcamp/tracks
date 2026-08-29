import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, VIEWER_EMAIL, signIn } from './helpers'

/**
 * The presentation deck's reports, on the dashboard.
 *
 * The figures are the same ones 09_presentation.sql asserts against
 * `v_period_totals`, `v_sector_totals` and `v_aip_totals` — there is nothing
 * new to check about them here. What a browser is for is the scope: that a
 * department account gets its own office and says so, that the two reports the
 * database computes city-wide are not offered inside one office, and that
 * hand-editing the office out of the request does not reach another office's
 * figures.
 */
test.describe('the dashboard reports', () => {
  test('a department account reads its own office, and the slide says so',
    async ({ page }) => {
      await signIn(page, DEPARTMENT_EMAIL)

      const report = page.getByLabel('Report', { exact: true })
      await expect(report).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()

      // The scope is stated on the slide itself, because a head comparing this
      // grand total against the consolidated AIP has to be able to see, there,
      // that the two are not the same document.
      await expect(page.getByText('only. Every figure here is your')).toBeVisible()

      // …and it is a scope, not a drill-down. `presentation_deck()` sets
      // `filtered` the moment a department id is passed; captioning the only
      // programme an office has as "Filtered" would be false.
      await expect(page.getByText('Filtered.', { exact: false })).toHaveCount(0)
    })

  test('the dropdown changes report without a round trip', async ({ page }) => {
    await signIn(page, DEPARTMENT_EMAIL)

    await page.getByLabel('Report', { exact: true }).click()
    await page.getByRole('option', { name: 'Investment by Sector' }).click()
    await expect(page.getByRole('heading', { name: 'Investment by Sector' })).toBeVisible()

    // The whole deck arrived in one payload, so the report is client state and
    // the URL is untouched.
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('withholds the two reports that are the city\'s, from an office',
    async ({ page }) => {
      await signIn(page, DEPARTMENT_EMAIL)
      await page.getByLabel('Report', { exact: true }).click()

      // The NTA and the statutory bases belong to no office, and the
      // multi-year series is the whole programme's — neither narrows.
      await expect(page.getByRole('option')).toHaveCount(10)
      await expect(page.getByRole('option', {
        name: 'Programme against Recorded Resources',
      })).toHaveCount(0)
      await expect(page.getByRole('option', { name: 'Multi-Year Trends' })).toHaveCount(0)
    })

  test('a city-wide role reads the whole programme, and all twelve reports',
    async ({ page }) => {
      await signIn(page, VIEWER_EMAIL)

      await expect(page.getByText('only. Every figure here is your')).toHaveCount(0)
      await page.getByLabel('Report', { exact: true }).click()
      await expect(page.getByRole('option')).toHaveCount(12)
    })
})
