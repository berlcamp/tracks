import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { TRACKS_COOKIE_PREFIX, TRACKS_SCHEMA, TRACKS_STORAGE_KEY } from '@/lib/supabase/config'

const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/error', '/no-access']

/** The marketing landing page. Kept out of PUBLIC_PATHS because the prefix test
 *  below would read "/" as a prefix of every route and open the whole app. */
const LANDING_PATH = '/'

/**
 * The access gate.
 *
 * Supabase WILL mint a session for any Google account that clicks through — on
 * a shared project there is no per-app way to prevent that. What this guarantees
 * instead is that an account with no `tracks.profiles` row reaches nothing: it is
 * bounced to /no-access, and RLS returns zero rows besides.
 *
 * Do not "fix" the OAuth exchange with a Supabase auth hook: hooks are
 * project-wide and would break the other apps on this project.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: TRACKS_SCHEMA },
      auth: { storageKey: TRACKS_STORAGE_KEY },
      cookieOptions: { name: TRACKS_COOKIE_PREFIX },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options))
        },
      },
    },
  )

  // Refreshes the session cookie as a side effect. Must run before any redirect.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic =
    pathname === LANDING_PATH ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user) {
    if (isPublic) return response
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  const { data: profile } = await supabase
    .from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle()

  if (!profile) {
    // Lazy provisioning: claim an invitation for this email. This is also how
    // the bootstrap planning admin gets bound on first sign-in, and how an
    // invitee who already existed in auth.users — because they use another app
    // on this shared project — gets in. An AFTER INSERT trigger on auth.users
    // structurally cannot handle that case, and would put every other app's
    // signup at risk besides.
    await supabase.rpc('claim_invite')

    const { data: claimed } = await supabase
      .from('profiles').select('id').eq('auth_user_id', user.id).maybeSingle()

    if (!claimed) {
      if (pathname === '/no-access') return response
      const url = request.nextUrl.clone()
      url.pathname = '/no-access'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  if (pathname === '/login' || pathname === '/no-access' || pathname === LANDING_PATH) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
