import { json } from '@/lib/adminApi'
import { DEFAULT_PASSWORD, findAuthUserByEmail, requireSignedIn } from '@/lib/staffAdmin'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/staff/reset-password  { staff_id }
// Signed-in admins only. Creates the staff member's sign-in if they don't
// have one yet, or resets it, to the default password, flagged so they must
// choose a new one before it grants any access. Only super admins can reset
// a super admin.
export async function POST(request) {
  try {
    const caller = await requireSignedIn(request)
    if (caller.error) return caller.error
    const { staff: me, user: meUser } = caller
    if (!me || !(me.is_admin || me.is_super_admin) || meUser.app_metadata?.must_change_password) {
      return json({ error: 'Only admins can reset passwords.' }, 403)
    }

    let body
    try { body = await request.json() } catch { body = null }
    const staffId = body?.staff_id
    if (typeof staffId !== 'string' || !staffId) return json({ error: '`staff_id` is required.' }, 400)

    const db = getSupabaseAdmin()
    const { data: target, error: targetError } = await db.from('staff')
      .select('id, name, email, is_active, is_admin, is_super_admin, is_checkin')
      .eq('id', staffId)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target) return json({ error: 'Staff member not found.' }, 404)
    if (!target.is_active) return json({ error: `${target.name} is inactive. Activate them first.` }, 400)
    if (!target.email) return json({ error: `${target.name} has no email address. Add one first.` }, 400)
    if (!(target.is_admin || target.is_super_admin || target.is_checkin)) {
      return json({ error: `${target.name} signs in with just their email; there's no password to reset.` }, 400)
    }
    if (target.is_super_admin && !me.is_super_admin) {
      return json({ error: 'Only a super admin can reset a super admin.' }, 403)
    }

    const existing = await findAuthUserByEmail(target.email)
    if (existing) {
      const { error } = await db.auth.admin.updateUserById(existing.id, {
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        app_metadata: { ...existing.app_metadata, must_change_password: true }
      })
      if (error) throw error
    } else {
      const { error } = await db.auth.admin.createUser({
        email: target.email.trim().toLowerCase(),
        password: DEFAULT_PASSWORD,
        email_confirm: true,
        app_metadata: { must_change_password: true }
      })
      if (error) throw error
    }

    return json({ ok: true, created: !existing, name: target.name, email: target.email })
  } catch (err) {
    return json({ error: err.message || 'Could not reset the password.' }, 500)
  }
}
