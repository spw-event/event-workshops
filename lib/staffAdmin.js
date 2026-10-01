import 'server-only'
import { json } from './adminApi'
import { getSupabaseAdmin } from './supabaseAdmin'

// Server side of staff sign-in management (app/api/staff/*). No email is
// involved: an admin resets someone to DEFAULT_PASSWORD, and the account is
// flagged (app_metadata.must_change_password) until its owner picks a new
// one. The database treats a flagged account as having no staff access at
// all (see current_staff_id()), so the shared default only ever lets someone
// reach the "choose a new password" screen.

export const DEFAULT_PASSWORD = 'spw1958'
export const MIN_PASSWORD_LENGTH = 8

// Who is calling: their Supabase Auth user (from the bearer access token)
// and the active staff row with the same email. Returns { user, staff } or
// { error: Response }.
export async function requireSignedIn(request) {
  const header = request.headers.get('authorization') || ''
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (!token) return { error: json({ error: 'Not signed in.' }, 401) }
  const db = getSupabaseAdmin()
  const { data, error } = await db.auth.getUser(token)
  if (error || !data?.user) return { error: json({ error: 'Not signed in.' }, 401) }
  const user = data.user
  const { data: rows, error: staffError } = await db.from('staff')
    .select('id, name, email, is_active, is_admin, is_super_admin, is_checkin')
    .ilike('email', user.email)
    .eq('is_active', true)
    .order('id')
  if (staffError) throw staffError
  // ilike treats _ and % as wildcards; keep only the exact (case-insensitive) match.
  const staff = (rows || []).find(s => s.email?.trim().toLowerCase() === user.email.toLowerCase()) || null
  return { user, staff }
}

export async function findAuthUserByEmail(email) {
  const db = getSupabaseAdmin()
  const target = email.trim().toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === target)
    if (match) return match
    if (data.users.length < 1000) return null
  }
}
