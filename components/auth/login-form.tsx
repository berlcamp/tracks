'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/browser'
import { DEV_ACCOUNTS, DEV_LOGIN_EMAIL, DEV_LOGIN_PASSWORD } from '@/lib/dev-login'

export function LoginForm({
  next, error, showDevLogin,
}: {
  next: string
  error: string | null
  showDevLogin: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'google' | 'password' | null>(null)
  const [email, setEmail] = useState(DEV_LOGIN_EMAIL)
  const [password, setPassword] = useState(DEV_LOGIN_PASSWORD)

  async function signInWithGoogle() {
    setPending('google')
    const supabase = createClient()
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // `select_account`, not `consent`: nothing here touches a Google API, so
        // there is no refresh token worth re-consenting for — but staff with a
        // personal and a City account need the picker, or they sign in as the
        // wrong one and land on /no-access with no idea why.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthError) {
      setPending(null)
      toast.error(oauthError.message)
    }
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault()
    setPending('password')
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setPending(null)
    if (signInError) {
      toast.error(signInError.message)
      return
    }
    router.push(next as never)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button onClick={signInWithGoogle} disabled={pending !== null} size="lg" className="w-full">
        <GoogleMark />
        {pending === 'google' ? 'Redirecting…' : 'Continue with Google'}
      </Button>

      {showDevLogin ? (
        <>
          <div className="relative">
            <Separator />
            <span className="absolute inset-0 -top-2.5 mx-auto w-fit bg-background px-2 text-xs text-muted-foreground">
              Local development
            </span>
          </div>
          {/* Role switcher. Clicking fills the form rather than signing in
              directly, so it is obvious which account is about to be used. */}
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">
              Sign in as — accounts come from <code>npm run db:users</code>
            </p>
            <div className="grid gap-1">
              {DEV_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setEmail(account.email)
                    setPassword(DEV_LOGIN_PASSWORD)
                  }}
                  className={cn(
                    'flex items-baseline justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                    email === account.email
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <span className="font-medium">{account.role}</span>
                  <span className="text-muted-foreground">{account.scope}</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={signInWithPassword} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} autoComplete="username"
                     onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" disabled={pending !== null}>
              {pending === 'password' ? 'Signing in…' : 'Sign in locally'}
            </Button>
            <p className="text-xs text-muted-foreground">
              This panel appears only against a local Supabase. Production has no passwords.
            </p>
          </form>
        </>
      ) : null}
    </div>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  )
}
