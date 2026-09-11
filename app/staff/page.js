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
  const [allSessions, setAllSessions] = useState([])
  const [allMoments, setAllMoments] = useState([])
  const [allShifts, setAllShifts] = useState([])
  const [allStaffAssignments, setAllStaffAssignments] = useState([])
  const [allWorkshopAssns, setAllWorkshopAssns] = useState([])
  const [myWorkshopAssns, setMyWorkshopAssns] = useState([]) // this account's own workshop-wide (vendor) coverage
  const [staffResources, setStaffResources] = useState([])
  const [eventInfoSections, setEventInfoSections] = useState([])
  const [eventPartners, setEventPartners] = useState([])
  const [gearItems, setGearItems] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [guestEvents, setGuestEvents] = useState([])
  const [guests, setGuests] = useState([]) // Check-In tab only (Guest Services staff)
  const [checkinSearch, setCheckinSearch] = useState('')
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [eventsWithAssignments, setEventsWithAssignments] = useState([])

  const [staffRole, setStaffRole] = useState(null) // 'staff' | 'instructor'
  const [instructorSessions, setInstructorSessions] = useState([])

  const [expandedRosters, setExpandedRosters] = useState({})
  const [activeGuestLookup, setActiveGuestLookup] = useState(null)
  const [guestQuery, setGuestQuery] = useState('')
  const [guestResults, setGuestResults] = useState([])

  // My Agenda tab — day filter
  const [agendaDayFilter, setAgendaDayFilter] = useState('all')

  // Public Schedule tab (read-only reference view of the full guest schedule)
  const [pubDayFilter, setPubDayFilter] = useState('all')
  const [pubTypeFilter, setPubTypeFilter] = useState('all')
  const [scheduleViewMode, setScheduleViewMode] = useState('public') // 'public' | 'staff' — staff-only toggle
  const [pubExpandedSessionId, setPubExpandedSessionId] = useState(null)
  const [expandedPublicRosters, setExpandedPublicRosters] = useState({})

  // Guide tab — which info section (by id) is currently expanded
  const [guideSection, setGuideSection] = useState(null)
  const [mapFullscreen, setMapFullscreen] = useState(false)

  // Schedule tab, staff mode — which item keys have their notes expanded
  const [expandedNotes, setExpandedNotes] = useState({})

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
      if (record.is_checkin) setActiveTab('checkin')
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
      if (staffData.is_checkin) setActiveTab('checkin')
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
      { data: regs },
      { data: evts },
      { data: ge },
      { data: sess },
      { data: mom },
      { data: seaData },
      { data: res },
      { data: swa },
      { data: infoSections },
      { data: partners },
      { data: gear },
      { data: shifts },
      { data: allSA },
      { data: allWA },
      { data: guestsData }
    ] = await Promise.all([
      supabase.from('staff_assignments')
        .select('id, staff_id, session_id, moment_id, shift_id, sessions(id, date, start_time, end_time, capacity, event_id, workshops(name, location)), open_moments(id, name, date, start_time, end_time, location, moment_type, event_id), staff_shifts(id, title, shift_date, start_time, end_time, location, shift_type, description, event_id)')
        .eq('staff_id', staffRecord.id),
      supabase.from('registrations').select('*, guests(id, name)').eq('status', 'confirmed'),
      supabase.from('events').select('*').order('start_date'),
      supabase.from('guest_events').select('*, guests(id, name)'),
      supabase.from('sessions').select('*, workshops(name, location, instructor, description)').order('date').order('start_time'),
      supabase.from('open_moments').select('*').order('date').order('start_time'),
      supabase.from('staff_event_assignments').select('*, events(*)').eq('staff_id', staffRecord.id),
      supabase.from('staff_resources').select('*').order('sort_order'),
      supabase.from('staff_workshop_assignments').select('*').eq('staff_id', staffRecord.id),
      supabase.from('event_info_sections').select('*').order('sort_order'),
      supabase.from('event_partners').select('*').order('sort_order'),
      supabase.from('gear_items').select('*').order('sort_order'),
      supabase.from('staff_shifts').select('*').order('shift_date').order('start_time'),
      supabase.from('staff_assignments')
        .select('id, staff_id, session_id, moment_id, shift_id, staff(id, name, is_vendor)')
        .not('staff_id', 'is', null),
      supabase.from('staff_workshop_assignments').select('id, staff_id, workshop_id, staff(id, name, is_vendor)'),
      supabase.from('guests').select('*, ticket_types(*)').order('name')
    ])
    console.log('[loadData] staffRecord.id:', staffRecord.id)
    console.log('[loadData] myA count:', myA?.length ?? 'null', 'error:', myAError ? JSON.stringify(myAError) : null)
    if (myA?.length) console.log('[loadData] myA[0]:', JSON.stringify(myA[0]))
    setMyAssignments(myA || [])
    setRegistrations(regs || [])
    setEvents(evts || [])
    setGuestEvents(ge || [])
    setAllSessions(sess || [])
    setAllMoments(mom || [])
    setStaffResources(res || [])
    setEventInfoSections(infoSections || [])
    setEventPartners(partners || [])
    setGearItems(gear || [])
    setAllShifts(shifts || [])
    setAllStaffAssignments(allSA || [])
    setAllWorkshopAssns(allWA || [])
    setMyWorkshopAssns(swa || [])
    setGuests(guestsData || [])
    // Union: staff_event_assignments + events derived from actual assignments
    const seaEvts = (seaData || []).map(sea => sea.events).filter(Boolean)
    const seaEventIds = new Set(seaEvts.map(e => e.id))
    const assignmentEventIds = new Set((myA || []).map(a =>
      a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
    ).filter(Boolean))
    // Vendor workshop-wide assignments also count toward "events with assignments",
    // even when the vendor has no direct staff_assignments/staff_event_assignments row.
    const workshopIdsForEvents = (swa || []).map(a => a.workshop_id)
    for (const s of (sess || [])) {
      if (workshopIdsForEvents.includes(s.workshop_id) && s.event_id) assignmentEventIds.add(s.event_id)
    }
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

  // Check-In tab (Guest Services staff) — mirrors admin's Check-In tab exactly.
  async function updateGuestCheckinStatus(guestId, status) {
    if (!selectedEvent) return
    const { error } = await supabase
      .from('guest_events')
      .update({ checkin_status: status })
      .eq('guest_id', guestId)
      .eq('event_id', selectedEvent.id)
    if (!error) {
      setGuestEvents(ge => ge.map(e =>
        e.guest_id === guestId && e.event_id === selectedEvent.id
          ? { ...e, checkin_status: status }
          : e
      ))
    }
  }

  async function updateGuestWaiverSigned(guestId, signed) {
    const { error } = await supabase
      .from('guests')
      .update({ waiver_signed: signed })
      .eq('id', guestId)
    if (!error) {
      setGuests(gs => gs.map(g => g.id === guestId ? { ...g, waiver_signed: signed } : g))
    }
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

  // Filter this staff member's own assignments to the selected event. Regular
  // staff mainly get shift assignments (session/moment duty is referenced via
  // the Schedule tab's Staff View instead), but vendors need their own
  // sessions surfaced too — direct assignments plus workshop-wide blanket
  // coverage from staff_workshop_assignments — since that's how most vendor
  // coverage is actually granted. Shifts stay included for everyone: a vendor
  // occasionally does get one, and it shouldn't disappear from their agenda.
  const myFilteredAssignments = selectedEvent
    ? myAssignments.filter(a => {
        const eid = a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
        return eid === selectedEvent.id
      })
    : myAssignments
  const myIsVendor = !!staffMember?.is_vendor
  const myShiftAssignments = myFilteredAssignments.filter(a => a.staff_shifts)
  const myAgendaAssignments = myIsVendor
    ? (() => {
        const directSessions = myFilteredAssignments.filter(a => a.sessions)
        const directSessionIds = new Set(directSessions.map(a => a.session_id))
        const workshopIds = myWorkshopAssns.map(a => a.workshop_id)
        const workshopWideSessions = allSessions
          .filter(s => workshopIds.includes(s.workshop_id) && (!selectedEvent || s.event_id === selectedEvent.id) && !directSessionIds.has(s.id))
          .map(s => ({ id: 'wa_' + s.id, staff_id: staffMember?.id, session_id: s.id, moment_id: null, shift_id: null, sessions: s, open_moments: null, staff_shifts: null }))
        return [...directSessions, ...workshopWideSessions, ...myShiftAssignments]
      })()
    : myShiftAssignments
  const myGrouped = groupByDate(myAgendaAssignments)
  const myDates = Object.keys(myGrouped).sort()

  const card = { background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 18px', marginBottom: 10 }
  const inp = { width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', boxSizing: 'border-box' }
  const btn = (bg, color) => ({ padding: '8px 16px', borderRadius: 8, border: bg === '#fff' ? '0.5px solid #d0d0d0' : 'none', background: bg, color: color || '#1a1a1a', fontSize: 13, cursor: 'pointer', fontWeight: bg === '#1a1a1a' ? 500 : 400 })
  const dateHdr = { fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginTop: 24, marginBottom: 10, paddingBottom: 8, borderBottom: '0.5px solid #E8E4DE' }
  const badge = (bg, color) => ({ display: 'inline-block', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: bg, color })

  function renderResourcesTab() {
    const visible = staffResources.filter(r =>
      selectedEvent && (r.event_id === selectedEvent.id || r.is_global) &&
      !(staffMember?.is_vendor && r.hidden_from_vendors)
    )
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

  // Read-only reference view of the full public schedule for the selected event —
  // same visual layout as the guest Schedule tab (day/type pills, workshop cards
  // with time-slot pills, open moment cards), but with guest count/roster in place
  // of reserve controls, and no party size or credits UI.
  function renderPublicScheduleTab() {
    if (!selectedEvent) {
      return <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>Select an event to view its schedule.</div>
    }
    const eid = selectedEvent.id
    const isStaffMode = !isVendor && scheduleViewMode === 'staff'
    const eventSessions = allSessions.filter(s => s.event_id === eid)
    const eventMoments = allMoments.filter(m => m.event_id === eid && m.moment_type !== 'amenity')
    const eventShifts = isStaffMode ? allShifts.filter(s => s.event_id === eid) : []
    const pubAllDates = [...new Set([
      ...eventSessions.map(s => s.date),
      ...eventMoments.map(m => m.date),
      ...eventShifts.map(s => s.shift_date)
    ].filter(Boolean))].sort()
    const datesToShow = pubDayFilter === 'all' ? pubAllDates : [pubDayFilter]
    const showWorkshops = pubTypeFilter === 'all' || pubTypeFilter === 'workshops'
    const showMoments = pubTypeFilter === 'all' || pubTypeFilter === 'moments'
    const showShifts = isStaffMode && (pubTypeFilter === 'all' || pubTypeFilter === 'shifts')

    // Looks up who's assigned to one session/moment/shift (plus workshop-wide
    // vendor coverage for sessions) — only ever called in staff mode.
    const getAssignedStaff = (matchFn, workshopId) => {
      const direct = allStaffAssignments.filter(matchFn).map(a => a.staff).filter(Boolean)
      const workshopWide = workshopId ? allWorkshopAssns.filter(a => a.workshop_id === workshopId).map(a => a.staff).filter(Boolean) : []
      return [...direct, ...workshopWide]
    }

    // Staff-mode-only block appended to a card: who's assigned + an
    // expandable staff notes field. Renders nothing in public mode.
    const renderStaffModeExtras = (staffList, notes, noteKey) => {
      if (!isStaffMode) return null
      const notesOpen = !!expandedNotes[noteKey]
      return (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 6 }}>Assigned Staff</div>
          {staffList.length === 0 ? (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: '#FFF8E8', color: '#A06000', border: '0.5px solid #F0D880' }}>
              Unassigned
            </span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {staffList.map((sm, i) => (
                <span key={sm.id + '_' + i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 12, background: '#F0EDE8', color: '#555' }}>
                  {sm.name}
                  {sm.is_vendor && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.75 }}>Partner</span>}
                </span>
              ))}
            </div>
          )}
          {notes && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setExpandedNotes(n => ({ ...n, [noteKey]: !notesOpen }))}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8C8C8C', fontSize: 12, padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                Notes {notesOpen ? '▾' : '▸'}
              </button>
              {notesOpen && (
                <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 8, lineHeight: 1.55, fontStyle: 'italic', whiteSpace: 'pre-line' }}>
                  {notes}
                </div>
              )}
            </div>
          )}
        </div>
      )
    }

    const renderSessionExpansion = session => {
      const sessionRegs = registrations.filter(r => r.session_id === session.id)
      const totalGuests = sessionRegs.reduce((s, r) => s + (r.party_size || 1), 0)
      const rosterOpen = !!expandedPublicRosters[session.id]
      const lookupOpen = activeGuestLookup === session.id
      return (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E8E4DE' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 }}>
            {formatTime(session.start_time)} – {formatTime(session.end_time)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#555', flex: 1 }}>
              {totalGuests}{session.capacity != null ? ' / ' + session.capacity : ''} registered
            </div>
            <button onClick={() => setExpandedPublicRosters(r => ({ ...r, [session.id]: !rosterOpen }))}
              style={{ ...btn('#fff'), fontSize: 12, padding: '4px 12px' }}>
              {rosterOpen ? 'Hide roster' : 'View roster'}
            </button>
            <button onClick={() => toggleLookup(session.id)}
              style={{ ...btn(lookupOpen ? '#1a1a1a' : '#fff', lookupOpen ? '#fff' : '#1a1a1a'), fontSize: 12, padding: '4px 12px' }}>
              Guest Lookup
            </button>
          </div>
          {rosterOpen && (
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
          {renderGuestLookup(session.id)}
          {renderStaffModeExtras(getAssignedStaff(a => a.session_id === session.id, session.workshop_id), session.staff_notes, 'session_' + session.id)}
        </div>
      )
    }

    const renderTimeSlotPill = session => {
      const sessionRegs = registrations.filter(r => r.session_id === session.id)
      const totalGuests = sessionRegs.reduce((s, r) => s + (r.party_size || 1), 0)
      const isFull = session.capacity != null && totalGuests >= session.capacity
      const isExpanded = pubExpandedSessionId === session.id
      return (
        <button key={session.id} onClick={() => setPubExpandedSessionId(isExpanded ? null : session.id)} style={{
          padding: '8px 14px', borderRadius: 20, cursor: 'pointer',
          fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
          background: isFull ? '#F0EDEA' : '#fff',
          border: '0.5px solid ' + (isFull ? '#E8E4DE' : '#1a1a1a'),
          color: isFull ? '#8C8C8C' : '#1a1a1a',
          outline: isExpanded ? '2px solid #1a1a1a' : 'none', outlineOffset: 1
        }}>
          {formatTime(session.start_time)} – {formatTime(session.end_time)}
          {' · ' + totalGuests + (session.capacity != null ? '/' + session.capacity : '')}
        </button>
      )
    }

    const renderWorkshopCard = group => {
      const workshop = group.workshop
      const expandedSession = group.sessions.find(s => s.id === pubExpandedSessionId)
      return (
        <div key={group.workshopId} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ marginBottom: 5 }}>
            <span style={badge('#EEF3EE', '#2D4A2D')}>Workshop</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{workshop?.name}</div>
          <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
            {workshop?.instructor || ''}{workshop?.instructor && workshop?.location ? ' · ' : ''}{workshop?.location ? '📍 ' + workshop.location : ''}
          </div>
          {workshop?.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 6, lineHeight: 1.5 }}>{workshop.description}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {group.sessions.map(renderTimeSlotPill)}
          </div>
          {expandedSession && renderSessionExpansion(expandedSession)}
        </div>
      )
    }

    const renderMomentCard = (m, isMandatory) => {
      const lookupOpen = activeGuestLookup === m.id
      return (
        <div key={m.id} style={{
          background: isMandatory ? '#F5F0E8' : '#fff', borderRadius: 4, padding: '14px 16px', marginBottom: 10,
          border: '0.5px solid ' + (isMandatory ? '#E8D8BC' : '#E8E4DE'),
          borderLeft: '3px solid ' + (isMandatory ? '#C4A882' : '#B5622A')
        }}>
          <div style={{ marginBottom: 5 }}>
            <span style={badge(isMandatory ? '#C4A882' : '#F5E4CC', '#5C3D1E')}>
              {isMandatory ? 'All Campers' : 'Drop-in'}
            </span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{m.name}</div>
          <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
            {formatTime(m.start_time)}{m.end_time ? ' – ' + formatTime(m.end_time) : ''}
            {m.location ? ' · 📍 ' + m.location : ''}
          </div>
          {m.description && <div style={{ fontSize: 11, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid ' + (isMandatory ? '#E8D8BC' : '#F0EDE8') }}>
            <button onClick={() => toggleLookup(m.id)}
              style={{ ...btn(lookupOpen ? '#1a1a1a' : '#fff', lookupOpen ? '#fff' : '#1a1a1a'), fontSize: 12, padding: '4px 12px' }}>
              Guest Lookup
            </button>
            {renderGuestLookup(m.id)}
          </div>
          {renderStaffModeExtras(getAssignedStaff(a => a.moment_id === m.id), m.staff_notes, 'moment_' + m.id)}
        </div>
      )
    }

    const renderShiftCard = s => (
      <div key={s.id} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', borderLeft: '3px solid #666', padding: '14px 16px', marginBottom: 10 }}>
        <div style={{ marginBottom: 5 }}>
          <span style={badge('#EFEDEA', '#666')}>Back of House</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: '#1a1a1a' }}>{s.title}</div>
        <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 3 }}>
          {formatTime(s.start_time)} – {formatTime(s.end_time)}
          {s.location ? ' · 📍 ' + s.location : ''}
        </div>
        {renderStaffModeExtras(getAssignedStaff(a => a.shift_id === s.id), s.description, 'shift_' + s.id)}
      </div>
    )

    const renderDay = date => {
      const daySessions = eventSessions.filter(s => s.date === date)
      const dayMoments = eventMoments.filter(m => m.date === date)
      const dayShifts = showShifts ? eventShifts.filter(s => s.shift_date === date) : []
      const workshopGroups = {}
      if (showWorkshops) {
        daySessions.forEach(s => {
          if (!workshopGroups[s.workshop_id]) workshopGroups[s.workshop_id] = { workshopId: s.workshop_id, workshop: s.workshops, sessions: [] }
          workshopGroups[s.workshop_id].sessions.push(s)
        })
        Object.values(workshopGroups).forEach(g => g.sessions.sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')))
      }
      const dayItems = [
        ...(showWorkshops ? Object.values(workshopGroups).map(g => ({ type: 'workshop', group: g, time: g.sessions[0]?.start_time || '' })) : []),
        ...(showMoments ? dayMoments.map(m => ({ type: m.moment_type === 'mandatory' ? 'mandatory' : 'optional', data: m, time: m.start_time || '' })) : []),
        ...dayShifts.map(s => ({ type: 'shift', data: s, time: s.start_time || '' }))
      ].sort((a, b) => (a.time || '').localeCompare(b.time || ''))

      if (dayItems.length === 0) return null

      return (
        <div key={date}>
          <div style={dateHdr}>{formatDate(date)}</div>
          {dayItems.map(item =>
            item.type === 'workshop' ? renderWorkshopCard(item.group) :
            item.type === 'shift' ? renderShiftCard(item.data) :
            renderMomentCard(item.data, item.type === 'mandatory'))}
        </div>
      )
    }

    const dayNodes = datesToShow.map(renderDay)
    const isEmpty = dayNodes.every(n => n === null)

    return (
      <div>
        {!isVendor && (
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, border: '0.5px solid #1a1a1a', borderRadius: 8, width: 'fit-content', overflow: 'hidden' }}>
            {[['public', 'Public View'], ['staff', 'Staff View']].map(([v, label]) => (
              <button key={v} onClick={() => {
                setScheduleViewMode(v)
                if (v === 'public' && pubTypeFilter === 'shifts') setPubTypeFilter('all')
              }} style={{
                padding: '6px 16px', border: 'none', fontSize: 13, cursor: 'pointer',
                background: scheduleViewMode === v ? '#1a1a1a' : '#fff',
                color: scheduleViewMode === v ? '#fff' : '#1a1a1a',
                fontWeight: scheduleViewMode === v ? 500 : 400
              }}>{label}</button>
            ))}
          </div>
        )}

        {pubAllDates.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {['all', ...pubAllDates].map(d => {
              const active = pubDayFilter === d
              return (
                <button key={d} onClick={() => setPubDayFilter(d)} style={{
                  padding: '5px 14px', borderRadius: 20,
                  border: '0.5px solid ' + (active ? '#1a1a1a' : '#E8E4DE'),
                  background: active ? '#1a1a1a' : '#fff',
                  color: active ? '#fff' : '#8C8C8C',
                  fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
                }}>
                  {d === 'all' ? 'All' : new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                </button>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          {[['all', 'All'], ['workshops', 'Workshops'], ['moments', 'Open Moments'], ...(isStaffMode ? [['shifts', 'Back of House']] : [])].map(([key, label]) => {
            const active = pubTypeFilter === key
            return (
              <button key={key} onClick={() => setPubTypeFilter(key)} style={{
                padding: '5px 14px', borderRadius: 20,
                border: '0.5px solid ' + (active ? '#1a1a1a' : '#E8E4DE'),
                background: active ? '#1a1a1a' : '#fff',
                color: active ? '#fff' : '#8C8C8C',
                fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
              }}>{label}</button>
            )
          })}
        </div>

        {isEmpty ? (
          <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>
            No {pubTypeFilter === 'moments' ? 'open moments' : pubTypeFilter === 'workshops' ? 'workshops' : 'schedule items'} for this selection.
          </div>
        ) : dayNodes}
      </div>
    )
  }

  // Guide tab — four collapsible sections (Site / Info / Packing List / Resources),
  // one open at a time, replacing the standalone Resources tab.
  // Site tab — map, amenities, and partners for the selected event (same
  // content the guest Site tab shows).
  function renderSiteTab() {
    const eid = selectedEvent?.id
    const amenityMoments = allMoments.filter(m => m.event_id === eid && m.moment_type === 'amenity')
    const partnersForEvent = eventPartners.filter(p => p.event_id === eid).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return (
      <div>
        {selectedEvent?.map_image_url && (
          <div style={{ marginBottom: 28 }}>
            <div style={dateHdr}>Site Map</div>
            <img
              src={selectedEvent.map_image_url}
              alt="Event map"
              onClick={() => setMapFullscreen(true)}
              style={{ width: '100%', borderRadius: 4, display: 'block', border: '0.5px solid #E8E4DE', cursor: 'zoom-in' }}
            />
          </div>
        )}
        {amenityMoments.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <div style={dateHdr}>Amenities &amp; Hours</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {amenityMoments.map(m => (
                <div key={m.id} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{m.name}</div>
                  {m.location && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>{m.location}</div>}
                  {m.hours_text && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2 }}>{m.hours_text}</div>}
                  {m.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{m.description}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {partnersForEvent.length > 0 && (
          <div>
            <div style={dateHdr}>Partners</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {partnersForEvent.map(p => (
                <div key={p.id} style={{ background: '#fff', borderRadius: 4, border: '0.5px solid #E8E4DE', padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 4, lineHeight: 1.5 }}>{p.description}</div>}
                  {p.website_url && (
                    <a href={p.website_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#2D4A2D', fontWeight: 600, textDecoration: 'none', marginTop: 6, display: 'inline-block' }}>
                      Visit →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {!selectedEvent?.map_image_url && amenityMoments.length === 0 && partnersForEvent.length === 0 && (
          <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>Nothing to show here yet for this event.</div>
        )}
        {mapFullscreen && selectedEvent?.map_image_url && (
          <div
            onClick={() => setMapFullscreen(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}
          >
            <img src={selectedEvent.map_image_url} alt="Event map" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
        )}
      </div>
    )
  }

  // Guide tab — checkin/checkout callouts + collapsible info sections (one
  // open at a time). Partners live on the Site tab, Packing List and
  // Resources are their own top-level tabs now.
  function renderGuideTab() {
    const eid = selectedEvent?.id
    const infoForEvent = eventInfoSections.filter(s => s.event_id === eid).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    return (
      <div>
        {(selectedEvent?.checkin_time || selectedEvent?.checkout_time) && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            {selectedEvent?.checkin_time && (
              <div style={{ flex: '1 1 150px', minWidth: 140, background: '#F5F0E8', border: '0.5px solid #E8E4DE', borderRadius: 6, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 6 }}>Check-in</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{selectedEvent.checkin_time}</div>
              </div>
            )}
            {selectedEvent?.checkout_time && (
              <div style={{ flex: '1 1 150px', minWidth: 140, background: '#F5F0E8', border: '0.5px solid #E8E4DE', borderRadius: 6, padding: '16px 18px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 6 }}>Check-out</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{selectedEvent.checkout_time}</div>
              </div>
            )}
          </div>
        )}
        {infoForEvent.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No information available for this event yet.</div>
        ) : (
          infoForEvent.map(s => {
            const open = guideSection === s.id
            return (
              <div key={s.id}>
                <button
                  onClick={() => setGuideSection(open ? null : s.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 0', background: 'none', border: 'none',
                    borderBottom: '0.5px solid #E8E4DE', cursor: 'pointer', textAlign: 'left', font: 'inherit'
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#1a1a1a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{s.title}</span>
                  <span style={{ fontSize: 13, color: '#8C8C8C', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
                </button>
                <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.25s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ padding: '14px 0 18px', fontSize: 14, lineHeight: 1.7, color: '#1a1a1a', whiteSpace: 'pre-wrap' }}>
                      {s.content}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* Staff Resources — always-open section (not another accordion toggle) with the category buttons right below the header */}
        <div style={dateHdr}>Staff Resources</div>
        {renderResourcesTab()}
      </div>
    )
  }

  // Packing List tab — read only, no checkboxes; excludes guests-only items,
  // flags staff-only ones (both/staff visibility both show, matching the
  // guest side's own guests/both split).
  function renderPackingListTab() {
    const eid = selectedEvent?.id
    const gearForEvent = gearItems.filter(g => g.event_id === eid && g.visibility !== 'guests')
    const gearCats = [...new Set(gearForEvent.map(g => g.category))].sort()
    if (gearForEvent.length === 0) {
      return <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>No packing list for this event yet.</div>
    }
    return (
      <div>
        {gearCats.map(cat => (
          <div key={cat}>
            <div style={dateHdr}>{cat}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {gearForEvent.filter(g => g.category === cat).map(item => (
                <div key={item.id} style={{ padding: '10px 14px', background: '#fff', border: '0.5px solid #E8E4DE', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a' }}>{item.name}</div>
                    {item.visibility === 'staff' && <span style={badge('#F5F0E8', '#A06000')}>Staff</span>}
                  </div>
                  {item.description && <div style={{ fontSize: 12, color: '#8C8C8C', marginTop: 2, lineHeight: 1.4 }}>{item.description}</div>}
                  {(item.link_1_url || item.link_2_url) && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {item.link_1_url && (
                        <a href={item.link_1_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, border: '0.5px solid #1a1a1a', background: '#fff', color: '#1a1a1a', textDecoration: 'none', fontWeight: 600 }}>
                          {item.link_1_label || 'Learn more'}
                        </a>
                      )}
                      {item.link_2_url && (
                        <a href={item.link_2_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, padding: '4px 10px', borderRadius: 20, border: '0.5px solid #1a1a1a', background: '#fff', color: '#1a1a1a', textDecoration: 'none', fontWeight: 600 }}>
                          {item.link_2_label || 'Learn more'}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Check-In tab — Guest Services staff only. Mirrors the admin Check-In tab
  // exactly (same data, same layout, same status buttons and waiver toggle).
  function renderCheckInTab() {
    if (!selectedEvent) {
      return <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>Select an event to view check-in.</div>
    }

    const eventGEs = guestEvents.filter(ge => ge.event_id === selectedEvent.id)
    const allCheckinGuests = eventGEs.map(ge => ({
      ge,
      guest: guests.find(g => g.id === ge.guest_id)
    })).filter(x => x.guest)

    const search = checkinSearch.toLowerCase()
    const filtered = allCheckinGuests.filter(x =>
      !search ||
      x.guest.name.toLowerCase().includes(search) ||
      x.guest.email.toLowerCase().includes(search)
    )

    const sortOrder = { checked_in: 0, not_arrived: 1, departed: 2 }
    filtered.sort((a, b) => {
      const aS = a.ge.checkin_status || 'not_arrived'
      const bS = b.ge.checkin_status || 'not_arrived'
      const aO = sortOrder[aS] ?? 1
      const bO = sortOrder[bS] ?? 1
      if (aO !== bO) return aO - bO
      return a.guest.name.localeCompare(b.guest.name)
    })

    const total = eventGEs.length
    const checkedIn = eventGEs.filter(ge => ge.checkin_status === 'checked_in').length
    const departed = eventGEs.filter(ge => ge.checkin_status === 'departed').length
    const notArrived = eventGEs.filter(ge => !ge.checkin_status || ge.checkin_status === 'not_arrived').length

    const statusLabels = { not_arrived: 'Not Arrived', checked_in: 'Checked In', departed: 'Departed' }
    const activeColors = {
      not_arrived: { bg: '#e0e0e0', color: '#444', border: '#c0c0c0' },
      checked_in: { bg: '#1a7a4a', color: '#fff', border: '#1a7a4a' },
      departed: { bg: '#2060b0', color: '#fff', border: '#2060b0' }
    }

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
          {[
            { label: 'Total', value: total, color: '#1a1a1a' },
            { label: 'Checked In', value: checkedIn, color: '#1a7a4a' },
            { label: 'Departed', value: departed, color: '#2060b0' },
            { label: 'Not Arrived', value: notArrived, color: '#888' }
          ].map(s => (
            <div key={s.label} style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <input type="text" placeholder="Search by name or email..." value={checkinSearch}
          onChange={e => setCheckinSearch(e.target.value)}
          style={{ ...inp, marginBottom: 14 }} />

        {filtered.length === 0 ? (
          <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No guests found.</div>
        ) : filtered.map(({ ge, guest }) => {
          const status = ge.checkin_status || 'not_arrived'
          const ticketDefault = guest.ticket_types ? guest.ticket_types.credits_per_person * guest.ticket_types.party_cap : null
          const hasCreditNotes = !!(ge.credit_notes && ge.credit_notes.trim())
          const hasBookingSummary = !!(ge.booking_summary && ge.booking_summary.trim())
          const creditsTotal = ge.credits_total != null ? ge.credits_total : (ticketDefault || 0)
          const creditsUsed = ge.credits_used || 0
          const creditsRemaining = creditsTotal - creditsUsed
          const workshopCount = registrations.filter(r => r.guest_id === guest.id && r.event_id === selectedEvent.id && r.status === 'confirmed').length
          return (
            <div key={guest.id} style={{ ...card, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{guest.name}</div>
                    {status === 'checked_in' && guest.waiver_signed && (
                      <span style={{ fontSize: 11, color: '#1a7a4a', background: '#e8f5ee', padding: '2px 8px', borderRadius: 10 }}>✓ waiver</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginTop: 2 }}>
                    {guest.ticket_types?.display_name || guest.ticket_types?.name}
                  </div>
                  {hasBookingSummary && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: '#fff8ec', color: '#9a5a18', border: '0.5px solid #e8c080' }}>
                        📋 {ge.booking_summary}
                      </span>
                    </div>
                  )}
                  {hasCreditNotes && (
                    <div style={{ marginTop: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: '#fff8ec', color: '#9a5a18', border: '0.5px solid #e8c080' }}>
                        📋 {ge.credit_notes}
                      </span>
                    </div>
                  )}
                  {creditsRemaining > 0 ? (
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      <span style={{ fontWeight: 600, color: '#1a7a4a' }}>{creditsRemaining} credit{creditsRemaining === 1 ? '' : 's'} available</span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: '#999', marginTop: 6 }}>All credits used</div>
                  )}
                  {workshopCount > 0 && (
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {workshopCount} workshop{workshopCount === 1 ? '' : 's'} registered
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {['not_arrived', 'checked_in', 'departed'].map(s => {
                    const isActive = status === s
                    const c = isActive ? activeColors[s] : { bg: '#fff', color: '#bbb', border: '#e8e8e8' }
                    return (
                      <button key={s} onClick={() => updateGuestCheckinStatus(guest.id, s)}
                        style={{ fontSize: 11, padding: '5px 11px', borderRadius: 6, border: '0.5px solid ' + c.border, background: c.bg, color: c.color, cursor: 'pointer', fontWeight: isActive ? 500 : 400 }}>
                        {statusLabels[s]}
                      </button>
                    )
                  })}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#888', cursor: 'pointer', marginLeft: 6 }}>
                    <input type="checkbox" checked={!!guest.waiver_signed}
                      onChange={e => updateGuestWaiverSigned(guest.id, e.target.checked)}
                      style={{ cursor: 'pointer' }} />
                    Waiver
                  </label>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Instructor fallback view (read-only roster for vendor/workshop instructors)
  if (staffMember && staffRole === 'instructor') return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, width: '100%', margin: '0 auto', padding: '24px 16px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
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

  const isVendor = !!staffMember.is_vendor
  const isCheckin = !!staffMember.is_checkin

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, width: '100%', margin: '0 auto', padding: '24px 16px', color: '#1a1a1a', background: '#FAFAF8', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8C8C8C', marginBottom: 4 }}>
            Snow Peak Way &middot; {isVendor ? 'Partner' : 'Staff'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{isVendor ? (staffMember.vendor_name || staffMember.name) : staffMember.name}</div>
          {!isVendor && staffMember.role && <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 2 }}>{staffMember.role}</div>}
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

      {/* Sub-tabs: Schedule / My Agenda / Site / Guide / Packing List / Resources — same hierarchy for staff and vendor partners */}
      <div style={{
        display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
        borderBottom: '0.5px solid #E0DEDA', marginBottom: 24
      }}>
        {[...(isCheckin ? [['checkin', 'Check-In']] : []), ['schedule', 'Schedule'], ['agenda', 'My Agenda'], ['site', 'Site'], ['guide', 'Guide'], ['packing', 'Packing List']].map(([t, label]) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            flex: '0 0 auto',
            padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, whiteSpace: 'nowrap', color: activeTab === t ? '#1a1a1a' : '#8C8C8C',
            borderBottom: activeTab === t ? '2px solid #1a1a1a' : '2px solid transparent',
            marginBottom: -1, fontWeight: activeTab === t ? 500 : 400
          }}>{label}</button>
        ))}
      </div>

      {/* CHECK-IN — Guest Services staff only, mirrors admin's Check-In tab */}
      {activeTab === 'checkin' && isCheckin && renderCheckInTab()}

      {/* SCHEDULE — read-only public schedule for the selected event */}
      {activeTab === 'schedule' && renderPublicScheduleTab()}

      {/* MY AGENDA — back-of-house shift coverage for staff; vendors get that plus their own sessions (incl. workshop-wide coverage) */}
      {activeTab === 'agenda' && (
        <div>
          {myDates.length === 0 && (
            <div style={{ textAlign: 'center', color: '#8C8C8C', padding: '48px 0', fontSize: 14 }}>
              {isVendor ? 'Nothing assigned yet.' : 'No shifts assigned yet.'}
            </div>
          )}
          {myDates.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
              {['all', ...myDates].map(d => {
                const active = agendaDayFilter === d
                return (
                  <button key={d} onClick={() => setAgendaDayFilter(d)} style={{
                    padding: '5px 14px', borderRadius: 20,
                    border: '0.5px solid ' + (active ? '#1a1a1a' : '#E8E4DE'),
                    background: active ? '#1a1a1a' : '#fff',
                    color: active ? '#fff' : '#8C8C8C',
                    fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
                  }}>
                    {d === 'all' ? 'All' : new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                  </button>
                )
              })}
            </div>
          )}
          {(agendaDayFilter === 'all' ? myDates : myDates.filter(d => d === agendaDayFilter)).map(date => (
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
                    background: info.sessionId ? '#fff' : '#F5F4F1',
                    borderLeft: '3px solid ' + (info.sessionId ? info.typeColor : '#C8C4BC')
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, color: '#8C8C8C', fontWeight: 500 }}>{info.time}</div>
                      <span style={badge(info.sessionId ? info.typeBg : '#E8E4DE', info.sessionId ? info.typeColor : '#888')}>{info.type}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500, marginBottom: info.location ? 4 : 0 }}>{info.title}</div>
                    {info.location && <div style={{ fontSize: 13, color: '#8C8C8C' }}>📍 {info.location}</div>}
                    {info.activityNotes && (
                      <div style={{ fontSize: 13, color: '#8C8C8C', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #F0EDE8', lineHeight: 1.55, fontStyle: 'italic' }}>
                        {info.activityNotes}
                      </div>
                    )}
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
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* SITE */}
      {activeTab === 'site' && renderSiteTab()}

      {/* GUIDE */}
      {activeTab === 'guide' && renderGuideTab()}

      {/* PACKING LIST */}
      {activeTab === 'packing' && renderPackingListTab()}
    </div>
  )
}
