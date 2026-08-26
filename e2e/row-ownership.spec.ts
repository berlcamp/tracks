import { expect, test } from '@playwright/test'
import { signIn, openFirstAip } from '../e2e/helpers'

test('two encoders, each owning their own rows', async ({ page }) => {
  // Elena writes a row.
  await signIn(page, 'cmo.encoder@tracks.local')
  await openFirstAip(page)
  await page.getByRole('button', { name: /^Actions for item 1$/ }).click()
  await page.getByRole('menuitem', { name: 'Add row below' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Program \/ Project \/ Activity Description/).fill('Elena row')
  await dialog.getByLabel(/^MOOE/).fill('1000')
  await dialog.getByRole('button', { name: 'Add item' }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })

  const elenaRow = page.getByRole('row').filter({ hasText: 'Elena row' })
  await expect(elenaRow).toContainText('Elena Encoder (CMO)')
  await expect(elenaRow.getByRole('button', { name: /^Actions for/ })).toBeVisible()

  // Ramon sees who wrote it, and is offered nothing on it.
  await signIn(page, 'cmo.encoder2@tracks.local')
  await openFirstAip(page)
  const asRamon = page.getByRole('row').filter({ hasText: 'Elena row' })
  await expect(asRamon).toContainText('Elena Encoder (CMO)')

  // He may still put his own row beside hers — inserting is not editing — but
  // hers is not his to change or remove.
  await asRamon.getByRole('button', { name: /^Actions for/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Add row below' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Edit row' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Delete row' })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The head answers for the whole office, so the row is theirs to fix.
  await signIn(page, 'cmo.head@tracks.local')
  await openFirstAip(page)
  const asHead = page.getByRole('row').filter({ hasText: 'Elena row' })
  await expect(asHead.getByRole('button', { name: /^Actions for/ })).toBeVisible()
})
