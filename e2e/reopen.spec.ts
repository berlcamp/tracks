import { expect, test } from '@playwright/test'
import { DEPARTMENT_EMAIL, openFirstAip, signIn } from './helpers'

/**
 * City Planning handing a submission back.
 *
 * The escape hatch used to exist only as an RPC: `reopen_aip` was granted and
 * the server action was written, but nothing on screen called it — so a
 * submission accepted before its rows were read could not be rescued from the
 * UI at all. These tests do not actually reopen anything; they check the way
 * back is offered, and refused to the office it would be handed to.
 */
test.describe('reopening a submission', () => {
  test('City Planning is offered it, and must say why', async ({ page }) => {
    await signIn(page)
    await openFirstAip(page)

    // Nothing to hand back if the office still has it: the local stack's first
    // AIP is whatever the last run left behind, and a draft is a legitimate
    // state for it to be in.
    const draft = await page.getByText('Draft', { exact: true }).count()
    test.skip(draft > 0, 'The first AIP is a draft — there is nothing to reopen')

    const reopen = page.getByRole('button', { name: 'Reopen' })
    await expect(reopen).toBeVisible()
    await reopen.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Reopen this submission?')).toBeVisible()

    // A reason is required by the RPC and kept in the audit log, so the dialog
    // refuses an empty one rather than letting the database do it.
    await dialog.getByRole('button', { name: 'Reopen submission' }).click()
    await expect(dialog.getByText('Say why this submission is going back.')).toBeVisible()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the department is not offered it on its own AIP', async ({ page }) => {
    await signIn(page, DEPARTMENT_EMAIL)
    await openFirstAip(page)
    await expect(page.getByRole('button', { name: 'Reopen' })).toHaveCount(0)
  })
})
