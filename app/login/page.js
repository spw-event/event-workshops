'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'

// Writes the same keys app/staff/page.js and app/admin/page.js read on
// mount — so a login here is indistinguishable from a login on either of
// those pages' own fallback forms.
function persistStaffAuth(record, role) {
  localStorage.setItem('spw_staff_record', JSON.stringify(record))
  localStorage.setItem('spw_staff_role', role)
}

export default function LoginPage() {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function checkLogin() {
    const trimmed = input.trim()
    if (!trimmed) return
    setLoading(true)
    setError('')

    // Staff table first, matched by email (case-insensitive) — covers Snow
    // Peak staff, admins, super admins, and staff-table vendors.
    const { data: staffRows, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .ilike('email', trimmed)
      .eq('is_active', true)
      .limit(1)
    console.log('[login] staff table query — data:', staffRows, 'error:', staffError)
    const staffData = staffRows?.[0]

    if (staffData) {
      const role = staffData.is_super_admin ? 'super_admin' : staffData.is_admin ? 'admin' : staffData.is_vendor ? 'vendor' : 'staff'
      persistStaffAuth(staffData, role)
      window.location.href = (role === 'super_admin' || role === 'admin') ? '/admin' : '/staff'
      return
    }

    // Not found by email — fall back to instructor_pins, treating the input
    // as a PIN. Preserves backwards compatibility for existing instructor
    // records (e.g. Thaan) that were never migrated to the staff table.
    const { data: instrRows, error: instrError } = await supabase
      .from('instructor_pins')
      .select('*, workshops(*)')
      .eq('pin', trimmed)
      .limit(1)
    console.log('[login] instructor_pins query — data:', instrRows, 'error:', instrError)
    const instrData = instrRows?.[0]

    if (instrData) {
      persistStaffAuth(instrData, 'vendor')
      window.location.href = '/staff'
      return
    }

    setError("We couldn't find that email or access code. Contact your event coordinator for access.")
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#FAFAF8', padding: 24, fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 24px' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#8C8C8C', marginBottom: 8, textTransform: 'uppercase' }}>Snow Peak Way</div>
        <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 28 }}>Staff &amp; Admin Access</div>
        <form onSubmit={e => { e.preventDefault(); !loading && checkLogin() }}>
          <input
            type="text"
            placeholder="Email or access code"
            value={input}
            onChange={e => { setInput(e.target.value); setError('') }}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', padding: 12,
              borderRadius: 8, border: '0.5px solid #E8E4DE', background: '#fff',
              fontSize: 15, color: '#1a1a1a', marginBottom: 16, fontFamily: 'inherit'
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'left', marginBottom: 16, lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !input.trim()}
            style={{
              width: '100%', padding: 12, borderRadius: 8, border: 'none',
              background: '#1a1a1a', color: '#fff', fontSize: 15, fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading || !input.trim() ? 0.6 : 1
            }}
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
