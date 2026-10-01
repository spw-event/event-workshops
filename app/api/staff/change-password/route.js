import { json } from '@/lib/adminApi'
import { DEFAULT_PASSWORD, MIN_PASSWORD_LENGTH, requireSignedIn } from '@/lib/staffAdmin'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/staff/change-password  { password }
// The signed-in user sets their own password. Done server-side because the
// "must change password" flag lives in app_metadata, which only the service
// role can clear — setting the password and clearing the flag happen together.
export async function POST(request) {
  try {
    const caller = await requireSignedIn(request)
    if (caller.error) return caller.error

    let body
    try { body = await request.json() } catch { body = null }
    const password = body?.password
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400)
    }
    if (password.trim().toLowerCase() === DEFAULT_PASSWORD) {
      return json({ error: 'Choose something other than the default password.' }, 400)
    }

    const { user } = caller
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
      password,
      app_metadata: { ...user.app_metadata, must_change_password: false }
    })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  } catch (err) {
    return json({ error: err.message || 'Could not change the password.' }, 500)
  }
}
