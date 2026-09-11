'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const INFO_SECTION_ICONS = ['📍', '☕', '🚗', '📋', '📞', '🏕️', '⚠️', '🛁', '🛒', '📄']

const TIMEZONE_OPTIONS = [
  { label: 'ET', value: 'America/New_York' },
  { label: 'CT', value: 'America/Chicago' },
  { label: 'MT', value: 'America/Denver' },
  { label: 'PT', value: 'America/Los_Angeles' },
]

function timezoneLabel(tz) {
  return TIMEZONE_OPTIONS.find(o => o.value === tz)?.label || tz
}

// registration_opens_at is saved as a naive datetime-local string (no offset),
// which Postgres stores with a UTC label even though the digits actually
// represent wall-clock time in registration_timezone. This resolves those
// digits into the true absolute instant they were meant to represent, so
// "is registration open" comparisons and the display line are both correct
// regardless of what timezone the browser doing the comparing is in.
function resolveRegistrationOpenTime(event) {
  if (!event?.registration_opens_at) return null
  const tz = event.registration_timezone || 'America/New_York'
  const raw = new Date(event.registration_opens_at)
  const guessUtc = Date.UTC(
    raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(),
    raw.getUTCHours(), raw.getUTCMinutes(), raw.getUTCSeconds()
  )
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
  const map = {}
  dtf.formatToParts(new Date(guessUtc)).forEach(p => { if (p.type !== 'literal') map[p.type] = p.value })
  const hour = map.hour === '24' ? 0 : Number(map.hour)
  const shownAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second))
  return new Date(guessUtc + (guessUtc - shownAsUtc))
}

function formatOpensAt(event) {
  const resolved = resolveRegistrationOpenTime(event)
  if (!resolved) return ''
  const tz = event.registration_timezone || 'America/New_York'
  const formatted = resolved.toLocaleString('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  })
  return 'Opens: ' + formatted + ' ' + timezoneLabel(tz)
}

// Orders a list of category names using their gear_categories sort_order for
// this event. Categories without an explicit row yet (never reordered) sort
// after ones that have been, alphabetically among themselves.
function orderGearCategories(categories, categoryRows, eventId) {
  const orderMap = {}
  categoryRows.filter(gc => gc.event_id === eventId).forEach(gc => { orderMap[gc.name] = gc.sort_order })
  return [...categories].sort((a, b) => {
    const ao = orderMap[a]
    const bo = orderMap[b]
    if (ao !== undefined && bo !== undefined) return ao - bo
    if (ao !== undefined) return -1
    if (bo !== undefined) return 1
    return a.localeCompare(b)
  })
}

export default function AdminPage() {
  const [role, setRole] = useState(null)
  const [staffRecord, setStaffRecord] = useState(null) // set when auto-authenticated via /login instead of PIN
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [instructorWorkshop, setInstructorWorkshop] = useState(null)

  const [guests, setGuests] = useState([])
  const [ticketTypes, setTicketTypes] = useState([])
  const [workshops, setWorkshops] = useState([])
  const [sessions, setSessions] = useState([])
  const [registrations, setRegistrations] = useState([])
  const [events, setEvents] = useState([])
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [adminSettings, setAdminSettings] = useState({})
  const [guestEvents, setGuestEvents] = useState([])

  const [newGuest, setNewGuest] = useState({ name: '', email: '', ticket_type_id: '' })
  const [guestMsg, setGuestMsg] = useState(null)
  const [addingGuest, setAddingGuest] = useState(false)
  const [guestSubTab, setGuestSubTab] = useState('list')
  const [bulkCSV, setBulkCSV] = useState('')
  const [bulkPreview, setBulkPreview] = useState([])
  const [bulkResults, setBulkResults] = useState(null) // { added, linked, alreadyRegistered, failed: [{name,email,reason}] }
  const [bulkImporting, setBulkImporting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState({})
  const [guestSearch, setGuestSearch] = useState('')
  const [adjustingGuest, setAdjustingGuest] = useState(null)
  const [newCreditsAvail, setNewCreditsAvail] = useState(0)
  const [newCreditNotes, setNewCreditNotes] = useState('')
  const [newBookingSummary, setNewBookingSummary] = useState('')
  const [creditsMsg, setCreditsMsg] = useState(null)
  const [editingGuestTicket, setEditingGuestTicket] = useState(null) // guest id
  const [editGuestTicketTypeId, setEditGuestTicketTypeId] = useState('')
  const [guestTicketMsg, setGuestTicketMsg] = useState(null)
  const [savingGuestTicket, setSavingGuestTicket] = useState(false)

  const [activityType, setActivityType] = useState('workshop') // 'workshop' | 'moment' — unified Program add form
  const [newWorkshop, setNewWorkshop] = useState({ name: '', category: '', instructor: '', description: '', location: '', max_per_guest: 1, date: '', start_time: '', end_time: '', capacity: 30 })
  const [workshopMsg, setWorkshopMsg] = useState(null)
  const [addingWorkshop, setAddingWorkshop] = useState(false)
  const [editingWorkshop, setEditingWorkshop] = useState(null)
  const [editWorkshopData, setEditWorkshopData] = useState({})
  const [savingWorkshop, setSavingWorkshop] = useState(false)
  const [editingCapacityId, setEditingCapacityId] = useState(null)
  const [editCapacityValue, setEditCapacityValue] = useState('')

  const [openMoments, setOpenMoments] = useState([])
  const [newMoment, setNewMoment] = useState({ name: '', description: '', location: '', date: '', start_time: '', end_time: '', hours_text: '', moment_type: 'optional' })
  const [momentMsg, setMomentMsg] = useState(null)
  const [addingMoment, setAddingMoment] = useState(false)
  const [editingMoment, setEditingMoment] = useState(null)
  const [editMomentData, setEditMomentData] = useState({})
  const [savingMoment, setSavingMoment] = useState(false)
  const [workshopSessionForms, setWorkshopSessionForms] = useState({})
  const [addingSessionFor, setAddingSessionFor] = useState(null)
  const [sessionMsgFor, setSessionMsgFor] = useState({})
  const [addingTimeFor, setAddingTimeFor] = useState(null) // workshop_id whose "+ Add another time" mini-form is open

const [newTicketType, setNewTicketType] = useState({ name: '', display_name: '', party_cap: 1, credits_per_person: 2, description: '' })
  const [ticketMsg, setTicketMsg] = useState(null)
  const [addingTicket, setAddingTicket] = useState(false)
  const [editingTicketType, setEditingTicketType] = useState(null)
  const [editTicketData, setEditTicketData] = useState({})
  const [savingTicket, setSavingTicket] = useState(false)

  const [newEvent, setNewEvent] = useState({ name: '', description: '', location: '', start_date: '', end_date: '', registration_opens_at: '' })
  const [eventMsg, setEventMsg] = useState(null)
  const [addingEvent, setAddingEvent] = useState(false)
  const [newEventCopySource, setNewEventCopySource] = useState('')
  const [newEventCopyCategories, setNewEventCopyCategories] = useState({
    workshops: false, moments: false, shifts: false, gear: false, info: false, partners: false, resources: false
  })
  const [archivedEventsOpen, setArchivedEventsOpen] = useState(false)

  const [settingsMsg, setSettingsMsg] = useState(null)
  const [newPins, setNewPins] = useState({ super_admin_pin: '', admin_pin: '' })

  const [checkinSearch, setCheckinSearch] = useState('')

  const [gearItems, setGearItems] = useState([])
  const [gearCategories, setGearCategories] = useState([]) // { event_id, name, sort_order } — controls gear list section order
  const [reorderingGearCat, setReorderingGearCat] = useState(null)
  const [newGearItem, setNewGearItem] = useState({ name: '', category: '', description: '', link_1_label: '', link_1_url: '', link_2_label: '', link_2_url: '', is_available_to_rent: false, visibility: 'both', sort_order: 0 })
  const [gearMsg, setGearMsg] = useState(null)
  const [addingGear, setAddingGear] = useState(false)
  const [editingGearItem, setEditingGearItem] = useState(null)
  const [editGearData, setEditGearData] = useState({})
  const [copyGearOpen, setCopyGearOpen] = useState(false)
  const [copyingGear, setCopyingGear] = useState(false)
  const [savingGear, setSavingGear] = useState(false)

  const [infoSections, setInfoSections] = useState([])
  const [newInfoSection, setNewInfoSection] = useState({ title: '', content: '', icon: '📄', sort_order: 0 })
  const [infoSectionMsg, setInfoSectionMsg] = useState(null)
  const [addingInfoSection, setAddingInfoSection] = useState(false)
  const [editingInfoSection, setEditingInfoSection] = useState(null)
  const [editInfoSectionData, setEditInfoSectionData] = useState({})
  const [savingInfoSection, setSavingInfoSection] = useState(false)

  const [partners, setPartners] = useState([])
  const [newPartner, setNewPartner] = useState({ name: '', description: '', website_url: '', logo_url: '', sort_order: 0 })
  const [partnerMsg, setPartnerMsg] = useState(null)
  const [addingPartner, setAddingPartner] = useState(false)
  const [editingPartner, setEditingPartner] = useState(null)
  const [editPartnerData, setEditPartnerData] = useState({})
  const [savingPartner, setSavingPartner] = useState(false)

  const [staffShifts, setStaffShifts] = useState([])
  const [staffAssignments, setStaffAssignments] = useState([])
  const [staffSubTab, setStaffSubTab] = useState('staff & vendors')
  const [campGuideSubTab, setCampGuideSubTab] = useState('gear list')
  const [assignDateFilter, setAssignDateFilter] = useState('')
  const [assignTypeFilter, setAssignTypeFilter] = useState('all')
  const [assignUnassignedOnly, setAssignUnassignedOnly] = useState(false)
  const [assignmentsView, setAssignmentsView] = useState('activity') // 'activity' | 'staff'
  const [assignConflictsOnly, setAssignConflictsOnly] = useState(false) // By Staff view only
  const [addingShiftInline, setAddingShiftInline] = useState(false)
  const [newInlineShift, setNewInlineShift] = useState({ title: '', date: '', start_time: '', end_time: '', location: '', description: '' })
  const [inlineShiftMsg, setInlineShiftMsg] = useState(null)
  const [shiftMsg, setShiftMsg] = useState(null)
  const [openAssignDropdown, setOpenAssignDropdown] = useState(null)
  const [showAllStaff, setShowAllStaff] = useState({})
  const [addingAllFor, setAddingAllFor] = useState(null)
  const [assignRoleFilter, setAssignRoleFilter] = useState({}) // per item key: 'all' | 'sp' | 'vendor'
  const [editingShiftId, setEditingShiftId] = useState(null)
  const [editShiftData, setEditShiftData] = useState({})
  const [savingShift, setSavingShift] = useState(false)

  // Switching the type filter or the selected event can invalidate the
  // current date-pill selection (e.g. a shift-only date while switching to
  // Guest-Facing, or a date that only exists in a different event) and
  // silently empty the list — reset to "All dates" whenever either changes.
  useEffect(() => { setAssignDateFilter('') }, [assignTypeFilter, selectedEvent?.id])

  // shiftMsg (e.g. "Back of house item deleted") should only ever be visible
  // right after the action that set it — otherwise it lingers and resurfaces
  // on unrelated filter changes or tab visits, reading as a false success.
  useEffect(() => { setShiftMsg(null) }, [assignTypeFilter, assignDateFilter, assignUnassignedOnly, staffSubTab, selectedEvent?.id])

  const [staffMembers, setStaffMembers] = useState([])
  const [staffEventAssns, setStaffEventAssns] = useState([])
  const [staffWorkshopAssns, setStaffWorkshopAssns] = useState([])
  const [newStaffMember, setNewStaffMember] = useState({ name: '', pin: '', email: '', phone: '', notes: '', is_vendor: false, vendor_name: '', is_checkin: false })
  const [staffMemberMsg, setStaffMemberMsg] = useState(null)
  const [addingStaffMember, setAddingStaffMember] = useState(false)
  const [staffDeleteInput, setStaffDeleteInput] = useState({})
  const [togglingStaffId, setTogglingStaffId] = useState(null)
  const [editingStaffMember, setEditingStaffMember] = useState(null)
  const [editStaffMemberData, setEditStaffMemberData] = useState({})
  const [savingStaffMember, setSavingStaffMember] = useState(false)

  const [staffResources, setStaffResources] = useState([])
  const [newStaffResource, setNewStaffResource] = useState({ title: '', category: '', description: '', image_url: '', is_global: false, hidden_from_vendors: false, sort_order: 0 })
  const [staffResourceMsg, setStaffResourceMsg] = useState(null)
  const [addingStaffResource, setAddingStaffResource] = useState(false)
  const [editingStaffResource, setEditingStaffResource] = useState(null)
  const [editStaffResourceData, setEditStaffResourceData] = useState({})
  const [savingStaffResource, setSavingStaffResource] = useState(false)
  const [resourceDeleteInput, setResourceDeleteInput] = useState({})
  const [openResourceCategory, setOpenResourceCategory] = useState(null)

  // ── AUTH ─────────────────────────────────────────────────
  // Auto-login from the unified /login entry — falls back to the PIN screen
  // below when neither key is present, or the stored role isn't admin-level.
  useEffect(() => {
    const storedRecord = localStorage.getItem('spw_staff_record')
    const storedRole = localStorage.getItem('spw_staff_role')
    if (!storedRecord || (storedRole !== 'super_admin' && storedRole !== 'admin')) return
    try {
      const record = JSON.parse(storedRecord)
      setStaffRecord(record)
      setRole(storedRole === 'super_admin' ? 'super' : 'admin')
      loadAll()
    } catch {
      localStorage.removeItem('spw_staff_record')
      localStorage.removeItem('spw_staff_role')
    }
  }, [])

  function adminSignOut() {
    localStorage.removeItem('spw_staff_record')
    localStorage.removeItem('spw_staff_role')
    setStaffRecord(null)
    setRole(null)
  }

  async function checkPin() {
    setLoading(true)
    setPinError('')
    const { data: settings } = await supabase.from('admin_settings').select('*')
    const map = {}
    settings?.forEach(s => { map[s.key] = s.value })

    if (pin === map['super_admin_pin']) {
      setRole('super')
      setAdminSettings(map)
      await loadAll()
    } else if (pin === map['admin_pin']) {
      setRole('admin')
      await loadAll()
    } else {
      const { data: instrPin } = await supabase
        .from('instructor_pins').select('*, workshops(*)').eq('pin', pin).single()
      if (instrPin) {
        setRole('instructor')
        setInstructorWorkshop(instrPin.workshops)
        await loadAll()
      } else {
        setPinError('Incorrect PIN')
      }
    }
    setLoading(false)
  }

  async function loadAll() {
    const [
      { data: g }, { data: tt }, { data: w },
      { data: s }, { data: r }, { data: e },
      { data: ge }, { data: om }, { data: gi }, { data: gc },
      { data: sa }, { data: sm }, { data: sea }, { data: is }, { data: sr },
      { data: ep }, { data: swa }
    ] = await Promise.all([
      supabase.from('guests').select('*, ticket_types(*)').order('name'),
      supabase.from('ticket_types').select('*').order('name'),
      supabase.from('workshops').select('*').order('name'),
      supabase.from('sessions').select('*, workshops(*)').order('date').order('start_time'),
      supabase.from('registrations').select('*, guests(*), sessions(*, workshops(*))').neq('status', 'cancelled'),
      supabase.from('events').select('*').order('start_date'),
      supabase.from('guest_events').select('*, guests(*), events(*)'),
      supabase.from('open_moments').select('*').order('date').order('start_time'),
      supabase.from('gear_items').select('*').order('sort_order'),
      supabase.from('gear_categories').select('*').order('sort_order'),
      supabase.from('staff_assignments').select('*, staff(id, name, is_vendor), sessions(id, date, start_time, end_time, event_id, workshops(name)), open_moments(id, name, date, start_time, end_time, event_id), staff_shifts(id, title, shift_date, start_time, end_time, event_id)'),
      supabase.from('staff').select('*').order('name'),
      supabase.from('staff_event_assignments').select('*, events(id, name)'),
      supabase.from('event_info_sections').select('*').order('sort_order'),
      supabase.from('staff_resources').select('*').order('sort_order'),
      supabase.from('event_partners').select('*').order('sort_order'),
      supabase.from('staff_workshop_assignments').select('*, staff(id, name), workshops(id, name)')
    ])
    const { data: ss, error: ssError } = await supabase.from('staff_shifts').select('*').order('shift_date').order('start_time')
    console.log('[loadAll] staff_shifts result:', ss, 'error:', ssError)
    setGuests(g || [])
    setTicketTypes(tt || [])
    setWorkshops(w || [])
    setSessions(s || [])
    setRegistrations(r || [])
    setEvents(e || [])
    setGuestEvents(ge || [])
    setOpenMoments(om || [])
    setGearItems(gi || [])
    setGearCategories(gc || [])
    setInfoSections(is || [])
    setPartners(ep || [])
    setStaffResources(sr || [])
    setStaffShifts(ss || [])
    setStaffAssignments(sa || [])
    setStaffMembers(sm || [])
    setStaffEventAssns(sea || [])
    setStaffWorkshopAssns(swa || [])
    if (e && e.length > 0 && !selectedEvent) {
      const activeEvents = e.filter(ev => !ev.is_archived)
      const upcoming = activeEvents.find(ev => !isPastEvent(ev) && (ev.status === 'upcoming' || ev.status === 'active'))
        || activeEvents.find(ev => !isPastEvent(ev))
        || activeEvents[0]
        || e[0]
      setSelectedEvent(upcoming)
    }
  }

  // ── HELPERS ───────────────────────────────────────────────
  function getSessionForm(workshopId) {
    const stored = workshopSessionForms[workshopId]
    return { date: selectedEvent?.start_date || '', start_time: '', end_time: '', capacity: 30, ...stored }
  }

  function isPastEvent(ev) {
    if (!ev?.end_date) return false
    return ev.end_date < new Date().toISOString().slice(0, 10)
  }

  function isRegistrationOpenForEvent(ev) {
    if (!ev?.registration_opens_at) return true
    const opensAt = resolveRegistrationOpenTime(ev)
    return !opensAt || opensAt <= new Date()
  }

  function formatTime(t) {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return (hour % 12 || 12) + ':' + m + ' ' + (hour >= 12 ? 'PM' : 'AM')
  }

  function getEnrolled(sessionId) {
    return registrations.filter(r => r.session_id === sessionId && r.status === 'confirmed')
      .reduce((sum, r) => sum + (r.party_size || 1), 0)
  }

 function getGuestTotal(guest) {
    if (!selectedEvent) return 0
    const ge = guestEvents.find(ge => ge.guest_id === guest.id && ge.event_id === selectedEvent.id)
    if (ge?.credits_total) return ge.credits_total
    if (!guest.ticket_types) return 0
    return guest.ticket_types.credits_per_person * guest.ticket_types.party_cap
  }

  function getGuestCreditsUsed(guestId) {
    if (!selectedEvent) return 0
    const eventSessionIds = new Set(filteredSessions.map(s => s.id))
    return registrations
      .filter(r => r.guest_id === guestId && r.status === 'confirmed' && eventSessionIds.has(r.session_id))
      .reduce((sum, r) => sum + (r.party_size || 1), 0)
  }

  function downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    // Some browsers (notably Firefox) silently ignore .click() on an
    // anchor that was never attached to the DOM — must append before
    // clicking, then clean up both the element and the object URL after.
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // Shared by both export formats below — builds the flat list of schedule
  // items for the selected event plus an assignment lookup, regardless of
  // the Assignments tab's current type/date filters, so an export never
  // silently omits data because of whatever the admin happened to be
  // looking at on screen.
  function buildScheduleExportData() {
    const eid = selectedEvent.id
    const eventSessionsAll = sessions.filter(s => s.event_id === eid)
    const eventMomentsAll = openMoments.filter(m => m.event_id === eid)
    const eventShiftsAll = staffShifts.filter(s => s.event_id === eid)
    const eventAssignmentsAll = staffAssignments.filter(a => {
      const e = a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
      return e === eid
    })
    const activeStaff = staffMembers.filter(sm => sm.is_active !== false)

    const items = [
      ...eventSessionsAll.map(s => ({ type: 'Workshop', id: s.id, key: 'session_' + s.id, date: s.date, start_time: s.start_time, end_time: s.end_time, title: s.workshops?.name || 'Workshop', location: s.workshops?.location, workshopId: s.workshop_id })),
      ...eventMomentsAll.map(m => ({ type: m.moment_type === 'mandatory' ? 'All Campers' : m.moment_type === 'amenity' ? 'Amenity' : 'Open Moment', id: m.id, key: 'moment_' + m.id, date: m.date, start_time: m.start_time, end_time: m.end_time, title: m.name, location: m.location })),
      ...eventShiftsAll.map(s => ({ type: 'Back of House', id: s.id, key: 'shift_' + s.id, date: s.shift_date, start_time: s.start_time, end_time: s.end_time, title: s.title, location: s.location })),
    ].sort((a, b) => (a.date + 'T' + (a.start_time || '')) < (b.date + 'T' + (b.start_time || '')) ? -1 : 1)

    const isAssignedToItem = (staffId, item) => eventAssignmentsAll.some(a => a.staff_id === staffId && (
      item.key.startsWith('session_') ? a.session_id === item.id :
      item.key.startsWith('moment_') ? a.moment_id === item.id :
      a.shift_id === item.id
    )) || (item.workshopId ? staffWorkshopAssns.some(a => a.staff_id === staffId && a.workshop_id === item.workshopId) : false)

    return { items, isAssignedToItem, activeStaff }
  }

  function exportSlug() {
    return (selectedEvent.name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + new Date().toISOString().slice(0, 10)
  }

  // Plain-text schedule + assignment dump for the selected event — narrative
  // format (not CSV) so it can be pasted straight into an AI chat for review
  // (coverage gaps, staff overload, etc.) without any parsing on their end.
  function exportStaffSchedule() {
    if (!selectedEvent) return
    const { items, isAssignedToItem, activeStaff } = buildScheduleExportData()
    const assignedNamesFor = item => activeStaff.filter(sm => isAssignedToItem(sm.id, item)).map(sm => sm.name)

    let out = 'SNOW PEAK WAY — STAFF SCHEDULE EXPORT\n'
    out += 'Event: ' + selectedEvent.name + '\n'
    out += 'Dates: ' + (selectedEvent.start_date || '') + ' to ' + (selectedEvent.end_date || '') + '\n'
    out += 'Exported: ' + new Date().toISOString() + '\n'
    out += '\n=== SCHEDULE BY DATE ===\n'

    const byDate = {}
    items.forEach(i => { (byDate[i.date || 'No date'] ||= []).push(i) })
    Object.keys(byDate).sort().forEach(date => {
      const label = date === 'No date' ? 'No date' : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      out += '\n' + label.toUpperCase() + '\n' + '-'.repeat(label.length) + '\n'
      byDate[date].forEach(item => {
        const names = assignedNamesFor(item)
        out += (item.start_time ? formatTime(item.start_time) : '') + (item.end_time ? ' – ' + formatTime(item.end_time) : '') + ' | ' + item.type + ' | ' + item.title + '\n'
        if (item.location) out += '  Location: ' + item.location + '\n'
        out += '  Assigned: ' + (names.length ? names.join(', ') : 'UNASSIGNED') + '\n'
      })
    })

    out += '\n\n=== STAFF SUMMARY ===\n'
    activeStaff.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(sm => {
      const mine = items.filter(item => isAssignedToItem(sm.id, item))
      out += '\n' + sm.name + (sm.is_vendor ? ' (Vendor' + (sm.vendor_name ? ': ' + sm.vendor_name : '') + ')' : '') + ' — ' + mine.length + ' item' + (mine.length !== 1 ? 's' : '') + '\n'
      if (mine.length === 0) {
        out += '  Nothing scheduled.\n'
      } else {
        mine.forEach(item => {
          const dateLabel = item.date ? new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
          out += '  ' + dateLabel + ' ' + (item.start_time ? formatTime(item.start_time) : '') + (item.end_time ? '–' + formatTime(item.end_time) : '') + ' — ' + item.title + ' (' + item.type + ')\n'
        })
      }
    })

    const staffWithNothing = activeStaff.filter(sm => !items.some(item => isAssignedToItem(sm.id, item)))
    if (staffWithNothing.length > 0) {
      out += '\nSTAFF WITH NOTHING SCHEDULED:\n'
      staffWithNothing.forEach(sm => { out += '  - ' + sm.name + '\n' })
    }

    downloadText(out, 'staff-schedule-' + exportSlug() + '.txt')
  }

  // One row per schedule item — opens cleanly in Excel/Sheets, unlike the
  // narrative .txt export above which is meant for pasting into an AI chat.
  function exportStaffScheduleCSV() {
    if (!selectedEvent) return
    const { items, isAssignedToItem, activeStaff } = buildScheduleExportData()
    const rows = [['Date', 'Start', 'End', 'Type', 'Title', 'Location', 'Assigned Staff', 'Assigned Count']]
    items.forEach(item => {
      const names = activeStaff.filter(sm => isAssignedToItem(sm.id, item)).map(sm => sm.name)
      rows.push([
        item.date || '',
        item.start_time ? formatTime(item.start_time) : '',
        item.end_time ? formatTime(item.end_time) : '',
        item.type,
        item.title,
        item.location || '',
        names.join('; '),
        String(names.length)
      ])
    })
    downloadCSV(rows, 'staff-schedule-' + exportSlug() + '.csv')
  }

  function exportInviteLinks() {
    console.log('[exportInviteLinks] called, filteredGuests.length:', filteredGuests.length)
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const rows = [['Name', 'Email', 'Ticket Type', 'Invite Link']]
    filteredGuests.forEach(g => {
      const url = base + '?token=' + g.token + (selectedEvent ? '&event=' + selectedEvent.id : '')
      rows.push([g.name, g.email, g.ticket_types?.name || '', url])
    })
    console.log('[exportInviteLinks] rows to export:', rows.length - 1)
    downloadCSV(rows, 'snowpeak-invite-links.csv')
  }

  function parseBulkCSV(raw) {
    return raw.trim().split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''))
      return parts.length >= 3 ? { name: parts[0], email: parts[1], ticket_type_name: parts[2] } : null
    }).filter(Boolean)
  }

  // Event-filtered data
  const filteredSessions = selectedEvent
    ? sessions.filter(s => s.event_id === selectedEvent.id)
    : sessions

  const filteredRegs = selectedEvent
    ? registrations.filter(r => r.event_id === selectedEvent.id)
    : registrations

  const filteredMoments = selectedEvent
    ? openMoments.filter(m => m.event_id === selectedEvent.id)
    : openMoments

const filteredGuests = guests.filter(g => {
    const matchSearch = g.name.toLowerCase().includes(guestSearch.toLowerCase()) ||
      g.email.toLowerCase().includes(guestSearch.toLowerCase())
    const matchEvent = selectedEvent
      ? guestEvents.some(ge => ge.guest_id === g.id && ge.event_id === selectedEvent.id)
      : true
    return matchSearch && matchEvent
  })

  const sessionsByWorkshop = workshops.map(w => ({
    ...w, sessions: filteredSessions.filter(s => s.workshop_id === w.id)
  })).filter(w => w.sessions.length > 0)

  const totalCap = filteredSessions.reduce((s, x) => s + x.capacity, 0)
  const totalEnrolled = filteredSessions.reduce((s, x) => s + getEnrolled(x.id), 0)
  const overallPct = totalCap > 0 ? Math.round((totalEnrolled / totalCap) * 100) : 0

  // ── GUEST ACTIONS ─────────────────────────────────────────
  async function addGuest() {
    if (!newGuest.name || !newGuest.email || !newGuest.ticket_type_id) {
      setGuestMsg({ type: 'error', text: 'All fields required.' }); return
    }
    if (!selectedEvent) {
      setGuestMsg({ type: 'error', text: 'Select an event first.' }); return
    }
    setAddingGuest(true)

    // Guests can attend multiple events — an existing email links to this
    // event instead of failing on the unique constraint.
    const emailKey = newGuest.email.trim().toLowerCase()
    const existingGuest = guests.find(g => g.email.toLowerCase() === emailKey)

    if (existingGuest) {
      const alreadyLinked = guestEvents.some(ge => ge.guest_id === existingGuest.id && ge.event_id === selectedEvent.id)
      if (alreadyLinked) {
        setGuestMsg({ type: 'warning', text: existingGuest.name + ' is already registered for ' + selectedEvent.name + '.' })
      } else {
        const { error } = await supabase.from('guest_events').insert({ guest_id: existingGuest.id, event_id: selectedEvent.id, credits_used: 0 })
        if (!error) {
          setGuestMsg({ type: 'success', text: existingGuest.name + ' is already a guest — added to ' + selectedEvent.name })
          setNewGuest({ name: '', email: '', ticket_type_id: '' })
          await loadAll()
        } else {
          setGuestMsg({ type: 'error', text: 'Could not link guest to event.' })
        }
      }
      setAddingGuest(false)
      return
    }

    const { data: guestData, error } = await supabase
      .from('guests')
      .insert({ ...newGuest, credits_used: 0 })
      .select()
      .single()

    if (!error && guestData) {
      await supabase.from('guest_events').insert({
        guest_id: guestData.id,
        event_id: selectedEvent.id,
        credits_used: 0
      })
      setGuestMsg({ type: 'success', text: 'Guest added and linked to ' + selectedEvent.name + '. Find their invite link in the guest list.' })
      setNewGuest({ name: '', email: '', ticket_type_id: '' })
      await loadAll()
    } else if (error) {
      setGuestMsg({ type: 'error', text: error.message.includes('unique') ? 'Email already exists.' : 'Could not add guest.' })
    }
    setAddingGuest(false)
  }

  async function deleteGuest(id, name) {
    if (deleteConfirm[id] !== name) return
    await supabase.from('guests').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n[id]; return n })
    await loadAll()
  }

  async function updateGuestTicketType() {
    if (!editingGuestTicket || !editGuestTicketTypeId) return
    setSavingGuestTicket(true)
    const { error } = await supabase.from('guests').update({ ticket_type_id: editGuestTicketTypeId }).eq('id', editingGuestTicket)
    if (!error) {
      setEditingGuestTicket(null)
      setGuestTicketMsg(null)
      await loadAll()
    } else {
      setGuestTicketMsg({ type: 'error', text: 'Could not update ticket type.' })
    }
    setSavingGuestTicket(false)
  }

  async function saveCredits(guest) {
    if (!selectedEvent) return
    const payload = { credits_total: newCreditsAvail, credit_notes: newCreditNotes.trim() || null, booking_summary: newBookingSummary.trim() || null }
    console.log('[saveCredits] guest_id:', guest.id, 'event_id:', selectedEvent.id, 'payload:', payload)
    const { data, error } = await supabase
      .from('guest_events')
      .update(payload)
      .eq('guest_id', guest.id)
      .eq('event_id', selectedEvent.id)
      .select()
    console.log('[saveCredits] result — data:', data, 'error:', error)
    if (error) {
      setCreditsMsg({ type: 'error', text: 'Could not save: ' + error.message })
      return
    }
    setAdjustingGuest(null)
    setNewCreditNotes('')
    setNewBookingSummary('')
    setCreditsMsg(null)
    await loadAll()
  }

  async function bulkImport() {
    if (!selectedEvent) return
    setBulkImporting(true)

    let addedCount = 0, linkedCount = 0, alreadyRegisteredCount = 0
    const failedRows = []

    // Local, mutable snapshots so duplicate emails *within this same CSV*
    // are also handled correctly, not just ones that already existed
    // before the import started.
    const knownGuestsByEmail = {}
    guests.forEach(g => { knownGuestsByEmail[g.email.toLowerCase()] = g })
    const knownGuestEventKeys = new Set(guestEvents.map(ge => ge.guest_id + '|' + ge.event_id))

    for (const row of bulkPreview) {
      const emailKey = row.email.trim().toLowerCase()
      const tt = ticketTypes.find(t => t.name.toLowerCase() === row.ticket_type_name.toLowerCase())
      if (!tt) {
        failedRows.push({ name: row.name, email: row.email, reason: 'Ticket type not found: ' + row.ticket_type_name })
        continue
      }

      const existingGuest = knownGuestsByEmail[emailKey]

      if (existingGuest) {
        const geKey = existingGuest.id + '|' + selectedEvent.id
        if (knownGuestEventKeys.has(geKey)) {
          alreadyRegisteredCount++
          continue
        }
        const { error: geError } = await supabase.from('guest_events').insert({ guest_id: existingGuest.id, event_id: selectedEvent.id, credits_used: 0 })
        if (!geError) {
          knownGuestEventKeys.add(geKey)
          linkedCount++
        } else {
          failedRows.push({ name: row.name, email: row.email, reason: 'Unknown error' })
        }
        continue
      }

      const { data: guestData, error } = await supabase
        .from('guests')
        .insert({ name: row.name, email: row.email, ticket_type_id: tt.id, credits_used: 0 })
        .select().single()

      if (!error && guestData) {
        const { error: geError } = await supabase.from('guest_events').insert({ guest_id: guestData.id, event_id: selectedEvent.id, credits_used: 0 })
        knownGuestsByEmail[emailKey] = guestData
        if (!geError) {
          knownGuestEventKeys.add(guestData.id + '|' + selectedEvent.id)
          addedCount++
        } else {
          failedRows.push({ name: row.name, email: row.email, reason: 'Unknown error' })
        }
      } else {
        const reason = error?.message?.includes('unique') ? 'Email already exists' : 'Unknown error'
        failedRows.push({ name: row.name, email: row.email, reason })
      }
    }

    setBulkResults({ added: addedCount, linked: linkedCount, alreadyRegistered: alreadyRegisteredCount, failed: failedRows })
    setBulkPreview([]); setBulkCSV('')
    await loadAll()
    setBulkImporting(false)
  }

  // ── WORKSHOP ACTIONS ──────────────────────────────────────
  async function addWorkshop() {
    if (!newWorkshop.name || !selectedEvent) { setWorkshopMsg({ type: 'error', text: 'Name required.' }); return }
    if (!newWorkshop.start_time || !newWorkshop.end_time) { setWorkshopMsg({ type: 'error', text: 'Start and end time required.' }); return }
    setAddingWorkshop(true)
    const { data: ws, error } = await supabase.from('workshops').insert({
      name: newWorkshop.name,
      category: newWorkshop.category || null,
      instructor: newWorkshop.instructor || null,
      location: newWorkshop.location || null,
      description: newWorkshop.description || null,
      max_per_guest: parseInt(newWorkshop.max_per_guest) || 1,
      is_paid: false, price: 0
    }).select().single()
    if (!error && ws) {
      const { error: sessErr } = await supabase.from('sessions').insert({
        event_id: selectedEvent.id,
        workshop_id: ws.id,
        date: newWorkshop.date || selectedEvent.start_date,
        start_time: newWorkshop.start_time,
        end_time: newWorkshop.end_time,
        capacity: parseInt(newWorkshop.capacity) || 30
      })
      if (!sessErr) {
        setWorkshopMsg({ type: 'success', text: 'Workshop added.' })
        setNewWorkshop({ name: '', category: '', instructor: '', description: '', location: '', max_per_guest: 1, date: '', start_time: '', end_time: '', capacity: 30 })
        await loadAll()
      } else {
        setWorkshopMsg({ type: 'error', text: 'Workshop created, but could not add its time slot.' })
      }
    } else {
      setWorkshopMsg({ type: 'error', text: 'Could not add workshop.' })
    }
    setAddingWorkshop(false)
  }

  async function updateWorkshop() {
    if (!editingWorkshop) return
    setSavingWorkshop(true)
    const { error } = await supabase.from('workshops').update({
      name: editWorkshopData.name,
      category: editWorkshopData.category,
      instructor: editWorkshopData.instructor,
      location: editWorkshopData.location,
      description: editWorkshopData.description,
      max_per_guest: parseInt(editWorkshopData.max_per_guest) || 1
    }).eq('id', editingWorkshop.id)
    if (!error) {
      setEditingWorkshop(null)
      setEditWorkshopData({})
      await loadAll()
    } else {
      setWorkshopMsg({ type: 'error', text: 'Could not update workshop.' })
    }
    setSavingWorkshop(false)
  }

  async function updateSessionCapacity(sessionId) {
    const capacity = parseInt(editCapacityValue)
    if (!capacity || capacity < 1) return
    const { error } = await supabase.from('sessions').update({ capacity }).eq('id', sessionId)
    if (!error) {
      setEditingCapacityId(null)
      setEditCapacityValue('')
      await loadAll()
    }
  }

  async function addInlineSession(workshopId) {
    const form = getSessionForm(workshopId)
    if (!form.start_time || !form.end_time || !selectedEvent) {
      setSessionMsgFor(m => ({ ...m, [workshopId]: { type: 'error', text: 'Start and end time required.' } })); return false
    }
    setAddingSessionFor(workshopId)
    const { error } = await supabase.from('sessions').insert({
      event_id: selectedEvent.id,
      workshop_id: workshopId,
      date: form.date || selectedEvent.start_date,
      start_time: form.start_time,
      end_time: form.end_time,
      capacity: parseInt(form.capacity) || 30
    })
    if (!error) {
      setSessionMsgFor(m => ({ ...m, [workshopId]: null }))
      setWorkshopSessionForms(f => ({ ...f, [workshopId]: { ...getSessionForm(workshopId), start_time: '', end_time: '' } }))
      await loadAll()
    } else {
      setSessionMsgFor(m => ({ ...m, [workshopId]: { type: 'error', text: 'Could not add time slot: ' + (error?.message || 'unknown error') } }))
    }
    setAddingSessionFor(null)
    return !error
  }

  async function addMoment() {
    if (!newMoment.name || !selectedEvent) { setMomentMsg({ type: 'error', text: 'Name required.' }); return }
    setAddingMoment(true)
    const isAmenity = newMoment.moment_type === 'amenity'
    const { error } = await supabase.from('open_moments').insert({
      event_id: selectedEvent.id,
      name: newMoment.name,
      description: newMoment.description || null,
      location: newMoment.location || null,
      date: isAmenity ? null : (newMoment.date || null),
      start_time: isAmenity ? null : (newMoment.start_time || null),
      end_time: isAmenity ? null : (newMoment.end_time || null),
      hours_text: isAmenity ? (newMoment.hours_text || null) : null,
      moment_type: newMoment.moment_type
    })
    if (!error) {
      setMomentMsg({ type: 'success', text: 'Moment added.' })
      setNewMoment({ name: '', description: '', location: '', date: '', start_time: '', end_time: '', hours_text: '', moment_type: 'optional' })
      await loadAll()
    } else setMomentMsg({ type: 'error', text: 'Could not add moment.' })
    setAddingMoment(false)
  }

  async function deleteMoment(id) {
    await supabase.from('open_moments').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['moment_' + id]; return n })
    await loadAll()
  }

  async function updateMoment() {
    if (!editingMoment) return
    setSavingMoment(true)
    const isAmenityEdit = editMomentData.moment_type === 'amenity'
    const { error } = await supabase.from('open_moments').update({
      name: editMomentData.name,
      moment_type: editMomentData.moment_type,
      date: isAmenityEdit ? null : (editMomentData.date || null),
      start_time: isAmenityEdit ? null : (editMomentData.start_time || null),
      end_time: isAmenityEdit ? null : (editMomentData.end_time || null),
      hours_text: isAmenityEdit ? (editMomentData.hours_text || null) : null,
      location: editMomentData.location || null,
      description: editMomentData.description || null,
    }).eq('id', editingMoment.id)
    if (!error) {
      await loadAll()
      setEditingMoment(null)
      setEditMomentData({})
    }
    setSavingMoment(false)
  }


  async function deleteSession(id) {
    if (!deleteConfirm['session_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['session_' + id]: true })); return
    }
    await supabase.from('sessions').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['session_' + id]; return n })
    await loadAll()
  }

  async function addGearItem() {
    if (!newGearItem.name || !newGearItem.category || !selectedEvent) {
      setGearMsg({ type: 'error', text: 'Name and category required.' }); return
    }
    setAddingGear(true)
    const { error } = await supabase.from('gear_items').insert({
      event_id: selectedEvent.id,
      name: newGearItem.name,
      category: newGearItem.category,
      description: newGearItem.description || null,
      link_1_label: newGearItem.link_1_label || null,
      link_1_url: newGearItem.link_1_url || null,
      link_2_label: newGearItem.link_2_label || null,
      link_2_url: newGearItem.link_2_url || null,
      is_available_to_rent: newGearItem.is_available_to_rent,
      visibility: newGearItem.visibility,
      sort_order: parseInt(newGearItem.sort_order) || 0
    })
    if (!error) {
      setGearMsg({ type: 'success', text: 'Item added.' })
      setNewGearItem({ name: '', category: '', description: '', link_1_label: '', link_1_url: '', link_2_label: '', link_2_url: '', is_available_to_rent: false, visibility: 'both', sort_order: 0 })
      await loadAll()
    } else {
      setGearMsg({ type: 'error', text: 'Could not add item.' })
    }
    setAddingGear(false)
  }

  async function deleteGearItem(id) {
    if (!deleteConfirm['gear_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['gear_' + id]: true })); return
    }
    await supabase.from('gear_items').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['gear_' + id]; return n })
    await loadAll()
  }

  async function updateGearItem() {
    if (!editingGearItem) return
    setSavingGear(true)
    const { error } = await supabase.from('gear_items').update({
      name: editGearData.name,
      category: editGearData.category,
      description: editGearData.description || null,
      link_1_label: editGearData.link_1_label || null,
      link_1_url: editGearData.link_1_url || null,
      link_2_label: editGearData.link_2_label || null,
      link_2_url: editGearData.link_2_url || null,
      is_available_to_rent: editGearData.is_available_to_rent,
      visibility: editGearData.visibility,
      sort_order: parseInt(editGearData.sort_order) || 0
    }).eq('id', editingGearItem.id)
    if (!error) {
      setEditingGearItem(null)
      await loadAll()
    } else {
      setGearMsg({ type: 'error', text: 'Could not update item.' })
    }
    setSavingGear(false)
  }

  // Moves a category earlier/later among the currently-displayed categories
  // for this event, re-numbering all of them 0..n so order stays contiguous
  // and predictable. Categories with no gear_categories row yet (never
  // reordered) are materialized here on first use.
  async function moveGearCategory(orderedCats, catIndex, direction, eventId) {
    const newIndex = catIndex + direction
    if (newIndex < 0 || newIndex >= orderedCats.length) return
    setReorderingGearCat(orderedCats[catIndex])
    try {
      const reordered = [...orderedCats]
      const [moved] = reordered.splice(catIndex, 1)
      reordered.splice(newIndex, 0, moved)

      // PostgREST's bulk upsert requires every object in the batch to have
      // identical keys — a mix of rows with/without `id` (existing vs.
      // never-ordered categories) fails with PGRST102 "All object keys must
      // match". Generate ids client-side so every row is uniformly shaped.
      const existingByName = {}
      gearCategories.filter(gc => gc.event_id === eventId).forEach(gc => { existingByName[gc.name] = gc.id })
      const rows = reordered.map((name, i) => ({
        id: existingByName[name] || crypto.randomUUID(),
        event_id: eventId,
        name,
        sort_order: i
      }))

      const { error } = await supabase.from('gear_categories').upsert(rows, { onConflict: 'event_id,name' })
      if (!error) { setGearMsg(null); await loadAll() }
      else { console.error('[moveGearCategory] upsert error:', error); setGearMsg({ type: 'error', text: 'Could not reorder categories.' }) }
    } catch (err) {
      // Guarantees reorderingGearCat always clears below — without this, a
      // thrown error (network failure, etc.) would leave this category's
      // buttons permanently disabled until a full page reload.
      console.error('[moveGearCategory] threw:', err)
      setGearMsg({ type: 'error', text: 'Could not reorder categories.' })
    } finally {
      setReorderingGearCat(null)
    }
  }

  async function copyGearFromEvent(sourceEventId) {
    if (!selectedEvent || !sourceEventId) return
    setCopyGearOpen(false)
    setCopyingGear(true)
    const key = gi => (gi.name || '').trim().toLowerCase() + '|' + (gi.category || '').trim().toLowerCase()
    const existingKeys = new Set(gearItems.filter(gi => gi.event_id === selectedEvent.id).map(key))
    const toCopy = gearItems.filter(gi => gi.event_id === sourceEventId && !existingKeys.has(key(gi)))

    if (toCopy.length === 0) {
      setGearMsg({ type: 'warning', text: 'No new items to copy — they already exist on this event.' })
      setCopyingGear(false)
      return
    }

    const { error } = await supabase.from('gear_items').insert(
      toCopy.map(gi => ({
        event_id: selectedEvent.id,
        name: gi.name,
        category: gi.category,
        description: gi.description || null,
        link_1_label: gi.link_1_label || null,
        link_1_url: gi.link_1_url || null,
        link_2_label: gi.link_2_label || null,
        link_2_url: gi.link_2_url || null,
        is_available_to_rent: gi.is_available_to_rent,
        sort_order: gi.sort_order
      }))
    )
    if (!error) {
      setGearMsg({ type: 'success', text: 'Copied ' + toCopy.length + ' item' + (toCopy.length === 1 ? '' : 's') + '.' })
      await loadAll()
    } else {
      setGearMsg({ type: 'error', text: 'Could not copy items.' })
    }
    setCopyingGear(false)
  }

  async function addInfoSection() {
    if (!newInfoSection.title || !selectedEvent) {
      setInfoSectionMsg({ type: 'error', text: 'Title required.' }); return
    }
    setAddingInfoSection(true)
    const { error } = await supabase.from('event_info_sections').insert({
      event_id: selectedEvent.id,
      title: newInfoSection.title,
      content: newInfoSection.content || null,
      icon: newInfoSection.icon || '📄',
      sort_order: parseInt(newInfoSection.sort_order) || 0
    })
    if (!error) {
      setInfoSectionMsg({ type: 'success', text: 'Section added.' })
      setNewInfoSection({ title: '', content: '', icon: '📄', sort_order: 0 })
      await loadAll()
    } else {
      setInfoSectionMsg({ type: 'error', text: 'Could not add section.' })
    }
    setAddingInfoSection(false)
  }

  async function deleteInfoSection(id) {
    if (!deleteConfirm['info_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['info_' + id]: true })); return
    }
    await supabase.from('event_info_sections').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['info_' + id]; return n })
    await loadAll()
  }

  async function updateInfoSection() {
    if (!editingInfoSection) return
    setSavingInfoSection(true)
    const { error } = await supabase.from('event_info_sections').update({
      title: editInfoSectionData.title,
      content: editInfoSectionData.content || null,
      icon: editInfoSectionData.icon || '📄',
      sort_order: parseInt(editInfoSectionData.sort_order) || 0
    }).eq('id', editingInfoSection.id)
    if (!error) {
      setEditingInfoSection(null)
      await loadAll()
    } else {
      setInfoSectionMsg({ type: 'error', text: 'Could not update section.' })
    }
    setSavingInfoSection(false)
  }

  async function addPartner() {
    if (!newPartner.name || !selectedEvent) {
      setPartnerMsg({ type: 'error', text: 'Name required.' }); return
    }
    setAddingPartner(true)
    const { error } = await supabase.from('event_partners').insert({
      event_id: selectedEvent.id,
      name: newPartner.name,
      description: newPartner.description || null,
      website_url: newPartner.website_url || null,
      logo_url: newPartner.logo_url || null,
      sort_order: parseInt(newPartner.sort_order) || 0
    })
    if (!error) {
      setPartnerMsg({ type: 'success', text: 'Partner added.' })
      setNewPartner({ name: '', description: '', website_url: '', logo_url: '', sort_order: 0 })
      await loadAll()
    } else {
      setPartnerMsg({ type: 'error', text: 'Could not add partner.' })
    }
    setAddingPartner(false)
  }

  async function deletePartner(id) {
    if (!deleteConfirm['partner_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['partner_' + id]: true })); return
    }
    await supabase.from('event_partners').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['partner_' + id]; return n })
    await loadAll()
  }

  async function updatePartner() {
    if (!editingPartner) return
    setSavingPartner(true)
    const { error } = await supabase.from('event_partners').update({
      name: editPartnerData.name,
      description: editPartnerData.description || null,
      website_url: editPartnerData.website_url || null,
      logo_url: editPartnerData.logo_url || null,
      sort_order: parseInt(editPartnerData.sort_order) || 0
    }).eq('id', editingPartner.id)
    if (!error) {
      setEditingPartner(null)
      await loadAll()
    } else {
      setPartnerMsg({ type: 'error', text: 'Could not update partner.' })
    }
    setSavingPartner(false)
  }

  async function addStaffResource() {
    if (!newStaffResource.title || !selectedEvent) {
      setStaffResourceMsg({ type: 'error', text: 'Title required.' }); return
    }
    setAddingStaffResource(true)
    const { error } = await supabase.from('staff_resources').insert({
      event_id: selectedEvent.id,
      title: newStaffResource.title,
      category: newStaffResource.category || null,
      description: newStaffResource.description || null,
      image_url: newStaffResource.image_url || null,
      is_global: newStaffResource.is_global,
      hidden_from_vendors: newStaffResource.hidden_from_vendors,
      sort_order: parseInt(newStaffResource.sort_order) || 0
    })
    if (!error) {
      setStaffResourceMsg({ type: 'success', text: 'Resource added.' })
      setNewStaffResource({ title: '', category: '', description: '', image_url: '', is_global: false, hidden_from_vendors: false, sort_order: 0 })
      await loadAll()
    } else {
      setStaffResourceMsg({ type: 'error', text: 'Could not add resource.' })
    }
    setAddingStaffResource(false)
  }

  async function deleteStaffResource(id, title) {
    if ((resourceDeleteInput[id] || '') !== title) return
    await supabase.from('staff_resources').delete().eq('id', id)
    setResourceDeleteInput(d => { const n = { ...d }; delete n[id]; return n })
    await loadAll()
  }

  async function updateStaffResource() {
    if (!editingStaffResource) return
    setSavingStaffResource(true)
    const { error } = await supabase.from('staff_resources').update({
      title: editStaffResourceData.title,
      category: editStaffResourceData.category || null,
      description: editStaffResourceData.description || null,
      image_url: editStaffResourceData.image_url || null,
      is_global: editStaffResourceData.is_global,
      hidden_from_vendors: editStaffResourceData.hidden_from_vendors,
      sort_order: parseInt(editStaffResourceData.sort_order) || 0
    }).eq('id', editingStaffResource.id)
    if (!error) {
      setEditingStaffResource(null)
      await loadAll()
    } else {
      setStaffResourceMsg({ type: 'error', text: 'Could not update resource.' })
    }
    setSavingStaffResource(false)
  }

  async function updateCheckinStatus(guestId, status) {
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

  async function updateWaiverSigned(guestId, signed) {
    const { error } = await supabase
      .from('guests')
      .update({ waiver_signed: signed })
      .eq('id', guestId)
    if (!error) {
      setGuests(gs => gs.map(g => g.id === guestId ? { ...g, waiver_signed: signed } : g))
    }
  }

  // ── SUPER ADMIN ───────────────────────────────────────────
  async function addTicketType() {
    if (!newTicketType.name) { setTicketMsg({ type: 'error', text: 'Name required.' }); return }
    setAddingTicket(true)
    const { error } = await supabase.from('ticket_types').insert(newTicketType)
    if (!error) {
      setTicketMsg({ type: 'success', text: 'Ticket type added.' })
      setNewTicketType({ name: '', display_name: '', party_cap: 1, credits_per_person: 2, description: '' })
      await loadAll()
    } else setTicketMsg({ type: 'error', text: 'Could not add ticket type.' })
    setAddingTicket(false)
  }

  async function saveTicketType() {
    if (!editingTicketType) return
    setSavingTicket(true)
    const { error } = await supabase.from('ticket_types').update({
      name: editTicketData.name,
      display_name: editTicketData.display_name,
      party_cap: parseInt(editTicketData.party_cap) || 1,
      credits_per_person: parseInt(editTicketData.credits_per_person) || 1,
      description: editTicketData.description,
    }).eq('id', editingTicketType.id)
    if (!error) {
      await loadAll()
      setEditingTicketType(null)
      setEditTicketData({})
    }
    setSavingTicket(false)
  }
  async function deleteTicketType(id) {
    if (!deleteConfirm['tt_' + id]) { setDeleteConfirm(d => ({ ...d, ['tt_' + id]: true })); return }
    await supabase.from('ticket_types').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['tt_' + id]; return n })
    await loadAll()
  }

  // Copies selected data categories from an existing event onto a freshly
  // created (empty) one. Workshops are duplicated as new rows (not
  // re-pointed at the source event's workshop_id) so later edits on one
  // event's copy never bleed into the other's.
  async function copyEventDataToEvent(sourceEventId, targetEventId, categories, dayOffset = 0) {
    const tasks = []
    // Shifts a date by the gap between the source and target events' start
    // dates, so a workshop that ran on "Saturday of the old event" lands on
    // "Saturday of the new event" instead of keeping its literal old date.
    const shiftDate = dateStr => {
      if (!dateStr || !dayOffset) return dateStr
      const d = new Date(dateStr + 'T12:00:00')
      d.setDate(d.getDate() + dayOffset)
      return d.toISOString().slice(0, 10)
    }

    if (categories.workshops) {
      tasks.push((async () => {
        const byWorkshop = {}
        sessions.filter(s => s.event_id === sourceEventId).forEach(s => {
          if (!byWorkshop[s.workshop_id]) byWorkshop[s.workshop_id] = { workshop: s.workshops, rows: [] }
          byWorkshop[s.workshop_id].rows.push(s)
        })
        for (const { workshop, rows } of Object.values(byWorkshop)) {
          if (!workshop) continue
          const { data: newWorkshop, error: wErr } = await supabase.from('workshops').insert({
            name: workshop.name,
            category: workshop.category,
            instructor: workshop.instructor,
            location: workshop.location,
            description: workshop.description,
            max_per_guest: workshop.max_per_guest,
            is_paid: workshop.is_paid,
            price: workshop.price
          }).select().single()
          if (wErr || !newWorkshop) continue
          await supabase.from('sessions').insert(rows.map(s => ({
            event_id: targetEventId,
            workshop_id: newWorkshop.id,
            date: shiftDate(s.date),
            start_time: s.start_time,
            end_time: s.end_time,
            capacity: s.capacity
          })))
        }
      })())
    }

    if (categories.moments) {
      const rows = openMoments.filter(m => m.event_id === sourceEventId)
      if (rows.length > 0) {
        tasks.push(supabase.from('open_moments').insert(rows.map(m => ({
          event_id: targetEventId,
          name: m.name,
          description: m.description,
          location: m.location,
          date: shiftDate(m.date),
          start_time: m.start_time,
          end_time: m.end_time,
          hours_text: m.hours_text,
          moment_type: m.moment_type
        }))))
      }
    }

    if (categories.shifts) {
      const rows = staffShifts.filter(s => s.event_id === sourceEventId)
      if (rows.length > 0) {
        tasks.push(supabase.from('staff_shifts').insert(rows.map(s => ({
          event_id: targetEventId,
          title: s.title,
          shift_date: shiftDate(s.shift_date),
          start_time: s.start_time,
          end_time: s.end_time,
          location: s.location,
          description: s.description
        }))))
      }
    }

    if (categories.gear) {
      const gearRows = gearItems.filter(g => g.event_id === sourceEventId)
      if (gearRows.length > 0) {
        tasks.push(supabase.from('gear_items').insert(gearRows.map(g => ({
          event_id: targetEventId,
          name: g.name,
          category: g.category,
          description: g.description,
          link_1_label: g.link_1_label,
          link_1_url: g.link_1_url,
          link_2_label: g.link_2_label,
          link_2_url: g.link_2_url,
          is_available_to_rent: g.is_available_to_rent,
          visibility: g.visibility,
          sort_order: g.sort_order
        }))))
      }
      const catRows = gearCategories.filter(c => c.event_id === sourceEventId)
      if (catRows.length > 0) {
        tasks.push(supabase.from('gear_categories').insert(catRows.map(c => ({
          event_id: targetEventId, name: c.name, sort_order: c.sort_order
        }))))
      }
    }

    if (categories.info) {
      const rows = infoSections.filter(s => s.event_id === sourceEventId)
      if (rows.length > 0) {
        tasks.push(supabase.from('event_info_sections').insert(rows.map(s => ({
          event_id: targetEventId, title: s.title, content: s.content, icon: s.icon, sort_order: s.sort_order
        }))))
      }
    }

    if (categories.partners) {
      const rows = partners.filter(p => p.event_id === sourceEventId)
      if (rows.length > 0) {
        tasks.push(supabase.from('event_partners').insert(rows.map(p => ({
          event_id: targetEventId, name: p.name, description: p.description, website_url: p.website_url, logo_url: p.logo_url, sort_order: p.sort_order
        }))))
      }
    }

    if (categories.resources) {
      // Global resources already show on every event — copying them would
      // just duplicate what's already visible.
      const rows = staffResources.filter(r => r.event_id === sourceEventId && !r.is_global)
      if (rows.length > 0) {
        tasks.push(supabase.from('staff_resources').insert(rows.map(r => ({
          event_id: targetEventId, title: r.title, category: r.category, description: r.description,
          image_url: r.image_url, is_global: false, hidden_from_vendors: r.hidden_from_vendors, sort_order: r.sort_order
        }))))
      }
    }

    await Promise.all(tasks)
  }

  async function addEvent() {
    if (!newEvent.name || !newEvent.start_date || !newEvent.end_date) {
      setEventMsg({ type: 'error', text: 'Name and dates required.' }); return
    }
    setAddingEvent(true)
    const { data: created, error } = await supabase.from('events').insert({ ...newEvent, status: 'upcoming' }).select().single()
    if (!error && created) {
      if (newEventCopySource && Object.values(newEventCopyCategories).some(Boolean)) {
        const sourceEvent = events.find(e => e.id === newEventCopySource)
        const dayOffset = sourceEvent?.start_date && created.start_date
          ? Math.round((new Date(created.start_date + 'T12:00:00') - new Date(sourceEvent.start_date + 'T12:00:00')) / 86400000)
          : 0
        await copyEventDataToEvent(newEventCopySource, created.id, newEventCopyCategories, dayOffset)
      }
      setEventMsg({ type: 'success', text: 'Event created.' })
      setNewEvent({ name: '', description: '', location: '', start_date: '', end_date: '', registration_opens_at: '' })
      setNewEventCopySource('')
      setNewEventCopyCategories({ workshops: false, moments: false, shifts: false, gear: false, info: false, partners: false, resources: false })
      await loadAll()
    } else setEventMsg({ type: 'error', text: 'Could not create event.' })
    setAddingEvent(false)
  }

  async function updateEventField(eventId, field, value) {
    await supabase.from('events').update({ [field]: value || null }).eq('id', eventId)
    await loadAll()
  }

  async function setEventArchived(eventId, archived) {
    // Not routed through updateEventField — its `value || null` coercion
    // would turn `is_archived: false` into `null` and break Unarchive.
    await supabase.from('events').update({ is_archived: archived }).eq('id', eventId)
    await loadAll()
  }

  // ── STAFF SHIFTS & ASSIGNMENTS ────────────────────────────
  async function createInlineShift() {
    if (!newInlineShift.title || !newInlineShift.date || !newInlineShift.start_time || !newInlineShift.end_time || !selectedEvent) {
      setInlineShiftMsg({ type: 'error', text: 'Title, date, start and end time required.' }); return
    }
    const shiftPayload = {
      title: newInlineShift.title, shift_date: newInlineShift.date,
      start_time: newInlineShift.start_time, end_time: newInlineShift.end_time,
      location: newInlineShift.location || null, description: newInlineShift.description || null,
      event_id: selectedEvent.id
    }
    console.log('creating shift payload:', JSON.stringify(shiftPayload))
    const { data, error } = await supabase.from('staff_shifts').insert(shiftPayload).select().single()
    console.log('create shift error:', error)
    if (!error && data) {
      setNewInlineShift({ title: '', date: '', start_time: '', end_time: '', location: '', description: '' })
      setAddingShiftInline(false)
      setInlineShiftMsg(null)
      await loadAll()
      setOpenAssignDropdown('shift_' + data.id)
    } else setInlineShiftMsg({ type: 'error', text: 'Could not create item.' })
  }

  async function deleteStaffShift(id) {
    if (!deleteConfirm['shift_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['shift_' + id]: true })); return
    }
    await supabase.from('staff_assignments').delete().eq('shift_id', id)
    await supabase.from('staff_shifts').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['shift_' + id]; return n })
    setShiftMsg({ type: 'success', text: 'Back of house item deleted' })
    // Auto-dismiss — loadAll() below can't clear it itself (it would wipe
    // the message before this render even shows it), and this message
    // shouldn't be able to outlive the action that caused it.
    setTimeout(() => setShiftMsg(m => (m?.text === 'Back of house item deleted' ? null : m)), 4000)
    await loadAll()
  }

  async function updateStaffShift() {
    if (!editingShiftId) return
    if (!editShiftData.title || !editShiftData.date || !editShiftData.start_time || !editShiftData.end_time) {
      setShiftMsg({ type: 'error', text: 'Title, date, start and end time required.' }); return
    }
    setSavingShift(true)
    const { error } = await supabase.from('staff_shifts').update({
      title: editShiftData.title,
      shift_date: editShiftData.date,
      start_time: editShiftData.start_time,
      end_time: editShiftData.end_time,
      location: editShiftData.location || null,
      description: editShiftData.description || null,
    }).eq('id', editingShiftId)
    if (!error) {
      setEditingShiftId(null)
      setEditShiftData({})
      await loadAll()
    } else {
      setShiftMsg({ type: 'error', text: 'Could not update item.' })
    }
    setSavingShift(false)
  }

  async function addStaffAssignment(staffId, type, itemId, autoAddEvent = false) {
    if (autoAddEvent && selectedEvent) {
      const already = staffEventAssns.some(a => a.staff_id === staffId && a.event_id === selectedEvent.id)
      if (!already) await supabase.from('staff_event_assignments').insert({ staff_id: staffId, event_id: selectedEvent.id })
    }
    const col = type === 'session' ? 'session_id' : type === 'moment' ? 'moment_id' : 'shift_id'
    const payload = { staff_id: staffId, [col]: itemId }
    console.log('[addStaffAssignment] inserting staff_assignment:', JSON.stringify(payload))
    const { error: saError } = await supabase.from('staff_assignments').insert(payload)
    console.log('[addStaffAssignment] insert error:', saError)
    loadAll()
  }

  async function removeStaffAssignment(id) {
    await supabase.from('staff_assignments').delete().eq('id', id)
    loadAll()
  }

  // Assigns every given staff member to one item in a single insert, instead
  // of one round-trip per person — used by the "Add all" button.
  async function addAllStaffAssignments(staffIds, type, itemId) {
    if (staffIds.length === 0) return
    const col = type === 'session' ? 'session_id' : type === 'moment' ? 'moment_id' : 'shift_id'
    const payload = staffIds.map(staffId => ({ staff_id: staffId, [col]: itemId }))
    const { error } = await supabase.from('staff_assignments').insert(payload)
    if (error) console.log('[addAllStaffAssignments] insert error:', error)
    await loadAll()
  }

  function getStaffConflicts(staffId, targetDate, targetStart, targetEnd, excludeId = null) {
    const conflicts = []
    staffAssignments
      .filter(a => a.staff_id === staffId && a.id !== excludeId)
      .forEach(a => {
        let date, start, end, title
        if (a.sessions) { date = a.sessions.date; start = a.sessions.start_time; end = a.sessions.end_time; title = a.sessions.workshops?.name || 'Workshop' }
        else if (a.open_moments) { date = a.open_moments.date; start = a.open_moments.start_time; end = a.open_moments.end_time; title = a.open_moments.name }
        else if (a.staff_shifts) { date = a.staff_shifts.shift_date; start = a.staff_shifts.start_time; end = a.staff_shifts.end_time; title = a.staff_shifts.title }
        if (date === targetDate && start && end && start < targetEnd && end > targetStart) {
          conflicts.push({ title, time: formatTime(start) })
        }
      })
    return conflicts
  }

  // ── STAFF TABLE CRUD ─────────────────────────────────────
  async function createStaffMember() {
    if (!newStaffMember.name || !newStaffMember.pin) {
      setStaffMemberMsg({ type: 'error', text: 'Name and PIN are required.' }); return
    }
    setAddingStaffMember(true)
    const { error } = await supabase.from('staff').insert({
      name: newStaffMember.name, pin: newStaffMember.pin,
      email: newStaffMember.email || null,
      phone: newStaffMember.phone || null,
      notes: newStaffMember.notes || null,
      is_vendor: newStaffMember.is_vendor,
      vendor_name: newStaffMember.is_vendor ? (newStaffMember.vendor_name || null) : null,
      is_checkin: newStaffMember.is_checkin,
      is_active: true
    })
    if (!error) {
      setStaffMemberMsg({ type: 'success', text: 'Staff member added.' })
      setNewStaffMember({ name: '', pin: '', email: '', phone: '', notes: '', is_vendor: false, vendor_name: '', is_checkin: false })
      await loadAll()
    } else setStaffMemberMsg({ type: 'error', text: error.message.includes('unique') ? 'PIN already in use.' : 'Could not add staff member.' })
    setAddingStaffMember(false)
  }

  async function updateStaffMember() {
    if (!editingStaffMember) return
    setSavingStaffMember(true)
    const { error } = await supabase.from('staff').update({
      name: editStaffMemberData.name,
      pin: editStaffMemberData.pin,
      email: editStaffMemberData.email || null,
      phone: editStaffMemberData.phone || null,
      notes: editStaffMemberData.notes || null,
      is_vendor: editStaffMemberData.is_vendor,
      vendor_name: editStaffMemberData.is_vendor ? (editStaffMemberData.vendor_name || null) : null,
      is_checkin: editStaffMemberData.is_checkin,
    }).eq('id', editingStaffMember.id)
    if (!error) {
      setEditingStaffMember(null)
      setEditStaffMemberData({})
      await loadAll()
    } else {
      setStaffMemberMsg({ type: 'error', text: error.message.includes('unique') ? 'PIN already in use.' : 'Could not update staff member.' })
    }
    setSavingStaffMember(false)
  }

  async function toggleStaffActive(id, current) {
    setTogglingStaffId(id)
    await supabase.from('staff').update({ is_active: !current }).eq('id', id)
    await loadAll()
    setTogglingStaffId(null)
  }

  async function deleteStaffMember(id, name) {
    if ((staffDeleteInput[id] || '') !== name) return
    // Clear join-table rows first — staff_workshop_assignments has a FK on
    // staff_id with no cascade, so deleting the staff row first would fail.
    await supabase.from('staff_workshop_assignments').delete().eq('staff_id', id)
    await supabase.from('staff').delete().eq('id', id)
    setStaffDeleteInput(d => { const n = { ...d }; delete n[id]; return n })
    await loadAll()
  }

  async function addStaffEventAssn(staffId, eventId) {
    if (!eventId) return
    await supabase.from('staff_event_assignments').insert({ staff_id: staffId, event_id: eventId })
    await loadAll()
  }

  // Removing someone from an event should also clear whatever they were
  // assigned to *within* that event — otherwise they keep showing up on
  // sessions/moments/shifts (and workshop-wide vendor coverage) there even
  // though they've been taken off the event itself.
  async function removeStaffEventAssn(assnRow) {
    const { id, staff_id: staffId, event_id: eventId } = assnRow
    await supabase.from('staff_event_assignments').delete().eq('id', id)

    const sessionIds = sessions.filter(s => s.event_id === eventId).map(s => s.id)
    const momentIds = openMoments.filter(m => m.event_id === eventId).map(m => m.id)
    const shiftIds = staffShifts.filter(s => s.event_id === eventId).map(s => s.id)
    const workshopIds = [...new Set(sessions.filter(s => s.event_id === eventId).map(s => s.workshop_id).filter(Boolean))]

    await Promise.all([
      sessionIds.length > 0 ? supabase.from('staff_assignments').delete().eq('staff_id', staffId).in('session_id', sessionIds) : null,
      momentIds.length > 0 ? supabase.from('staff_assignments').delete().eq('staff_id', staffId).in('moment_id', momentIds) : null,
      shiftIds.length > 0 ? supabase.from('staff_assignments').delete().eq('staff_id', staffId).in('shift_id', shiftIds) : null,
      workshopIds.length > 0 ? supabase.from('staff_workshop_assignments').delete().eq('staff_id', staffId).in('workshop_id', workshopIds) : null,
    ].filter(Boolean))

    await loadAll()
  }

  async function addStaffWorkshopAssn(staffId, workshopId) {
    if (!workshopId) return
    await supabase.from('staff_workshop_assignments').insert({ staff_id: staffId, workshop_id: workshopId })
    await loadAll()
  }

  async function removeStaffWorkshopAssn(id) {
    await supabase.from('staff_workshop_assignments').delete().eq('id', id)
    await loadAll()
  }

  async function savePins() {
    const updates = []
    if (newPins.super_admin_pin) updates.push(supabase.from('admin_settings').update({ value: newPins.super_admin_pin }).eq('key', 'super_admin_pin'))
    if (newPins.admin_pin) updates.push(supabase.from('admin_settings').update({ value: newPins.admin_pin }).eq('key', 'admin_pin'))
    await Promise.all(updates)
    setSettingsMsg({ type: 'success', text: 'PINs updated.' })
    setNewPins({ super_admin_pin: '', admin_pin: '' })
  }

  // ── STYLES ────────────────────────────────────────────────
  const card = { background: '#fff', border: '0.5px solid #e8e8e8', borderRadius: 12, padding: '14px 18px', marginBottom: 10 }
  const inp = { width: '100%', fontSize: 14, padding: '9px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', boxSizing: 'border-box' }
  const btn = (bg, color) => ({ padding: '8px 16px', borderRadius: 8, border: bg === '#fff' ? '0.5px solid #d0d0d0' : 'none', background: bg, color: color || '#1a1a1a', fontSize: 13, cursor: 'pointer', fontWeight: bg === '#1a1a1a' || bg === '#c0392b' ? 500 : 400 })
  const lbl = { fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }
  const fw = { marginBottom: 12 }

  function Msg({ msg }) {
    if (!msg) return null
    const colors = { success: ['#f0faf4', '#1a7a4a', '#a3d9b8'], warning: ['#fffbea', '#8a6000', '#f5d88a'], error: ['#fff0f0', '#c0392b', '#f5c0c0'] }
    const [bg, color, border] = colors[msg.type] || colors.error
    return <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13, background: bg, color, border: '0.5px solid ' + border }}>{msg.text}</div>
  }

  function TabBar({ tabs, active, onChange }) {
    return (
      <div className="tab-scroll" style={{
        display: 'block',
        overflowX: 'scroll',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        margin: '0 -16px',
        padding: '0 16px',
        borderBottom: '0.5px solid #e0e0e0',
        marginBottom: 20
      }}>
        <div style={{ display: 'flex', width: 'max-content' }}>
          {tabs.map(t => (
            <button key={t} onClick={() => onChange(t)} style={{ padding: '7px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: active === t ? '#1a1a1a' : '#888', borderBottom: active === t ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -1, fontWeight: active === t ? 500 : 400, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── PIN SCREEN ────────────────────────────────────────────
  if (!role) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 320, width: '100%' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Snow Peak USA</div>
        <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 24 }}>Staff Access</div>
        <input type="password" placeholder="Enter PIN" value={pin}
          onChange={e => { setPin(e.target.value); setPinError('') }}
          onKeyDown={e => e.key === 'Enter' && checkPin()}
          style={{ ...inp, marginBottom: 8, fontSize: 15, padding: '10px 12px' }} />
        {pinError && <div style={{ color: '#e74c3c', fontSize: 13, marginBottom: 8 }}>{pinError}</div>}
        <button onClick={checkPin} disabled={loading} style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#1a1a1a', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
          {loading ? 'Checking...' : 'Sign In'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/login" style={{ fontSize: 12, color: '#888' }}>Staff? Sign in with email →</a>
        </div>
      </div>
    </div>
  )

  // ── INSTRUCTOR VIEW ───────────────────────────────────────
  if (role === 'instructor') {
    const mySessions = sessions.filter(s => s.workshop_id === instructorWorkshop?.id)
    return (
      <div style={{ fontFamily: 'sans-serif', maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Instructor View · Read Only</div>
        <div style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>{instructorWorkshop?.name}</div>
        {instructorWorkshop?.location && <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>📍 {instructorWorkshop.location}</div>}
        <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>{instructorWorkshop?.instructor}</div>
        {mySessions.map(session => {
          const confirmed = registrations.filter(r => r.session_id === session.id && r.status === 'confirmed')
          const enrolled = confirmed.reduce((s, r) => s + (r.party_size || 1), 0)
          return (
            <div key={session.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{formatTime(session.start_time)} – {formatTime(session.end_time)}</div>
                <div style={{ fontSize: 13, color: enrolled >= session.capacity ? '#c0392b' : '#888' }}>{enrolled} / {session.capacity}</div>
              </div>
              {confirmed.length === 0 ? (
                <div style={{ fontSize: 13, color: '#aaa' }}>No registrations yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {confirmed.map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#f9f9f9', borderRadius: 6, fontSize: 13 }}>
                      <span>{r.guests?.name}</span>
                      {r.party_size > 1 && <span style={{ color: '#888' }}>party of {r.party_size}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── MAIN ADMIN ────────────────────────────────────────────
  const adminTabs = ['dashboard', 'check-in', 'guests', 'program', 'camp guide', 'staff & vendors']
  const superTabs = [...adminTabs, 'ticket types', 'events', 'settings']
  const tabs = role === 'super' ? superTabs : adminTabs

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 960, width: '100%', boxSizing: 'border-box', margin: '0 auto', padding: '24px 16px', color: '#1a1a1a' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
            {staffRecord?.name ? staffRecord.name + ' · ' : ''}{role === 'super' ? 'Super Admin' : 'Admin'} · Snow Peak USA
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>Event Manager</div>
          {/* Event switcher */}
          {events.filter(ev => !ev.is_archived).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {events.filter(ev => !ev.is_archived).map(ev => {
                const past = isPastEvent(ev)
                const isSelected = selectedEvent?.id === ev.id
                return (
                  <button key={ev.id} onClick={() => setSelectedEvent(ev)} style={{
                    padding: '4px 12px', borderRadius: 20, border: '0.5px solid',
                    borderColor: isSelected ? '#1a1a1a' : '#d0d0d0',
                    background: isSelected ? '#1a1a1a' : past ? '#f5f5f5' : '#fff',
                    color: isSelected ? '#fff' : past ? '#aaa' : '#666',
                    fontSize: 12, cursor: 'pointer'
                  }}>
                    {ev.name} <span style={{ opacity: 0.6, fontSize: 10 }}>{past ? 'Past' : ev.status}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={loadAll} style={btn('#fff')}>↻ Refresh</button>
          <button onClick={adminSignOut} style={btn('#fff')}>Sign out</button>
        </div>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={t => { setActiveTab(t); setGuestSubTab('add') }} />

      {/* ── DASHBOARD ── */}
      {activeTab === 'dashboard' && (
        <div>
          {selectedEvent && (
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              Showing: <strong style={{ color: '#1a1a1a' }}>{selectedEvent.name}</strong> · {selectedEvent.location} · {selectedEvent.start_date} to {selectedEvent.end_date}
              {selectedEvent.registration_opens_at && <span> · Registration opens {new Date(selectedEvent.registration_opens_at).toLocaleString()}</span>}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Guests', value: guestEvents.filter(ge => ge.event_id === selectedEvent?.id).length },
              { label: 'Registrations', value: filteredRegs.filter(r => r.status === 'confirmed').length },
              { label: 'Capacity used', value: overallPct + '%' },
              { label: 'Spots remaining', value: totalCap - totalEnrolled }
            ].map(s => (
              <div key={s.label} style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ fontSize: 24, fontWeight: 500 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>Overall capacity</span>
              <span style={{ color: '#888' }}>{totalEnrolled} of {totalCap} seats</span>
            </div>
            <div style={{ background: '#e0e0e0', borderRadius: 4, height: 8 }}>
              <div style={{ width: Math.min(overallPct, 100) + '%', height: 8, borderRadius: 4, background: overallPct >= 90 ? '#c0392b' : overallPct >= 70 ? '#e67e22' : '#1a7a4a' }} />
            </div>
          </div>

          {/* Credits vs Capacity — client-side from already-loaded guestEvents/guests/sessions, no extra queries */}
          {(() => {
            const eventGuestEvents = guestEvents.filter(ge => ge.event_id === selectedEvent?.id)
            const totalCreditsAvailable = eventGuestEvents.reduce((sum, ge) => {
              if (ge.credits_total) return sum + ge.credits_total
              const guest = guests.find(g => g.id === ge.guest_id)
              if (!guest?.ticket_types) return sum
              return sum + guest.ticket_types.credits_per_person * guest.ticket_types.party_cap
            }, 0)
            const seatsPerCredit = totalCreditsAvailable > 0 ? totalCap / totalCreditsAvailable : null
            const coveragePct = seatsPerCredit !== null ? Math.round(seatsPerCredit * 100) : null
            const status = seatsPerCredit === null ? 'none' : seatsPerCredit >= 1 ? 'good' : seatsPerCredit >= 0.8 ? 'warn' : 'bad'
            const colors = {
              good: { bg: '#eafaf0', border: '#a3d9b8', text: '#1a7a4a' },
              warn: { bg: '#fff8ec', border: '#f0d880', text: '#8a6000' },
              bad: { bg: '#fff0f0', border: '#f5c0c0', text: '#c0392b' },
              none: { bg: '#f5f5f5', border: '#e0e0e0', text: '#888' }
            }[status]
            const message = {
              good: 'Workshop capacity covers all guest credits',
              warn: 'Slightly undersupplied — consider adding sessions',
              bad: 'Not enough workshop capacity for available credits',
              none: 'No guest credits issued yet for this event.'
            }[status]

            return (
              <div style={{ background: colors.bg, border: '0.5px solid ' + colors.border, borderRadius: 8, padding: '14px 18px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 }}>Credits vs Capacity</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 600, color: colors.text }}>
                      {coveragePct === null ? '—' : coveragePct + '%'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {seatsPerCredit === null ? 'coverage' : seatsPerCredit.toFixed(1) + ' seats per credit'}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    {totalCap} workshop seats · {totalCreditsAvailable} credits available
                  </div>
                </div>
                <div style={{ fontSize: 13, color: colors.text, fontWeight: 500 }}>{message}</div>
              </div>
            )
          })()}

          {sessionsByWorkshop.map(w => (
            <div key={w.id} style={card}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{w.name}</div>
              {w.location && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>📍 {w.location}</div>}
              {!w.location && <div style={{ marginBottom: 8 }} />}
              {w.sessions.map(s => {
                const enrolled = getEnrolled(s.id)
                const pct = Math.round((enrolled / s.capacity) * 100)
                const regs = filteredRegs.filter(r => r.session_id === s.id && r.status === 'confirmed')
                return (
                  <div key={s.id} style={{ padding: '8px 10px', background: '#f9f9f9', borderRadius: 8, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                      <span style={{ fontSize: 12, color: pct >= 100 ? '#c0392b' : pct >= 80 ? '#e67e22' : '#1a7a4a', fontWeight: 500 }}>
                        {enrolled}/{s.capacity} · {s.capacity - enrolled} left
                      </span>
                    </div>
                    <div style={{ background: '#e0e0e0', borderRadius: 3, height: 5, marginBottom: regs.length > 0 ? 5 : 0 }}>
                      <div style={{ width: Math.min(pct, 100) + '%', height: 5, borderRadius: 3, background: pct >= 100 ? '#c0392b' : pct >= 80 ? '#e67e22' : '#1a7a4a' }} />
                    </div>
                    {regs.length > 0 && (
                      <div style={{ fontSize: 11, color: '#888' }}>
                        {regs.map(r => r.guests?.name + (r.party_size > 1 ? ' ×' + r.party_size : '')).join(' · ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── GUESTS ── */}
      {activeTab === 'guests' && (
        <div>
          {selectedEvent && (
            <div style={{ fontSize: 13, color: '#888', marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 8 }}>
              Adding guests to: <strong style={{ color: '#1a1a1a' }}>{selectedEvent.name}</strong>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {['add', 'bulk import', 'list'].map(t => (
              <button key={t} onClick={() => setGuestSubTab(t)} style={{ padding: '5px 14px', borderRadius: 20, border: '0.5px solid', borderColor: guestSubTab === t ? '#1a1a1a' : '#d0d0d0', background: guestSubTab === t ? '#1a1a1a' : '#fff', color: guestSubTab === t ? '#fff' : '#666', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                {t}
              </button>
            ))}
          </div>

          {guestSubTab === 'add' && (
            <div style={{ maxWidth: 480 }}>
              <Msg msg={guestMsg} />
              {[{ label: 'Full name', key: 'name', type: 'text', ph: 'Alice Chen' }, { label: 'Email', key: 'email', type: 'email', ph: 'alice@example.com' }].map(f => (
                <div key={f.key} style={fw}>
                  <label style={lbl}>{f.label}</label>
                  <input type={f.type} value={newGuest[f.key]} onChange={e => setNewGuest(g => ({ ...g, [f.key]: e.target.value }))} placeholder={f.ph} style={inp} />
                </div>
              ))}
              <div style={fw}>
                <label style={lbl}>Ticket type</label>
                <select value={newGuest.ticket_type_id} onChange={e => setNewGuest(g => ({ ...g, ticket_type_id: e.target.value }))} style={inp}>
                  <option value="">Select...</option>
                  {ticketTypes.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · party of {tt.party_cap} · {tt.credits_per_person * tt.party_cap} credits</option>)}
                </select>
              </div>
              <button onClick={addGuest} disabled={addingGuest} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '11px' }}>
                {addingGuest ? 'Adding...' : 'Add guest'}
              </button>
            </div>
          )}

          {guestSubTab === 'bulk import' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ padding: 14, background: '#f9f9f9', borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>CSV format</div>
                <code style={{ fontSize: 12, color: '#555' }}>Name, Email, Ticket Type Name</code>
                <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Valid types: {ticketTypes.map(t => t.name).join(', ')}</div>
              </div>
              <textarea value={bulkCSV} onChange={e => { setBulkCSV(e.target.value); setBulkPreview([]); setBulkResults(null) }}
                placeholder={'Alice Chen, alice@example.com, 4P Cabin\nBob Marley, bob@example.com, 5P Tentsite'}
                style={{ width: '100%', height: 150, fontSize: 13, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', boxSizing: 'border-box', fontFamily: 'monospace', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={() => { setBulkPreview(parseBulkCSV(bulkCSV)); setBulkResults(null) }} style={btn('#fff')}>Preview</button>
                {bulkPreview.length > 0 && (
                  <button onClick={bulkImport} disabled={bulkImporting} style={btn('#1a1a1a', '#fff')}>
                    {bulkImporting ? 'Importing...' : 'Import ' + bulkPreview.length + ' guests'}
                  </button>
                )}
              </div>
              {bulkPreview.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {bulkPreview.map((row, i) => {
                    const tt = ticketTypes.find(t => t.name.toLowerCase() === row.ticket_type_name.toLowerCase())
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: tt ? '#f0faf4' : '#fff0f0', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                        <span>{row.name} · {row.email}</span>
                        <span style={{ color: tt ? '#1a7a4a' : '#c0392b' }}>{tt ? row.ticket_type_name : '✗ not found'}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Detailed import results ── */}
              {bulkResults && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                    <div style={{ flex: '1 1 130px', padding: '10px 14px', borderRadius: 8, background: '#f0faf4', border: '0.5px solid #a3d9b8' }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: '#1a7a4a' }}>{bulkResults.added}</div>
                      <div style={{ fontSize: 11, color: '#1a7a4a' }}>new guest{bulkResults.added === 1 ? '' : 's'} added</div>
                    </div>
                    <div style={{ flex: '1 1 130px', padding: '10px 14px', borderRadius: 8, background: '#f0faf4', border: '0.5px solid #a3d9b8' }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: '#1a7a4a' }}>{bulkResults.linked}</div>
                      <div style={{ fontSize: 11, color: '#1a7a4a' }}>existing guest{bulkResults.linked === 1 ? '' : 's'} linked to this event</div>
                    </div>
                    <div style={{ flex: '1 1 130px', padding: '10px 14px', borderRadius: 8, background: '#fffbea', border: '0.5px solid #f5d88a' }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: '#8a6000' }}>{bulkResults.alreadyRegistered}</div>
                      <div style={{ fontSize: 11, color: '#8a6000' }}>already registered for this event</div>
                    </div>
                    <div style={{ flex: '1 1 130px', padding: '10px 14px', borderRadius: 8, background: bulkResults.failed.length > 0 ? '#fff0f0' : '#f9f9f9', border: '0.5px solid ' + (bulkResults.failed.length > 0 ? '#f5c0c0' : '#e0e0e0') }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: bulkResults.failed.length > 0 ? '#c0392b' : '#888' }}>{bulkResults.failed.length}</div>
                      <div style={{ fontSize: 11, color: bulkResults.failed.length > 0 ? '#c0392b' : '#888' }}>failed</div>
                    </div>
                  </div>

                  {bulkResults.failed.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#c0392b', marginBottom: 6 }}>Failed rows</div>
                      {bulkResults.failed.map((f, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '7px 10px', background: '#fff0f0', borderRadius: 6, fontSize: 12, marginBottom: 4 }}>
                          <span>{f.name} · {f.email}</span>
                          <span style={{ color: '#c0392b' }}>{f.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {guestSubTab === 'list' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search..." value={guestSearch} onChange={e => setGuestSearch(e.target.value)}
                  style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0' }} />
                <button
                  onClick={exportInviteLinks}
                  style={btn('#fff')}
                >
                  ↓ Export CSV ({filteredGuests.length})
                </button>
              </div>
              {filteredGuests.map(guest => {
                const total = getGuestTotal(guest)
                const used = getGuestCreditsUsed(guest.id)
                const remaining = total - used
                const guestEvent = guestEvents.find(x => x.guest_id === guest.id && x.event_id === selectedEvent?.id)
                const hasCustomCredits = guestEvent?.credits_total != null
                const gRegs = filteredRegs.filter(r => r.guest_id === guest.id && r.status === 'confirmed')
                const isDeleting = deleteConfirm[guest.id] !== undefined
                return (
                  <div key={guest.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{guest.name}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{guest.email}</div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{guest.ticket_types?.name} · {remaining} of {total} credits remaining</span>
                          {guest.waiver_signed && <span style={{ color: '#1a7a4a' }}>✓ waiver</span>}
                          {hasCustomCredits && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: '#fff8ec', color: '#9a5a18', border: '0.5px solid #e8c080' }}>Custom</span>
                          )}
                        </div>
                        {hasCustomCredits && guestEvent?.credit_notes && (
                          <div style={{ fontSize: 11, color: '#aaa', fontStyle: 'italic', marginTop: 2 }}>{guestEvent.credit_notes}</div>
                        )}
                        {guestEvent?.booking_summary && (
                          <div style={{ fontSize: 12, color: '#9a5a18', marginTop: 4 }}>📋 {guestEvent.booking_summary}</div>
                        )}
                        {gRegs.length > 0 && (
                          <div style={{ fontSize: 11, color: '#1a7a4a', marginTop: 4 }}>
                            ✓ {gRegs.map(r => r.sessions?.workshops?.name + (r.party_size > 1 ? ' ×' + r.party_size : '')).join(', ')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        {isRegistrationOpenForEvent(selectedEvent) ? (
                          <button onClick={() => { const base = window.location.origin.replace('/admin', ''); navigator.clipboard.writeText(base + '?token=' + guest.token + (selectedEvent ? '&event=' + selectedEvent.id : '')) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                            Copy link
                          </button>
                        ) : (
                          <span style={{ fontSize: 11, padding: '4px 10px', color: '#aaa' }}>Not open yet</span>
                        )}
                        <button onClick={() => { setEditingGuestTicket(guest.id); setEditGuestTicketTypeId(guest.ticket_type_id || ''); setGuestTicketMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                          Ticket type
                        </button>
                        <button onClick={() => { setAdjustingGuest(guest); setNewCreditsAvail(total); setNewCreditNotes(guestEvent?.credit_notes || ''); setNewBookingSummary(guestEvent?.booking_summary || ''); setCreditsMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                          Credits
                        </button>
                        {!isDeleting ? (
                          <button onClick={() => setDeleteConfirm(d => ({ ...d, [guest.id]: '' }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input placeholder={'Type "' + guest.name + '" to confirm'} value={deleteConfirm[guest.id] || ''}
                              onChange={e => setDeleteConfirm(d => ({ ...d, [guest.id]: e.target.value }))}
                              style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #f5c0c0', width: 150 }} />
                            <button onClick={() => deleteGuest(guest.id, guest.name)} disabled={deleteConfirm[guest.id] !== guest.name}
                              style={{ ...btn(deleteConfirm[guest.id] === guest.name ? '#c0392b' : '#e0e0e0', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                            <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n[guest.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                          </div>
                        )}
                      </div>
                    </div>
                    {editingGuestTicket === guest.id && (
                      <div style={{ marginTop: 12, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
                        <div style={{ fontSize: 13, marginBottom: 10 }}>Change ticket type for {guest.name}</div>
                        <Msg msg={guestTicketMsg} />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select value={editGuestTicketTypeId} onChange={e => setEditGuestTicketTypeId(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 220, marginBottom: 0 }}>
                            <option value="">Select...</option>
                            {ticketTypes.map(tt => <option key={tt.id} value={tt.id}>{tt.name} · party of {tt.party_cap} · {tt.credits_per_person * tt.party_cap} credits</option>)}
                          </select>
                          <button onClick={updateGuestTicketType} disabled={savingGuestTicket || !editGuestTicketTypeId} style={btn('#1a1a1a', '#fff')}>
                            {savingGuestTicket ? 'Saving...' : 'Save'}
                          </button>
                          <button onClick={() => { setEditingGuestTicket(null); setGuestTicketMsg(null) }} style={btn('#fff')}>Cancel</button>
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>
                          Changing this changes their default credit total ({total} credits currently) — use "Credits" instead if you just want a one-off override for this event.
                        </div>
                      </div>
                    )}
                    {adjustingGuest?.id === guest.id && (
                      <div style={{ marginTop: 12, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
                        <div style={{ fontSize: 13, marginBottom: 10 }}>Set available credits for {guest.name} at {selectedEvent?.name}</div>
                        <Msg msg={creditsMsg} />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => setNewCreditsAvail(c => Math.max(used, c - 1))} style={{ width: 32, height: 32, borderRadius: 6, border: '0.5px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 18 }}>−</button>
                          <span style={{ fontSize: 18, fontWeight: 500, minWidth: 32, textAlign: 'center' }}>{newCreditsAvail}</span>
                          <button onClick={() => setNewCreditsAvail(c => c + 1)} style={{ width: 32, height: 32, borderRadius: 6, border: '0.5px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 18 }}>+</button>
                          <span style={{ fontSize: 12, color: '#888' }}>credits available (default: {total})</span>
                          <button onClick={() => saveCredits(guest)} style={btn('#1a1a1a', '#fff')}>Save</button>
                          <button onClick={() => { setAdjustingGuest(null); setNewCreditNotes(''); setNewBookingSummary(''); setCreditsMsg(null) }} style={btn('#fff')}>Cancel</button>
                        </div>
                        {(hasCustomCredits || newCreditsAvail !== total) && (
                          <div style={{ marginTop: 10, maxWidth: 360 }}>
                            <label style={lbl}>Reason for override</label>
                            <input type="text" value={newCreditNotes} onChange={e => setNewCreditNotes(e.target.value)}
                              placeholder="e.g. 2 sites booked, comp upgrade, etc." style={inp} />
                          </div>
                        )}
                        <div style={{ marginTop: 10, maxWidth: 360 }}>
                          <label style={lbl}>Booking summary (shown to guest)</label>
                          <input type="text" value={newBookingSummary} onChange={e => setNewBookingSummary(e.target.value)}
                            placeholder="e.g. 2 sites: Large + Jyubako" style={inp} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── WORKSHOPS ── */}
      {activeTab === 'program' && (
        <div>
          {/* Add activity form */}
          <div style={{ maxWidth: 520, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
              Add activity {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <Msg msg={activityType === 'workshop' ? workshopMsg : momentMsg} />

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={() => setActivityType('workshop')} style={{
                flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid',
                borderColor: activityType === 'workshop' ? '#1a1a1a' : '#d0d0d0',
                background: activityType === 'workshop' ? '#1a1a1a' : '#fff',
                color: activityType === 'workshop' ? '#fff' : '#666',
                fontSize: 13, fontWeight: 500, cursor: 'pointer'
              }}>🧭 Workshop</button>
              <button onClick={() => setActivityType('moment')} style={{
                flex: 1, padding: '10px', borderRadius: 8, border: '0.5px solid',
                borderColor: activityType === 'moment' ? '#1a1a1a' : '#d0d0d0',
                background: activityType === 'moment' ? '#1a1a1a' : '#fff',
                color: activityType === 'moment' ? '#fff' : '#666',
                fontSize: 13, fontWeight: 500, cursor: 'pointer'
              }}>🌿 Open Moment</button>
            </div>

            {activityType === 'workshop' ? (
              <>
                {[
                  { label: 'Name *', key: 'name', ph: 'Camp Cooking with Thaan' },
                  { label: 'Category', key: 'category', ph: 'Food & Drink' },
                  { label: 'Instructor', key: 'instructor', ph: 'Thaan' },
                  { label: 'Location', key: 'location', ph: 'Main Pavilion, Campfire Circle...' },
                  { label: 'Description', key: 'description', ph: 'Optional' }
                ].map(f => (
                  <div key={f.key} style={fw}>
                    <label style={lbl}>{f.label}</label>
                    <input type="text" value={newWorkshop[f.key]} onChange={e => setNewWorkshop(w => ({ ...w, [f.key]: e.target.value }))} placeholder={f.ph} style={inp} />
                  </div>
                ))}
                <div style={fw}>
                  <label style={lbl}>Max per guest</label>
                  <input type="number" min="1" value={newWorkshop.max_per_guest} onChange={e => setNewWorkshop(w => ({ ...w, max_per_guest: e.target.value }))} style={{ ...inp, width: 100 }} />
                </div>
              </>
            ) : (
              <>
                <div style={fw}>
                  <label style={lbl}>Name *</label>
                  <input type="text" value={newMoment.name} onChange={e => setNewMoment(m => ({ ...m, name: e.target.value }))} placeholder="Campfire Gathering" style={inp} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => setNewMoment(m => ({ ...m, moment_type: 'mandatory' }))} style={{
                    flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid',
                    borderColor: newMoment.moment_type === 'mandatory' ? '#1a1a1a' : '#d0d0d0',
                    background: newMoment.moment_type === 'mandatory' ? '#1a1a1a' : '#fff',
                    color: newMoment.moment_type === 'mandatory' ? '#fff' : '#666',
                    fontSize: 12, cursor: 'pointer'
                  }}>⛺ All Campers</button>
                  <button onClick={() => setNewMoment(m => ({ ...m, moment_type: 'optional' }))} style={{
                    flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid',
                    borderColor: newMoment.moment_type === 'optional' ? '#1a1a1a' : '#d0d0d0',
                    background: newMoment.moment_type === 'optional' ? '#1a1a1a' : '#fff',
                    color: newMoment.moment_type === 'optional' ? '#fff' : '#666',
                    fontSize: 12, cursor: 'pointer'
                  }}>🌿 Drop-in</button>
                  <button onClick={() => setNewMoment(m => ({ ...m, moment_type: 'amenity', date: '' }))} style={{
                    flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid',
                    borderColor: newMoment.moment_type === 'amenity' ? '#1a1a1a' : '#d0d0d0',
                    background: newMoment.moment_type === 'amenity' ? '#1a1a1a' : '#fff',
                    color: newMoment.moment_type === 'amenity' ? '#fff' : '#666',
                    fontSize: 12, cursor: 'pointer'
                  }}>🏕️ Amenity</button>
                </div>
                <div style={fw}><label style={lbl}>Location</label><input type="text" value={newMoment.location} onChange={e => setNewMoment(m => ({ ...m, location: e.target.value }))} placeholder="Main Field" style={inp} /></div>
                <div style={fw}><label style={lbl}>Description</label><input type="text" value={newMoment.description} onChange={e => setNewMoment(m => ({ ...m, description: e.target.value }))} placeholder="Optional" style={inp} /></div>
              </>
            )}

            {activityType === 'moment' && newMoment.moment_type === 'amenity' ? (
              <>
                <div style={fw}>
                  <label style={lbl}>Hours</label>
                  <input type="text" value={newMoment.hours_text} onChange={e => setNewMoment(m => ({ ...m, hours_text: e.target.value }))}
                    placeholder="Fri 11am–10pm · Sat 8am–10pm · Sun 8am–1pm" style={inp} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: -6, marginBottom: 12 }}>Amenities repeat daily — no date needed.</div>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: activityType === 'workshop' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lbl}>Date</label>
                  <input type="date" value={(activityType === 'workshop' ? newWorkshop.date : newMoment.date) || ''}
                    onChange={e => activityType === 'workshop' ? setNewWorkshop(w => ({ ...w, date: e.target.value })) : setNewMoment(m => ({ ...m, date: e.target.value }))}
                    placeholder={selectedEvent?.start_date} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Start time</label>
                  <input type="time" value={(activityType === 'workshop' ? newWorkshop.start_time : newMoment.start_time) || ''}
                    onChange={e => activityType === 'workshop' ? setNewWorkshop(w => ({ ...w, start_time: e.target.value })) : setNewMoment(m => ({ ...m, start_time: e.target.value }))}
                    style={inp} />
                </div>
                <div>
                  <label style={lbl}>End time</label>
                  <input type="time" value={(activityType === 'workshop' ? newWorkshop.end_time : newMoment.end_time) || ''}
                    onChange={e => activityType === 'workshop' ? setNewWorkshop(w => ({ ...w, end_time: e.target.value })) : setNewMoment(m => ({ ...m, end_time: e.target.value }))}
                    style={inp} />
                </div>
                {activityType === 'workshop' && (
                  <div>
                    <label style={lbl}>Capacity</label>
                    <input type="number" value={newWorkshop.capacity} onChange={e => setNewWorkshop(w => ({ ...w, capacity: e.target.value }))} style={inp} />
                  </div>
                )}
              </div>
            )}

            <button
              onClick={activityType === 'workshop' ? addWorkshop : addMoment}
              disabled={activityType === 'workshop' ? addingWorkshop : addingMoment}
              style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}
            >
              {(activityType === 'workshop' ? addingWorkshop : addingMoment) ? 'Adding...' : 'Add activity'}
            </button>
          </div>

          {/* Unified chronological list */}
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
            Activities {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
          </div>
          {(() => {
            const workshopGroups = {}
            filteredSessions.forEach(s => {
              if (!workshopGroups[s.workshop_id]) workshopGroups[s.workshop_id] = { key: 'workshop_' + s.workshop_id, kind: 'workshop', workshop: s.workshops, sessions: [] }
              workshopGroups[s.workshop_id].sessions.push(s)
            })
            Object.values(workshopGroups).forEach(g => {
              g.sessions.sort((a, b) => (a.date + 'T' + a.start_time).localeCompare(b.date + 'T' + b.start_time))
              g.date = g.sessions[0]?.date
              g.start = g.sessions[0]?.start_time
            })

            const momentKind = m => m.moment_type === 'mandatory' ? 'mandatory' : m.moment_type === 'amenity' ? 'amenity' : 'optional'

            const rows = [
              ...Object.values(workshopGroups),
              ...filteredMoments.map(m => ({ key: 'moment_' + m.id, kind: momentKind(m), date: m.date, start: m.start_time, end: m.end_time, moment: m }))
            ].sort((a, b) => (a.date || '9999-99-99').localeCompare(b.date || '9999-99-99') || (a.start || '99:99:99').localeCompare(b.start || '99:99:99'))

            if (rows.length === 0) {
              return <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No activities yet for this event.</div>
            }

            const typeBadge = {
              workshop: { label: 'Workshop', bg: '#D4E4D4', color: '#2D4A2D' },
              mandatory: { label: 'All Campers', bg: '#C4A882', color: '#5C3D1E' },
              optional: { label: 'Drop-in', bg: '#F5E4CC', color: '#5C3D1E' },
              amenity: { label: 'Amenity', bg: '#D4E8EC', color: '#1A5C68' }
            }

            return rows.map(row => {
              const b = typeBadge[row.kind]

              /* ── WORKSHOP CARD ── */
              if (row.kind === 'workshop') {
                const w = row.workshop
                const isEditingThis = editingWorkshop?.id === w?.id
                const slotForm = getSessionForm(w?.id)
                const addingTime = addingTimeFor === w?.id

                return (
                  <div key={row.key} style={card}>
                    {isEditingThis ? (
                      <div>
                        {[
                          { label: 'Name *', key: 'name' },
                          { label: 'Category', key: 'category' },
                          { label: 'Instructor', key: 'instructor' },
                          { label: 'Location', key: 'location' },
                          { label: 'Description', key: 'description' }
                        ].map(f => (
                          <div key={f.key} style={fw}>
                            <label style={lbl}>{f.label}</label>
                            <input type="text" value={editWorkshopData[f.key] || ''} onChange={e => setEditWorkshopData(d => ({ ...d, [f.key]: e.target.value }))} style={inp} />
                          </div>
                        ))}
                        <div style={fw}>
                          <label style={lbl}>Max per guest</label>
                          <input type="number" min="1" value={editWorkshopData.max_per_guest ?? 1} onChange={e => setEditWorkshopData(d => ({ ...d, max_per_guest: e.target.value }))} style={{ ...inp, width: 100 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={updateWorkshop} disabled={savingWorkshop} style={btn('#1a1a1a', '#fff')}>{savingWorkshop ? 'Saving...' : 'Save'}</button>
                          <button onClick={() => { setEditingWorkshop(null); setEditWorkshopData({}) }} style={btn('#fff')}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Workshop name and details */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                          <div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                              <div style={{ fontSize: 14, fontWeight: 500 }}>{w?.name}</div>
                              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#888' }}>
                              {w?.category}{w?.instructor ? ' · ' + w.instructor : ''}
                              {w?.location ? ' · 📍 ' + w.location : ''}
                            </div>
                            {w?.description && <div style={{ fontSize: 12, color: '#aaa' }}>{w.description}</div>}
                          </div>
                          <button onClick={() => { setEditingWorkshop(w); setEditWorkshopData({ name: w.name, category: w.category || '', instructor: w.instructor || '', location: w.location || '', description: w.description || '', max_per_guest: w.max_per_guest || 1 }); setWorkshopMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>Edit</button>
                        </div>

                        {/* Sessions list */}
                        <div style={{ borderTop: '0.5px solid #ebebeb' }}>
                          {row.sessions.map(s => {
                            const enrolled = getEnrolled(s.id)
                            const isConfirmDelete = deleteConfirm['session_' + s.id]
                            const isEditingCap = editingCapacityId === s.id
                            return (
                              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderBottom: '0.5px solid #f2f2f2' }}>
                                <div>
                                  <div style={{ fontSize: 13, fontWeight: 500 }}>{s.date} · {formatTime(s.start_time)} – {formatTime(s.end_time)}</div>
                                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{enrolled}/{s.capacity} enrolled</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                                  {isEditingCap ? (
                                    <>
                                      <input type="number" min="1" value={editCapacityValue} onChange={e => setEditCapacityValue(e.target.value)} style={{ ...inp, width: 70, padding: '5px 8px' }} />
                                      <button onClick={() => updateSessionCapacity(s.id)} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 11, padding: '4px 10px' }}>Save</button>
                                      <button onClick={() => { setEditingCapacityId(null); setEditCapacityValue('') }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Cancel</button>
                                    </>
                                  ) : (
                                    <button onClick={() => { setEditingCapacityId(s.id); setEditCapacityValue(String(s.capacity)) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit capacity</button>
                                  )}
                                  {!isConfirmDelete ? (
                                    <button onClick={() => setDeleteConfirm(d => ({ ...d, ['session_' + s.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                                  ) : (
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      <button onClick={() => deleteSession(s.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                                      <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['session_' + s.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* + Add time slot — belongs to the workshop, not any one session */}
                        {!addingTime ? (
                          <button onClick={() => setAddingTimeFor(w?.id)} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', marginTop: 10 }}>+ Add time slot</button>
                        ) : (
                          <div style={{ marginTop: 10, borderTop: '0.5px solid #ebebeb', paddingTop: 12 }}>
                            <Msg msg={sessionMsgFor[w?.id]} />
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div>
                                <label style={lbl}>Date</label>
                                <input type="date" value={slotForm.date} onChange={e => setWorkshopSessionForms(f => ({ ...f, [w.id]: { ...slotForm, date: e.target.value } }))} style={{ ...inp, width: 150 }} />
                              </div>
                              <div>
                                <label style={lbl}>Start</label>
                                <input type="time" value={slotForm.start_time} onChange={e => setWorkshopSessionForms(f => ({ ...f, [w.id]: { ...slotForm, start_time: e.target.value } }))} style={{ ...inp, width: 130 }} />
                              </div>
                              <div>
                                <label style={lbl}>End</label>
                                <input type="time" value={slotForm.end_time} onChange={e => setWorkshopSessionForms(f => ({ ...f, [w.id]: { ...slotForm, end_time: e.target.value } }))} style={{ ...inp, width: 130 }} />
                              </div>
                              <div>
                                <label style={lbl}>Cap</label>
                                <input type="number" value={slotForm.capacity} onChange={e => setWorkshopSessionForms(f => ({ ...f, [w.id]: { ...slotForm, capacity: e.target.value } }))} style={{ ...inp, width: 70 }} />
                              </div>
                              <button onClick={async () => { const ok = await addInlineSession(w.id); if (ok) setAddingTimeFor(null) }} disabled={addingSessionFor === w.id} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 12, padding: '8px 14px' }}>
                                {addingSessionFor === w.id ? 'Saving...' : 'Save'}
                              </button>
                              <button onClick={() => { setAddingTimeFor(null); setSessionMsgFor(m => ({ ...m, [w.id]: null })) }} style={{ ...btn('#fff'), fontSize: 12, padding: '8px 14px' }}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              }

              /* ── OPEN MOMENT ROW ── */
              const m = row.moment
              return (
                <div key={row.key} style={card}>
                  {editingMoment?.id === m.id ? (
                    <div>
                      <div style={fw}>
                        <label style={lbl}>Name</label>
                        <input value={editMomentData.name || ''} onChange={e => setEditMomentData(d => ({ ...d, name: e.target.value }))} style={inp} />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        <button onClick={() => setEditMomentData(d => ({ ...d, moment_type: 'mandatory' }))} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid', borderColor: editMomentData.moment_type === 'mandatory' ? '#1a1a1a' : '#d0d0d0', background: editMomentData.moment_type === 'mandatory' ? '#1a1a1a' : '#fff', color: editMomentData.moment_type === 'mandatory' ? '#fff' : '#666', fontSize: 12, cursor: 'pointer' }}>⛺ All Campers</button>
                        <button onClick={() => setEditMomentData(d => ({ ...d, moment_type: 'optional' }))} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid', borderColor: editMomentData.moment_type === 'optional' ? '#1a1a1a' : '#d0d0d0', background: editMomentData.moment_type === 'optional' ? '#1a1a1a' : '#fff', color: editMomentData.moment_type === 'optional' ? '#fff' : '#666', fontSize: 12, cursor: 'pointer' }}>🌿 Drop-in</button>
                        <button onClick={() => setEditMomentData(d => ({ ...d, moment_type: 'amenity', date: '' }))} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '0.5px solid', borderColor: editMomentData.moment_type === 'amenity' ? '#1a1a1a' : '#d0d0d0', background: editMomentData.moment_type === 'amenity' ? '#1a1a1a' : '#fff', color: editMomentData.moment_type === 'amenity' ? '#fff' : '#666', fontSize: 12, cursor: 'pointer' }}>🏕️ Amenity</button>
                      </div>
                      {editMomentData.moment_type === 'amenity' ? (
                        <div style={fw}>
                          <label style={lbl}>Hours</label>
                          <input type="text" value={editMomentData.hours_text || ''} onChange={e => setEditMomentData(d => ({ ...d, hours_text: e.target.value }))}
                            placeholder="Fri 11am–10pm · Sat 8am–10pm · Sun 8am–1pm" style={inp} />
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div><label style={lbl}>Date</label><input type="date" value={editMomentData.date || ''} onChange={e => setEditMomentData(d => ({ ...d, date: e.target.value }))} style={inp} /></div>
                          <div><label style={lbl}>Start time</label><input type="time" value={editMomentData.start_time || ''} onChange={e => setEditMomentData(d => ({ ...d, start_time: e.target.value }))} style={inp} /></div>
                          <div><label style={lbl}>End time</label><input type="time" value={editMomentData.end_time || ''} onChange={e => setEditMomentData(d => ({ ...d, end_time: e.target.value }))} style={inp} /></div>
                        </div>
                      )}
                      <div style={fw}><label style={lbl}>Location</label><input value={editMomentData.location || ''} onChange={e => setEditMomentData(d => ({ ...d, location: e.target.value }))} style={inp} /></div>
                      <div style={fw}><label style={lbl}>Description</label><input value={editMomentData.description || ''} onChange={e => setEditMomentData(d => ({ ...d, description: e.target.value }))} style={inp} /></div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={updateMoment} disabled={savingMoment} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 12, padding: '6px 14px' }}>{savingMoment ? 'Saving...' : 'Save'}</button>
                        <button onClick={() => { setEditingMoment(null); setEditMomentData({}) }} style={{ ...btn('#fff'), fontSize: 12, padding: '6px 14px' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                          {m.date && m.date + ' · '}{m.start_time && formatTime(m.start_time)}{m.end_time && ' – ' + formatTime(m.end_time)}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}</span>
                        </div>
                        {m.location && <div style={{ fontSize: 12, color: '#888' }}>📍 {m.location}</div>}
                        {m.description && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{m.description}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                        <button onClick={() => { setEditingMoment(m); setEditMomentData({ ...m }) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                        {!deleteConfirm['moment_' + m.id] ? (
                          <button onClick={() => setDeleteConfirm(d => ({ ...d, ['moment_' + m.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button onClick={() => deleteMoment(m.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                            <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['moment_' + m.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* ── CHECK-IN ── */}
      {activeTab === 'check-in' && (
        <div>
          {!selectedEvent ? (
            <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>Select an event to view check-in.</div>
          ) : (() => {
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
              <>
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
                  const workshopCount = filteredRegs.filter(r => r.guest_id === guest.id && r.status === 'confirmed').length
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
                              <button key={s} onClick={() => updateCheckinStatus(guest.id, s)}
                                style={{ fontSize: 11, padding: '5px 11px', borderRadius: 6, border: '0.5px solid ' + c.border, background: c.bg, color: c.color, cursor: 'pointer', fontWeight: isActive ? 500 : 400 }}>
                                {statusLabels[s]}
                              </button>
                            )
                          })}
                          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#888', cursor: 'pointer', marginLeft: 6 }}>
                            <input type="checkbox" checked={!!guest.waiver_signed}
                              onChange={e => updateWaiverSigned(guest.id, e.target.checked)}
                              style={{ cursor: 'pointer' }} />
                            Waiver
                          </label>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()}
        </div>
      )}

      {/* ── CAMP GUIDE ── */}
      {activeTab === 'camp guide' && (
        <div>
          <TabBar tabs={['gear list', 'info', 'partners']} active={campGuideSubTab} onChange={setCampGuideSubTab} />

          {/* ── GEAR LIST ── */}
          {campGuideSubTab === 'gear list' && (
          <div>
          {/* Add gear item form */}
          <div style={{ maxWidth: 520, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
              Add gear item {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <Msg msg={gearMsg} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Name *</label>
                <input type="text" value={newGearItem.name} onChange={e => setNewGearItem(g => ({ ...g, name: e.target.value }))} placeholder="Sleeping Bag" style={inp} />
              </div>
              <div>
                <label style={lbl}>Category *</label>
                <input type="text" value={newGearItem.category} onChange={e => setNewGearItem(g => ({ ...g, category: e.target.value }))} placeholder="Shelter, Clothing, Cooking, Essentials" list="gear-categories" style={inp} />
                <datalist id="gear-categories">
                  {['Shelter', 'Clothing', 'Cooking', 'Essentials'].map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div style={{ ...fw }}>
              <label style={lbl}>Description</label>
              <input type="text" value={newGearItem.description} onChange={e => setNewGearItem(g => ({ ...g, description: e.target.value }))} placeholder="Optional note shown to guests" style={inp} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Link 1 label</label>
                <input type="text" value={newGearItem.link_1_label} onChange={e => setNewGearItem(g => ({ ...g, link_1_label: e.target.value }))} placeholder="Rent, Shop, Sign up…" style={inp} />
              </div>
              <div>
                <label style={lbl}>Link 1 URL</label>
                <input type="text" value={newGearItem.link_1_url} onChange={e => setNewGearItem(g => ({ ...g, link_1_url: e.target.value }))} placeholder="https://..." style={inp} />
              </div>
              <div>
                <label style={lbl}>Link 2 label</label>
                <input type="text" value={newGearItem.link_2_label} onChange={e => setNewGearItem(g => ({ ...g, link_2_label: e.target.value }))} placeholder="Optional" style={inp} />
              </div>
              <div>
                <label style={lbl}>Link 2 URL</label>
                <input type="text" value={newGearItem.link_2_url} onChange={e => setNewGearItem(g => ({ ...g, link_2_url: e.target.value }))} placeholder="https://... (optional)" style={inp} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={newGearItem.is_available_to_rent} onChange={e => setNewGearItem(g => ({ ...g, is_available_to_rent: e.target.checked }))} style={{ cursor: 'pointer' }} />
                Available to rent
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <label style={lbl} htmlFor="gear-sort">Sort order</label>
                <input id="gear-sort" type="number" value={newGearItem.sort_order} onChange={e => setNewGearItem(g => ({ ...g, sort_order: e.target.value }))} style={{ ...inp, width: 70, marginBottom: 0 }} />
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Visible to</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['both', 'Staff & Guests'], ['guests', 'Guests Only'], ['staff', 'Staff Only']].map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setNewGearItem(g => ({ ...g, visibility: v }))} style={{
                    padding: '6px 12px', borderRadius: 8, border: '0.5px solid', cursor: 'pointer', fontSize: 12,
                    borderColor: newGearItem.visibility === v ? '#1a1a1a' : '#d0d0d0',
                    background: newGearItem.visibility === v ? '#1a1a1a' : '#fff',
                    color: newGearItem.visibility === v ? '#fff' : '#555'
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <button onClick={addGearItem} disabled={addingGear} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingGear ? 'Adding...' : 'Add item'}
            </button>
          </div>

          {/* Gear list grouped by category */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              Gear list {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setCopyGearOpen(o => !o)}
                disabled={!selectedEvent || copyingGear}
                style={{ ...btn('#fff'), fontSize: 12, padding: '6px 12px' }}
              >
                Copy gear list from another event
              </button>
              {copyGearOpen && (
                events.filter(e => e.id !== selectedEvent?.id).length === 0 ? (
                  <span style={{ fontSize: 12, color: '#888' }}>No other events.</span>
                ) : (
                  <select
                    defaultValue=""
                    disabled={copyingGear}
                    onChange={e => { const id = e.target.value; if (id) copyGearFromEvent(id) }}
                    style={{ ...inp, width: 'auto', marginBottom: 0, fontSize: 13 }}
                  >
                    <option value="" disabled>{copyingGear ? 'Copying...' : 'Select an event…'}</option>
                    {events.filter(e => e.id !== selectedEvent?.id).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                )
              )}
            </div>
          </div>
          {(() => {
            const eventGear = selectedEvent
              ? gearItems.filter(gi => gi.event_id === selectedEvent.id)
              : gearItems
            if (eventGear.length === 0) {
              return <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No gear items yet for this event.</div>
            }
            const rawCats = [...new Set(eventGear.map(gi => gi.category))]
            const cats = orderGearCategories(rawCats, gearCategories, selectedEvent?.id)
            return cats.map((cat, catIndex) => (
              <div key={cat} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#aaa' }}>{cat}</div>
                  {cats.length > 1 && selectedEvent && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button
                        type="button"
                        disabled={catIndex === 0 || reorderingGearCat === cat}
                        onClick={() => moveGearCategory(cats, catIndex, -1, selectedEvent.id)}
                        title="Move category up"
                        style={{ fontSize: 11, padding: '1px 6px', border: '0.5px solid #d0d0d0', borderRadius: 4, background: '#fff', cursor: catIndex === 0 ? 'default' : 'pointer', color: catIndex === 0 ? '#ddd' : '#888', lineHeight: 1.4 }}
                      >↑</button>
                      <button
                        type="button"
                        disabled={catIndex === cats.length - 1 || reorderingGearCat === cat}
                        onClick={() => moveGearCategory(cats, catIndex, 1, selectedEvent.id)}
                        title="Move category down"
                        style={{ fontSize: 11, padding: '1px 6px', border: '0.5px solid #d0d0d0', borderRadius: 4, background: '#fff', cursor: catIndex === cats.length - 1 ? 'default' : 'pointer', color: catIndex === cats.length - 1 ? '#ddd' : '#888', lineHeight: 1.4 }}
                      >↓</button>
                    </div>
                  )}
                </div>
                {eventGear.filter(gi => gi.category === cat).map(gi => (
                  <div key={gi.id} style={card}>
                    {editingGearItem?.id === gi.id ? (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                          <div>
                            <label style={lbl}>Name *</label>
                            <input type="text" value={editGearData.name || ''} onChange={e => setEditGearData(d => ({ ...d, name: e.target.value }))} style={inp} />
                          </div>
                          <div>
                            <label style={lbl}>Category *</label>
                            <input type="text" value={editGearData.category || ''} onChange={e => setEditGearData(d => ({ ...d, category: e.target.value }))} list="gear-categories-edit" style={inp} />
                            <datalist id="gear-categories-edit">
                              {['Shelter', 'Clothing', 'Cooking', 'Essentials'].map(c => <option key={c} value={c} />)}
                            </datalist>
                          </div>
                        </div>
                        <div style={{ marginBottom: 10 }}>
                          <label style={lbl}>Description</label>
                          <input type="text" value={editGearData.description || ''} onChange={e => setEditGearData(d => ({ ...d, description: e.target.value }))} style={inp} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                          <div>
                            <label style={lbl}>Link 1 label</label>
                            <input type="text" value={editGearData.link_1_label || ''} onChange={e => setEditGearData(d => ({ ...d, link_1_label: e.target.value }))} placeholder="Rent, Shop, Sign up…" style={inp} />
                          </div>
                          <div>
                            <label style={lbl}>Link 1 URL</label>
                            <input type="text" value={editGearData.link_1_url || ''} onChange={e => setEditGearData(d => ({ ...d, link_1_url: e.target.value }))} placeholder="https://..." style={inp} />
                          </div>
                          <div>
                            <label style={lbl}>Link 2 label</label>
                            <input type="text" value={editGearData.link_2_label || ''} onChange={e => setEditGearData(d => ({ ...d, link_2_label: e.target.value }))} placeholder="Optional" style={inp} />
                          </div>
                          <div>
                            <label style={lbl}>Link 2 URL</label>
                            <input type="text" value={editGearData.link_2_url || ''} onChange={e => setEditGearData(d => ({ ...d, link_2_url: e.target.value }))} placeholder="https://... (optional)" style={inp} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!editGearData.is_available_to_rent} onChange={e => setEditGearData(d => ({ ...d, is_available_to_rent: e.target.checked }))} style={{ cursor: 'pointer' }} />
                            Available to rent
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <label style={{ ...lbl, marginBottom: 0 }}>Sort</label>
                            <input type="number" value={editGearData.sort_order ?? 0} onChange={e => setEditGearData(d => ({ ...d, sort_order: e.target.value }))} style={{ ...inp, width: 60 }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                          <label style={lbl}>Visible to</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {[['both', 'Staff & Guests'], ['guests', 'Guests Only'], ['staff', 'Staff Only']].map(([v, label]) => (
                              <button key={v} type="button" onClick={() => setEditGearData(d => ({ ...d, visibility: v }))} style={{
                                padding: '6px 12px', borderRadius: 8, border: '0.5px solid', cursor: 'pointer', fontSize: 12,
                                borderColor: editGearData.visibility === v ? '#1a1a1a' : '#d0d0d0',
                                background: editGearData.visibility === v ? '#1a1a1a' : '#fff',
                                color: editGearData.visibility === v ? '#fff' : '#555'
                              }}>{label}</button>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={updateGearItem} disabled={savingGear} style={btn('#1a1a1a', '#fff')}>{savingGear ? 'Saving...' : 'Save'}</button>
                          <button onClick={() => setEditingGearItem(null)} style={btn('#fff')}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{gi.name}</div>
                            {gi.is_available_to_rent && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#fff8ec', color: '#9a5a18', border: '0.5px solid #e8c080' }}>Rentable</span>}
                            {gi.visibility === 'staff' && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10, background: '#F5F0E8', color: '#A06000', border: '0.5px solid #E8C080' }}>Staff Only</span>}
                            {gi.visibility === 'guests' && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10, background: '#EEF3EE', color: '#2D4A2D', border: '0.5px solid #C0D4C0' }}>Guests Only</span>}
                          </div>
                          {gi.description && <div style={{ fontSize: 12, color: '#aaa' }}>{gi.description}</div>}
                          {(gi.link_1_url || gi.link_2_url) && (
                            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                              {gi.link_1_url && <span>{gi.link_1_label || 'Link 1'}: {gi.link_1_url} </span>}
                              {gi.link_2_url && <span>{gi.link_2_label || 'Link 2'}: {gi.link_2_url}</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                          <button onClick={() => { setEditingGearItem(gi); setEditGearData({ name: gi.name, category: gi.category, description: gi.description || '', link_1_label: gi.link_1_label || '', link_1_url: gi.link_1_url || '', link_2_label: gi.link_2_label || '', link_2_url: gi.link_2_url || '', is_available_to_rent: gi.is_available_to_rent, visibility: gi.visibility || 'both', sort_order: gi.sort_order }); setGearMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                          {!deleteConfirm['gear_' + gi.id] ? (
                            <button onClick={() => deleteGearItem(gi.id)} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button onClick={() => deleteGearItem(gi.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                              <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['gear_' + gi.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))
          })()}
          </div>
          )}

          {/* ── INFO ── */}
          {campGuideSubTab === 'info' && (
          <div>
          {/* Add info section form */}
          <div style={{ maxWidth: 520, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
              Add info section {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <Msg msg={infoSectionMsg} />
            <div style={fw}>
              <label style={lbl}>Title *</label>
              <input type="text" value={newInfoSection.title} onChange={e => setNewInfoSection(s => ({ ...s, title: e.target.value }))} placeholder="Site & Campfield" style={inp} />
            </div>
            <div style={fw}>
              <label style={lbl}>Content</label>
              <textarea value={newInfoSection.content} onChange={e => setNewInfoSection(s => ({ ...s, content: e.target.value }))} placeholder={'Plain text, one idea per line.\nmailto:info@snowpeak.com and tel:+18884244916 become tappable links.'} rows={4} style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div style={fw}>
              <label style={lbl}>Icon</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {INFO_SECTION_ICONS.map(icon => (
                  <button key={icon} type="button" onClick={() => setNewInfoSection(s => ({ ...s, icon }))}
                    style={{
                      fontSize: 18, width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
                      border: newInfoSection.icon === icon ? '1.5px solid #1a1a1a' : '0.5px solid #d0d0d0',
                      background: newInfoSection.icon === icon ? '#f5f2ec' : '#fff'
                    }}>
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
              <label style={lbl} htmlFor="info-sort">Sort order</label>
              <input id="info-sort" type="number" value={newInfoSection.sort_order} onChange={e => setNewInfoSection(s => ({ ...s, sort_order: e.target.value }))} style={{ ...inp, width: 70, marginBottom: 0 }} />
            </div>
            <button onClick={addInfoSection} disabled={addingInfoSection} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingInfoSection ? 'Adding...' : 'Add section'}
            </button>
          </div>

          {/* Info sections list */}
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
            Info sections {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
          </div>
          {(() => {
            const eventInfoSections = (selectedEvent
              ? infoSections.filter(s => s.event_id === selectedEvent.id)
              : infoSections
            ).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            if (eventInfoSections.length === 0) {
              return <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No info sections yet for this event.</div>
            }
            return eventInfoSections.map(s => (
              <div key={s.id} style={card}>
                {editingInfoSection?.id === s.id ? (
                  <div>
                    <div style={fw}>
                      <label style={lbl}>Title *</label>
                      <input type="text" value={editInfoSectionData.title || ''} onChange={e => setEditInfoSectionData(d => ({ ...d, title: e.target.value }))} style={inp} />
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Content</label>
                      <textarea value={editInfoSectionData.content || ''} onChange={e => setEditInfoSectionData(d => ({ ...d, content: e.target.value }))} rows={4} style={{ ...inp, resize: 'vertical' }} />
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Icon</label>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {INFO_SECTION_ICONS.map(icon => (
                          <button key={icon} type="button" onClick={() => setEditInfoSectionData(d => ({ ...d, icon }))}
                            style={{
                              fontSize: 18, width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
                              border: editInfoSectionData.icon === icon ? '1.5px solid #1a1a1a' : '0.5px solid #d0d0d0',
                              background: editInfoSectionData.icon === icon ? '#f5f2ec' : '#fff'
                            }}>
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <label style={{ ...lbl, marginBottom: 0 }}>Sort</label>
                      <input type="number" value={editInfoSectionData.sort_order ?? 0} onChange={e => setEditInfoSectionData(d => ({ ...d, sort_order: e.target.value }))} style={{ ...inp, width: 60 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={updateInfoSection} disabled={savingInfoSection} style={btn('#1a1a1a', '#fff')}>{savingInfoSection ? 'Saving...' : 'Save'}</button>
                      <button onClick={() => setEditingInfoSection(null)} style={btn('#fff')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 16 }}>{s.icon || '📄'}</span>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{s.title}</div>
                      </div>
                      {s.content && <div style={{ fontSize: 12, color: '#aaa', whiteSpace: 'pre-line' }}>{s.content}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button onClick={() => { setEditingInfoSection(s); setEditInfoSectionData({ title: s.title, content: s.content || '', icon: s.icon || '📄', sort_order: s.sort_order }); setInfoSectionMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                      {!deleteConfirm['info_' + s.id] ? (
                        <button onClick={() => deleteInfoSection(s.id)} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button onClick={() => deleteInfoSection(s.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                          <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['info_' + s.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          })()}
          </div>
          )}

          {/* ── PARTNERS ── */}
          {campGuideSubTab === 'partners' && (
          <div>
          {/* Add partner form */}
          <div style={{ maxWidth: 520, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
              Add partner {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <Msg msg={partnerMsg} />
            <div style={fw}>
              <label style={lbl}>Name *</label>
              <input type="text" value={newPartner.name} onChange={e => setNewPartner(p => ({ ...p, name: e.target.value }))} placeholder="Partner name" style={inp} />
            </div>
            <div style={fw}>
              <label style={lbl}>Description</label>
              <textarea value={newPartner.description} onChange={e => setNewPartner(p => ({ ...p, description: e.target.value }))} placeholder="2-3 sentences about who they are and what they're doing at the event" rows={3} style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Website URL</label>
                <input type="text" value={newPartner.website_url} onChange={e => setNewPartner(p => ({ ...p, website_url: e.target.value }))} placeholder="https://... (optional)" style={inp} />
              </div>
              <div>
                <label style={lbl}>Logo URL</label>
                <input type="text" value={newPartner.logo_url} onChange={e => setNewPartner(p => ({ ...p, logo_url: e.target.value }))} placeholder="Direct image URL (optional)" style={inp} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
              <label style={lbl} htmlFor="partner-sort">Sort order</label>
              <input id="partner-sort" type="number" value={newPartner.sort_order} onChange={e => setNewPartner(p => ({ ...p, sort_order: e.target.value }))} style={{ ...inp, width: 70, marginBottom: 0 }} />
            </div>
            <button onClick={addPartner} disabled={addingPartner} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingPartner ? 'Adding...' : 'Add partner'}
            </button>
          </div>

          {/* Partners list */}
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
            Partners {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
          </div>
          {(() => {
            const eventPartners = (selectedEvent
              ? partners.filter(p => p.event_id === selectedEvent.id)
              : partners
            ).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            if (eventPartners.length === 0) {
              return <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No partners yet for this event.</div>
            }
            return eventPartners.map(p => (
              <div key={p.id} style={card}>
                {editingPartner?.id === p.id ? (
                  <div>
                    <div style={fw}>
                      <label style={lbl}>Name *</label>
                      <input type="text" value={editPartnerData.name || ''} onChange={e => setEditPartnerData(d => ({ ...d, name: e.target.value }))} style={inp} />
                    </div>
                    <div style={fw}>
                      <label style={lbl}>Description</label>
                      <textarea value={editPartnerData.description || ''} onChange={e => setEditPartnerData(d => ({ ...d, description: e.target.value }))} rows={3} style={{ ...inp, resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                      <div>
                        <label style={lbl}>Website URL</label>
                        <input type="text" value={editPartnerData.website_url || ''} onChange={e => setEditPartnerData(d => ({ ...d, website_url: e.target.value }))} style={inp} />
                      </div>
                      <div>
                        <label style={lbl}>Logo URL</label>
                        <input type="text" value={editPartnerData.logo_url || ''} onChange={e => setEditPartnerData(d => ({ ...d, logo_url: e.target.value }))} style={inp} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <label style={{ ...lbl, marginBottom: 0 }}>Sort</label>
                      <input type="number" value={editPartnerData.sort_order ?? 0} onChange={e => setEditPartnerData(d => ({ ...d, sort_order: e.target.value }))} style={{ ...inp, width: 60 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={updatePartner} disabled={savingPartner} style={btn('#1a1a1a', '#fff')}>{savingPartner ? 'Saving...' : 'Save'}</button>
                      <button onClick={() => setEditingPartner(null)} style={btn('#fff')}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, display: 'flex', gap: 10 }}>
                      {p.logo_url && (
                        <img src={p.logo_url} alt={p.name} style={{ width: 44, height: 44, objectFit: 'contain', background: '#faf9f7', border: '0.5px solid #eee', borderRadius: 6, flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                        {p.description && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{p.description}</div>}
                        {p.website_url && <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{p.website_url}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button onClick={() => { setEditingPartner(p); setEditPartnerData({ name: p.name, description: p.description || '', website_url: p.website_url || '', logo_url: p.logo_url || '', sort_order: p.sort_order }); setPartnerMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                      {!deleteConfirm['partner_' + p.id] ? (
                        <button onClick={() => deletePartner(p.id)} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button onClick={() => deletePartner(p.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                          <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['partner_' + p.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          })()}
          </div>
          )}
        </div>
      )}

      {/* ── TICKET TYPES ── */}
      {activeTab === 'ticket types' && role === 'super' && (
        <div>
          <div style={{ maxWidth: 480, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Add ticket type</div>
            <Msg msg={ticketMsg} />
           <div style={fw}>
  <label style={lbl}>Name *</label>
  <input type="text" value={newTicketType.name} onChange={e => setNewTicketType(t => ({ ...t, name: e.target.value }))} placeholder="4P Cabin" style={inp} />
</div>
<div style={fw}>
  <label style={lbl}>Guest display name (what guests see)</label>
  <input type="text" value={newTicketType.display_name || ''} onChange={e => setNewTicketType(t => ({ ...t, display_name: e.target.value }))} placeholder="e.g. Cabin for 2" style={inp} />
</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Party cap</label>
                <input type="number" value={newTicketType.party_cap} onChange={e => setNewTicketType(t => ({ ...t, party_cap: parseInt(e.target.value) }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Credits per person</label>
                <input type="number" value={newTicketType.credits_per_person} onChange={e => setNewTicketType(t => ({ ...t, credits_per_person: parseInt(e.target.value) }))} style={inp} />
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Description</label>
              <input type="text" value={newTicketType.description} onChange={e => setNewTicketType(t => ({ ...t, description: e.target.value }))} placeholder="Optional" style={inp} />
            </div>
            <button onClick={addTicketType} disabled={addingTicket} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingTicket ? 'Adding...' : 'Add ticket type'}
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Ticket types</div>
          {ticketTypes.map(tt => (
            <div key={tt.id} style={card}>
              {editingTicketType?.id === tt.id ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div><label style={lbl}>Name</label><input value={editTicketData.name || ''} onChange={e => setEditTicketData(d => ({ ...d, name: e.target.value }))} style={inp} /></div>
                    <div><label style={lbl}>Display name</label><input value={editTicketData.display_name || ''} onChange={e => setEditTicketData(d => ({ ...d, display_name: e.target.value }))} style={inp} /></div>
                    <div><label style={lbl}>Party cap</label><input type="number" value={editTicketData.party_cap ?? 1} onChange={e => setEditTicketData(d => ({ ...d, party_cap: e.target.value }))} style={inp} /></div>
                    <div><label style={lbl}>Credits per person</label><input type="number" value={editTicketData.credits_per_person ?? 1} onChange={e => setEditTicketData(d => ({ ...d, credits_per_person: e.target.value }))} style={inp} /></div>
                  </div>
                  <div style={{ marginBottom: 10 }}><label style={lbl}>Description</label><input value={editTicketData.description || ''} onChange={e => setEditTicketData(d => ({ ...d, description: e.target.value }))} style={inp} /></div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                    Total credits: {(parseInt(editTicketData.credits_per_person) || 1) * (parseInt(editTicketData.party_cap) || 1)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={saveTicketType} disabled={savingTicket} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 12, padding: '6px 14px' }}>{savingTicket ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => { setEditingTicketType(null); setEditTicketData({}) }} style={{ ...btn('#fff'), fontSize: 12, padding: '6px 14px' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{tt.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>Party of {tt.party_cap} · {tt.credits_per_person} credits/person · {tt.credits_per_person * tt.party_cap} total</div>
                    {tt.description && <div style={{ fontSize: 12, color: '#aaa' }}>{tt.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => { setEditingTicketType(tt); setEditTicketData({ ...tt }) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                    {!deleteConfirm['tt_' + tt.id] ? (
                      <button onClick={() => setDeleteConfirm(d => ({ ...d, ['tt_' + tt.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button onClick={() => deleteTicketType(tt.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                        <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['tt_' + tt.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── EVENTS ── */}
      {activeTab === 'events' && role === 'super' && (
        <div>
          <div style={{ maxWidth: 520, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Create event</div>
            <Msg msg={eventMsg} />
            {[{ label: 'Event name *', key: 'name', ph: 'Snow Peak Way WA' }, { label: 'Location', key: 'location', ph: 'Washington State' }, { label: 'Description', key: 'description', ph: 'Optional' }].map(f => (
              <div key={f.key} style={fw}>
                <label style={lbl}>{f.label}</label>
                <input type="text" value={newEvent[f.key]} onChange={e => setNewEvent(ev => ({ ...ev, [f.key]: e.target.value }))} placeholder={f.ph} style={inp} />
              </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div><label style={lbl}>Start date *</label><input type="date" value={newEvent.start_date} onChange={e => setNewEvent(ev => ({ ...ev, start_date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>End date *</label><input type="date" value={newEvent.end_date} onChange={e => setNewEvent(ev => ({ ...ev, end_date: e.target.value }))} style={inp} /></div>
            </div>
            <div style={fw}>
              <label style={lbl}>Registration opens (date & time)</label>
              <input type="datetime-local" value={newEvent.registration_opens_at} onChange={e => setNewEvent(ev => ({ ...ev, registration_opens_at: e.target.value }))} style={inp} />
            </div>

            <div style={fw}>
              <label style={lbl}>Copy data from an existing event (optional)</label>
              <select value={newEventCopySource} onChange={e => setNewEventCopySource(e.target.value)} style={inp}>
                <option value="">None — start blank</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
            </div>
            {newEventCopySource && (
              <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>
                  Dates shift to match this event's start date — e.g. a Saturday workshop lands on this event's Saturday.
                </div>
                {[
                  ['workshops', 'Workshops & sessions'],
                  ['moments', 'Open moments'],
                  ['shifts', 'Back of house shifts'],
                  ['gear', 'Gear / packing list'],
                  ['info', 'Info sections'],
                  ['partners', 'Partners'],
                  ['resources', 'Staff resources']
                ].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newEventCopyCategories[key]}
                      onChange={e => setNewEventCopyCategories(c => ({ ...c, [key]: e.target.checked }))}
                      style={{ cursor: 'pointer' }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}

            <button onClick={addEvent} disabled={addingEvent} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingEvent ? 'Creating...' : 'Create event'}
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Events</div>
          {(() => {
            const activeEvents = events.filter(ev => !ev.is_archived)
            const archivedEvents = events.filter(ev => ev.is_archived)

            const renderEventCard = (ev, archived) => {
              const evPast = isPastEvent(ev)
              return (
                <div key={ev.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>{ev.name}</div>
                        {archived && <span style={{ fontSize: 11, fontWeight: 500, color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: 10 }}>Archived</span>}
                        {!archived && evPast && <span style={{ fontSize: 11, fontWeight: 500, color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: 10 }}>Past</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>{ev.location} · {ev.start_date} to {ev.end_date}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {['upcoming', 'active', 'past'].map(s => (
                          <button key={s} onClick={() => updateEventField(ev.id, 'status', s)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '0.5px solid', borderColor: ev.status === s ? '#1a1a1a' : '#d0d0d0', background: ev.status === s ? '#1a1a1a' : '#fff', color: ev.status === s ? '#fff' : '#666', cursor: 'pointer', textTransform: 'capitalize' }}>
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {archived ? (
                        <button onClick={() => setEventArchived(ev.id, false)} style={{ ...btn('#fff'), fontSize: 11, padding: '5px 12px' }}>Unarchive</button>
                      ) : (
                        <button onClick={() => setEventArchived(ev.id, true)} style={{ ...btn('#fff'), fontSize: 11, padding: '5px 12px', color: '#8a6000', borderColor: '#f0d880' }}>Archive</button>
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Location</label>
                    <input type="text" defaultValue={ev.location || ''}
                      onBlur={e => updateEventField(ev.id, 'location', e.target.value)}
                      placeholder="Washington State" style={inp} />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Registration opens</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <input type="datetime-local" defaultValue={ev.registration_opens_at?.slice(0, 16) || ''}
                        onBlur={e => updateEventField(ev.id, 'registration_opens_at', e.target.value)}
                        style={{ ...inp, maxWidth: 220, width: 'auto', flex: '1 1 auto' }} />
                      <select
                        value={ev.registration_timezone || 'America/New_York'}
                        onChange={e => updateEventField(ev.id, 'registration_timezone', e.target.value)}
                        style={{ ...inp, maxWidth: 90, width: 'auto' }}
                      >
                        {TIMEZONE_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                      </select>
                    </div>
                    {ev.registration_opens_at && (
                      <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                        {formatOpensAt(ev)}
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Map image URL</label>
                    <input type="url" defaultValue={ev.map_image_url || ''}
                      onBlur={e => updateEventField(ev.id, 'map_image_url', e.target.value)}
                      placeholder="https://..." style={inp} />
                    {ev.map_image_url && (
                      <img src={ev.map_image_url} alt="Map preview" style={{ marginTop: 8, maxWidth: 220, maxHeight: 140, borderRadius: 4, objectFit: 'cover', border: '0.5px solid #E8E4DE' }} />
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                    <div>
                      <label style={lbl}>Check-in time</label>
                      <input type="text" defaultValue={ev.checkin_time || ''}
                        onBlur={e => updateEventField(ev.id, 'checkin_time', e.target.value)}
                        placeholder="Friday June 13 · 11am – 6pm" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Check-out time</label>
                      <input type="text" defaultValue={ev.checkout_time || ''}
                        onBlur={e => updateEventField(ev.id, 'checkout_time', e.target.value)}
                        placeholder="Sunday June 15 · 11am – 2pm" style={inp} />
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Check-in notes</label>
                    <input type="text" defaultValue={ev.checkin_notes || ''}
                      onBlur={e => updateEventField(ev.id, 'checkin_notes', e.target.value)}
                      placeholder="Contact info@snowpeak.com if arriving after 6pm" style={inp} />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Questions contact</label>
                    <input type="text" defaultValue={ev.questions_contact || ''}
                      onBlur={e => updateEventField(ev.id, 'questions_contact', e.target.value)}
                      placeholder="+1 (888) 424-4916 or info@snowpeak.com" style={inp} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                    <div>
                      <label style={lbl}>Contact email</label>
                      <input type="text" defaultValue={ev.contact_email || ''}
                        onBlur={e => updateEventField(ev.id, 'contact_email', e.target.value)}
                        placeholder="info@snowpeak.com" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Day-of contact number</label>
                      <input type="text" defaultValue={ev.contact_phone_dayof || ''}
                        onBlur={e => updateEventField(ev.id, 'contact_phone_dayof', e.target.value)}
                        placeholder="+1 (555) 000-0000" style={inp} />
                    </div>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label style={lbl}>Schedule explainer text</label>
                    <textarea defaultValue={ev.schedule_explainer || ''}
                      onBlur={e => updateEventField(ev.id, 'schedule_explainer', e.target.value)}
                      placeholder="Workshops require a reservation and use your credits. Open activities are drop-in — just show up, or save them to your agenda."
                      rows={3} style={{ ...inp, resize: 'vertical' }} />
                  </div>
                </div>
              )
            }

            return (
              <>
                {activeEvents.map(ev => renderEventCard(ev, false))}

                {archivedEvents.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <button
                      onClick={() => setArchivedEventsOpen(o => !o)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        background: 'none', border: 'none', cursor: 'pointer', padding: '10px 0',
                        borderTop: '0.5px solid #e0e0e0', fontSize: 13, fontWeight: 500, color: '#666'
                      }}
                    >
                      <span>{archivedEventsOpen ? '▾' : '▸'}</span>
                      Archived Events ({archivedEvents.length})
                    </button>
                    {archivedEventsOpen && archivedEvents.map(ev => renderEventCard(ev, true))}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ── STAFF & VENDORS ── */}
      {activeTab === 'staff & vendors' && (
        <div>
          <TabBar tabs={['staff & vendors', 'assignments', 'resources']} active={staffSubTab} onChange={setStaffSubTab} />

          {/* ── ASSIGNMENTS ── */}
          {staffSubTab === 'assignments' && (
            <div>
              {/* Add back of house item — always visible, above the filters */}
              <div style={{ marginBottom: 16 }}>
                <Msg msg={shiftMsg} />
                {!addingShiftInline ? (
                  <button onClick={() => setAddingShiftInline(true)} style={{ ...btn('#fff'), fontSize: 12 }}>+ Add Back of House Shift</button>
                ) : (
                  <div style={{ border: '0.5px solid #d0d0d0', borderRadius: 8, padding: 14, marginTop: 8, background: '#FAFAF8' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>New back of house item</div>
                    <Msg msg={inlineShiftMsg} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div><label style={lbl}>Title *</label><input style={inp} value={newInlineShift.title} onChange={e => setNewInlineShift(s => ({ ...s, title: e.target.value }))} placeholder="Morning briefing" /></div>
                      <div><label style={lbl}>Location</label><input style={inp} value={newInlineShift.location} onChange={e => setNewInlineShift(s => ({ ...s, location: e.target.value }))} placeholder="Camp entrance" /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div><label style={lbl}>Date *</label><input type="date" style={inp} value={newInlineShift.date} onChange={e => setNewInlineShift(s => ({ ...s, date: e.target.value }))} /></div>
                      <div><label style={lbl}>Start *</label><input type="time" style={inp} value={newInlineShift.start_time} onChange={e => setNewInlineShift(s => ({ ...s, start_time: e.target.value }))} /></div>
                      <div><label style={lbl}>End *</label><input type="time" style={inp} value={newInlineShift.end_time} onChange={e => setNewInlineShift(s => ({ ...s, end_time: e.target.value }))} /></div>
                    </div>
                    <div style={fw}><label style={lbl}>Activity notes (visible to assigned staff)</label><input style={inp} value={newInlineShift.description} onChange={e => setNewInlineShift(s => ({ ...s, description: e.target.value }))} placeholder="What to expect, where to meet…" /></div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button onClick={createInlineShift} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 12, padding: '7px 16px' }}>Create</button>
                      <button onClick={() => { setAddingShiftInline(false); setInlineShiftMsg(null); setNewInlineShift({ title: '', date: '', start_time: '', end_time: '', location: '', description: '' }) }} style={{ ...btn('#fff'), fontSize: 12, padding: '7px 12px' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>

              {/* View toggle: by activity (current behavior) vs. by staff member */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 0, border: '0.5px solid #1a1a1a', borderRadius: 8, width: 'fit-content', overflow: 'hidden' }}>
                  {[['activity', 'By Activity'], ['staff', 'By Staff']].map(([v, label]) => (
                    <button key={v} onClick={() => setAssignmentsView(v)} style={{
                      padding: '6px 16px', border: 'none', fontSize: 13, cursor: 'pointer',
                      background: assignmentsView === v ? '#1a1a1a' : '#fff',
                      color: assignmentsView === v ? '#fff' : '#1a1a1a',
                      fontWeight: assignmentsView === v ? 500 : 400
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={exportStaffSchedule}
                    disabled={!selectedEvent}
                    title="Downloads the full schedule + assignments as a plain-text file — paste it into an AI chat for review."
                    style={{ ...btn('#fff'), fontSize: 12, padding: '6px 14px', opacity: selectedEvent ? 1 : 0.5 }}
                  >
                    Export schedule (.txt)
                  </button>
                  <button
                    onClick={exportStaffScheduleCSV}
                    disabled={!selectedEvent}
                    title="Downloads the full schedule + assignments as a spreadsheet-friendly CSV."
                    style={{ ...btn('#fff'), fontSize: 12, padding: '6px 14px', opacity: selectedEvent ? 1 : 0.5 }}
                  >
                    Export schedule (.csv)
                  </button>
                </div>
              </div>

              {/* Type filter row */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                {['all', 'program', 'shift'].map(t => (
                  <button key={t} onClick={() => setAssignTypeFilter(t)}
                    style={{ padding: '5px 12px', borderRadius: 20, border: '0.5px solid #d0d0d0', background: assignTypeFilter === t ? '#1a1a1a' : '#fff', color: assignTypeFilter === t ? '#fff' : '#555', fontSize: 12, cursor: 'pointer' }}>
                    {t === 'all' ? 'All' : t === 'program' ? 'Guest-Facing' : 'Back of House'}
                  </button>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#555', cursor: 'pointer' }}>
                  <input type="checkbox" checked={assignUnassignedOnly} onChange={e => setAssignUnassignedOnly(e.target.checked)} />
                  {assignmentsView === 'staff' ? 'Staff with nothing scheduled only' : 'Unassigned only'}
                </label>
                {assignmentsView === 'staff' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#c0392b', cursor: 'pointer' }}>
                    <input type="checkbox" checked={assignConflictsOnly} onChange={e => setAssignConflictsOnly(e.target.checked)} />
                    Conflicts only
                  </label>
                )}
              </div>

              {(() => {
                if (!selectedEvent) return <div style={{ fontSize: 13, color: '#aaa' }}>Select an event to view schedule items.</div>

                const eventSessions = filteredSessions
                const eventMoments = filteredMoments
                const eventShifts = staffShifts.filter(s => s.event_id === selectedEvent.id)
                const eventStaffAssignments = staffAssignments.filter(a => {
                  const eid = a.sessions?.event_id || a.open_moments?.event_id || a.staff_shifts?.event_id
                  return eid === selectedEvent.id
                })

                const typeBadge = {
                  session: { label: 'Workshop', bg: '#E8EEF8', color: '#2A4A8A' },
                  moment: { label: 'Open Moment', bg: '#F0EAF8', color: '#5A2A8A' },
                  shift: { label: 'Back of House', bg: '#EFEDEA', color: '#666' },
                }

                const isItemUnassigned = i => {
                  const hasDirect = eventStaffAssignments.some(a => a.staff_id && (
                    i.type === 'session' ? a.session_id === i.id :
                    i.type === 'moment' ? a.moment_id === i.id :
                    a.shift_id === i.id
                  ))
                  if (hasDirect) return false
                  // Workshop-wide vendor coverage counts as assigned too.
                  if (i.type === 'session' && i.workshopId) {
                    return !staffWorkshopAssns.some(a => a.workshop_id === i.workshopId)
                  }
                  return true
                }

                const renderItemCard = item => {
                  const itemKey = item.type + '_' + item.id
                  const assigned = eventStaffAssignments.filter(a => a.staff_id && (
                    item.type === 'session' ? a.session_id === item.id :
                    item.type === 'moment' ? a.moment_id === item.id :
                    a.shift_id === item.id
                  ))
                  const assignedIds = new Set(assigned.map(a => a.staff_id))
                  // Vendors auto-assigned to every session of this workshop via
                  // staff_workshop_assignments — shown as a distinct badge, not a
                  // manually-assignable pill (no staff_assignments row backs these).
                  const workshopVendors = item.type === 'session' && item.workshopId
                    ? staffWorkshopAssns.filter(a => a.workshop_id === item.workshopId)
                    : []
                  const isDropdownOpen = openAssignDropdown === itemKey
                  const isShowAll = showAllStaff[itemKey] || false
                  const allActiveStaff = staffMembers.filter(sm => sm.is_active !== false)
                  const eventStaff = allActiveStaff.filter(sm => staffEventAssns.some(a => a.staff_id === sm.id && a.event_id === selectedEvent.id))
                  const staffList = (isShowAll || eventStaff.length === 0) ? allActiveStaff : eventStaff
                  const roleFilter = assignRoleFilter[itemKey] || 'all'
                  const roleFilteredStaffList = staffList.filter(sm => roleFilter === 'all' ? true : roleFilter === 'vendor' ? !!sm.is_vendor : !sm.is_vendor)
                  const badge = typeBadge[item.type]

                  if (item.type === 'shift' && editingShiftId === item.id) {
                    return (
                      <div key={itemKey} style={{ ...card, marginBottom: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Edit back of house item</div>
                        <Msg msg={shiftMsg} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div><label style={lbl}>Title *</label><input style={inp} value={editShiftData.title || ''} onChange={e => setEditShiftData(d => ({ ...d, title: e.target.value }))} /></div>
                          <div><label style={lbl}>Location</label><input style={inp} value={editShiftData.location || ''} onChange={e => setEditShiftData(d => ({ ...d, location: e.target.value }))} /></div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                          <div><label style={lbl}>Date *</label><input type="date" style={inp} value={editShiftData.date || ''} onChange={e => setEditShiftData(d => ({ ...d, date: e.target.value }))} /></div>
                          <div><label style={lbl}>Start *</label><input type="time" style={inp} value={editShiftData.start_time || ''} onChange={e => setEditShiftData(d => ({ ...d, start_time: e.target.value }))} /></div>
                          <div><label style={lbl}>End *</label><input type="time" style={inp} value={editShiftData.end_time || ''} onChange={e => setEditShiftData(d => ({ ...d, end_time: e.target.value }))} /></div>
                        </div>
                        <div style={fw}><label style={lbl}>Description / notes</label><input style={inp} value={editShiftData.description || ''} onChange={e => setEditShiftData(d => ({ ...d, description: e.target.value }))} /></div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <button onClick={updateStaffShift} disabled={savingShift} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 12, padding: '7px 16px' }}>{savingShift ? 'Saving…' : 'Save'}</button>
                          <button onClick={() => { setEditingShiftId(null); setEditShiftData({}) }} style={{ ...btn('#fff'), fontSize: 12, padding: '7px 12px' }}>Cancel</button>
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div key={itemKey} style={{ ...card, marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>{item.title}</div>
                            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: badge.bg, color: badge.color }}>{badge.label}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#888' }}>{formatTime(item.start_time)} – {formatTime(item.end_time)}{item.location ? ' · ' + item.location : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                          <button type="button" onClick={() => setOpenAssignDropdown(prev => prev === itemKey ? null : itemKey)}
                            style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                            Assign
                          </button>
                          {item.type === 'shift' && (
                            <button type="button" onClick={() => { setEditingShiftId(item.id); setEditShiftData({ title: item.title, date: item.date, start_time: item.start_time, end_time: item.end_time, location: item.location || '', description: item.notes || '' }); setShiftMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                              Edit
                            </button>
                          )}
                          {item.type === 'shift' && (
                            deleteConfirm['shift_' + item.id] ? (
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 11, color: '#c0392b' }}>Delete this back of house item? Assigned staff will be unassigned.</span>
                                <button type="button" onClick={() => deleteStaffShift(item.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                                <button type="button" onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['shift_' + item.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                              </div>
                            ) : (
                              <button type="button" onClick={() => deleteStaffShift(item.id)} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>
                                Delete
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      <textarea
                        placeholder="Activity notes (visible to assigned staff)…"
                        defaultValue={item.notes || ''}
                        onBlur={async e => {
                          const val = e.target.value
                          if (item.type === 'session') await supabase.from('sessions').update({ staff_notes: val || null }).eq('id', item.id)
                          else if (item.type === 'moment') await supabase.from('open_moments').update({ staff_notes: val || null }).eq('id', item.id)
                          else await supabase.from('staff_shifts').update({ description: val || null }).eq('id', item.id)
                        }}
                        rows={2}
                        style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 6, border: '0.5px solid #e0e0e0', resize: 'none', fontStyle: 'italic', color: '#666', boxSizing: 'border-box', marginBottom: assigned.length > 0 || workshopVendors.length > 0 || isDropdownOpen ? 8 : 0, fontFamily: 'inherit', background: '#FAFAF8' }}
                      />
                      {assigned.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: workshopVendors.length > 0 || isDropdownOpen ? 8 : 0 }}>
                          {assigned.map(a => (
                            <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: '#EEF3EE', color: '#2D4A2D', fontSize: 12, fontWeight: 500 }}>
                              {a.staff?.name}
                              {a.staff?.is_vendor && <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.75 }}>Partner</span>}
                              <button type="button" onClick={() => { setStaffAssignments(prev => prev.filter(a2 => a2.id !== a.id)); removeStaffAssignment(a.id) }}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#2D4A2D', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                      {workshopVendors.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: isDropdownOpen ? 8 : 0 }}>
                          {workshopVendors.map(a => (
                            <span key={'wv_' + a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, background: '#FFF8E8', color: '#9a5a18', border: '0.5px solid #E8C080', fontSize: 12, fontWeight: 500 }}>
                              {a.staff?.name}
                              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.8 }}>Workshop</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {isDropdownOpen && (
                        <div style={{ border: '0.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', background: '#F5F3F0' }}>
                          {eventStaff.length > 0 && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer', marginBottom: 8 }}>
                              <input type="checkbox" checked={isShowAll} onChange={e => setShowAllStaff(s => ({ ...s, [itemKey]: e.target.checked }))} />
                              Show all active staff
                            </label>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '0.5px solid #e0e0e0', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              {[['all', 'All'], ['sp', 'SP Staff'], ['vendor', 'Partners']].map(([key, label]) => (
                                <button key={key} type="button" onClick={() => setAssignRoleFilter(f => ({ ...f, [itemKey]: key }))} style={{
                                  padding: '3px 10px', borderRadius: 14, border: '0.5px solid #d0d0d0', fontSize: 11, cursor: 'pointer',
                                  background: roleFilter === key ? '#1a1a1a' : '#fff', color: roleFilter === key ? '#fff' : '#555'
                                }}>{label}</button>
                              ))}
                            </div>
                            {(() => {
                              const unassignedInList = roleFilteredStaffList.filter(sm => !assignedIds.has(sm.id))
                              if (unassignedInList.length === 0) return null
                              const isAddingAll = addingAllFor === itemKey
                              const addAllLabel = roleFilter === 'vendor' ? 'Add all Partners' : roleFilter === 'sp' ? 'Add all SP Staff' : 'Add all'
                              return (
                                <button
                                  onClick={() => {
                                    setAddingAllFor(itemKey)
                                    const col = item.type === 'session' ? 'session_id' : item.type === 'moment' ? 'moment_id' : 'shift_id'
                                    setStaffAssignments(prev => [...prev, ...unassignedInList.map(sm => ({
                                      id: 'opt_' + Date.now() + '_' + sm.id, staff_id: sm.id, [col]: item.id,
                                      staff: { id: sm.id, name: sm.name, is_vendor: sm.is_vendor },
                                      sessions: item.type === 'session' ? { id: item.id, date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id, workshops: { name: item.title } } : null,
                                      open_moments: item.type === 'moment' ? { id: item.id, name: item.title, date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id } : null,
                                      staff_shifts: item.type === 'shift' ? { id: item.id, title: item.title, shift_date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id } : null,
                                    }))])
                                    addAllStaffAssignments(unassignedInList.map(sm => sm.id), item.type, item.id).finally(() => setAddingAllFor(null))
                                  }}
                                  disabled={isAddingAll}
                                  style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '0.5px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: isAddingAll ? 'default' : 'pointer', opacity: isAddingAll ? 0.6 : 1 }}
                                >
                                  {isAddingAll ? 'Adding…' : addAllLabel + ' (' + unassignedInList.length + ')'}
                                </button>
                              )
                            })()}
                          </div>
                          {eventStaff.length === 0 && !isShowAll && (
                            <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>No event-specific staff — showing all active.</div>
                          )}
                          {roleFilteredStaffList.length === 0 && (
                            <div style={{ fontSize: 12, color: '#aaa' }}>No staff match this filter.</div>
                          )}
                          {roleFilteredStaffList.map(sm => {
                            const isAssigned = assignedIds.has(sm.id)
                            const assignmentRow = isAssigned ? assigned.find(a => a.staff_id === sm.id) : null
                            const conflicts = !isAssigned && item.date && item.start_time && item.end_time
                              ? getStaffConflicts(sm.id, item.date, item.start_time, item.end_time) : []
                            const hasConflict = conflicts.length > 0
                            const conflictTooltip = conflicts.map(c => c.title + ' at ' + c.time).join('; ')
                            return (
                              <div key={sm.id} title={hasConflict ? conflictTooltip : undefined}
                                onClick={() => {
                                  if (isAssigned && assignmentRow) {
                                    setStaffAssignments(prev => prev.filter(a => a.id !== assignmentRow.id))
                                    removeStaffAssignment(assignmentRow.id)
                                  } else {
                                    const col = item.type === 'session' ? 'session_id' : item.type === 'moment' ? 'moment_id' : 'shift_id'
                                    setStaffAssignments(prev => [...prev, {
                                      id: 'opt_' + Date.now(), staff_id: sm.id, [col]: item.id,
                                      staff: { id: sm.id, name: sm.name, is_vendor: sm.is_vendor },
                                      sessions: item.type === 'session' ? { id: item.id, date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id, workshops: { name: item.title } } : null,
                                      open_moments: item.type === 'moment' ? { id: item.id, name: item.title, date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id } : null,
                                      staff_shifts: item.type === 'shift' ? { id: item.id, title: item.title, shift_date: item.date, start_time: item.start_time, end_time: item.end_time, event_id: selectedEvent.id } : null,
                                    }])
                                    addStaffAssignment(sm.id, item.type, item.id, isShowAll)
                                  }
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px', borderRadius: 6, cursor: 'pointer', background: isAssigned ? '#EAF4EB' : 'transparent', marginBottom: 2 }}>
                                <span style={{ width: 16, flexShrink: 0, color: '#2D7A3A', fontSize: 13, fontWeight: 700 }}>{isAssigned ? '✓' : ''}</span>
                                <span style={{ fontSize: 12, fontWeight: 500, color: '#1a1a1a', flex: 1 }}>{sm.name}</span>
                                {sm.is_vendor && (
                                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: '#FFF8E8', color: '#9a5a18', border: '0.5px solid #E8C080', flexShrink: 0 }}>Partner</span>
                                )}
                                {hasConflict && (
                                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 20, background: '#FEF3E2', color: '#B5622A', border: '0.5px solid #F0C888', flexShrink: 0 }}>Conflict</span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }

                const renderSection = items => {
                  if (items.length === 0) return <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>No items match the current filters.</div>
                  const byDate = {}
                  items.forEach(item => { if (!byDate[item.date]) byDate[item.date] = []; byDate[item.date].push(item) })
                  return Object.keys(byDate).sort().map(date => (
                    <div key={date}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginTop: 12, marginBottom: 8, paddingBottom: 6, borderBottom: '0.5px solid #eee' }}>
                        {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                      </div>
                      {byDate[date].map(item => renderItemCard(item))}
                    </div>
                  ))
                }

                const allItems = [
                  ...eventSessions.map(s => ({ type: 'session', id: s.id, date: s.date, start_time: s.start_time, end_time: s.end_time, title: s.workshops?.name || 'Workshop', location: s.workshops?.location, notes: s.staff_notes, workshopId: s.workshop_id })),
                  ...eventMoments.map(m => ({ type: 'moment', id: m.id, date: m.date, start_time: m.start_time, end_time: m.end_time, title: m.name, location: m.location, notes: m.staff_notes })),
                  ...eventShifts.map(s => ({ type: 'shift', id: s.id, date: s.shift_date, start_time: s.start_time, end_time: s.end_time, title: s.title, location: s.location, notes: s.description })),
                ].sort((a, b) => (a.date + 'T' + a.start_time) < (b.date + 'T' + b.start_time) ? -1 : 1)

                let typeFilteredItems = allItems.filter(i => {
                  if (assignTypeFilter === 'all') return true
                  if (assignTypeFilter === 'program') return i.type === 'session' || i.type === 'moment'
                  return i.type === 'shift'
                })

                const availableDates = [...new Set(typeFilteredItems.map(i => i.date).filter(Boolean))].sort()

                let visibleItems = typeFilteredItems
                if (assignDateFilter) visibleItems = visibleItems.filter(i => i.date === assignDateFilter)
                if (assignUnassignedOnly) visibleItems = visibleItems.filter(isItemUnassigned)

                const formatAssignDayPill = d => {
                  const date = new Date(d + 'T12:00:00')
                  return date.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + date.getDate()
                }

                const dayFilterPills = availableDates.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                    {['all', ...availableDates].map(d => {
                      const active = d === 'all' ? !assignDateFilter : assignDateFilter === d
                      return (
                        <button key={d} onClick={() => setAssignDateFilter(d === 'all' ? '' : d)} style={{
                          padding: '5px 14px', borderRadius: 20,
                          border: '0.5px solid', borderColor: active ? '#1a1a1a' : '#E8E4DE',
                          background: active ? '#1a1a1a' : '#fff',
                          color: active ? '#fff' : '#8C8C8C',
                          fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer'
                        }}>
                          {d === 'all' ? 'All' : formatAssignDayPill(d)}
                        </button>
                      )
                    })}
                  </div>
                )

                if (assignmentsView === 'staff') {
                  const relevantStaff = staffMembers.filter(sm => sm.is_active !== false).slice().sort((a, b) => a.name.localeCompare(b.name))
                  const staffRows = relevantStaff.map(sm => {
                    const direct = typeFilteredItems.filter(item => eventStaffAssignments.some(a => a.staff_id === sm.id && (
                      item.type === 'session' ? a.session_id === item.id :
                      item.type === 'moment' ? a.moment_id === item.id :
                      a.shift_id === item.id
                    )))
                    const directKeys = new Set(direct.map(i => i.type + '_' + i.id))
                    // Workshop-wide vendor coverage — same rule as isItemUnassigned/renderItemCard above.
                    const workshopWide = typeFilteredItems.filter(item =>
                      item.type === 'session' && item.workshopId &&
                      !directKeys.has(item.type + '_' + item.id) &&
                      staffWorkshopAssns.some(a => a.staff_id === sm.id && a.workshop_id === item.workshopId)
                    )
                    let items = [...direct, ...workshopWide].sort((a, b) => (a.date + 'T' + a.start_time) < (b.date + 'T' + b.start_time) ? -1 : 1)
                    if (assignDateFilter) items = items.filter(i => i.date === assignDateFilter)
                    // Flag items that overlap another on this person's own list —
                    // catches double-bookings already in the data (e.g. from a
                    // rescheduled item or a bulk "Add all"), not just ones caught
                    // at assign-time by getStaffConflicts above. Shift-vs-shift
                    // overlap is excluded: back-of-house shifts are deliberately
                    // broad windows (a 5-hour "Guest Services" block is expected
                    // to contain a "Lunch" shift) and flagging those would just
                    // be noise — only a Workshop or Open Moment on one side is a
                    // real, guest-facing time conflict.
                    const conflictIdx = new Set()
                    for (let i = 0; i < items.length; i++) {
                      for (let j = i + 1; j < items.length; j++) {
                        const a = items[i], b = items[j]
                        const involvesFixedCommitment = a.type !== 'shift' || b.type !== 'shift'
                        if (involvesFixedCommitment && a.date === b.date && a.start_time < b.end_time && b.start_time < a.end_time) {
                          conflictIdx.add(i); conflictIdx.add(j)
                        }
                      }
                    }
                    return { staff: sm, items, conflictCount: conflictIdx.size, conflictIdx }
                  })
                  let visibleRows = assignUnassignedOnly ? staffRows.filter(r => r.items.length === 0) : staffRows
                  if (assignConflictsOnly) visibleRows = visibleRows.filter(r => r.conflictCount > 0)

                  return (
                    <div>
                      {dayFilterPills}
                      {visibleRows.length === 0 ? (
                        <div style={{ fontSize: 13, color: '#aaa' }}>No staff match the current filters.</div>
                      ) : visibleRows.map(({ staff: sm, items, conflictCount, conflictIdx }) => (
                        <div key={sm.id} style={{ ...card, marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: items.length ? 10 : 0, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{sm.name}</div>
                            {sm.is_vendor && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#FFF8E8', color: '#9a5a18', border: '0.5px solid #e8c080' }}>Vendor</span>}
                            {sm.role && <span style={{ fontSize: 12, color: '#aaa' }}>{sm.role}</span>}
                            {conflictCount > 0 && (
                              <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#FCEBEA', color: '#c0392b', border: '0.5px solid #F0B8B0' }}>
                                ⚠ {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 'auto' }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                          </div>
                          {items.length === 0 ? (
                            <div style={{ fontSize: 12, color: '#c99', fontStyle: 'italic' }}>Nothing scheduled{assignDateFilter ? ' on this day' : ''}.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {items.map((item, i) => {
                                const badge = typeBadge[item.type]
                                const hasConflict = conflictIdx.has(i)
                                return (
                                  <div key={item.type + '_' + item.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, flexWrap: 'wrap',
                                    background: hasConflict ? '#FCEBEA' : '#FAFAF8',
                                    border: hasConflict ? '0.5px solid #F0B8B0' : 'none'
                                  }}>
                                    {hasConflict && <span title="Overlaps another item below" style={{ fontSize: 12 }}>⚠</span>}
                                    <span style={{ fontSize: 11, color: '#888', minWidth: 150 }}>
                                      {new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {formatTime(item.start_time)}–{formatTime(item.end_time)}
                                    </span>
                                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.color }}>{badge.label}</span>
                                    <span style={{ fontSize: 12, fontWeight: 500 }}>{item.title}</span>
                                    {item.location && <span style={{ fontSize: 11, color: '#aaa' }}>📍 {item.location}</span>}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                }

                return (
                  <div>
                    {dayFilterPills}
                    {renderSection(visibleItems)}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── STAFF & VENDORS ── */}
          {staffSubTab === 'staff & vendors' && (
            <div>
              {/* ── SNOW PEAK STAFF ── */}
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1a1a', marginBottom: 16, paddingBottom: 10, borderBottom: '1.5px solid #1a1a1a' }}>
                Snow Peak Staff
              </div>

              <div style={{ maxWidth: 540, marginBottom: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Add staff member</div>
                <Msg msg={staffMemberMsg} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={fw}><label style={lbl}>Name *</label><input style={inp} value={newStaffMember.name} onChange={e => setNewStaffMember(s => ({ ...s, name: e.target.value }))} placeholder="Alex Chen" /></div>
                  <div style={fw}><label style={lbl}>PIN *</label><input style={inp} value={newStaffMember.pin} onChange={e => setNewStaffMember(s => ({ ...s, pin: e.target.value }))} placeholder="alex2026" /></div>
                  <div style={fw}><label style={lbl}>Email</label><input style={inp} value={newStaffMember.email} onChange={e => setNewStaffMember(s => ({ ...s, email: e.target.value }))} placeholder="alex@snowpeak.com" /></div>
                  <div style={fw}><label style={lbl}>Phone</label><input style={inp} value={newStaffMember.phone} onChange={e => setNewStaffMember(s => ({ ...s, phone: e.target.value }))} placeholder="+1 555 000 0000" /></div>
                  <div style={{ ...fw, gridColumn: '1/-1' }}><label style={lbl}>Notes</label><input style={inp} value={newStaffMember.notes} onChange={e => setNewStaffMember(s => ({ ...s, notes: e.target.value }))} placeholder="Internal notes" /></div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={newStaffMember.is_vendor} onChange={e => setNewStaffMember(s => ({ ...s, is_vendor: e.target.checked }))} style={{ cursor: 'pointer' }} />
                  Is Vendor/Partner
                </label>
                {newStaffMember.is_vendor && (
                  <div style={fw}>
                    <label style={lbl}>Vendor/Partner name</label>
                    <input style={inp} value={newStaffMember.vendor_name} onChange={e => setNewStaffMember(s => ({ ...s, vendor_name: e.target.value }))} placeholder="Occam Cider Co" />
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={newStaffMember.is_checkin} onChange={e => setNewStaffMember(s => ({ ...s, is_checkin: e.target.checked }))} style={{ cursor: 'pointer' }} />
                  Guest Services
                </label>
                <button onClick={createStaffMember} disabled={addingStaffMember} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
                  {addingStaffMember ? 'Adding…' : 'Add staff member'}
                </button>
              </div>

              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: '#888' }}>
                Staff members <span style={{ fontWeight: 400 }}>({staffMembers.length})</span>
              </div>
              {staffMembers.length === 0 && <div style={{ fontSize: 13, color: '#aaa', marginBottom: 28 }}>No staff members yet.</div>}
              {staffMembers.map(sm => {
                const memberEventAssns = staffEventAssns.filter(a => a.staff_id === sm.id)
                const memberWorkshopAssns = staffWorkshopAssns.filter(a => a.staff_id === sm.id)
                const isDeleting = staffDeleteInput[sm.id] !== undefined
                const isEditingThis = editingStaffMember?.id === sm.id
                return (
                  <div key={sm.id} style={{ ...card, opacity: sm.is_active === false ? 0.6 : 1, marginBottom: 10 }}>
                    {isEditingThis ? (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div style={fw}><label style={lbl}>Name *</label><input style={inp} value={editStaffMemberData.name || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, name: e.target.value }))} /></div>
                          <div style={fw}><label style={lbl}>PIN *</label><input style={inp} value={editStaffMemberData.pin || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, pin: e.target.value }))} /></div>
                          <div style={fw}><label style={lbl}>Email</label><input style={inp} value={editStaffMemberData.email || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, email: e.target.value }))} /></div>
                          <div style={fw}><label style={lbl}>Phone</label><input style={inp} value={editStaffMemberData.phone || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, phone: e.target.value }))} /></div>
                          <div style={{ ...fw, gridColumn: '1/-1' }}><label style={lbl}>Notes</label><input style={inp} value={editStaffMemberData.notes || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, notes: e.target.value }))} /></div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
                          <input type="checkbox" checked={!!editStaffMemberData.is_vendor} onChange={e => setEditStaffMemberData(d => ({ ...d, is_vendor: e.target.checked }))} style={{ cursor: 'pointer' }} />
                          Is Vendor/Partner
                        </label>
                        {editStaffMemberData.is_vendor && (
                          <div style={fw}>
                            <label style={lbl}>Vendor/Partner name</label>
                            <input style={inp} value={editStaffMemberData.vendor_name || ''} onChange={e => setEditStaffMemberData(d => ({ ...d, vendor_name: e.target.value }))} placeholder="Occam Cider Co" />
                          </div>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer', marginBottom: 12 }}>
                          <input type="checkbox" checked={!!editStaffMemberData.is_checkin} onChange={e => setEditStaffMemberData(d => ({ ...d, is_checkin: e.target.checked }))} style={{ cursor: 'pointer' }} />
                          Guest Services
                        </label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={updateStaffMember} disabled={savingStaffMember} style={btn('#1a1a1a', '#fff')}>{savingStaffMember ? 'Saving…' : 'Save'}</button>
                          <button onClick={() => { setEditingStaffMember(null); setEditStaffMemberData({}) }} style={btn('#fff')}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{sm.name}</div>
                          {sm.is_vendor && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: '#FFF8E8', color: '#9a5a18', border: '0.5px solid #E8C080' }}>Partner</span>}
                          {sm.is_checkin && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: '#EEF3EE', color: '#2D4A2D', border: '0.5px solid #C0D4C0' }}>Guest Services</span>}
                          {sm.is_active === false && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: '#F5F0E8', color: '#B5622A' }}>Inactive</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 2 }}>
                          PIN: {sm.pin}{sm.email ? ' · ' + sm.email : ''}{sm.phone ? ' · ' + sm.phone : ''}
                          {sm.is_vendor && sm.vendor_name ? ' · ' + sm.vendor_name : ''}
                        </div>
                        {sm.notes && <div style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>{sm.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={() => { setEditingStaffMember(sm); setEditStaffMemberData({ name: sm.name, pin: sm.pin, email: sm.email || '', phone: sm.phone || '', notes: sm.notes || '', is_vendor: sm.is_vendor || false, vendor_name: sm.vendor_name || '', is_checkin: sm.is_checkin || false }); setStaffMemberMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                        <button
                          onClick={() => toggleStaffActive(sm.id, sm.is_active !== false)}
                          disabled={togglingStaffId === sm.id}
                          style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: sm.is_active === false ? '#2D4A2D' : '#888' }}>
                          {togglingStaffId === sm.id ? '…' : sm.is_active === false ? 'Activate' : 'Deactivate'}
                        </button>
                        {!isDeleting ? (
                          <button onClick={() => setStaffDeleteInput(d => ({ ...d, [sm.id]: '' }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete Permanently</button>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexBasis: '100%' }}>
                            <div style={{ fontSize: 11, color: '#c0392b', lineHeight: 1.4, maxWidth: 420 }}>
                              This permanently deletes {sm.name}{memberEventAssns.length > 0
                                ? ' and removes them from all ' + memberEventAssns.length + ' linked event' + (memberEventAssns.length !== 1 ? 's' : '') + ' (' + memberEventAssns.map(a => a.events?.name).filter(Boolean).join(', ') + ')'
                                : ''} — not just the one you're currently viewing. This can't be undone.
                            </div>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input
                                placeholder={'Type "' + sm.name + '" to confirm'}
                                value={staffDeleteInput[sm.id] || ''}
                                onChange={e => setStaffDeleteInput(d => ({ ...d, [sm.id]: e.target.value }))}
                                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #f5c0c0', width: 160 }}
                              />
                              <button onClick={() => deleteStaffMember(sm.id, sm.name)} disabled={(staffDeleteInput[sm.id] || '') !== sm.name}
                                style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px', opacity: (staffDeleteInput[sm.id] || '') !== sm.name ? 0.4 : 1 }}>Delete Permanently</button>
                              <button onClick={() => setStaffDeleteInput(d => { const n = { ...d }; delete n[sm.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    )}
                    {!isEditingThis && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {memberEventAssns.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>No events</span>}
                      {memberEventAssns.map(a => (
                        <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: '#EEF3EE', color: '#2D4A2D', fontSize: 12 }}>
                          {a.events?.name}
                          <button onClick={() => removeStaffEventAssn(a)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#2D4A2D', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                      <select value="" onChange={e => e.target.value && addStaffEventAssn(sm.id, e.target.value)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #d0d0d0', color: '#666', background: '#fff', cursor: 'pointer' }}>
                        <option value="">+ Add to event</option>
                        {events.filter(ev => !memberEventAssns.some(a => a.event_id === ev.id)).map(ev => (
                          <option key={ev.id} value={ev.id}>{ev.name}</option>
                        ))}
                      </select>
                    </div>
                    )}
                    {!isEditingThis && sm.is_vendor && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid #F0EDE8' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#aaa', marginBottom: 6 }}>Assigned Workshops</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {memberWorkshopAssns.length === 0 && <span style={{ fontSize: 12, color: '#aaa' }}>No workshops</span>}
                        {memberWorkshopAssns.map(a => (
                          <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 20, background: '#EEF3EE', color: '#2D4A2D', fontSize: 12 }}>
                            {a.workshops?.name}
                            <button onClick={() => removeStaffWorkshopAssn(a.id)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#2D4A2D', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                          </span>
                        ))}
                        <select value="" onChange={e => e.target.value && addStaffWorkshopAssn(sm.id, e.target.value)}
                          style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #d0d0d0', color: '#666', background: '#fff', cursor: 'pointer' }}>
                          <option value="">+ Add workshop</option>
                          {workshops.filter(w => !memberWorkshopAssns.some(a => a.workshop_id === w.id)).map(w => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    )}
                  </div>
                )
              })}

              <div style={{ fontSize: 12, color: '#aaa', marginTop: 20 }}>
                Vendors and partners can be added as staff members using the Partner toggle above.
              </div>
            </div>
          )}

          {/* ── RESOURCES ── */}
          {staffSubTab === 'resources' && (
            <div>
              <div style={{ maxWidth: 520, marginBottom: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
                  Add resource {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
                </div>
                <Msg msg={staffResourceMsg} />
                <div style={fw}>
                  <label style={lbl}>Title *</label>
                  <input type="text" value={newStaffResource.title} onChange={e => setNewStaffResource(r => ({ ...r, title: e.target.value }))} placeholder="Café Station Setup" style={inp} />
                </div>
                <div style={fw}>
                  <label style={lbl}>Category</label>
                  <input type="text" value={newStaffResource.category} onChange={e => setNewStaffResource(r => ({ ...r, category: e.target.value }))} placeholder="Station Setup" list="resource-categories" style={inp} />
                  <datalist id="resource-categories">
                    {['Station Setup', 'Safety & Emergency', 'Guest Services', 'Food & Beverage', 'General Reference'].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div style={fw}>
                  <label style={lbl}>Description</label>
                  <textarea value={newStaffResource.description} onChange={e => setNewStaffResource(r => ({ ...r, description: e.target.value }))} placeholder="Optional notes staff will see" rows={3} style={{ ...inp, resize: 'vertical' }} />
                </div>
                <div style={fw}>
                  <label style={lbl}>Image URL</label>
                  <input type="text" value={newStaffResource.image_url} onChange={e => setNewStaffResource(r => ({ ...r, image_url: e.target.value }))} placeholder="https://..." style={inp} />
                  {newStaffResource.image_url && (
                    <img src={newStaffResource.image_url} alt="Preview" style={{ marginTop: 8, maxWidth: 220, maxHeight: 140, borderRadius: 4, objectFit: 'cover', border: '0.5px solid #E8E4DE' }} />
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={newStaffResource.is_global} onChange={e => setNewStaffResource(r => ({ ...r, is_global: e.target.checked }))} style={{ cursor: 'pointer' }} />
                    Global (visible for all events)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={newStaffResource.hidden_from_vendors} onChange={e => setNewStaffResource(r => ({ ...r, hidden_from_vendors: e.target.checked }))} style={{ cursor: 'pointer' }} />
                    Hidden from vendors
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <label style={lbl} htmlFor="resource-sort">Sort order</label>
                    <input id="resource-sort" type="number" value={newStaffResource.sort_order} onChange={e => setNewStaffResource(r => ({ ...r, sort_order: e.target.value }))} style={{ ...inp, width: 70, marginBottom: 0 }} />
                  </div>
                </div>
                <button onClick={addStaffResource} disabled={addingStaffResource} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
                  {addingStaffResource ? 'Adding…' : 'Add resource'}
                </button>
              </div>

              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
                Resources {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name} + global</span>}
              </div>
              {(() => {
                const visible = staffResources
                  .filter(r => selectedEvent && (r.event_id === selectedEvent.id || r.is_global))
                  .slice()
                  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                if (visible.length === 0) {
                  return <div style={{ fontSize: 13, color: '#aaa', padding: 14, background: '#f9f9f9', borderRadius: 8 }}>No resources yet for this event.</div>
                }
                const cats = [...new Set(visible.map(r => r.category || 'General'))]
                return cats.map(cat => {
                  const catItems = visible.filter(r => (r.category || 'General') === cat)
                  const isOpen = openResourceCategory === cat
                  return (
                  <div key={cat} style={{ marginBottom: 10, borderTop: '0.5px solid #e8e8e8', borderRight: '0.5px solid #e8e8e8', borderBottom: '0.5px solid #e8e8e8', borderLeft: '0.5px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
                    <button
                      onClick={() => setOpenResourceCategory(isOpen ? null : cat)}
                      className={isOpen ? 'resource-cat-header resource-cat-header-open' : 'resource-cat-header'}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                        font: 'inherit'
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#888', flex: 1 }}>{cat}</span>
                      <span style={{ fontSize: 11, color: '#aaa' }}>{catItems.length}</span>
                      <span style={{ fontSize: 12, color: '#aaa' }}>{isOpen ? '▾' : '▸'}</span>
                    </button>
                    {isOpen && (
                    <div style={{ padding: '10px 14px 14px' }}>
                    {catItems.map(res => {
                      const isDeleting = resourceDeleteInput[res.id] !== undefined
                      return (
                        <div key={res.id} style={card}>
                          {editingStaffResource?.id === res.id ? (
                            <div>
                              <div style={fw}>
                                <label style={lbl}>Title *</label>
                                <input type="text" value={editStaffResourceData.title || ''} onChange={e => setEditStaffResourceData(d => ({ ...d, title: e.target.value }))} style={inp} />
                              </div>
                              <div style={fw}>
                                <label style={lbl}>Category</label>
                                <input type="text" value={editStaffResourceData.category || ''} onChange={e => setEditStaffResourceData(d => ({ ...d, category: e.target.value }))} list="resource-categories" style={inp} />
                              </div>
                              <div style={fw}>
                                <label style={lbl}>Description</label>
                                <textarea value={editStaffResourceData.description || ''} onChange={e => setEditStaffResourceData(d => ({ ...d, description: e.target.value }))} rows={3} style={{ ...inp, resize: 'vertical' }} />
                              </div>
                              <div style={fw}>
                                <label style={lbl}>Image URL</label>
                                <input type="text" value={editStaffResourceData.image_url || ''} onChange={e => setEditStaffResourceData(d => ({ ...d, image_url: e.target.value }))} style={inp} />
                                {editStaffResourceData.image_url && (
                                  <img src={editStaffResourceData.image_url} alt="Preview" style={{ marginTop: 8, maxWidth: 220, maxHeight: 140, borderRadius: 4, objectFit: 'cover', border: '0.5px solid #E8E4DE' }} />
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                  <input type="checkbox" checked={!!editStaffResourceData.is_global} onChange={e => setEditStaffResourceData(d => ({ ...d, is_global: e.target.checked }))} style={{ cursor: 'pointer' }} />
                                  Global
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                  <input type="checkbox" checked={!!editStaffResourceData.hidden_from_vendors} onChange={e => setEditStaffResourceData(d => ({ ...d, hidden_from_vendors: e.target.checked }))} style={{ cursor: 'pointer' }} />
                                  Hidden from vendors
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <label style={{ ...lbl, marginBottom: 0 }}>Sort</label>
                                  <input type="number" value={editStaffResourceData.sort_order ?? 0} onChange={e => setEditStaffResourceData(d => ({ ...d, sort_order: e.target.value }))} style={{ ...inp, width: 60 }} />
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button onClick={updateStaffResource} disabled={savingStaffResource} style={btn('#1a1a1a', '#fff')}>{savingStaffResource ? 'Saving…' : 'Save'}</button>
                                <button onClick={() => setEditingStaffResource(null)} style={btn('#fff')}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 220 }}>
                                {res.image_url && (
                                  <img src={res.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover', border: '0.5px solid #E8E4DE', flexShrink: 0 }} />
                                )}
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                                    <div style={{ fontSize: 14, fontWeight: 500 }}>{res.title}</div>
                                    {res.is_global && <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#EEF3EE', color: '#2D4A2D', border: '0.5px solid #C0D4C0' }}>Global</span>}
                                    {res.hidden_from_vendors && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 10, background: '#F5F0E8', color: '#A06000', border: '0.5px solid #E8C080' }}>Hidden from vendors</span>}
                                  </div>
                                  {res.description && <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{res.description}</div>}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button onClick={() => { setEditingStaffResource(res); setEditStaffResourceData({ title: res.title, category: res.category || '', description: res.description || '', image_url: res.image_url || '', is_global: res.is_global, hidden_from_vendors: res.hidden_from_vendors, sort_order: res.sort_order }); setStaffResourceMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                                {!isDeleting ? (
                                  <button onClick={() => setResourceDeleteInput(d => ({ ...d, [res.id]: '' }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                                ) : (
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input placeholder={'Type "' + res.title + '" to confirm'} value={resourceDeleteInput[res.id] || ''}
                                      onChange={e => setResourceDeleteInput(d => ({ ...d, [res.id]: e.target.value }))}
                                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #f5c0c0', width: 150 }} />
                                    <button onClick={() => deleteStaffResource(res.id, res.title)} disabled={resourceDeleteInput[res.id] !== res.title}
                                      style={{ ...btn(resourceDeleteInput[res.id] === res.title ? '#c0392b' : '#e0e0e0', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                                    <button onClick={() => setResourceDeleteInput(d => { const n = { ...d }; delete n[res.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    </div>
                    )}
                  </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── SETTINGS ── */}
      {activeTab === 'settings' && role === 'super' && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Change PINs</div>
          <Msg msg={settingsMsg} />
          <div style={fw}>
            <label style={lbl}>New super admin PIN</label>
            <input type="text" value={newPins.super_admin_pin} onChange={e => setNewPins(p => ({ ...p, super_admin_pin: e.target.value }))} placeholder="Leave blank to keep current" style={inp} />
          </div>
          <div style={fw}>
            <label style={lbl}>New admin PIN</label>
            <input type="text" value={newPins.admin_pin} onChange={e => setNewPins(p => ({ ...p, admin_pin: e.target.value }))} placeholder="Leave blank to keep current" style={inp} />
          </div>
          <button onClick={savePins} style={{ ...btn('#1a1a1a', '#fff'), padding: '10px 24px' }}>Save PINs</button>
          <div style={{ marginTop: 24, padding: 14, background: '#f9f9f9', borderRadius: 8, fontSize: 12, color: '#666', lineHeight: 1.8 }}>
            <strong>Super admin</strong> — ticket types, events, PINs, everything<br />
            <strong>Admin</strong> — guests, workshops, staff & vendors, dashboard<br />
            <strong>Vendor/instructor</strong> — read-only roster for their workshop
          </div>
        </div>
      )}
    </div>
  )
}