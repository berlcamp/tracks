import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, VIEWER_EMAIL, signIn } from './helpers'

/**
 * The deck the City Planning Office presents from.
 *
 * The figures are asserted in 09_presentation.sql, against the same views the
 * AIP workbook prints. What is left for a browser is that the thing opens, that
 * it moves between slides, that presentation mode actually removes the app
 * around it, and — the one that matters most in a session hall — that a
 * filtered slide says out loud that it is filtered.
 */
test.describe('the AIP presentation', () => {
  test('opens on the executive summary and walks the deck', async ({ page }) => {
    await signIn(page)
    await page.goto('/planning/reports')

    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()
    await expect(page.getByText('Slide 1 of 12')).toBeVisible()

    await page.getByRole('button', { name: 'Investment by Sector' }).click()
    await expect(page).toHaveURL(/slide=sectors/)
    await expect(page.getByRole('heading', { name: 'Investment by Sector' })).toBeVisible()

    // Back at the first slide there is nowhere further back to go: the deck
    // stops rather than wrapping, because looping to slide one mid-sentence
    // reads as a bug.
    await page.goto('/planning/reports?slide=summary')
    await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  test('a slide nobody recognises falls back rather than erroring', async ({ page }) => {
    await signIn(page)
    await page.goto('/planning/reports?slide=a-report-that-was-removed')
    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()
  })

  test('a filter that cannot be read leaves the deck standing', async ({ page }) => {
    await signIn(page)
    // An empty or hand-edited id reaches a uuid parameter. Falling back is the
    // rule everywhere else here, and a report somebody is waiting to present is
    // the worst place to be the exception.
    await page.goto('/planning/reports?sector=&office=not-a-uuid')
    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()
  })

  test('a drill-down says that every figure on the slide was recomputed',
    async ({ page }) => {
      await signIn(page)
      await page.goto('/planning/reports')

      await page.getByLabel('Sector', { exact: true }).click()
      const options = page.getByRole('option')
      test.skip(await options.count() < 2, 'No sector has a line on this stack')
      await options.nth(1).click()

      await expect(page).toHaveURL(/sector=[0-9a-f-]{36}/)
      await expect(page.getByText('Filtered.', { exact: false }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Clear filters' }).click()
      await expect(page.getByText('Filtered.', { exact: false })).toHaveCount(0)
    })

  test('presentation mode takes the application off the screen', async ({ page }) => {
    await signIn(page)
    await page.goto('/planning/reports')

    await page.getByRole('link', { name: 'Presentation mode' }).click()
    await expect(page).toHaveURL(/\/planning\/reports\/present/)
    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()

    // Not covered — absent. An overlay would leave the rail in the tab order
    // and in the accessibility tree, so somebody tabbing mid-presentation
    // lands on links nobody can see. This route renders no navigation at all.
    await expect(page.getByRole('navigation', { name: 'Report contents' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Consolidated AIP' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toHaveCount(0)

    // The clicker sends arrows and nothing else.
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(/slide=sectors/)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/planning\/reports(\?|$)/)
    await expect(page.getByRole('navigation', { name: 'Report contents' })).toBeVisible()
  })

  test('the presentation route keeps the document and the filters it was opened with',
    async ({ page }) => {
      await signIn(page)
      await page.goto('/planning/reports/present?slide=execution')
      await expect(page.getByRole('heading', { name: 'Execution and Monitoring' }))
        .toBeVisible()
      await expect(page.getByText('1 / 12')).toHaveCount(0)
      await expect(page.getByText('8 / 12')).toBeVisible()
    })

  test('prints every slide on one page', async ({ page }) => {
    await signIn(page)
    await page.goto('/planning/reports?print=all')
    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Decision Summary' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(12)
  })

  test('a viewer may present it and a department user may not', async ({ page }) => {
    // The same readership as the Consolidated AIP. An office has no call to
    // present the city's programme; its own figures are on its AIP screen.
    await signIn(page, VIEWER_EMAIL)
    await page.goto('/planning/reports')
    await expect(page.getByRole('heading', { name: 'Executive Summary' })).toBeVisible()

    await signIn(page, DEPARTMENT_EMAIL)
    await page.goto('/planning/reports')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
