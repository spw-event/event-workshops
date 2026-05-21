'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [guest, setGuest] = useState(null)
  const [guestEvent, setGuestEvent] = useState(null)
  const [myEvents, setMyEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
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
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [opensAt, setOpensAt] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const eventId = params.get('event')
    if (!token) {
      setError('No invite token found. Please use the link from your invitation email.')
      setLoading(false)
      return
    }
    loadData(token, eventId)
  }, [])

  async function loadData(token, eventId) {
    setLoading(true)

    // Load guest
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

    // Load events this guest is invited to
    const { data: guestEvents } = await supabase
      .from('guest_events')
      .select('*, events(*)')
      .eq('guest_id', guestData.id)
      

    const events = (guestEvents || []).map(ge => ge.events).filter(Boolean)
    setMyEvents(events)

    // Pick event — from URL param or first upcoming
    let activeEvent = null
    if (eventId) {
      activeEvent = events.find(e => e.id === eventId) || events[0]
    } else {
      activeEvent = events.find(e => e.status === 'upcoming' || e.status === 'active') || events[0]
    }

    if (!activeEvent) {
      setError('You are not registered for any upcoming events.')
      setLoading(false)
      return
    }
    setSelectedEvent(activeEvent)

    // Check registration open time
    if (activeEvent.registration_opens_at) {
      const opensDate = new Date(activeEvent.registration_opens_at)
      const now = new Date()
      if (now < opensDate) {
        setRegistrationOpen(false)
        setOpensAt(opensDate)
      }
    }

    // Load guest_event record for credits
    const geRecord = guestEvents?.find(ge => ge.event_id === activeEvent.id)
    setGuestEvent(geRecord || null)

    await loadEventData(guestData, activeEvent)
    setLoading(false)
  }

  async function loadEventData(guestData, event) {
    // Credits
    const { data: creditsUsed } = await supabase
      .rpc('get_party_credits_used', { p_guest_id: guestData.id, p_event_id: event.id })
    const { data: creditsTotal } = await supabase
      .rpc('get_party_credits_total', { p_guest_id: guestData.id, p_event_id: event.id })
    setPartyCreditsUsed(creditsUsed || 0)
    setPartyCreditsTotal(creditsTotal || 0)

    // Sessions for this event
    const { data: sessionData } = await supabase
      .from('sessions')
      .select('*, workshops(*)')
      .eq('event_id', event.id)
      .order('start_time', { ascending: true })
    setSessions(sessionData || [])

    // Unique workshops from sessions
    const wsMap = {}
    sessionData?.forEach(s => { if (s.workshops) wsMap[s.workshop_id] = s.workshops })
    setWorkshops(Object.values(wsMap))

    // Registrations for this guest and event
    const { data: regData } = await supabase
      .from('registrations')
      .select('*, sessions(*, workshops(*))')
      .eq('guest_id', guestData.id)
      .eq('event_id', event.id)
      .neq('status', 'cancelled')
    setRegistrations(regData || [])

    // Availability
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

  async function switchEvent(event) {
    setSelectedEvent(event)
    setRegistrations([])
    setSessions([])
    setWorkshops([])
    setMessage(null)

    if (event.registration_opens_at) {
      const opensDate = new Date(event.registration_opens_at)
      const now = new Date()
      setRegistrationOpen(now >= opensDate)
      setOpensAt(opensDate)
    } else {
      setRegistrationOpen(true)
      setOpensAt(null)
    }

    const geRecord = await supabase
      .from('guest_events')
      .select('*')
      .eq('guest_id', guest.id)
      .eq('event_id', event.id)
      .single()
    setGuestEvent(geRecord.data || null)

    await loadEventData(guest, event)
  }

  async function refreshAll() {
    if (!guest || !selectedEvent) return
    await loadEventData(guest, selectedEvent)
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
    if (!guest || !partySelectorSession || !selectedEvent) return
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
      const { error: wlError } = await supabase
        .from('registrations')
        .insert({ guest_id: guest.id, session_id: session.id, event_id: selectedEvent.id, status: 'waitlisted', party_size: partySize })
      if (!wlError) {
        setMessage({ type: 'warning', text: 'Not enough spots for your group — added to waitlist.' })
        await refreshAll()
      }
    } else {
      const { error: regError } = await supabase
        .from('registrations')
        .insert({ guest_id: guest.id, session_id: session.id, event_id: selectedEvent.id, status: 'confirmed', party_size: partySize })
      if (!regError) {
        // Update credits in guest_events
        await supabase
          .from('guest_events')
          .update({ credits_used: (guestEvent?.credits_used || 0) + partySize })
          .eq('guest_id', guest.id)
          .eq('event_id', selectedEvent.id)
        setMessage({ type: 'success', text: 'Registered ' + partySize + ' person' + (partySize > 1 ? 's' : '') + ' successfully!' })
        await refreshAll()
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
    await supabase
      .from('guest_events')
      .update({ credits_used: Math.max(0, (guestEvent?.credits_used || 0) - creditRefund) })
      .eq('guest_id', guest.id)
      .eq('event_id', selectedEvent.id)

    // Promote waitlisted
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

    setMessage({ type: 'success', text: 'Cancelled. ' + creditRefund + ' credit' + (creditRefund > 1 ? 's' : '') + ' returned.' })
    await refreshAll()
  }

  function generateICS(session) {
    if (!session) return
    const name = session.workshops?.name || 'Workshop'
    const formatDT = (d, t) => new Date(d + 'T' + t).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      'DTSTART:' + formatDT(session.date, session.start_time),
      'DTEND:' + formatDT(session.date, session.end_time),
      'SUMMARY:' + name + ' — ' + (selectedEvent?.name || 'Snow Peak'),
      'LOCATION:' + (session.workshops?.location || ''),
      'END:VEVENT', 'END:VCALENDAR'].join('\n')
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

  function getReg(sessionId) {
    return registrations.find(r => r.session_id === sessionId)
  }

  function formatTime(t) {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return (hour % 12 || 12) + ':' + m + ' ' + (hour >= 12 ? 'PM' : 'AM')
  }

  function formatDate(d) {
    if (!d) return ''
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  }

  function formatDateTime(dt) {
    if (!dt) return ''
    return new Date(dt).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const sessionsByWorkshop = workshops.map(w => ({
    ...w, sessions: sessions.filter(s => s.workshop_id === w.id)
  })).filter(w => w.sessions.length > 0)

  const creditsRemaining = partyCreditsTotal - partyCreditsUsed
  const confirmedRegs = registrations.filter(r => r.status === 'confirmed')

  function getMaxPartySize(sessionId) {
    const avail = sessionAvailability[sessionId] || 0
    const partyCap = guest?.ticket_types?.party_cap || 1
    return Math.max(1, Math.min(creditsRemaining, partyCap, avail))
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
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
          Snow Peak USA
        </div>
        <div style={{ fontSize: 22, fontWeight: 500 }}>
          Welcome, {guest?.name?.split(' ')[0]}
        </div>

        {/* Event switcher */}
        {myEvents.length > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {myEvents.map(ev => (
              <button key={ev.id} onClick={() => switchEvent(ev)} style={{
                padding: '5px 14px', borderRadius: 20, border: '0.5px solid',
                borderColor: selectedEvent?.id === ev.id ? '#1a1a1a' : '#d0d0d0',
                background: selectedEvent?.id === ev.id ? '#1a1a1a' : '#fff',
                color: selectedEvent?.id === ev.id ? '#fff' : '#666',
                fontSize: 12, cursor: 'pointer'
              }}>
                {ev.name}
              </button>
            ))}
          </div>
        )}

        {selectedEvent && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
            {selectedEvent.name} · {selectedEvent.location && selectedEvent.location + ' · '}
            {new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{new Date(selectedEvent.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}

        {guest?.ticket_types && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
            {guest.ticket_types.name} · {creditsRemaining} of {partyCreditsTotal} credits remaining
          </div>
        )}
      </div>

      {/* Registration not open yet */}
      {!registrationOpen && opensAt && (
        <div style={{ padding: '14px 16px', background: '#fffbea', border: '0.5px solid #f5d88a', borderRadius: 10, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#8a6000', marginBottom: 4 }}>Registration not open yet</div>
          <div style={{ fontSize: 13, color: '#8a6000' }}>Workshop registration opens {formatDateTime(opensAt)}. You can browse the schedule below.</div>
        </div>
      )}

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

      {/* Party size modal */}
      {partySelectorSession && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>{partySelectorSession.workshops?.name}</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>{formatTime(partySelectorSession.start_time)} – {formatTime(partySelectorSession.end_time)}</div>
            {partySelectorSession.workshops?.location && (
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>📍 {partySelectorSession.workshops.location}</div>
            )}
            <div style={{ fontSize: 14, marginBottom: 12 }}>How many people are you registering?</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {Array.from({ length: getMaxPartySize(partySelectorSession.id) }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => setSelectedPartySize(n)} style={{
                  width: 44, height: 44, borderRadius: 8, border: '0.5px solid',
                  borderColor: selectedPartySize === n ? '#1a1a1a' : '#e0e0e0',
                  background: selectedPartySize === n ? '#1a1a1a' : '#fff',
                  color: selectedPartySize === n ? '#fff' : '#1a1a1a',
                  fontSize: 15, fontWeight: 500, cursor: 'pointer'
                }}>{n}</button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              {selectedPartySize} credit{selectedPartySize > 1 ? 's' : ''} used · {creditsRemaining - selectedPartySize} remaining after
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={closePartySelector} style={{ flex: 1, padding: 10, borderRadius: 8, border: '0.5px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontSize: 14 }}>Cancel</button>
              <button onClick={confirmRegister} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>Confirm</button>
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

      {/* Schedule */}
      {activeTab === 'schedule' && (
        <div>
          {sessionsByWorkshop.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
              <div>No workshops scheduled yet for this event.</div>
            </div>
          ) : sessionsByWorkshop.map(workshop => (
            <div key={workshop.id} style={{ background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '16px 20px', marginBottom: 12 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{workshop.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                  {workshop.category}{workshop.instructor ? ' · ' + workshop.instructor : ''}
                  {workshop.location ? ' · 📍 ' + workshop.location : ''}
                </div>
                {workshop.description && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{workshop.description}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {workshop.sessions.map(session => {
                  const registered = isRegistered(session.id)
                  const waitlisted = isWaitlisted(session.id)
                  const reg = getReg(session.id)
                  const avail = sessionAvailability[session.id] ?? session.capacity
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
                        <div style={{ fontSize: 11, color: avail <= 5 && !registered && !waitlisted ? '#c0392b' : '#aaa', marginTop: 2 }}>
                          {registered ? 'Registered' + (reg?.party_size > 1 ? ' · ' + reg.party_size + ' people' : '') :
                           waitlisted ? 'Waitlisted' :
                           avail === 0 ? 'Full — join waitlist' :
                           avail <= 5 ? avail + ' spots left' :
                           avail + ' spots available'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {registered && (
                          <>
                            <button onClick={() => generateICS(session)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', border: '0.5px solid #d0d0d0', borderRadius: 6, background: '#fff' }}>+ Cal</button>
                            <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b' }}>Cancel</button>
                          </>
                        )}
                        {waitlisted && (
                          <>
                            <span style={{ fontSize: 11, color: '#8a6000', background: '#fff3cd', padding: '2px 8px', borderRadius: 6 }}>Waitlisted</span>
                            <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b' }}>Remove</button>
                          </>
                        )}
                        {!registered && !waitlisted && (
                          <button
                            onClick={() => registrationOpen && creditsRemaining > 0 && openPartySelector(session)}
                            disabled={registering === session.id || creditsRemaining <= 0 || !registrationOpen}
                            style={{
                              fontSize: 12, padding: '5px 14px',
                              cursor: registrationOpen && creditsRemaining > 0 ? 'pointer' : 'not-allowed',
                              border: '0.5px solid ' + (registrationOpen && creditsRemaining > 0 ? '#1a1a1a' : '#e0e0e0'),
                              borderRadius: 6,
                              background: registrationOpen && creditsRemaining > 0 ? '#1a1a1a' : '#e0e0e0',
                              color: registrationOpen && creditsRemaining > 0 ? '#fff' : '#999'
                            }}
                          >
                            {registering === session.id ? '...' :
                             !registrationOpen ? 'Not open yet' :
                             creditsRemaining <= 0 ? 'No credits' :
                             avail === 0 ? 'Join waitlist' : 'Register'}
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

      {/* Agenda */}
      {activeTab === 'agenda' && (
        <div>
          {confirmedRegs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 15, marginBottom: 8 }}>No sessions registered yet</div>
              <div style={{ fontSize: 13 }}>Head to Workshops to register</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
                {confirmedRegs.length} session{confirmedRegs.length !== 1 ? 's' : ''} · {selectedEvent?.name}
              </div>
              {confirmedRegs
                .sort((a, b) => (a.sessions?.start_time || '').localeCompare(b.sessions?.start_time || ''))
                .map(reg => (
                  <div key={reg.id} style={{ background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 18px', marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>{reg.sessions?.workshops?.name}</div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 3 }}>
                          {formatTime(reg.sessions?.start_time)} – {formatTime(reg.sessions?.end_time)}
                        </div>
                        <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                          {formatDate(reg.sessions?.date)}
                          {reg.party_size > 1 ? ' · ' + reg.party_size + ' people' : ''}
                          {reg.sessions?.workshops?.location ? ' · 📍 ' + reg.sessions.workshops.location : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => generateICS(reg.sessions)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', border: '0.5px solid #d0d0d0', borderRadius: 6, background: '#fff' }}>+ Cal</button>
                        <button onClick={() => cancel(reg.id, reg.session_id, reg.party_size)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', border: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b' }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                ))}
              <button onClick={() => confirmedRegs.forEach(r => generateICS(r.sessions))} style={{ marginTop: 8, fontSize: 13, padding: '8px 16px', cursor: 'pointer', border: '0.5px solid #1a1a1a', borderRadius: 8, background: '#fff', width: '100%' }}>
                + Add all to calendar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}