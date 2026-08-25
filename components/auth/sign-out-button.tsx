'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

export function SignOutButton({ variant = 'outline' }: {
  variant?: 'outline' | 'ghost' | 'secondary'
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant={variant}
      disabled={pending}
      onClick={async () => {
        setPending(true)
        await createClient().auth.signOut()
        router.push('/login')
        router.refresh()
      }}
    >
      <LogOut className="size-4" />
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
