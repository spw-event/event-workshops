'use client'

import { useEffect, useState } from 'react'
import { isAdminRecord, lookupStaff, mustChangePassword, needsPassword, signInWithPassword, storeEmailOnlyStaff } from '../../lib/staffAuth'

// Single sign-in entry for /staff and /admin (both redirect here when signed
// out). Email first; admins and check-in staff then need their password. A
// forgotten password is reset by an admin (to the default), after which the
// owner is sent to /login/set-password to choose a new one.
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [step, setStep] = useState('email') // 'email' | 'password'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Signed in on a reset password but left before choosing a new one.
  useEffect(() => {
    mustChangePassword().then(must => { if (must) window.location.href = '/login/set-password' }).catch(() => {})
  }, [])

  async function submitEmail() {
    const trimmed = email.trim()
    if (!trimmed) return
    setLoading(true)
    setError('')
    try {
      const record = await lookupStaff(trimmed)
      if (!record) {
        setError("We couldn't find that email. Contact your event coordinator for access.")
      } else if (needsPassword(record)) {
        setStep('password')
      } else {
        storeEmailOnlyStaff(record)
        window.location.href = '/staff'
        return
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  async function submitPassword() {
    if (!password) return
    setLoading(true)
    setError('')
    const { record, mustChange, error: signInError } = await signInWithPassword(email, password)
    if (signInError) {
      setError(signInError.message === 'Invalid login credentials' ? 'Incorrect email or password.' : signInError.message)
      setLoading(false)
      return
    }
    if (mustChange) { window.location.href = '/login/set-password'; return }
    window.location.href = isAdminRecord(record) ? '/admin' : '/staff'
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: 12,
    borderRadius: 8, border: '0.5px solid #E8E4DE', background: '#fff',
    fontSize: 15, color: '#1a1a1a', marginBottom: 16, fontFamily: 'inherit'
  }
  const canSubmit = step === 'email' ? !!email.trim() : !!password

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#FAFAF8', padding: 24, fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 24px' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.08em', color: '#8C8C8C', marginBottom: 8, textTransform: 'uppercase' }}>Snow Peak Way</div>
        <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 28 }}>Staff &amp; Admin Access</div>
        <form onSubmit={e => { e.preventDefault(); if (!loading) (step === 'email' ? submitEmail() : submitPassword()) }}>
          <input
            type="email"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); setStep('email'); setPassword('') }}
            autoFocus
            style={inputStyle}
          />
          {step === 'password' && (
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              autoFocus
              style={inputStyle}
            />
          )}
          {error && (
            <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'left', marginBottom: 16, lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !canSubmit}
            style={{
              width: '100%', padding: 12, borderRadius: 8, border: 'none',
              background: '#1a1a1a', color: '#fff', fontSize: 15, fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading || !canSubmit ? 0.6 : 1
            }}
          >
            {loading ? 'Checking…' : step === 'email' ? 'Continue' : 'Sign In'}
          </button>
        </form>
        {step === 'password' && (
          <div style={{ marginTop: 16, fontSize: 12, color: '#8C8C8C', lineHeight: 1.5 }}>
            Forgot your password? Ask an admin to reset it.
          </div>
        )}
      </div>
    </div>
  )
}
