import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, openFirstAip, signIn } from './helpers'

/**
 * One person, two offices: an encoder in the CMO and the head of the CHO.
 * Needs the `two.offices@tracks.local` sign-in from `npm run db:users`.
 */
const TWO_OFFICES_EMAIL = 'two.offices@tracks.local'

function switcher(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: /^Working as .*Switch office$/ })
}

test.describe('a person with two offices', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, TWO_OFFICES_EMAIL)
  })

  test('starts in the office they were given first, and switches', async ({ page }) => {
    await expect(switcher(page)).toContainText('CMO · Department Encoder')
    await expect(page.locator('header').first()).toContainText("City Mayor's Office")

    await switcher(page).click()
    await page.getByRole('menuitem', { name: /City Health Office/ }).click()

    await expect(switcher(page)).toContainText('CHO · Department Head')
    await expect(page.locator('header').first()).toContainText('City Health Office')

    // The choice is remembered, not a one-page state.
    await page.goto('/aip')
    await expect(switcher(page)).toContainText('CHO · Department Head')

    // Put back, so the next test starts where the account starts.
    await switcher(page).click()
    await page.getByRole('menuitem', { name: /City Mayor's Office/ }).click()
    await expect(switcher(page)).toContainText('CMO · Department Encoder')
  })

  test('leaves a document of the old office for the section list', async ({ page }) => {
    await openFirstAip(page)
    await switcher(page).click()
    await page.getByRole('menuitem', { name: /City Health Office/ }).click()
    await expect(page).toHaveURL(/\/aip$/)
    await expect(switcher(page)).toContainText('CHO · Department Head')

    await switcher(page).click()
    await page.getByRole('menuitem', { name: /City Mayor's Office/ }).click()
    await expect(switcher(page)).toContainText('CMO · Department Encoder')
  })

  test('a tab left on the old office is told why its save was refused', async ({ page, context }) => {
    // Tab A opens the CMO's AIP while working as the CMO…
    await openFirstAip(page)
    const aipUrl = page.url()

    // …tab B switches to the CHO…
    const other = await context.newPage()
    await other.goto('/dashboard')
    await switcher(other).click()
    await other.getByRole('menuitem', { name: /City Health Office/ }).click()
    await expect(switcher(other)).toContainText('CHO · Department Head')

    // …and tab A, still showing the CMO, tries to add a row.
    await page.getByRole('button', { name: /^Actions for item 1$/ }).click()
    await page.getByRole('menuitem', { name: 'Add row below' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Program \/ Project \/ Activity Description/).fill('Stale tab row')
    await dialog.getByLabel(/^MOOE/).fill('1000')
    await dialog.getByRole('button', { name: 'Add item' }).click()
    await expect(dialog).toContainText('Switch back to CMO')

    // Nothing was written.
    await other.goto(aipUrl)
    await expect(other.getByRole('row').filter({ hasText: 'Stale tab row' })).toHaveCount(0)

    await switcher(other).click()
    await other.getByRole('menuitem', { name: /City Mayor's Office/ }).click()
    await expect(switcher(other)).toContainText('CMO · Department Encoder')
  })
})

test('a person with one office is offered no switcher', async ({ page }) => {
  await signIn(page, DEPARTMENT_EMAIL)
  await expect(switcher(page)).toHaveCount(0)
})
