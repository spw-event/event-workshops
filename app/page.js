'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [guest, setGuest] = useState(null)
  const [workshops, setWorkshops] = useState([])
  const [sessions, setSessions] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [partyCreditsUsed, setPartyCreditsUsed] = useState(0)
  const [partyCreditsTotal, setPartyCreditsTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('schedule')
  const [registering, setRegistering] = useState(null)
  const [message, setMessage] = useState(null)
  const [partySelectorSession, setPartySelectorSession] = useState(null)
  const [selectedPartySize, setSelectedPartySize] = useState(1)
  const [sessionAvailability, setSessionAvailability] = useState({})

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (!token) {
      setError('No invite token found. Please use the link from your invitation email.')
      setLoading(false)
      return
    }
    loadData(token)
  }, [])

  async function loadData(token) {
    setLoading(true)

    const { data: guestData, error: guestError } = await supabase
      .from('guests')
      .select('*, ticket_types(*)')
      .eq('token', token)
      .single()

    if (guestError || !guestData) {
      setError('Invalid invite token. Please check your invitation email.')
      setLoading(false)
      return
    }
    setGuest(guestData)

    const { data: creditsUsed } = await supabase
      .rpc('get_party_credits_used', { p_guest_id: guestData.id })
    const { data: creditsTotal } = await supabase
      .rpc('get_party_credits_total', { p_guest_id: guestData.id })
    setPartyCreditsUsed(creditsUsed || 0)
    setPartyCreditsTotal(creditsTotal || 0)

    const { data: eventData } = await supabase
      .from('events')
      .select('*')
      .eq('status', 'upcoming')
      .order('start_date', { ascending: true })
      .limit(1)
      .single()

    if (eventData) {
      const { data: workshopData } = await supabase
        .from('workshops')
        .select('*')
      setWorkshops(workshopData || [])

      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*, workshops(*)')
        .eq('event_id', eventData.id)
        .order('start_time', { ascending: true })
      setSessions(sessionData || [])

      const { data: regData } = await supabase
        .from('registrations')
        .select('*, sessions(*, workshops(*))')
        .eq('guest_id', guestData.id)
        .neq('status', 'cancelled')
      setRegistrations(regData || [])

      // Load availability for all sessions
      if (sessionData) {
        const availMap = {}
        for (const s of sessionData) {
          const { data: avail } = await supabase
            .rpc('get_session_availability', { p_session_id: s.id })
          availMap[s.id] = avail || 0
        }
        setSessionAvailability(availMap)
      }
    }

    setLoading(false)
  }

  async function refreshAll(guestId) {
    const { data: freshGuest } = await supabase
      .from('guests')
      .select('*, ticket_types(*)')
      .eq('id', guestId)
      .single()
    if (freshGuest) setGuest(freshGuest)

    const { data: creditsUsed } = await supabase
      .rpc('get_party_credits_used', { p_guest_id: guestId })
    setPartyCreditsUsed(creditsUsed || 0)

    const { data: creditsTotal } = await supabase
      .rpc('get_party_credits_total', { p_guest_id: guestId })
    setPartyCreditsTotal(creditsTotal || 0)

    const { data: regData } = await supabase
      .from('registrations')
      .select('*, sessions(*, workshops(*))')
      .eq('guest_id', guestId)
      .neq('status', 'cancelled')
    setRegistrations(regData || [])

    // Refresh availability
    const availMap = {}
    for (const s of sessions) {
      const { data: avail } = await supabase
        .rpc('get_session_availability', { p_session_id: s.id })
      availMap[s.id] = avail || 0
    }
    setSessionAvailability(availMap)
  }

  function openPartySelector(session) {
    setPartySelectorSession(session)
    setSelectedPartySize(1)
    setMessage(null)
  }

  function closePartySelector() {
    setPartySelectorSession(null)
    setSelectedPartySize(1)
  }

  async function confirmRegister() {
    if (!guest || !partySelectorSession) return
    const session = partySelectorSession
    const partySize = selectedPartySize
    closePartySelector()
    setRegistering(session.id)
    setMessage(null)

    const creditsRemaining = partyCreditsTotal - partyCreditsUsed
    if (partySize > creditsRemaining) {
      setMessage({ type: 'error', text: 'Not enough credits for that many people.' })
      setRegistering(null)
      return
    }

    const avail = sessionAvailability[session.id] || 0

    if (avail < partySize) {
      // Add to waitlist
      const { error: wlError } = await supabase
        .from('registrations')
        .insert({ guest_id: guest.id, session_id: session.id, status: 'waitlisted', party_size: partySize })
      if (!wlError) {
        setMessage({ type: 'warning', text: "Not enough spots for your group — added to waitlist." })
        await refreshAll(guest.id)
      }
    } else {
      const { error: regError } = await supabase
        .from('registrations')
        .insert({ guest_id: guest.id, session_id: session.id, status: 'confirmed', party_size: partySize })
      if (!regError) {
        await supabase
          .from('guests')
          .update({ credits_used: (guest.credits_used || 0) + partySize })
          .eq('id', guest.id)
        setMessage({ type: 'success', text: 'Registered ' + partySize + ' person' + (partySize > 1 ? 's' : '') + ' successfully!' })
        await refreshAll(guest.id)
      } else {
        setMessage({ type: 'error', text: 'Could not register. Please try again.' })
      }
    }
    setRegistering(null)
  }

  async function cancel(registrationId, sessionId, partySize) {
    setMessage(null)

    const { error: delError } = await supabase
      .from('registrations')
      .delete()
      .eq('id', registrationId)

    if (delError) {
      setMessage({ type: 'error', text: 'Could not cancel. Please try again.' })
      return
    }

    const creditRefund = partySize || 1
    const newCredits = Math.max(0, (guest.credits_used || 0) - creditRefund)
    await supabase
      .from('guests')
      .update({ credits_used: newCredits })
      .eq('id', guest.id)

    // Promote waitlisted guest if space opens
    const { data: waitlisted } = await supabase
      .from('registrations')
      .select('*')
      .eq('session_id', sessionId)
      .eq('status', 'waitlisted')
      .order('registered_at', { ascending: true })
      .limit(1)

    if (waitlisted && waitlisted.length > 0) {
      const newAvail = (sessionAvailability[sessionId] || 0) + creditRefund
      if (newAvail >= (waitlisted[0].party_size || 1)) {
        await supabase
          .from('registrations')
          .update({ status: 'confirmed' })
          .eq('id', waitlisted[0].id)
      }
    }

    setMessage({ type: 'success', text: 'Registration cancelled. ' + creditRefund + ' credit' + (creditRefund > 1 ? 's' : '') + ' returned to your party.' })
    await refreshAll(guest.id)
  }

  function generateICS(session) {
    if (!session) return
    const date = session.date
    const start = session.start_time
    const end = session.end_time
    const name = session.workshops?.name || 'Workshop'

    const formatDT = (d, t) => {
      const dt = new Date(d + 'T' + t)
      return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    }

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'DTSTART:' + formatDT(date, start),
      'DTEND:' + formatDT(date, end),
      'SUMMARY:' + name + ' - Snow Peak Way WA',
      'DESCRIPTION:Snow Peak Way WA Workshop',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\n')

    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name.replace(/\s+/g, '-') + '.ics'
    a.click()
  }

  function isRegistered(sessionId) {
    return registrations.some(r => r.session_id === sessionId && r.status === 'confirmed')
  }

  function isWaitlisted(sessionId) {
    return registrations.some(r => r.session_id === sessionId && r.status === 'waitlisted')
  }

  function getRegistration(sessionId) {
    return registrations.find(r => r.session_id === sessionId)
  }

  function formatTime(t) {
    if (!t) return ''
    const parts = t.split(':')
    const hour = parseInt(parts[0])
    const min = parts[1]
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const h12 = hour % 12 || 12
    return h12 + ':' + min + ' ' + ampm
  }

  function formatDate(d) {
    if (!d) return ''
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

  const sessionsByWorkshop = workshops.map(w => ({
    ...w,
    sessions: sessions.filter(s => s.workshop_id === w.id)
  })).filter(w => w.sessions.length > 0)

  const creditsRemaining = partyCreditsTotal - partyCreditsUsed
  const confirmedRegs = registrations.filter(r => r.status === 'confirmed')

  // Max party size for selector — min of credits remaining, party cap, and session availability
  function getMaxPartySize(sessionId) {
    const avail = sessionAvailability[sessionId] || 0
    const partyCap = guest?.ticket_types?.party_cap || 1
    return Math.min(creditsRemaining, partyCap, avail)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#666' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
        <div>Loading your Snow Peak experience...</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Access Required</div>
        <div style={{ color: '#666', lineHeight: 1.6 }}>{error}</div>
      </div>
    </div>
  )

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 680, margin: '0 auto', padding: '24px 16px', color: '#1a1a1a' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
          Snow Peak Way WA · Sept 18–20
        </div>
        <div style={{ fontSize: 22, fontWeight: 500 }}>
          Welcome, {guest?.name?.split(' ')[0]}
        </div>
        {guest?.ticket_types && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
            {guest.ticket_types.name} · {creditsRemaining} of {partyCreditsTotal} party credits remaining
          </div>
        )}
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: message.type === 'success' ? '#f0faf4' : message.type === 'error' ? '#fff0f0' : '#fffbea',
          color: message.type === 'success' ? '#1a7a4a' : message.type === 'error' ? '#c0392b' : '#8a6000',
          border: '0.5px solid ' + (message.type === 'success' ? '#a3d9b8' : message.type === 'error' ? '#f5c0c0' : '#f5d88a')
        }}>
          {message.text}
        </div>
      )}

      {/* Party Size Selector Modal */}
      {partySelectorSession && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '24px',
            maxWidth: 360, width: '100%', boxSizing: 'border-box'
          }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
              {partySelectorSession.workshops?.name}
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
              {formatTime(partySelectorSession.start_time)} – {formatTime(partySelectorSession.end_time)}
            </div>
            <div style={{ fontSize: 14, marginBottom: 12 }}>How many people are you registering?</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {Array.from({ length: getMaxPartySize(partySelectorSession.id) }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setSelectedPartySize(n)}
                  style={{
                    width: 44, height: 44, borderRadius: 8, border: '0.5px solid',
                    borderColor: selectedPartySize === n ? '#1a1a1a' : '#e0e0e0',
                    background: selectedPartySize === n ? '#1a1a1a' : '#fff',
                    color: selectedPartySize === n ? '#fff' : '#1a1a1a',
                    fontSize: 15, fontWeight: 500, cursor: 'pointer'
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>
              {selectedPartySize} credit{selectedPartySize > 1 ? 's' : ''} will be used · {creditsRemaining - selectedPartySize} remaining after
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closePartySelector} style={{
                flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid #e0e0e0',
                background: '#fff', cursor: 'pointer', fontSize: 14
              }}>
                Cancel
              </button>
              <button onClick={confirmRegister} style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none',
                background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500
              }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e0e0e0', marginBottom: 24 }}>
        {['schedule', 'agenda'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 14, color: activeTab === tab ? '#1a1a1a' : '#888',
            borderBottom: activeTab === tab ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -1, fontWeight: activeTab === tab ? 500 : 400
          }}>
            {tab === 'schedule' ? 'Workshops' : 'My Agenda'}
          </button>
        ))}
      </div>

      {/* Schedule Tab */}
      {activeTab === 'schedule' && (
        <div>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>
            {formatDate('2026-09-19')} · {creditsRemaining} credit{creditsRemaining !== 1 ? 's' : ''} remaining for your party
          </div>
          {sessionsByWorkshop.map(workshop => (
            <div key={workshop.id} style={{
              background: '#fff', border: '0.5px solid #e8e8e8',
              borderRadius: 12, padding: '16px 20px', marginBottom: 12
            }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{workshop.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                  {workshop.category}{workshop.instructor ? ' · ' + workshop.instructor : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {workshop.sessions.map(session => {
                  const registered = isRegistered(session.id)
                  const waitlisted = isWaitlisted(session.id)
                  const reg = getRegistration(session.id)
                  const avail = sessionAvailability[session.id] ?? session.capacity
                  const spotsLeft = avail
                  return (
                    <div key={session.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: registered ? '#f0faf4' : waitlisted ? '#fffbea' : '#f9f9f9',
                      borderRadius: 8, gap: 8, flexWrap: 'wrap'
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {formatTime(session.start_time)} – {formatTime(session.end_time)}
                        </div>
                        <div style={{ fontSize: 11, color: spotsLeft <= 5 && !registered && !waitlisted ? '#c0392b' : '#aaa', marginTop: 2 }}>
                          {registered ? 'You are registered' + (reg?.party_size > 1 ? ' (' + reg.party_size + ' people)' : '') :
                           waitlisted ? 'You are waitlisted' :
                           spotsLeft === 0 ? 'Full — join waitlist' :
                           spotsLeft <= 5 ? spotsLeft + ' spots left' :
                           spotsLeft + ' spots available'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {registered && (
                          <>
                            <button onClick={() => generateICS(session)} style={{
                              fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                              border: '0.5px solid #d0d0d0', borderRadius: 6, background: '#fff'
                            }}>+ Calendar</button>
                            <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{
                              fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                              border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b'
                            }}>Cancel</button>
                          </>
                        )}
                        {waitlisted && (
                          <>
                            <span style={{ fontSize: 11, color: '#8a6000', background: '#fff3cd', padding: '2px 8px', borderRadius: 6 }}>Waitlisted</span>
                            <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{
                              fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                              border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b'
                            }}>Remove</button>
                          </>
                        )}
                        {!registered && !waitlisted && (
                          <button
                            onClick={() => creditsRemaining > 0 && openPartySelector(session)}
                            disabled={registering === session.id || creditsRemaining <= 0}
                            style={{
                              fontSize: 12, padding: '5px 14px',
                              cursor: creditsRemaining > 0 ? 'pointer' : 'not-allowed',
                              border: '0.5px solid ' + (creditsRemaining > 0 ? '#1a1a1a' : '#e0e0e0'),
                              borderRadius: 6,
                              background: creditsRemaining > 0 ? '#1a1a1a' : '#e0e0e0',
                              color: creditsRemaining > 0 ? '#fff' : '#999'
                            }}
                          >
                            {registering === session.id ? 'Registering...' : creditsRemaining <= 0 ? 'No credits' : spotsLeft === 0 ? 'Join waitlist' : 'Register'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agenda Tab */}
      {activeTab === 'agenda' && (
        <div>
          {confirmedRegs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>No sessions registered yet</div>
              <div style={{ fontSize: 13 }}>Head to Workshops to register for sessions</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
                {confirmedRegs.length} session{confirmedRegs.length !== 1 ? 's' : ''} registered
              </div>
              {confirmedRegs
                .sort((a, b) => (a.sessions?.start_time || '').localeCompare(b.sessions?.start_time || ''))
                .map(reg => (
                  <div key={reg.id} style={{
                    background: '#fff', border: '0.5px solid #e8e8e8',
                    borderRadius: 12, padding: '14px 18px', marginBottom: 10
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>{reg.sessions?.workshops?.name}</div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 3 }}>
                          {formatTime(reg.sessions?.start_time)} – {formatTime(reg.sessions?.end_time)}
                        </div>
                        <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                          {formatDate(reg.sessions?.date)}
                          {reg.party_size > 1 ? ' · ' + reg.party_size + ' people' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => generateICS(reg.sessions)} style={{
                          fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                          border: '0.5px solid #d0d0d0', borderRadius: 6, background: '#fff'
                        }}>+ Calendar</button>
                        <button onClick={() => cancel(reg.id, reg.session_id, reg.party_size)} style={{
                          fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                          border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b'
                        }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                ))}
              <button onClick={() => confirmedRegs.forEach(r => generateICS(r.sessions))} style={{
                marginTop: 8, fontSize: 13, padding: '8px 16px', cursor: 'pointer',
                border: '0.5px solid #1a1a1a', borderRadius: 8, background: '#fff', width: '100%'
              }}>
                + Add all to calendar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}