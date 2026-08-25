/** The shape every server action returns. A failed action never throws into the
 *  client; it comes back as a message the form can show. */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof Error) return { ok: false, error: error.message }
  if (typeof error === 'string') return { ok: false, error }
  return { ok: false, error: 'Something went wrong. Please try again.' }
}
