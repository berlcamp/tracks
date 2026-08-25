import type { Metadata } from 'next'
import { LoginForm } from '@/components/auth/login-form'
import { devLoginEnabled } from '@/lib/dev-login'

export const metadata: Metadata = { title: 'Sign in · TRACKS' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to TRACKS</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Use the Google account the City Planning Office invited. Any other account
          will be able to sign in but will see nothing.
        </p>
      </div>
      <LoginForm
        next={params.next ?? '/dashboard'}
        error={params.error ?? null}
        showDevLogin={devLoginEnabled()}
      />
    </div>
  )
}
