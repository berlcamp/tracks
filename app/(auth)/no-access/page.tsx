import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'No access · TRACKS' }

export default async function NoAccessPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex size-11 items-center justify-center rounded-lg bg-amber-500/10">
        <ShieldAlert className="size-5 text-amber-600" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">No access yet</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {user?.email ? (
            <>
              <span className="font-medium text-foreground">{user.email}</span> signed in
              successfully, but it has not been invited to TRACKS.
            </>
          ) : (
            'This account has not been invited to TRACKS.'
          )}
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          Ask the City Planning Office to invite this exact address, then sign in again.
          If you have more than one Google account, check you used the right one.
        </p>
      </div>
      <SignOutButton />
    </div>
  )
}
