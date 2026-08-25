'use client'

import { createBrowserClient } from '@supabase/ssr'
import { TRACKS_COOKIE_PREFIX, TRACKS_SCHEMA, TRACKS_STORAGE_KEY } from './config'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: TRACKS_SCHEMA },
      auth: { storageKey: TRACKS_STORAGE_KEY },
      cookieOptions: { name: TRACKS_COOKIE_PREFIX },
    },
  )
}
