import { supabase } from './supabase'

// Staff sign-in, shared by /login, /staff and /admin.
//
// Admins, super admins and check-in staff sign in with a Supabase Auth
// email + password. Admins create/reset those sign-ins from the admin page
// (Staff & Vendors → Reset password); there are no password emails.
// Row-level security keys off that session, so it's what actually gates
// admin writes and guest data. Everyone else on the staff table still signs
// in with just their email: staff_login() returns their record, which is
// kept in localStorage and only unlocks data that is public anyway (plus
// the rosters for their own assigned sessions).

const RECORD_KEY = 'spw_staff_record'
const ROLE_KEY = 'spw_staff_role'
const EVENT_KEY = 'spw_staff_event_id'

export const isAdminRecord = record => !!(record?.is_admin || record?.is_super_admin)

// These roles see guest data, so they need a real session, not just an email.
export const needsPassword = record => isAdminRecord(record) || !!record?.is_checkin

export function staffRoleOf(record) {
  if (record.is_super_admin) return 'super_admin'
  if (record.is_admin) return 'admin'
  return record.is_vendor ? 'vendor' : 'staff'
}

// Active staff record for an email, without its PIN, or null.
export async function lookupStaff(email) {
  const { data, error } = await supabase.rpc('staff_login', { p_email: email.trim() })
  if (error) throw error
  return data
}

// The staff record linked to the current Supabase Auth session (matched by
// confirmed email in the database), or null when signed out or unlinked.
export async function getSignedInStaff() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return null
  const { data, error } = await supabase.rpc('my_staff')
  if (error) throw error
  return data
}

// After an admin reset (to the default password) the account is flagged
// until its owner chooses a new password; until then the database grants it
// no staff access, so it can only be used on /login/set-password.
export async function mustChangePassword() {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session?.user?.app_metadata?.must_change_password
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { error }
  if (data.user?.app_metadata?.must_change_password) return { mustChange: true }
  const record = await getSignedInStaff()
  if (!record) {
    await supabase.auth.signOut()
    return { error: { message: "This sign-in isn't linked to an active staff record. Contact your event coordinator." } }
  }
  clearStoredStaff()
  return { record }
}

// Sets the signed-in user's own password (and clears the must-change flag)
// via the server. Changing the password ends the existing session, so sign
// straight back in with the new one.
export async function changeOwnPassword(password) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: { message: 'Your session has expired. Sign in again.' } }
  const res = await fetch('/api/staff/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ password })
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: { message: body.error || 'Could not change the password.' } }
  const { error } = await supabase.auth.signInWithPassword({ email: session.user.email, password })
  if (error) return { error: { message: 'Password saved. Please sign in again with your new password.' } }
  return {}
}

// Admin action: reset a staff member's sign-in to the default password
// (creating it if they don't have one yet).
export async function resetStaffPassword(staffId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Your session has expired. Sign in again.' }
  const res = await fetch('/api/staff/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ staff_id: staffId })
  })
  const body = await res.json().catch(() => ({}))
  return res.ok ? body : { error: body.error || 'Could not reset the password.' }
}

export function storeEmailOnlyStaff(record) {
  localStorage.setItem(RECORD_KEY, JSON.stringify(record))
  localStorage.setItem(ROLE_KEY, staffRoleOf(record))
}

export function readStoredStaff() {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) || 'null')
  } catch {
    return null
  }
}

export function clearStoredStaff() {
  // Guest keys (spw_guest_token etc.) are intentionally untouched.
  localStorage.removeItem(RECORD_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(EVENT_KEY)
}

export async function signOutStaff() {
  clearStoredStaff()
  await supabase.auth.signOut()
  window.location.href = '/login'
}
