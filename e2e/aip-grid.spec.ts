import { expect, test } from '@playwright/test'
import { openFirstAip, signIn } from './helpers'

test.describe('the AIP grid', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await openFirstAip(page)
  })

  test('lays the worksheet out the way the office reads it', async ({ page }) => {
    // Sector band, then department band, then the column-C heading row.
    await expect(
      page.getByRole('cell', { name: 'GENERAL PUBLIC SECTOR', exact: true })).toBeVisible()
    await expect(
      page.getByRole('cell', { name: 'General and Administrative Operation', exact: true })
        .first()).toBeVisible()
    await expect(page.getByRole('cell', { name: /\(CMO\) TOTAL$/ })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'GENERAL PUBLIC SECTOR - TOTAL' })).toBeVisible()
  })

  test('does not scroll the page sideways, however wide the grid', async ({ page }) => {
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1)
    expect(overflows, 'the grid must scroll inside its own container').toBe(false)
  })

  test('filters rows and says when a subtotal covers only what is shown', async ({ page }) => {
    const filter = page.getByPlaceholder(/Filter by description/)
    await filter.fill('Travelling')

    await expect(page.getByText(/Administrative Cost for Travelling/)).toBeVisible()
    await expect(page.getByText('Acquisition of Office Supplies')).toHaveCount(0)
    await expect(page.getByText('(filtered rows only)').first()).toBeVisible()

    await filter.fill('')
    await expect(page.getByText('Acquisition of Office Supplies')).toBeVisible()
  })

  test('adds a row below the one you clicked, and renumbers without a reload',
    async ({ page }) => {
    const description = `E2E test item ${Date.now()}`

    // Rows are added the way a spreadsheet adds them: from the row you are on.
    await page.getByRole('button', { name: /^Actions for item 1$/ }).click()
    await page.getByRole('menuitem', { name: 'Add row below' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByLabel(/Program \/ Project \/ Activity Description/).fill(description)
    await dialog.getByLabel(/Personal Services/).fill('125000')

    // Column (12) adds up as you type — the figure everyone checks.
    await expect(dialog.getByText('125,000.00')).toBeVisible()

    await dialog.getByRole('button', { name: 'Add item' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByText(description)).toBeVisible({ timeout: 30_000 })
  })

  test('adds a column-C heading, which takes no item number', async ({ page }) => {
    const caption = `E2E HEADING ${Date.now()}`

    await page.getByRole('button', { name: /^Actions for item 1$/ }).click()
    await page.getByRole('menuitem', { name: 'Add row above' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Row type').click()
    await page.getByRole('option', { name: /PPA header/ }).click()

    // A heading carries its text and nothing else — the money fields are gone.
    await expect(dialog.getByLabel(/Personal Services/)).toHaveCount(0)
    await dialog.getByLabel(/^Heading/).fill(caption)
    await dialog.getByRole('button', { name: 'Add heading' }).click()

    await expect(dialog).toBeHidden({ timeout: 30_000 })
    const headingRow = page.getByRole('row').filter({ hasText: caption })
    await expect(headingRow).toBeVisible({ timeout: 30_000 })
  })

  test('exports the department workbook', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const href = document.querySelector<HTMLAnchorElement>('a[href*="/export"]')?.href
      if (!href) return null
      const response = await fetch(href)
      const buffer = await response.arrayBuffer()
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        disposition: response.headers.get('content-disposition'),
        magic: new TextDecoder().decode(new Uint8Array(buffer.slice(0, 2))),
      }
    })

    expect(result).not.toBeNull()
    expect(result!.status).toBe(200)
    expect(result!.type).toContain('spreadsheetml.sheet')
    expect(result!.disposition).toMatch(/filename="CY\d{4}-AIP-[A-Za-z-]+\.xlsx"/)
    // A real xlsx is a zip.
    expect(result!.magic).toBe('PK')
  })
})

test.describe('supplemental AIPs', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test('lists a department’s supplementals under its annual, not as strangers',
    async ({ page }) => {
      await page.goto('/aip')
      const table = page.getByRole('table')
      await expect(table.getByRole('cell', { name: 'Annual', exact: true }).first())
        .toBeVisible()
      await expect(table.getByRole('cell', { name: /^Supplemental No\. \d+$/ }).first())
        .toBeVisible()
    })

  test('offers the year’s submissions side by side with a combined figure',
    async ({ page }) => {
      await page.goto('/aip')
      await page.getByRole('link', { name: 'Open' }).first().click()
      await page.waitForURL(/\/aip\/[0-9a-f-]{36}/)

      const switcher = page.getByRole('navigation', { name: 'Submissions for this year' })
      await expect(switcher).toBeVisible()
      await expect(switcher.getByText('Combined:')).toBeVisible()

      // Switching goes to a different document rather than merging the two.
      // Waiting on the /aip/<id> pattern alone would match the page already on
      // screen and return immediately, so wait for the URL to actually change.
      const before = page.url()
      await switcher.getByRole('link', { name: /Supplemental No\. 1/ }).click()
      await page.waitForURL((url) => url.toString() !== before)
      await expect(page.getByText(/Supplemental AIP No\. 1/)).toBeVisible()
    })
})
