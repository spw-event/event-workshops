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
  const [openMoments, setOpenMoments] = useState([])
  const [momentSaves, setMomentSaves] = useState([])
  const [savingMoment, setSavingMoment] = useState(null)
  const [activeDay, setActiveDay] = useState(null)

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

    // Pick event — from URL param or first non-past
    const isPastEvent = (ev) => !!(ev?.end_date && ev.end_date < new Date().toISOString().slice(0, 10))

    let activeEvent = null
    if (eventId) {
      activeEvent = events.find(e => e.id === eventId && !isPastEvent(e))
        || events.find(e => e.id === eventId)
    } else {
      activeEvent = events.find(e => !isPastEvent(e) && (e.status === 'upcoming' || e.status === 'active'))
        || events.find(e => !isPastEvent(e))
    }

    if (!activeEvent) {
      setError(events.length > 0
        ? 'No upcoming events — check back soon.'
        : 'You are not registered for any events.')
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
    let { data: sessionData } = await supabase
      .from('sessions')
      .select('*, workshops(*)')
      .eq('event_id', event.id)
      .order('start_time', { ascending: true })

    // Fallback for legacy sessions that pre-date the event_id column
    if (!sessionData || sessionData.length === 0) {
      const { data: legacySessions } = await supabase
        .from('sessions')
        .select('*, workshops(*)')
        .is('event_id', null)
        .order('start_time', { ascending: true })
      if (legacySessions && legacySessions.length > 0) sessionData = legacySessions
    }
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

    // Open moments for this event
    const { data: momentsData } = await supabase
      .from('open_moments')
      .select('*')
      .eq('event_id', event.id)
      .order('date')
      .order('start_time')
    setOpenMoments(momentsData || [])

    // Moment saves for this guest
    const { data: savesData } = await supabase
      .from('guest_moment_saves')
      .select('*')
      .eq('guest_id', guestData.id)
    setMomentSaves(savesData || [])

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
          .update({ credits_used: partyCreditsUsed + partySize })
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
      .update({ credits_used: Math.max(0, partyCreditsUsed - creditRefund) })
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

  async function saveMoment(momentId) {
    setSavingMoment(momentId)
    await supabase.from('guest_moment_saves').insert({ guest_id: guest.id, moment_id: momentId })
    const { data } = await supabase.from('guest_moment_saves').select('*').eq('guest_id', guest.id)
    setMomentSaves(data || [])
    setSavingMoment(null)
  }

  async function unsaveMoment(momentId) {
    setSavingMoment(momentId)
    await supabase.from('guest_moment_saves').delete().eq('guest_id', guest.id).eq('moment_id', momentId)
    const { data } = await supabase.from('guest_moment_saves').select('*').eq('guest_id', guest.id)
    setMomentSaves(data || [])
    setSavingMoment(null)
  }

  function isMomentSaved(momentId) {
    return momentSaves.some(s => s.moment_id === momentId)
  }

  function generateMomentICS(moment) {
    if (!moment?.date || !moment?.start_time) return
    const formatDT = (d, t) => new Date(d + 'T' + t).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    const endTime = moment.end_time || moment.start_time
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      'DTSTART:' + formatDT(moment.date, moment.start_time),
      'DTEND:' + formatDT(moment.date, endTime),
      'SUMMARY:' + moment.name + ' — ' + (selectedEvent?.name || 'Snow Peak'),
      'LOCATION:' + (moment.location || ''),
      'END:VEVENT', 'END:VCALENDAR'].join('\n')
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = moment.name.replace(/\s+/g, '-') + '.ics'
    a.click()
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

  const creditsRemaining = partyCreditsTotal - partyCreditsUsed
  const confirmedRegs = registrations.filter(r => r.status === 'confirmed')
  const sortKey = (date, time) => (date || '9999-99-99') + ' ' + (time || '99:99:99')

  const allDates = [...new Set([
    ...sessions.map(s => s.date).filter(Boolean),
    ...openMoments.map(m => m.date).filter(Boolean)
  ])].sort()

  const currentDay = (activeDay && allDates.includes(activeDay)) ? activeDay : (allDates[0] || null)

  const agendaItems = [
    ...confirmedRegs.map(r => ({ type: 'reg', data: r, key: sortKey(r.sessions?.date, r.sessions?.start_time) })),
    ...openMoments.filter(m => m.moment_type === 'mandatory').map(m => ({ type: 'mandatory', data: m, key: sortKey(m.date, m.start_time) })),
    ...openMoments.filter(m => m.moment_type === 'optional' && isMomentSaved(m.id)).map(m => ({ type: 'saved', data: m, key: sortKey(m.date, m.start_time) }))
  ].sort((a, b) => a.key.localeCompare(b.key))

  function getMaxPartySize(sessionId) {
    const avail = sessionAvailability[sessionId] || 0
    const partyCap = guest?.ticket_types?.party_cap || 1
    return Math.max(1, Math.min(creditsRemaining, partyCap, avail))
  }

  function formatDayTab(d) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', background: '#FAFAF8' }}>
      <div style={{ textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
        <div>Loading your Snow Peak experience...</div>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24, background: '#FAFAF8' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Access Required</div>
        <div style={{ color: '#666', lineHeight: 1.6 }}>{error}</div>
      </div>
    </div>
  )

  return (
    <div style={{ background: '#FAFAF8', minHeight: '100vh', fontFamily: 'sans-serif', color: '#1a1a1a' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#b0a898', marginBottom: 6 }}>
            Snow Peak USA
          </div>
          <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.01em' }}>
            Welcome, {guest?.name?.split(' ')[0]}
          </div>

          {myEvents.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {myEvents.map(ev => (
                <button key={ev.id} onClick={() => switchEvent(ev)} style={{
                  padding: '5px 14px', borderRadius: 20,
                  borderTop: '0.5px solid', borderRight: '0.5px solid', borderBottom: '0.5px solid', borderLeft: '0.5px solid',
                  borderColor: selectedEvent?.id === ev.id ? '#1a1a1a' : '#d0c8bc',
                  background: selectedEvent?.id === ev.id ? '#1a1a1a' : 'transparent',
                  color: selectedEvent?.id === ev.id ? '#fff' : '#666',
                  fontSize: 12, cursor: 'pointer'
                }}>
                  {ev.name}
                </button>
              ))}
            </div>
          )}

          {selectedEvent && (
            <div style={{ fontSize: 13, color: '#888', marginTop: 8, lineHeight: 1.5 }}>
              {selectedEvent.name}{selectedEvent.location ? ' · ' + selectedEvent.location : ''} · {new Date(selectedEvent.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–{new Date(selectedEvent.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          )}

          {guest?.ticket_types && (
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              {guest.ticket_types.name} · {creditsRemaining} of {partyCreditsTotal} registration credits remaining
            </div>
          )}
        </div>

        {!registrationOpen && opensAt && (
          <div style={{ padding: '14px 16px', background: '#fffbea', borderTop: '0.5px solid #f5d88a', borderRight: '0.5px solid #f5d88a', borderBottom: '0.5px solid #f5d88a', borderLeft: '0.5px solid #f5d88a', borderRadius: 10, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#8a6000', marginBottom: 4 }}>Registration not open yet</div>
            <div style={{ fontSize: 13, color: '#8a6000' }}>Workshop registration opens {formatDateTime(opensAt)}. You can browse the schedule below.</div>
          </div>
        )}

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

        {/* Party size modal — unchanged */}
        {partySelectorSession && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
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
        <div style={{ display: 'flex', borderBottom: '0.5px solid #e0d8cc', marginBottom: 0 }}>
          {['schedule', 'agenda'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 14, color: activeTab === tab ? '#1a1a1a' : '#999',
              borderBottom: activeTab === tab ? '2px solid #1a4a2a' : '2px solid transparent',
              marginBottom: -1, fontWeight: activeTab === tab ? 500 : 400
            }}>
              {tab === 'schedule' ? 'Schedule' : 'My Agenda'}
            </button>
          ))}
        </div>

        {/* ── SCHEDULE TAB ── */}
        {activeTab === 'schedule' && (
          <div style={{ paddingTop: 20 }}>

            {/* Explainer */}
            <div style={{ fontSize: 13, color: '#6a5a48', lineHeight: 1.65, marginBottom: 20, padding: '13px 16px', background: '#f5f0e8', borderRadius: 10 }}>
              <strong style={{ color: '#3a2e1e', fontWeight: 600 }}>Workshops</strong> require registration and use your credits.{' '}
              <strong style={{ color: '#3a2e1e', fontWeight: 600 }}>Open activities</strong> are drop-in — just show up, or save them to your agenda.
            </div>

            {/* Day tabs */}
            {allDates.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                {allDates.map(d => (
                  <button key={d} onClick={() => setActiveDay(d)} style={{
                    padding: '7px 16px', borderRadius: 20,
                    borderTop: '1px solid', borderRight: '1px solid', borderBottom: '1px solid', borderLeft: '1px solid',
                    borderColor: currentDay === d ? '#1a4a2a' : '#d0c8bc',
                    background: currentDay === d ? '#1a4a2a' : 'transparent',
                    color: currentDay === d ? '#fff' : '#5a4a3a',
                    fontSize: 12, fontWeight: currentDay === d ? 500 : 400, cursor: 'pointer'
                  }}>
                    {formatDayTab(d)}
                  </button>
                ))}
              </div>
            )}

            {!currentDay ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
                <div>No workshops scheduled yet for this event.</div>
              </div>
            ) : (() => {
              const daySessions = sessions.filter(s => s.date === currentDay)
              const dayMoments = openMoments.filter(m => m.date === currentDay)
              const dayItems = [
                ...daySessions.map(s => ({ type: 'session', data: s, time: s.start_time })),
                ...dayMoments.map(m => ({ type: m.moment_type === 'mandatory' ? 'mandatory' : 'optional', data: m, time: m.start_time }))
              ].sort((a, b) => (a.time || '').localeCompare(b.time || ''))

              if (dayItems.length === 0) {
                return (
                  <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
                    <div style={{ fontSize: 32, marginBottom: 12 }}>⛺</div>
                    <div>Nothing scheduled for this day yet.</div>
                  </div>
                )
              }

              const timeBlocks = [
                { id: 'morning', label: 'Morning', test: h => h < 12 },
                { id: 'afternoon', label: 'Afternoon', test: h => h >= 12 && h < 16 },
                { id: 'evening', label: 'Evening', test: h => h >= 16 }
              ]

              return (
                <div>
                  {timeBlocks.map(block => {
                    const items = dayItems.filter(item => {
                      const h = item.time ? parseInt(item.time.split(':')[0]) : 0
                      return block.test(h)
                    })
                    if (items.length === 0) return null

                    return (
                      <div key={block.id} style={{ marginBottom: 8 }}>
                        {/* Time block divider */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, marginTop: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: '#7a6a5a', whiteSpace: 'nowrap' }}>{block.label}</span>
                          <div style={{ flex: 1, height: '0.5px', background: '#e0d8cc' }} />
                          <span style={{ fontSize: 11, color: '#b0a898', whiteSpace: 'nowrap' }}>{items.length} {items.length === 1 ? 'activity' : 'activities'}</span>
                        </div>

                        {items.map(item => {

                          /* ── ALL CAMPERS moment (mandatory) ── */
                          if (item.type === 'mandatory') {
                            const m = item.data
                            return (
                              <div key={m.id} style={{ background: '#f5f0e8', borderRadius: 12, padding: '14px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                <div style={{ fontSize: 20, lineHeight: 1, paddingTop: 3, flexShrink: 0 }}>⛺</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 5 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#7a5520', background: '#e8d0a0', padding: '2px 9px', borderRadius: 10 }}>All Campers</span>
                                  </div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: '#3a2e1e' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#7a6a52', marginTop: 3 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                  {m.description && <div style={{ fontSize: 11, color: '#9a8a72', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                                </div>
                                {m.date && m.start_time && (
                                  <button onClick={() => generateMomentICS(m)} style={{ fontSize: 11, padding: '5px 10px', borderTop: '0.5px solid #c8b08a', borderRight: '0.5px solid #c8b08a', borderBottom: '0.5px solid #c8b08a', borderLeft: '0.5px solid #c8b08a', borderRadius: 6, background: 'transparent', color: '#8a6a40', cursor: 'pointer', flexShrink: 0 }}>+ Cal</button>
                                )}
                              </div>
                            )
                          }

                          /* ── DROP IN moment (optional) ── */
                          if (item.type === 'optional') {
                            const m = item.data
                            const saved = isMomentSaved(m.id)
                            return (
                              <div key={m.id} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '1.5px dashed #d4b896', borderRight: '1.5px dashed #d4b896', borderBottom: '1.5px dashed #d4b896', borderLeft: '4px solid #c07830' }}>
                                <div style={{ fontSize: 20, lineHeight: 1, paddingTop: 3, flexShrink: 0 }}>🌿</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 5 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#8a5a10', background: '#fdecc8', padding: '2px 9px', borderRadius: 10 }}>Drop In</span>
                                  </div>
                                  <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                  {m.description && <div style={{ fontSize: 11, color: '#aaa', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignItems: 'flex-end' }}>
                                  {saved && m.date && m.start_time && (
                                    <button onClick={() => generateMomentICS(m)} style={{ fontSize: 11, padding: '4px 10px', borderTop: '0.5px solid #d0c8bc', borderRight: '0.5px solid #d0c8bc', borderBottom: '0.5px solid #d0c8bc', borderLeft: '0.5px solid #d0c8bc', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#666' }}>+ Cal</button>
                                  )}
                                  {saved ? (
                                    <button onClick={() => unsaveMoment(m.id)} disabled={savingMoment === m.id} style={{ fontSize: 12, padding: '5px 12px', borderTop: '0.5px solid #a3d9b8', borderRight: '0.5px solid #a3d9b8', borderBottom: '0.5px solid #a3d9b8', borderLeft: '0.5px solid #a3d9b8', borderRadius: 6, background: '#f0faf4', color: '#1a7a4a', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                      {savingMoment === m.id ? '...' : 'Added ✓'}
                                    </button>
                                  ) : (
                                    <button onClick={() => saveMoment(m.id)} disabled={savingMoment === m.id} style={{ fontSize: 12, padding: '5px 12px', borderTop: '1px solid #c07830', borderRight: '1px solid #c07830', borderBottom: '1px solid #c07830', borderLeft: '1px solid #c07830', borderRadius: 6, background: 'transparent', color: '#8a5010', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                      {savingMoment === m.id ? '...' : 'Add to My Agenda'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          }

                          /* ── WORKSHOP SESSION ── */
                          const session = item.data
                          const workshop = session.workshops
                          const registered = isRegistered(session.id)
                          const waitlisted = isWaitlisted(session.id)
                          const reg = getReg(session.id)
                          const avail = sessionAvailability[session.id] ?? session.capacity
                          const isFull = avail === 0 && !registered && !waitlisted
                          const canRegister = registrationOpen && creditsRemaining > 0

                          return (
                            <div key={session.id} style={{
                              background: registered ? '#edf7f1' : '#fff',
                              borderRadius: 12,
                              borderTop: '0.5px solid ' + (registered ? '#a3d9b8' : '#e8e0d5'),
                              borderRight: '0.5px solid ' + (registered ? '#a3d9b8' : '#e8e0d5'),
                              borderBottom: '0.5px solid ' + (registered ? '#a3d9b8' : '#e8e0d5'),
                              borderLeft: '4px solid ' + (registered ? '#1a7a4a' : isFull ? '#bbb' : '#1a4a2a'),
                              padding: '14px 16px', marginBottom: 10
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ fontSize: 20, lineHeight: 1, paddingTop: 3, flexShrink: 0 }}>🧭</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    {registered ? (
                                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: '#1a7a4a', padding: '2px 9px', borderRadius: 10 }}>✓ Registered</span>
                                    ) : waitlisted ? (
                                      <span style={{ fontSize: 11, fontWeight: 600, color: '#8a6000', background: '#fff3cd', padding: '2px 9px', borderRadius: 10 }}>Waitlisted</span>
                                    ) : isFull ? (
                                      <span style={{ fontSize: 11, fontWeight: 600, color: '#666', background: '#eee', padding: '2px 9px', borderRadius: 10 }}>Full</span>
                                    ) : (
                                      <span style={{ fontSize: 11, fontWeight: 600, color: '#1a4a2a', background: '#d4e8d8', padding: '2px 9px', borderRadius: 10 }}>Registration</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 15, fontWeight: 600, color: registered ? '#1a4a2a' : '#1a1a1a' }}>{workshop?.name}</div>
                                  <div style={{ fontSize: 12, color: registered ? '#2a7a3a' : '#888', marginTop: 3 }}>
                                    {workshop?.instructor || ''}{workshop?.instructor && workshop?.location ? ' · ' : ''}{workshop?.location ? '📍 ' + workshop.location : ''}
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 500, color: registered ? '#1a4a2a' : '#1a1a1a', marginTop: 8 }}>
                                    {formatTime(session.start_time)} – {formatTime(session.end_time)}
                                  </div>
                                  <div style={{ fontSize: 11, marginTop: 3, color: (!registered && !waitlisted && avail !== undefined && avail <= 5) ? '#c0392b' : (registered ? '#2a7a3a' : '#aaa') }}>
                                    {registered
                                      ? (reg?.party_size > 1 ? reg.party_size + ' people' : '1 person')
                                      : waitlisted ? "Waitlisted — we'll notify you if a spot opens"
                                      : avail === 0 ? 'No spots remaining'
                                      : avail <= 5 ? avail + ' spots left'
                                      : avail + ' spots available'}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                                  {registered && (
                                    <>
                                      <button onClick={() => generateICS(session)} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', borderTop: '0.5px solid #a3d9b8', borderRight: '0.5px solid #a3d9b8', borderBottom: '0.5px solid #a3d9b8', borderLeft: '0.5px solid #a3d9b8', borderRadius: 6, background: '#fff', color: '#1a7a4a' }}>+ Cal</button>
                                      <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', borderTop: '0.5px solid #ddd', borderRight: '0.5px solid #ddd', borderBottom: '0.5px solid #ddd', borderLeft: '0.5px solid #ddd', borderRadius: 6, background: '#fff', color: '#888' }}>Cancel</button>
                                    </>
                                  )}
                                  {waitlisted && (
                                    <button onClick={() => cancel(reg.id, session.id, reg?.party_size)} style={{ fontSize: 11, padding: '5px 10px', cursor: 'pointer', borderTop: '0.5px solid #ddd', borderRight: '0.5px solid #ddd', borderBottom: '0.5px solid #ddd', borderLeft: '0.5px solid #ddd', borderRadius: 6, background: '#fff', color: '#888' }}>Remove</button>
                                  )}
                                  {!registered && !waitlisted && (
                                    <button
                                      onClick={() => canRegister && openPartySelector(session)}
                                      disabled={registering === session.id || !canRegister}
                                      style={{
                                        fontSize: 12, padding: '7px 16px', cursor: canRegister ? 'pointer' : 'not-allowed',
                                        borderTop: '1px solid', borderRight: '1px solid', borderBottom: '1px solid', borderLeft: '1px solid',
                                        borderColor: canRegister ? '#1a4a2a' : '#ddd',
                                        borderRadius: 8,
                                        background: canRegister ? '#1a4a2a' : '#f0f0f0',
                                        color: canRegister ? '#fff' : '#aaa',
                                        fontWeight: 500, whiteSpace: 'nowrap'
                                      }}
                                    >
                                      {registering === session.id ? '...' :
                                       !registrationOpen ? 'Not open yet' :
                                       creditsRemaining <= 0 ? 'No credits' :
                                       isFull ? 'Join Waitlist' : 'Register'}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── MY AGENDA TAB ── */}
        {activeTab === 'agenda' && (
          <div style={{ paddingTop: 20 }}>
            {agendaItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: '#888' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
                <div style={{ fontSize: 15, marginBottom: 8, color: '#5a4a3a' }}>Your agenda is empty</div>
                <div style={{ fontSize: 13, color: '#999' }}>Register for workshops or save drop-in activities from the Schedule tab</div>
              </div>
            ) : (() => {
              const agendaDays = [...new Set(agendaItems.map(item =>
                item.type === 'reg' ? item.data.sessions?.date : item.data.date
              ).filter(Boolean))].sort()

              return (
                <div>
                  {agendaDays.map(day => {
                    const dayItems = agendaItems.filter(item => {
                      const d = item.type === 'reg' ? item.data.sessions?.date : item.data.date
                      return d === day
                    })

                    return (
                      <div key={day} style={{ marginBottom: 36 }}>
                        {/* Day header */}
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3a2e1e', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #e8e0d5' }}>
                          {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </div>

                        {dayItems.map(item => {
                          /* All Campers */
                          if (item.type === 'mandatory') {
                            const m = item.data
                            return (
                              <div key={'m-' + m.id} style={{ background: '#f5f0e8', borderRadius: 12, padding: '13px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                <div style={{ fontSize: 18, lineHeight: 1, paddingTop: 2, flexShrink: 0 }}>⛺</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#7a5520', background: '#e8d0a0', padding: '2px 9px', borderRadius: 10 }}>All Campers</span>
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#3a2e1e' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#7a6a52', marginTop: 2 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                </div>
                                {m.date && m.start_time && (
                                  <button onClick={() => generateMomentICS(m)} style={{ fontSize: 11, padding: '4px 10px', borderTop: '0.5px solid #c8b08a', borderRight: '0.5px solid #c8b08a', borderBottom: '0.5px solid #c8b08a', borderLeft: '0.5px solid #c8b08a', borderRadius: 6, background: 'transparent', color: '#8a6a40', cursor: 'pointer', flexShrink: 0 }}>+ Cal</button>
                                )}
                              </div>
                            )
                          }

                          /* Drop In (saved optional) */
                          if (item.type === 'saved') {
                            const m = item.data
                            return (
                              <div key={'s-' + m.id} style={{ background: '#fff', borderRadius: 12, padding: '13px 16px', marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start', borderTop: '0.5px solid #e8e0d5', borderRight: '0.5px solid #e8e0d5', borderBottom: '0.5px solid #e8e0d5', borderLeft: '4px solid #c07830' }}>
                                <div style={{ fontSize: 18, lineHeight: 1, paddingTop: 2, flexShrink: 0 }}>🌿</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#8a5a10', background: '#fdecc8', padding: '2px 9px', borderRadius: 10 }}>Drop In</span>
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
                                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                    {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
                                    {m.location ? ' · 📍 ' + m.location : ''}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  {m.date && m.start_time && (
                                    <button onClick={() => generateMomentICS(m)} style={{ fontSize: 11, padding: '4px 10px', borderTop: '0.5px solid #d0c8bc', borderRight: '0.5px solid #d0c8bc', borderBottom: '0.5px solid #d0c8bc', borderLeft: '0.5px solid #d0c8bc', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#666' }}>+ Cal</button>
                                  )}
                                  <button onClick={() => unsaveMoment(m.id)} disabled={savingMoment === m.id} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderTop: '0.5px solid #f5c0c0', borderRight: '0.5px solid #f5c0c0', borderBottom: '0.5px solid #f5c0c0', borderLeft: '0.5px solid #f5c0c0', borderRadius: 6, background: '#fff', color: '#c0392b' }}>Remove</button>
                                </div>
                              </div>
                            )
                          }

                          /* Workshop registration */
                          const reg = item.data
                          return (
                            <div key={reg.id} style={{ background: '#edf7f1', borderRadius: 12, padding: '13px 16px', marginBottom: 10, borderTop: '0.5px solid #a3d9b8', borderRight: '0.5px solid #a3d9b8', borderBottom: '0.5px solid #a3d9b8', borderLeft: '4px solid #1a7a4a' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ fontSize: 18, lineHeight: 1, paddingTop: 2, flexShrink: 0 }}>🧭</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: '#1a7a4a', padding: '2px 9px', borderRadius: 10 }}>✓ Registered</span>
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a4a2a' }}>{reg.sessions?.workshops?.name}</div>
                                  <div style={{ fontSize: 12, color: '#2a7a3a', marginTop: 2 }}>
                                    {formatTime(reg.sessions?.start_time)} – {formatTime(reg.sessions?.end_time)}
                                    {reg.party_size > 1 ? ' · ' + reg.party_size + ' people' : ''}
                                  </div>
                                  {reg.sessions?.workshops?.location && (
                                    <div style={{ fontSize: 11, color: '#4a8a5a', marginTop: 2 }}>📍 {reg.sessions.workshops.location}</div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                  <button onClick={() => generateICS(reg.sessions)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderTop: '0.5px solid #a3d9b8', borderRight: '0.5px solid #a3d9b8', borderBottom: '0.5px solid #a3d9b8', borderLeft: '0.5px solid #a3d9b8', borderRadius: 6, background: '#fff', color: '#1a7a4a' }}>+ Cal</button>
                                  <button onClick={() => cancel(reg.id, reg.session_id, reg.party_size)} style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderTop: '0.5px solid #ddd', borderRight: '0.5px solid #ddd', borderBottom: '0.5px solid #ddd', borderLeft: '0.5px solid #ddd', borderRadius: 6, background: '#fff', color: '#888' }}>Cancel</button>
                                </div>
                              </div>
                            </div>
                          )
                        })}

                        <button onClick={() => {
                          dayItems.forEach(item => {
                            if (item.type === 'reg') generateICS(item.data.sessions)
                            else if (item.data.date && item.data.start_time) generateMomentICS(item.data)
                          })
                        }} style={{ marginTop: 4, fontSize: 13, padding: '9px 16px', cursor: 'pointer', borderTop: '0.5px solid #c0b8ae', borderRight: '0.5px solid #c0b8ae', borderBottom: '0.5px solid #c0b8ae', borderLeft: '0.5px solid #c0b8ae', borderRadius: 8, background: 'transparent', color: '#6a5a4a', width: '100%' }}>
                          + Add {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} to calendar
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}