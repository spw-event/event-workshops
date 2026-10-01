import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client: bypasses RLS. Server-only — the `server-only` import
// above makes the build fail if this is ever pulled into a client component.
// Created lazily so a missing key surfaces as a request error, not a crash at
// module load during build.
let client = null

export function getSupabaseAdmin() {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase admin client is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  }
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return client
}
