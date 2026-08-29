import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, signIn } from './helpers'

/** The banner's own line, matched exactly so the toast's longer one is not it. */
const BANNER = 'Demo mode is on.'

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
    // Seeding builds every active department's document in one transaction.
    test.slow()
    await signIn(page)
    await page.goto('/settings')
    await page.getByRole('tab', { name: 'Demo' }).click()

    const toggle = page.getByRole('switch', { name: 'Demo mode' })
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('data-state')) === 'unchecked') {
      await toggle.click()
    }
    // The banner rather than the toast: a toast is gone in four seconds, and
    // its wording deliberately overlaps the banner's, so matching loosely on
    // either resolves to both.
    await expect(page.getByText(BANNER, { exact: true }))
      .toBeVisible({ timeout: 60_000 })

    // The year picker is the one place a demo year could be picked up by
    // somebody meaning to encode real work.
    await page.goto('/consolidated')
    await page.getByLabel('Programme year').click()
    await expect(page.getByRole('option').filter({ hasText: 'DEMO' }).first())
      .toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Escape')
  })

  // The demo year is dated behind the real programme so it can never become
  // the year every screen opens on. The cost of that is that enabling demo
  // mode changes nothing on the screen you are already looking at, which reads
  // exactly like a switch that does not work — so the banner is the way in,
  // and it is shown to everybody rather than only to whoever flipped it.
  test('a banner says it is on and leads to the year', async ({ page }) => {
    // Two full sign-ins and two navigations into a freshly seeded year of 28
    // offices. On a cold dev compile that does not fit the default budget, and
    // the failure looks like a missing banner rather than a slow page.
    test.slow()
    await signIn(page)
    await page.goto('/dashboard')
    await expect(page.getByText(BANNER, { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('link', { name: 'Open it' }).click()
    await page.waitForURL(/period=/)
    // The consolidated page's own heading is "Consolidated AIP"; the year it is
    // showing is named beneath it, and that is where (DEMO) reads.
    await expect(page.getByText(/Annual Investment Program \(DEMO\)/))
      .toBeVisible({ timeout: 30_000 })

    // A department account sees it too, and is sent to its own submissions
    // rather than to a consolidated programme it cannot reach.
    await signIn(page, DEPARTMENT_EMAIL)
    await page.goto('/dashboard')
    await expect(page.getByText(BANNER, { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Open it' }).click()
    await page.waitForURL(/\/aip\?period=/)
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
      await expect(page.getByText(BANNER, { exact: true }))
        .toHaveCount(0, { timeout: 60_000 })
    }

    // Gone for the administrator, whose policy on aips is FOR ALL and therefore
    // governs SELECT too — the case a predicate on aips_read alone would miss.
    await page.goto('/consolidated')
    await expect(page.getByRole('main').getByText('DEMO')).toHaveCount(0)

    // The banner goes with it — the switch being off has to be as legible as
    // it being on.
    await expect(page.getByText(BANNER, { exact: true })).toHaveCount(0)

    // And gone for a department account.
    await signIn(page, DEPARTMENT_EMAIL)
    await page.goto('/aip')
    await expect(page.getByRole('main').getByText('DEMO')).toHaveCount(0)
    await expect(page.getByText(BANNER, { exact: true })).toHaveCount(0)
  })
})
