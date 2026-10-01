'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { changeOwnPassword, clearStoredStaff, getSignedInStaff, isAdminRecord } from '../../../lib/staffAuth'

// Choose a new password. Reached after signing in with the default password
// an admin reset you to (the account has no staff access until this is done),
// or directly by any signed-in staff member who wants to change theirs.

const MIN_LENGTH = 8
const DEFAULT_PASSWORD = 'spw1958'

export default function SetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [mustChange, setMustChange] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setMustChange(!!session.user?.app_metadata?.must_change_password)
      setReady(true)
    })
  }, [])

  async function save() {
    if (password.length < MIN_LENGTH) { setError(`Use at least ${MIN_LENGTH} characters.`); return }
    if (password.trim().toLowerCase() === DEFAULT_PASSWORD) { setError('Choose something other than the default password.'); return }
    if (password !== confirm) { setError("Those passwords don't match."); return }
    setSaving(true)
    setError('')
    const { error: changeError } = await changeOwnPassword(password)
    if (changeError) {
      setError(changeError.message)
      setSaving(false)
      return
    }
    const record = await getSignedInStaff().catch(() => null)
    if (!record) {
      await supabase.auth.signOut()
      setError("Password saved, but this sign-in isn't linked to an active staff record. Contact your event coordinator.")
      setSaving(false)
      return
    }
    clearStoredStaff()
    window.location.href = isAdminRecord(record) ? '/admin' : '/staff'
  }

  async function cancel() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: 12,
    borderRadius: 8, border: '0.5px solid #E8E4DE', background: '#fff',
    fontSize: 15, color: '#1a1a1a', marginBottom: 16, fontFamily: 'inherit'
  }
  const canSubmit = !!password && !!confirm && !saving

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#FAFAF8', padding: 24, fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 24px' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#8C8C8C', marginBottom: 8, textTransform: 'uppercase' }}>Snow Peak Way</div>
        {ready && (
          <>
            <div style={{ fontSize: 15, color: '#1a1a1a', marginBottom: 6 }}>Choose a new password</div>
            <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 28, lineHeight: 1.5 }}>
              {mustChange
                ? 'Your password was reset. Pick a new one to continue.'
                : `At least ${MIN_LENGTH} characters.`}
            </div>
            <form onSubmit={e => { e.preventDefault(); if (canSubmit) save() }}>
              <input
                type="password"
                placeholder="New password"
                autoComplete="new-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                autoFocus
                style={inputStyle}
              />
              <input
                type="password"
                placeholder="Confirm password"
                autoComplete="new-password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError('') }}
                style={inputStyle}
              />
              {error && (
                <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'left', marginBottom: 16, lineHeight: 1.5 }}>{error}</div>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  width: '100%', padding: 12, borderRadius: 8, border: 'none',
                  background: '#1a1a1a', color: '#fff', fontSize: 15, fontWeight: 500,
                  cursor: canSubmit ? 'pointer' : 'default',
                  opacity: canSubmit ? 1 : 0.6
                }}
              >
                {saving ? 'Saving…' : 'Save password'}
              </button>
            </form>
            <button
              type="button"
              onClick={cancel}
              style={{ marginTop: 16, background: 'none', border: 'none', padding: 0, fontSize: 13, color: '#8C8C8C', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Cancel and sign out
            </button>
          </>
        )}
      </div>
    </div>
  )
}
