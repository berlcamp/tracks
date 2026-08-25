import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * The OAuth landing point. Exchanges the code for a session, then asks the
 * database to claim an invitation for this address.
 *
 * An account with no invitation lands on /no-access with no profile, no role and
 * no rows — which is the system working, not a bug.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Missing%20authorization%20code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  // Lazy provisioning. Safe to call on every sign-in: it is idempotent and
  // refreshes the display name and avatar from Google.
  await supabase.rpc('claim_invite')

  return NextResponse.redirect(`${origin}${next}`)
}
