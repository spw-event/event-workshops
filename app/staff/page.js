'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function StaffPage() {
  const [loginInput, setLoginInput] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loading, setLoading] = useState(false)
  // Starts true unconditionally (not read from localStorage) so server and
  // client render the same thing on first paint — resolved inside the mount
  // effect below, which only ever runs client-side.
  const [checkingStoredPin, setCheckingStoredPin] = useState(true)
  const [staffMember, setStaffMember] = useState(null)
  const [activeTab, setActiveTab] = useState('schedule')

  const [myAssignments, setMyAssignments] = useState([])
  const [allAssignments, setAllAssignments] = useState([])
  const [allSessions, setAllSessions] = useState([])
  const [allMoments, setAllMoments] = useState([])
  const [allShifts, setAllShifts] = useState([])
  const [staffResources, setStaffResources] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [guestEvents, setGuestEvents] = useState([])
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [eventsWithAssignments, setEventsWithAssignments] = useState([])

  const [staffRole, setStaffRole] = useState(null) // 'staff' | 'instructor'
  const [instructorSessions, setInstructorSessions] = useState([])

  const [expandedRosters, setExpandedRosters] = useState({})
  const [activeGuestLookup, setActiveGuestLookup] = useState(null)
  const [guestQuery, setGuestQuery] = useState('')
  const [guestResults, setGuestResults] = useState([])

  // Persists whichever record just authenticated (from a staff-table row or
  // an instructor_pins row) under the same unified keys /login writes, plus
  // the legacy spw_staff_id some sub-pages (e.g. /staff/resources) key off.
  function persistStaffAuth(record, role) {
    localStorage.setItem('spw_staff_record', JSON.stringify(record))
    localStorage.setItem('spw_staff_role', role)
    localStorage.setItem('spw_staff_id', record.id)
  }

  function clearStaffAuth() {
    // Guest localStorage keys (spw_guest_token etc) are intentionally untouched.
    localStorage.removeItem('spw_staff_record')
    localStorage.removeItem('spw_staff_role')
    localStorage.removeItem('spw_staff_id')
    localStorage.removeItem('spw_staff_event_id')
  }

  useEffect(() => {
    const storedRecord = localStorage.getItem('spw_staff_record')
    if (!storedRecord) { setCheckingStoredPin(false); return }
    let record
    try {
      record = JSON.parse(storedRecord)
    } catch {
      clearStaffAuth()
      setCheckingStoredPin(false)
      return
    }
    // instructor_pins rows have no is_active column at all — its presence on
    // the parsed record is what tells the two tables apart.
    const isStaffTableRecord = 'is_active' in record
    if (isStaffTableRecord) {
      if (!record.is_active) {
        clearStaffAuth()
        setCheckingStoredPin(false)
        return
      }
      setStaffMember(record)
      setStaffRole('staff')
      loadData(record).then(() => { setLoading(false); setCheckingStoredPin(false) })
    } else {
      setStaffMember(record)
      setStaffRole('instructor')
      loadInstructorData(record).then(() => { setLoading(false); setCheckingStoredPin(false) })
    }
  }, [])

  async function attemptLogin(inputValue) {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setLoading(true)
    setLoginError('')

    // Staff table first, matched by email (case-insensitive) — this is the
    // primary login path for Snow Peak staff, admins, and staff-table vendors.
    const { data: staffRows, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .ilike('email', trimmed)
      .eq('is_active', true)
      .limit(1)
    console.log('[attemptLogin] staff table query — data:', staffRows, 'error:', staffError)
    const staffData = staffRows?.[0]

    if (staffData) {
      const role = staffData.is_super_admin ? 'super_admin' : staffData.is_admin ? 'admin' : staffData.is_vendor ? 'vendor' : 'staff'
      persistStaffAuth(staffData, role)
      setStaffMember(staffData)
      setStaffRole('staff')
      await loadData(staffData)
      setLoading(false)
      setCheckingStoredPin(false)
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
    console.log('[attemptLogin] instructor_pins query — data:', instrRows, 'error:', instrError)
    const instrData = instrRows?.[0]

    if (instrData) {
      persistStaffAuth(instrData, 'vendor')
      setStaffMember(instrData)
      setStaffRole('instructor')
      await loadInstructorData(instrData)
    } else {
      setLoginError("We couldn't find that email. Contact your event coordinator for access.")
    }
    setLoading(false)
    setCheckingStoredPin(false)
  }

  function checkLogin() {
    attemptLogin(loginInput)
  }

  function signOut() {
    clearStaffAuth()
    window.location.href = '/login'
  }

  async function loadData(staffRecord) {
    const [
      { data: myA, error: myAError },
      { data: allA, error: allAError },
      { data: regs },
      { data: evts },
      { data: ge },
      { data: sess },
      { data: mom },
      { data: shifts },
      { data: seaData },
      { data: res }
    ] = await Promise.all([
      supabase.from('staff_assignments')
        .select('id, staff_id, session_id, moment_id, shift_id, sessions(id, date, start_time, end_time, capacity, event_id, workshops(name, location)), open_moments(id, name, date, start_time, end_time, location, moment_type, event_id), staff_shifts(id, title, shift_date, start_time, end_time, location, shift_type, description, event_id)')
        .eq('staff_id', staffRecord.id),
      supabase.from('staff_assignments')
        .select('*, staff(id, name), sessions(id, date, start_time, end_time, event_id, workshops(name, location)), open_moments(id, name, date, start_time, end_time, location, moment_type, event_id), staff_shifts(id, title, shift_date, start_time, end_time, location, shift_type, event_id)')
        .not('staff_id', 'is', null),
      supabase.from('registrations').select('*, guests(id, name)').eq('status', 'confirmed'),
      supabase.from('events').select('*').order('start_date'),
      supabase.from('guest_events').select('*, guests(id, name)'),
      supabase.from('sessions').select('*, workshops(name, location)').order('date').order('start_time'),
      supabase.from('open_moments').select('*').order('date').order('start_time'),
      supabase.from('staff_shifts').select('*').order('shift_date').order('start_time'),
      supabase.from('staff_event_assignments').select('*, events(id, name, status)').eq('staff_id', staffRecord.id),
      supabase.from('staff_resources').select('*').order('sort_order')
    ])
    console.log('[loadData] staffRecord.id:', staffRecord.id)
    console.log('[loadData] myA count:', myA?.length ?? 'null', 'error:', myAError ? JSON.stringify(myAError) : null)
    if (myA?.length) console.log('[loadData] myA[0]:', JSON.stringify(myA[0]))
    console.log('[loadData] allA count:', allA?.length ?? 'null', 'error:', allAError ? JSON.stringify(allAError) : null)
    setMyAssignments(myA || [])
    setAllAssignments(allA || [])
    setRegistrations(regs || [])
    setEvents(evts || [])
    setGuestEvents(ge || [])
    setAllSessions(sess || [])
    setAllMoments(mom || [])
    setAllShifts(shifts || [])
    setStaffResources(res || [])
    // Union: staff_event_assignments + events derived from actual assignments
    const seaEvts = (seaData || []).map(sea => sea.events).filter(Boolean)
    const seaEventIds = new Set(seaEvts.map(e => e.id))
    const assignmentEventIds = new Set((myA || []).map(a =>
      a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
    ).filter(Boolean))
    const evtsFromAssignments = (evts || []).filter(e => assignmentEventIds.has(e.id) && !seaEventIds.has(e.id))
    const evtsWithA = [...seaEvts, ...evtsFromAssignments].filter(e => !e.is_archived)
    setEventsWithAssignments(evtsWithA)
    const initial = evtsWithA.find(e => e.status === 'active') || evtsWithA[0] || (evts || []).find(e => !e.is_archived) || null
    selectEvent(initial)
  }

  // Also persists to localStorage so /staff/resources/[category] can read the
  // current event context without needing the staff member to sign in again.
  function selectEvent(ev) {
    setSelectedEvent(ev)
    if (ev) localStorage.setItem('spw_staff_event_id', ev.id)
  }

  async function loadInstructorData(instrRecord) {
    const [{ data: regs }, { data: sess }] = await Promise.all([
      supabase.from('registrations').select('*, guests(id, name)').eq('status', 'confirmed'),
      supabase.from('sessions')
        .select('*, workshops(name, location)')
        .eq('workshop_id', instrRecord.workshop_id)
        .order('date').order('start_time')
    ])
    setRegistrations(regs || [])
    setInstructorSessions(sess || [])
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

  function getAssignmentInfo(a) {
    if (a.sessions) {
      return {
        title: a.sessions.workshops?.name || 'Workshop',
        time: formatTime(a.sessions.start_time) + ' – ' + formatTime(a.sessions.end_time),
        sortKey: a.sessions.start_time || '',
        location: a.sessions.workshops?.location || '',
        date: a.sessions.date,
        type: 'Workshop',
        typeColor: '#2D4A2D', typeBg: '#EEF3EE',
        sessionId: a.sessions.id,
        capacity: a.sessions.capacity || null,
        activityNotes: a.sessions.staff_notes || null,
        isStaffOnly: false
      }
    }
    if (a.open_moments) {
      const isMandatory = a.open_moments.moment_type === 'mandatory'
      return {
        title: a.open_moments.name,
        time: formatTime(a.open_moments.start_time) + ' – ' + formatTime(a.open_moments.end_time),
        sortKey: a.open_moments.start_time || '',
        location: a.open_moments.location || '',
        date: a.open_moments.date,
        type: isMandatory ? 'Mandatory' : 'Open Moment',
        typeColor: isMandatory ? '#7A5C3C' : '#B5622A',
        typeBg: isMandatory ? '#F5F0E8' : '#FDF5EE',
        momentId: a.open_moments.id,
        activityNotes: a.open_moments.staff_notes || null,
        isStaffOnly: false
      }
    }
    if (a.staff_shifts) {
      return {
        title: a.staff_shifts.title,
        time: formatTime(a.staff_shifts.start_time) + ' – ' + formatTime(a.staff_shifts.end_time),
        sortKey: a.staff_shifts.start_time || '',
        location: a.staff_shifts.location || '',
        date: a.staff_shifts.shift_date,
        type: a.staff_shifts.shift_type || 'General',
        typeColor: '#666', typeBg: '#EFEDEA',
        activityNotes: a.staff_shifts.description || null,
        isStaffOnly: true
      }
    }
    return null
  }

  function groupByDate(assignments) {
    const groups = {}
    assignments.forEach(a => {
      const info = getAssignmentInfo(a)
      if (!info?.date) return
      if (!groups[info.date]) groups[info.date] = []
      groups[info.date].push({ ...a, _info: info })
    })
    Object.values(groups).forEach(arr => arr.sort((a, b) => a._info.sortKey.localeCompare(b._info.sortKey)))
    return groups
  }

  async function searchGuests(q) {
    setGuestQuery(q)
    if (!q.trim()) { setGuestResults([]); return }
    const { data } = await supabase
      .from('guests').select('id, name').ilike('name', `%${q.trim()}%`).limit(8)
    setGuestResults(data || [])
  }

  async function updateCheckin(geId, status) {
    await supabase.from('guest_events').update({ checkin_status: status }).eq('id', geId)
    setGuestEvents(prev => prev.map(g => g.id === geId ? { ...g, checkin_status: status } : g))
  }

  function toggleLookup(id) {
    if (activeGuestLookup === id) {
      setActiveGuestLookup(null)
      setGuestQuery('')
      setGuestResults([])
    } else {
      setActiveGuestLookup(id)
      setGuestQuery('')
      setGuestResults([])
    }
  }

  function renderGuestLookup(assignmentId) {
    if (activeGuestLookup !== assignmentId) return null
    return (
      <div style={{ marginTop: 10 }}>
        <input
          type="text" placeholder="Search by guest name…"
          value={guestQuery}
          onChange={e => searchGuests(e.target.value)}
          style={{ ...inp, fontSize: 13, padding: '8px 12px', marginBottom: 6 }}
          autoFocus
        />
        {guestResults.map(g => {
          const ge = guestEvents.find(x => x.guest_id === g.id && (!selectedEvent || x.event_id === selectedEvent.id))
          const status = ge?.checkin_status || 'not_arrived'
          const cfg = {
            not_arrived: { label: 'Not Arrived', color: '#666', bg: '#F0EEEA' },
            checked_in:  { label: 'Checked In',  color: '#2D4A2D', bg: '#EEF3EE' },
            departed:    { label: 'Departed',     color: '#2060B0', bg: '#EEF0F8' }
          }[status] || { label: 'Not Arrived', color: '#666', bg: '#F0EEEA' }
          return (
            <div key={g.id} style={{ padding: '10px 12px', background: '#F7F6F4', borderRadius: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
              </div>
              {ge && (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {[['not_arrived', 'Not Arrived'], ['checked_in', 'Check In'], ['departed', 'Departed']].map(([s, label]) => (
                    <button key={s} onClick={() => updateCheckin(ge.id, s)} style={{
                      padding: '4px 10px', borderRadius: 6, border: 'none', fontSize: 11, cursor: 'pointer',
                      background: status === s ? cfg.color : '#E8E4DE',
                      color: status === s ? '#fff' : '#666',
                      fontWeight: status === s ? 600 : 400
                    }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {guestQuery.trim() && guestResults.length === 0 && (
          <div style={{ fontSize: 13, color: '#aaa', padding: '6px 0' }}>No guests found.</div>
        )}
      </div>
    )
  }

  function buildAllItems() {
    if (!selectedEvent) return []
    const eid = selectedEvent.id
    const items = []

    allSessions.filter(s => s.event_id === eid).forEach(s => {
      items.push({
        key: 'session_' + s.id, date: s.date, start: s.start_time,
        time: formatTime(s.start_time) + ' – ' + formatTime(s.end_time),
        title: s.workshops?.name || 'Workshop',
        location: s.workshops?.location || '',
        type: 'Workshop', typeColor: '#2D4A2D', typeBg: '#EEF3EE',
        isStaffOnly: false,
        staff: allAssignments.filter(a => a.session_id === s.id).map(a => a.staff?.name).filter(Boolean)
      })
    })

    allMoments.filter(m => m.event_id === eid).forEach(m => {
      const isMand = m.moment_type === 'mandatory'
      items.push({
        key: 'moment_' + m.id, date: m.date, start: m.start_time,
        time: formatTime(m.start_time) + ' – ' + formatTime(m.end_time),
        title: m.name, location: m.location || '',
        type: isMand ? 'Mandatory' : 'Open Moment',
        typeColor: isMand ? '#7A5C3C' : '#B5622A',
        typeBg: isMand ? '#F5F0E8' : '#FDF5EE',
        isStaffOnly: false,
        staff: allAssignments.filter(a => a.moment_id === m.id).map(a => a.staff?.name).filter(Boolean)
      })
    })

    allShifts.filter(s => s.event_id === eid).forEach(s => {
      items.push({
        key: 'shift_' + s.id, date: s.date, start: s.start_time,
        time: formatTime(s.start_time) + ' – ' + formatTime(s.end_time),
        title: s.title, location: s.location || '',
        type: s.shift_type || 'General', typeColor: '#666', typeBg: '#EFEDEA',
        isStaffOnly: true,
        staff: allAssignments.filter(a => a.shift_id === s.id).map(a => a.staff?.name).filter(Boolean)
      })
    })

    return items
  }

  // Filter My Schedule to the selected event
  const myFilteredAssignments = selectedEvent
    ? myAssignments.filter(a => {
        const eid = a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
        return eid === selectedEvent.id
      })
    : myAssignments
  console.log('[render] myAssignments:', myAssignments.length, 'selectedEvent:', selectedEvent?.id, 'filtered:', myFilteredAssignments.length)
  const myGrouped = groupByDate(myFilteredAssignments)
  const myDates = Object.keys(myGrouped).sort()
  const allItems = buildAllItems()
  const allByDate = {}
  allItems.forEach(item => {
    if (!allByDate[item.date]) allByDate[item.date] = []
    allByDate[item.date].push(item)
  })
  const allDates = Object.keys(allByDate).sort()

  const card = { background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 18px', marginBottom: 10 }
  const inp = { width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', boxSizing: 'border-box' }
  const btn = (bg, color) => ({ padding: '8px 16px', borderRadius: 8, border: bg === '#fff' ? '0.5px solid #d0d0d0' : 'none', background: bg, color: color || '#1a1a1a', fontSize: 13, cursor: 'pointer', fontWeight: bg === '#1a1a1a' ? 500 : 400 })
  const dateHdr = { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginTop: 24, marginBottom: 10, paddingBottom: 8, borderBottom: '0.5px solid #E8E4DE' }
  const badge = (bg, color) => ({ display: 'inline-block', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: bg, color })

  // Shared between the full staff dashboard and the vendor-limited dashboard
  function renderResourcesTab() {
    const visible = staffResources.filter(r => selectedEvent && (r.event_id === selectedEvent.id || r.is_global))
    if (visible.length === 0) {
      return (
        <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>
          No resources yet for this event.
        </div>
      )
    }
    const catCounts = {}
    visible.forEach(r => {
      const cat = r.category || 'All Events'
      catCounts[cat] = (catCounts[cat] || 0) + 1
    })
    const cats = Object.keys(catCounts)
    return (
      <div>
        {cats.map(cat => (
          <a
            key={cat}
            href={'/staff/resources/' + encodeURIComponent(cat)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit',
              padding: '16px 18px', marginBottom: 8, background: '#fff',
              border: '0.5px solid #E8E4DE', borderRadius: 8
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1a1a', flex: 1 }}>{cat}</span>
            <span style={{ fontSize: 12, color: '#8C8C8C' }}>{catCounts[cat]}</span>
            <span style={{ fontSize: 16, color: '#8C8C8C' }}>→</span>
          </a>
        ))}
      </div>
    )
  }

  // Instructor fallback view (read-only roster for vendor/workshop instructors)
  if (staffMember && staffRole === 'instructor') return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: '24px 16px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 4 }}>
            Snow Peak Way &middot; Instructor
          </div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{staffMember.name}</div>
          {staffMember.workshops && <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 2 }}>{staffMember.workshops.name}</div>}
        </div>
        <button onClick={signOut} style={btn('#fff')}>Sign out</button>
      </div>
      {instructorSessions.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No sessions scheduled.</div>
      ) : (
        instructorSessions.map(s => {
          const sessionRegs = registrations.filter(r => r.session_id === s.id)
          const totalGuests = sessionRegs.reduce((acc, r) => acc + (r.party_size || 1), 0)
          const isExpanded = expandedRosters[s.id]
          return (
            <div key={s.id} style={{ background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 18px', marginBottom: 10, borderLeft: '3px solid #2D4A2D' }}>
              <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 4 }}>
                {formatDate(s.date)} &middot; {formatTime(s.start_time)} – {formatTime(s.end_time)}
              </div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{s.workshops?.name || 'Workshop'}</div>
              {s.workshops?.location && <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 2 }}>📍 {s.workshops.location}</div>}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, color: '#555', flexGrow: 1 }}>{totalGuests} guest{totalGuests !== 1 ? 's' : ''} registered</span>
                <button onClick={() => setExpandedRosters(r => ({ ...r, [s.id]: !isExpanded }))}
                  style={{ padding: '4px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
                  {isExpanded ? 'Hide roster' : 'View roster'}
                </button>
              </div>
              {isExpanded && (
                <div style={{ marginTop: 8 }}>
                  {sessionRegs.length === 0
                    ? <div style={{ fontSize: 13, color: '#aaa' }}>No registrations yet.</div>
                    : sessionRegs.map(r => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#F7F6F4', borderRadius: 8, fontSize: 13, marginBottom: 4 }}>
                        <span>{r.guests?.name}</span>
                        {r.party_size > 1 && <span style={{ color: '#8C8C8C' }}>party of {r.party_size}</span>}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )

  // Vendor-limited dashboard (staff table row with is_vendor = true) —
  // only their own workshop sessions + roster, and Resources. No My
  // Schedule/All Staff/shifts/guest check-in controls.
  if (staffMember && staffRole === 'staff' && staffMember.is_vendor) {
    const vendorSessions = myFilteredAssignments.filter(a => a.sessions)
    const vendorGrouped = groupByDate(vendorSessions)
    const vendorDates = Object.keys(vendorGrouped).sort()

    return (
      <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: '24px 16px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 4 }}>
              Snow Peak Way &middot; Partner
            </div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{staffMember.vendor_name || staffMember.name}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => loadData(staffMember)} style={btn('#fff')}>↻ Refresh</button>
            <button onClick={signOut} style={btn('#fff')}>Sign out</button>
          </div>
        </div>

        {eventsWithAssignments.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
            {eventsWithAssignments.map(ev => (
              <button key={ev.id} onClick={() => selectEvent(ev)} style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                fontWeight: selectedEvent?.id === ev.id ? 500 : 400,
                border: '0.5px solid ' + (selectedEvent?.id === ev.id ? '#1a1a1a' : '#D0CAC4'),
                background: selectedEvent?.id === ev.id ? '#1a1a1a' : '#fff',
                color: selectedEvent?.id === ev.id ? '#fff' : '#555'
              }}>{ev.name}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', borderBottom: '0.5px solid #E0DEDA', marginBottom: 24 }}>
          {[['sessions', 'My Sessions'], ['resources', 'Resources']].map(([t, label]) => (
            <button key={t} onClick={() => setActiveTab(t)} style={{
              padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, color: activeTab === t ? '#1a1a1a' : '#8C8C8C',
              borderBottom: activeTab === t ? '2px solid #1a1a1a' : '2px solid transparent',
              marginBottom: -1, fontWeight: activeTab === t ? 500 : 400
            }}>{label}</button>
          ))}
        </div>

        {activeTab !== 'resources' && (
          <div>
            {vendorDates.length === 0 && (
              <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No sessions scheduled.</div>
            )}
            {vendorDates.map(date => (
              <div key={date}>
                <div style={dateHdr}>{formatDate(date)}</div>
                {vendorGrouped[date].map(a => {
                  const info = a._info
                  const sessionRegs = info.sessionId ? registrations.filter(r => r.session_id === info.sessionId) : []
                  const totalGuests = sessionRegs.reduce((s, r) => s + (r.party_size || 1), 0)
                  const isExpanded = expandedRosters[a.id]

                  return (
                    <div key={a.id} style={{ ...card, borderLeft: '3px solid ' + info.typeColor }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, color: '#8C8C8C', fontWeight: 500 }}>{info.time}</div>
                        <span style={badge(info.typeBg, info.typeColor)}>{info.type}</span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: info.location ? 4 : 0 }}>{info.title}</div>
                      {info.location && <div style={{ fontSize: 13, color: '#8C8C8C' }}>📍 {info.location}</div>}

                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#555', flexGrow: 1 }}>
                            {totalGuests}{info.capacity ? ' / ' + info.capacity : ''} registered
                          </span>
                          <button onClick={() => setExpandedRosters(r => ({ ...r, [a.id]: !isExpanded }))}
                            style={{ ...btn('#fff'), fontSize: 12, padding: '4px 12px' }}>
                            {isExpanded ? 'Hide roster' : 'View roster'}
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 10 }}>
                            {sessionRegs.length === 0
                              ? <div style={{ fontSize: 13, color: '#aaa' }}>No registrations yet.</div>
                              : sessionRegs.map(r => (
                                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#F7F6F4', borderRadius: 8, fontSize: 13, marginBottom: 4 }}>
                                  <span>{r.guests?.name}</span>
                                  {r.party_size > 1 && <span style={{ color: '#8C8C8C' }}>party of {r.party_size}</span>}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'resources' && renderResourcesTab()}
      </div>
    )
  }

  if (checkingStoredPin) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', background: '#FAFAF8' }} />
  )

  if (!staffMember) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', background: '#FAFAF8', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 320, width: '100%' }}>
        <img src="/spw-logo.png" alt="Snow Peak Way" style={{ width: 120, display: 'block', margin: '0 auto 40px' }} />
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 16 }}>
          Snow Peak Way &middot; Staff
        </div>
        <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 28 }}>Enter your email to access your schedule</div>
        <form onSubmit={e => { e.preventDefault(); !loading && checkLogin() }}>
          <input
            type="text" placeholder="Email or access code" value={loginInput}
            onChange={e => { setLoginInput(e.target.value); setLoginError('') }}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', padding: 12,
              borderRadius: 8, border: '0.5px solid #E8E4DE', background: '#fff',
              fontSize: 15, color: '#1a1a1a', marginBottom: 16, fontFamily: 'inherit'
            }}
          />
          {loginError && <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'left', marginBottom: 16, lineHeight: 1.5 }}>{loginError}</div>}
          <button
            type="submit"
            disabled={loading || !loginInput.trim()}
            style={{
              width: '100%', padding: 12, borderRadius: 8, border: 'none',
              background: '#1a1a1a', color: '#fff', fontSize: 15, fontWeight: 500,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading || !loginInput.trim() ? 0.6 : 1
            }}
          >
            {loading ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', padding: '24px 16px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 4 }}>
            Snow Peak Way &middot; Staff
          </div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{staffMember.name}</div>
          {staffMember.role && <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 2 }}>{staffMember.role}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => loadData(staffMember)} style={btn('#fff')}>↻ Refresh</button>
          <button onClick={signOut} style={btn('#fff')}>Sign out</button>
        </div>
      </div>

      {/* Admin-capable staff can jump straight into /admin — already authenticated via localStorage */}
      {(staffMember.is_admin || staffMember.is_super_admin) && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, border: '0.5px solid #1a1a1a', borderRadius: 8, width: 'fit-content', overflow: 'hidden' }}>
          <button disabled style={{ padding: '6px 16px', border: 'none', background: '#1a1a1a', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'default' }}>
            Staff View
          </button>
          <a href="/admin" style={{ padding: '6px 16px', background: '#fff', color: '#1a1a1a', fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
            Admin View
          </a>
        </div>
      )}

      {/* Event tabs — top-level, only when assigned to multiple events */}
      {eventsWithAssignments.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {eventsWithAssignments.map(ev => (
            <button key={ev.id} onClick={() => selectEvent(ev)} style={{
              padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              fontWeight: selectedEvent?.id === ev.id ? 500 : 400,
              border: '0.5px solid ' + (selectedEvent?.id === ev.id ? '#1a1a1a' : '#D0CAC4'),
              background: selectedEvent?.id === ev.id ? '#1a1a1a' : '#fff',
              color: selectedEvent?.id === ev.id ? '#fff' : '#555'
            }}>{ev.name}</button>
          ))}
        </div>
      )}

      {/* Sub-tabs: My Schedule / All Staff / Resources */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid #E0DEDA', marginBottom: 24 }}>
        {[['schedule', 'My Schedule'], ['all', 'All Staff'], ['resources', 'Resources']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, color: activeTab === t ? '#1a1a1a' : '#8C8C8C',
            borderBottom: activeTab === t ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -1, fontWeight: activeTab === t ? 500 : 400
          }}>{label}</button>
        ))}
      </div>

      {/* MY SCHEDULE */}
      {activeTab === 'schedule' && (
        <div>
          {myDates.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No assignments yet.</div>
          )}
          {myDates.map(date => (
            <div key={date}>
              <div style={dateHdr}>{formatDate(date)}</div>
              {myGrouped[date].map(a => {
                const info = a._info
                const sessionRegs = info.sessionId ? registrations.filter(r => r.session_id === info.sessionId) : []
                const totalGuests = sessionRegs.reduce((s, r) => s + (r.party_size || 1), 0)
                const isExpanded = expandedRosters[a.id]
                const lookupOpen = activeGuestLookup === a.id

                return (
                  <div key={a.id} style={{
                    ...card,
                    background: info.isStaffOnly ? '#F5F4F1' : '#fff',
                    borderLeft: '3px solid ' + (info.isStaffOnly ? '#C8C4BC' : info.typeColor)
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, color: '#8C8C8C', fontWeight: 500 }}>{info.time}</div>
                      <span style={badge(info.isStaffOnly ? '#E8E4DE' : info.typeBg, info.isStaffOnly ? '#888' : info.typeColor)}>
                        {info.type}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: info.location ? 4 : 0 }}>{info.title}</div>
                    {info.location && <div style={{ fontSize: 13, color: '#8C8C8C' }}>📍 {info.location}</div>}

                    {info.activityNotes && (
                      <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #F0EDE8', lineHeight: 1.55, fontStyle: 'italic' }}>
                        {info.activityNotes}
                      </div>
                    )}

                    {/* Workshop: roster + guest lookup */}
                    {info.sessionId && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#555', flexGrow: 1 }}>
                            {totalGuests}{info.capacity ? ' / ' + info.capacity : ''} registered
                          </span>
                          <button onClick={() => setExpandedRosters(r => ({ ...r, [a.id]: !isExpanded }))}
                            style={{ ...btn('#fff'), fontSize: 12, padding: '4px 12px' }}>
                            {isExpanded ? 'Hide roster' : 'View roster'}
                          </button>
                          <button onClick={() => toggleLookup(a.id)}
                            style={{ ...btn(lookupOpen ? '#1a1a1a' : '#fff', lookupOpen ? '#fff' : '#1a1a1a'), fontSize: 12, padding: '4px 12px' }}>
                            Guest Lookup
                          </button>
                        </div>
                        {isExpanded && (
                          <div style={{ marginTop: 10 }}>
                            {sessionRegs.length === 0
                              ? <div style={{ fontSize: 13, color: '#aaa' }}>No registrations yet.</div>
                              : sessionRegs.map(r => (
                                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#F7F6F4', borderRadius: 8, fontSize: 13, marginBottom: 4 }}>
                                  <span>{r.guests?.name}</span>
                                  {r.party_size > 1 && <span style={{ color: '#8C8C8C' }}>party of {r.party_size}</span>}
                                </div>
                              ))}
                          </div>
                        )}
                        {renderGuestLookup(a.id)}
                      </div>
                    )}

                    {/* Open moment: guest lookup only */}
                    {info.momentId && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8' }}>
                        <button onClick={() => toggleLookup(a.id)}
                          style={{ ...btn(lookupOpen ? '#1a1a1a' : '#fff', lookupOpen ? '#fff' : '#1a1a1a'), fontSize: 12, padding: '4px 12px' }}>
                          Guest Lookup
                        </button>
                        {renderGuestLookup(a.id)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* ALL STAFF */}
      {activeTab === 'all' && (
        <div>
          {allDates.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No schedule items for this event.</div>
          )}

          {allDates.map(date => (
            <div key={date}>
              <div style={dateHdr}>{formatDate(date)}</div>
              {allByDate[date]
                .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
                .map(item => (
                  <div key={item.key} style={{
                    ...card,
                    background: item.isStaffOnly ? '#F5F4F1' : '#fff',
                    borderLeft: '3px solid ' + (item.isStaffOnly ? '#C8C4BC' : item.typeColor)
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, color: '#8C8C8C' }}>{item.time}</div>
                      <span style={badge(item.isStaffOnly ? '#E8E4DE' : item.typeBg, item.isStaffOnly ? '#888' : item.typeColor)}>
                        {item.type}
                      </span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: item.location ? 4 : 6 }}>{item.title}</div>
                    {item.location && <div style={{ fontSize: 13, color: '#8C8C8C', marginBottom: 8 }}>📍 {item.location}</div>}
                    {item.staff.length === 0 ? (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#FFF8E8', color: '#A06000', border: '0.5px solid #F0D880' }}>
                        Unassigned
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {item.staff.map((name, i) => (
                          <span key={i} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 12, background: '#F0EDE8', color: '#555' }}>{name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* RESOURCES — category list, each tapping through to its own page */}
      {activeTab === 'resources' && renderResourcesTab()}
    </div>
  )
}
