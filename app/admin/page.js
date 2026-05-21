'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AdminPage() {
  const [role, setRole] = useState(null)
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
  const [instructorPins, setInstructorPins] = useState([])
  const [guestEvents, setGuestEvents] = useState([])

  const [newGuest, setNewGuest] = useState({ name: '', email: '', ticket_type_id: '' })
  const [guestMsg, setGuestMsg] = useState(null)
  const [addingGuest, setAddingGuest] = useState(false)
  const [guestSubTab, setGuestSubTab] = useState('add')
  const [bulkCSV, setBulkCSV] = useState('')
  const [bulkPreview, setBulkPreview] = useState([])
  const [bulkMsg, setBulkMsg] = useState(null)
  const [bulkImporting, setBulkImporting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState({})
  const [guestSearch, setGuestSearch] = useState('')
  const [adjustingGuest, setAdjustingGuest] = useState(null)
  const [newCreditsAvail, setNewCreditsAvail] = useState(0)

  const [newWorkshop, setNewWorkshop] = useState({ name: '', category: '', instructor: '', description: '', location: '' })
  const [workshopMsg, setWorkshopMsg] = useState(null)
  const [addingWorkshop, setAddingWorkshop] = useState(false)
  const [editingWorkshop, setEditingWorkshop] = useState(null)
  const [editWorkshopData, setEditWorkshopData] = useState({})
  const [savingWorkshop, setSavingWorkshop] = useState(false)

  const [newSession, setNewSession] = useState({ workshop_id: '', date: '', start_time: '', end_time: '', capacity: 30 })
  const [sessionMsg, setSessionMsg] = useState(null)
  const [addingSession, setAddingSession] = useState(false)
  const [editingCapacity, setEditingCapacity] = useState({})

const [newTicketType, setNewTicketType] = useState({ name: '', display_name: '', party_cap: 1, credits_per_person: 2, description: '' })
  const [ticketMsg, setTicketMsg] = useState(null)
  const [addingTicket, setAddingTicket] = useState(false)

  const [newEvent, setNewEvent] = useState({ name: '', description: '', location: '', start_date: '', end_date: '', registration_opens_at: '' })
  const [eventMsg, setEventMsg] = useState(null)
  const [addingEvent, setAddingEvent] = useState(false)

  const [newInstructor, setNewInstructor] = useState({ name: '', pin: '', workshop_id: '' })
  const [instructorMsg, setInstructorMsg] = useState(null)
  const [addingInstructor, setAddingInstructor] = useState(false)

  const [shopifySecret, setShopifySecret] = useState('')
  const [shopifyMap, setShopifyMap] = useState([{ product: '', ticket_type_id: '' }])
  const [shopifyMsg, setShopifyMsg] = useState(null)
  const [savingShopify, setSavingShopify] = useState(false)

  const [settingsMsg, setSettingsMsg] = useState(null)
  const [newPins, setNewPins] = useState({ super_admin_pin: '', admin_pin: '' })

  // ── AUTH ─────────────────────────────────────────────────
  async function checkPin() {
    setLoading(true)
    setPinError('')
    const { data: settings } = await supabase.from('admin_settings').select('*')
    const map = {}
    settings?.forEach(s => { map[s.key] = s.value })

    if (pin === map['super_admin_pin']) {
      setRole('super')
      setAdminSettings(map)
      setShopifySecret(map['shopify_webhook_secret'] || '')
      try {
        const parsed = JSON.parse(map['shopify_product_map'] || '{}')
        const rows = Object.entries(parsed).map(([product, ticket_type_id]) => ({ product, ticket_type_id }))
        setShopifyMap(rows.length > 0 ? rows : [{ product: '', ticket_type_id: '' }])
      } catch (e) {}
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
      { data: ip }, { data: ge }
    ] = await Promise.all([
      supabase.from('guests').select('*, ticket_types(*)').order('name'),
      supabase.from('ticket_types').select('*').order('name'),
      supabase.from('workshops').select('*').order('name'),
      supabase.from('sessions').select('*, workshops(*)').order('date').order('start_time'),
      supabase.from('registrations').select('*, guests(*), sessions(*, workshops(*))').neq('status', 'cancelled'),
      supabase.from('events').select('*').order('start_date'),
      supabase.from('instructor_pins').select('*, workshops(*)').order('name'),
      supabase.from('guest_events').select('*, guests(*), events(*)')
    ])
    setGuests(g || [])
    setTicketTypes(tt || [])
    setWorkshops(w || [])
    setSessions(s || [])
    setRegistrations(r || [])
    setEvents(e || [])
    setInstructorPins(ip || [])
    setGuestEvents(ge || [])
    if (e && e.length > 0 && !selectedEvent) {
      const upcoming = e.find(ev => ev.status === 'upcoming' || ev.status === 'active') || e[0]
      setSelectedEvent(upcoming)
      setNewSession(ns => ({ ...ns, date: upcoming.start_date }))
    }
  }

  // ── HELPERS ───────────────────────────────────────────────
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
    const ge = guestEvents.find(ge => ge.guest_id === guestId && ge.event_id === selectedEvent.id)
    return ge?.credits_used || 0
  }

  function downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  function exportInviteLinks() {
    const base = typeof window !== 'undefined' ? window.location.origin.replace('/admin', '') : ''
    const rows = [['Name', 'Email', 'Ticket Type', 'Invite Link']]
    filteredGuests.forEach(g => {
      const url = base + '?token=' + g.token + (selectedEvent ? '&event=' + selectedEvent.id : '')
      rows.push([g.name, g.email, g.ticket_types?.name || '', url])
    })
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
    setAddingGuest(true)
    const { data: guestData, error } = await supabase
      .from('guests')
      .insert({ ...newGuest, credits_used: 0 })
      .select()
      .single()

    if (!error && guestData && selectedEvent) {
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

  async function saveCredits(guest) {
    if (!selectedEvent) return
    const { error } = await supabase
      .from('guest_events')
      .update({ credits_total: newCreditsAvail })
      .eq('guest_id', guest.id)
      .eq('event_id', selectedEvent.id)
    setAdjustingGuest(null)
    await loadAll()
  }

  async function bulkImport() {
    if (!selectedEvent) return
    setBulkImporting(true)
    let ok = 0, fail = 0
    for (const row of bulkPreview) {
      const tt = ticketTypes.find(t => t.name.toLowerCase() === row.ticket_type_name.toLowerCase())
      if (!tt) { fail++; continue }
      const { data: guestData, error } = await supabase
        .from('guests')
        .insert({ name: row.name, email: row.email, ticket_type_id: tt.id, credits_used: 0 })
        .select().single()
      if (!error && guestData) {
        await supabase.from('guest_events').insert({ guest_id: guestData.id, event_id: selectedEvent.id, credits_used: 0 })
        ok++
      } else fail++
    }
    setBulkMsg({ type: fail === 0 ? 'success' : 'warning', text: ok + ' guests added' + (fail > 0 ? ', ' + fail + ' failed' : '.') })
    setBulkPreview([]); setBulkCSV('')
    await loadAll()
    setBulkImporting(false)
  }

  // ── WORKSHOP ACTIONS ──────────────────────────────────────
  async function addWorkshop() {
    if (!newWorkshop.name) { setWorkshopMsg({ type: 'error', text: 'Name required.' }); return }
    setAddingWorkshop(true)
    const { error } = await supabase.from('workshops').insert({ ...newWorkshop, max_per_guest: 1, is_paid: false, price: 0 })
    if (!error) {
      setWorkshopMsg({ type: 'success', text: 'Workshop added.' })
      setNewWorkshop({ name: '', category: '', instructor: '', description: '', location: '' })
      await loadAll()
    } else setWorkshopMsg({ type: 'error', text: 'Could not add workshop.' })
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
      description: editWorkshopData.description
    }).eq('id', editingWorkshop.id)
    if (!error) {
      setEditingWorkshop(null)
      await loadAll()
    } else {
      setWorkshopMsg({ type: 'error', text: 'Could not update workshop.' })
    }
    setSavingWorkshop(false)
  }

  async function addSession() {
    if (!newSession.workshop_id || !newSession.start_time || !newSession.end_time || !selectedEvent) {
      setSessionMsg({ type: 'error', text: 'All fields required.' }); return
    }
    setAddingSession(true)
    const { error } = await supabase.from('sessions').insert({
      event_id: selectedEvent.id,
      workshop_id: newSession.workshop_id,
      date: newSession.date || selectedEvent.start_date,
      start_time: newSession.start_time,
      end_time: newSession.end_time,
      capacity: parseInt(newSession.capacity)
    })
    if (!error) {
      setSessionMsg({ type: 'success', text: 'Time slot added.' })
      setNewSession(s => ({ ...s, start_time: '', end_time: '' }))
      await loadAll()
    } else setSessionMsg({ type: 'error', text: 'Could not add time slot.' })
    setAddingSession(false)
  }

  async function saveCapacity(sessionId, cap) {
    await supabase.from('sessions').update({ capacity: parseInt(cap) }).eq('id', sessionId)
    setEditingCapacity({})
    await loadAll()
  }

  async function deleteSession(id) {
    if (!deleteConfirm['session_' + id]) {
      setDeleteConfirm(d => ({ ...d, ['session_' + id]: true })); return
    }
    await supabase.from('sessions').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['session_' + id]; return n })
    await loadAll()
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
  async function deleteTicketType(id) {
    if (!deleteConfirm['tt_' + id]) { setDeleteConfirm(d => ({ ...d, ['tt_' + id]: true })); return }
    await supabase.from('ticket_types').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['tt_' + id]; return n })
    await loadAll()
  }

  async function addEvent() {
    if (!newEvent.name || !newEvent.start_date || !newEvent.end_date) {
      setEventMsg({ type: 'error', text: 'Name and dates required.' }); return
    }
    setAddingEvent(true)
    const { error } = await supabase.from('events').insert({ ...newEvent, status: 'upcoming' })
    if (!error) {
      setEventMsg({ type: 'success', text: 'Event created.' })
      setNewEvent({ name: '', description: '', location: '', start_date: '', end_date: '', registration_opens_at: '' })
      await loadAll()
    } else setEventMsg({ type: 'error', text: 'Could not create event.' })
    setAddingEvent(false)
  }

  async function updateEventField(eventId, field, value) {
    await supabase.from('events').update({ [field]: value || null }).eq('id', eventId)
    await loadAll()
  }

  async function addInstructor() {
    if (!newInstructor.name || !newInstructor.pin || !newInstructor.workshop_id) {
      setInstructorMsg({ type: 'error', text: 'All fields required.' }); return
    }
    setAddingInstructor(true)
    const { error } = await supabase.from('instructor_pins').insert(newInstructor)
    if (!error) {
      setInstructorMsg({ type: 'success', text: 'Instructor added.' })
      setNewInstructor({ name: '', pin: '', workshop_id: '' })
      await loadAll()
    } else setInstructorMsg({ type: 'error', text: error.message.includes('unique') ? 'PIN already in use.' : 'Could not add.' })
    setAddingInstructor(false)
  }

  async function deleteInstructor(id) {
    if (!deleteConfirm['instr_' + id]) { setDeleteConfirm(d => ({ ...d, ['instr_' + id]: true })); return }
    await supabase.from('instructor_pins').delete().eq('id', id)
    setDeleteConfirm(d => { const n = { ...d }; delete n['instr_' + id]; return n })
    await loadAll()
  }

  async function saveShopify() {
    setSavingShopify(true)
    const mapObj = {}
    shopifyMap.forEach(r => { if (r.product && r.ticket_type_id) mapObj[r.product] = r.ticket_type_id })
    await Promise.all([
      supabase.from('admin_settings').update({ value: shopifySecret }).eq('key', 'shopify_webhook_secret'),
      supabase.from('admin_settings').update({ value: JSON.stringify(mapObj) }).eq('key', 'shopify_product_map')
    ])
    setShopifyMsg({ type: 'success', text: 'Saved.' })
    setSavingShopify(false)
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
      <div style={{ display: 'flex', borderBottom: '0.5px solid #e0e0e0', marginBottom: 20, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => onChange(t)} style={{ padding: '7px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: active === t ? '#1a1a1a' : '#888', borderBottom: active === t ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -1, fontWeight: active === t ? 500 : 400, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
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
          const waitlisted = registrations.filter(r => r.session_id === session.id && r.status === 'waitlisted')
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
                  {waitlisted.length > 0 && <>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 6, marginBottom: 2 }}>Waitlist</div>
                    {waitlisted.map(r => (
                      <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: '#fffbea', borderRadius: 6, fontSize: 13 }}>
                        <span>{r.guests?.name}</span>
                        {r.party_size > 1 && <span style={{ color: '#888' }}>party of {r.party_size}</span>}
                      </div>
                    ))}
                  </>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── MAIN ADMIN ────────────────────────────────────────────
  const adminTabs = ['dashboard', 'guests', 'workshops', 'time slots']
  const superTabs = [...adminTabs, 'ticket types', 'events', 'instructors', 'shopify', 'settings']
  const tabs = role === 'super' ? superTabs : adminTabs

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: '24px 16px', color: '#1a1a1a' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>
            {role === 'super' ? 'Super Admin' : 'Admin'} · Snow Peak USA
          </div>
          <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 10 }}>Workshop Manager</div>
          {/* Event switcher */}
          {events.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {events.map(ev => (
                <button key={ev.id} onClick={() => { setSelectedEvent(ev); setNewSession(s => ({ ...s, date: ev.start_date })) }} style={{
                  padding: '4px 12px', borderRadius: 20, border: '0.5px solid',
                  borderColor: selectedEvent?.id === ev.id ? '#1a1a1a' : '#d0d0d0',
                  background: selectedEvent?.id === ev.id ? '#1a1a1a' : '#fff',
                  color: selectedEvent?.id === ev.id ? '#fff' : '#666',
                  fontSize: 12, cursor: 'pointer'
                }}>
                  {ev.name} <span style={{ opacity: 0.6, fontSize: 10 }}>{ev.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={loadAll} style={btn('#fff')}>↻ Refresh</button>
          <button onClick={() => setRole(null)} style={btn('#fff')}>Sign out</button>
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
              <Msg msg={bulkMsg} />
              <textarea value={bulkCSV} onChange={e => { setBulkCSV(e.target.value); setBulkPreview([]) }}
                placeholder={'Alice Chen, alice@example.com, 4P Cabin\nBob Marley, bob@example.com, 5P Tentsite'}
                style={{ width: '100%', height: 150, fontSize: 13, padding: '10px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0', boxSizing: 'border-box', fontFamily: 'monospace', resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={() => setBulkPreview(parseBulkCSV(bulkCSV))} style={btn('#fff')}>Preview</button>
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
            </div>
          )}

          {guestSubTab === 'list' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <input type="text" placeholder="Search..." value={guestSearch} onChange={e => setGuestSearch(e.target.value)}
                  style={{ flex: 1, minWidth: 180, fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #d0d0d0' }} />
                <button onClick={exportInviteLinks} style={btn('#fff')}>↓ Export CSV ({filteredGuests.length})</button>
              </div>
              {filteredGuests.map(guest => {
                const total = getGuestTotal(guest)
                const used = getGuestCreditsUsed(guest.id)
                const remaining = total - used
                const gRegs = filteredRegs.filter(r => r.guest_id === guest.id && r.status === 'confirmed')
                const isDeleting = deleteConfirm[guest.id] !== undefined
                return (
                  <div key={guest.id} style={card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{guest.name}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{guest.email}</div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                          {guest.ticket_types?.name} · {remaining} of {total} credits remaining
                          {guest.waiver_signed && <span style={{ marginLeft: 8, color: '#1a7a4a' }}>✓ waiver</span>}
                        </div>
                        {gRegs.length > 0 && (
                          <div style={{ fontSize: 11, color: '#1a7a4a', marginTop: 4 }}>
                            ✓ {gRegs.map(r => r.sessions?.workshops?.name + (r.party_size > 1 ? ' ×' + r.party_size : '')).join(', ')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <button onClick={() => { const base = window.location.origin.replace('/admin', ''); navigator.clipboard.writeText(base + '?token=' + guest.token + (selectedEvent ? '&event=' + selectedEvent.id : '')) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
                          Copy link
                        </button>
                        <button onClick={() => { setAdjustingGuest(guest); setNewCreditsAvail(total) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>
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
                    {adjustingGuest?.id === guest.id && (
                      <div style={{ marginTop: 12, padding: 12, background: '#f9f9f9', borderRadius: 8 }}>
                        <div style={{ fontSize: 13, marginBottom: 10 }}>Set available credits for {guest.name} at {selectedEvent?.name}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => setNewCreditsAvail(c => Math.max(0, c - 1))} style={{ width: 32, height: 32, borderRadius: 6, border: '0.5px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 18 }}>−</button>
                          <span style={{ fontSize: 18, fontWeight: 500, minWidth: 32, textAlign: 'center' }}>{newCreditsAvail}</span>
                          <button onClick={() => setNewCreditsAvail(c => c + 1)} style={{ width: 32, height: 32, borderRadius: 6, border: '0.5px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontSize: 18 }}>+</button>
                          <span style={{ fontSize: 12, color: '#888' }}>credits available (default: {total})</span>
                          <button onClick={() => saveCredits(guest)} style={btn('#1a1a1a', '#fff')}>Save</button>
                          <button onClick={() => setAdjustingGuest(null)} style={btn('#fff')}>Cancel</button>
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
      {activeTab === 'workshops' && (
        <div>
          <div style={{ maxWidth: 480, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Add workshop</div>
            <Msg msg={workshopMsg} />
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
            <button onClick={addWorkshop} disabled={addingWorkshop} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingWorkshop ? 'Adding...' : 'Add workshop'}
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>All workshops ({workshops.length})</div>
          <Msg msg={workshopMsg} />
          {workshops.map(w => (
            <div key={w.id} style={card}>
              {editingWorkshop?.id === w.id ? (
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
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={updateWorkshop} disabled={savingWorkshop} style={btn('#1a1a1a', '#fff')}>{savingWorkshop ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => setEditingWorkshop(null)} style={btn('#fff')}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{w.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {w.category}{w.instructor ? ' · ' + w.instructor : ''}
                      {w.location ? ' · 📍 ' + w.location : ''}
                    </div>
                    {w.description && <div style={{ fontSize: 12, color: '#aaa' }}>{w.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#888' }}>{filteredSessions.filter(s => s.workshop_id === w.id).length} slots this event</span>
                    <button onClick={() => { setEditingWorkshop(w); setEditWorkshopData({ name: w.name, category: w.category || '', instructor: w.instructor || '', location: w.location || '', description: w.description || '' }); setWorkshopMsg(null) }} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px' }}>Edit</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── TIME SLOTS ── */}
      {activeTab === 'time slots' && (
        <div>
          <div style={{ maxWidth: 480, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>
              Add time slot {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
            </div>
            <Msg msg={sessionMsg} />
            <div style={fw}>
              <label style={lbl}>Workshop *</label>
              <select value={newSession.workshop_id} onChange={e => setNewSession(s => ({ ...s, workshop_id: e.target.value }))} style={inp}>
                <option value="">Select workshop...</option>
                {workshops.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div style={fw}>
              <label style={lbl}>Date *</label>
              <input type="date" value={newSession.date} onChange={e => setNewSession(s => ({ ...s, date: e.target.value }))} style={inp} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lbl}>Start time *</label>
                <input type="time" value={newSession.start_time} onChange={e => setNewSession(s => ({ ...s, start_time: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>End time *</label>
                <input type="time" value={newSession.end_time} onChange={e => setNewSession(s => ({ ...s, end_time: e.target.value }))} style={inp} />
              </div>
            </div>
            <div style={fw}>
              <label style={lbl}>Capacity</label>
              <input type="number" value={newSession.capacity} onChange={e => setNewSession(s => ({ ...s, capacity: e.target.value }))} style={inp} />
            </div>
            <button onClick={addSession} disabled={addingSession} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingSession ? 'Adding...' : 'Add time slot'}
            </button>
          </div>

          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
            Time slots {selectedEvent && <span style={{ fontWeight: 400, color: '#888' }}>· {selectedEvent.name}</span>}
          </div>
          {sessionsByWorkshop.map(w => (
            <div key={w.id} style={card}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{w.name}</div>
              {w.location && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>📍 {w.location}</div>}
              {!w.location && <div style={{ marginBottom: 8 }} />}
              {w.sessions.map(s => {
                const enrolled = getEnrolled(s.id)
                const isEditingCap = editingCapacity[s.id] !== undefined
                const isConfirmDelete = deleteConfirm['session_' + s.id]
                return (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: '#f9f9f9', borderRadius: 7, marginBottom: 5, flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {isEditingCap ? (
                        <>
                          <input type="number" value={editingCapacity[s.id]} onChange={e => setEditingCapacity(c => ({ ...c, [s.id]: e.target.value }))}
                            style={{ width: 60, fontSize: 13, padding: '3px 6px', borderRadius: 5, border: '0.5px solid #d0d0d0' }} />
                          <button onClick={() => saveCapacity(s.id, editingCapacity[s.id])} style={{ ...btn('#1a1a1a', '#fff'), fontSize: 11, padding: '3px 10px' }}>Save</button>
                          <button onClick={() => setEditingCapacity(c => { const n = { ...c }; delete n[s.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '3px 8px' }}>✕</button>
                        </>
                      ) : (
                        <button onClick={() => setEditingCapacity(c => ({ ...c, [s.id]: s.capacity }))} style={{ fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>
                          {enrolled}/{s.capacity} · edit cap
                        </button>
                      )}
                      {!isConfirmDelete ? (
                        <button onClick={() => setDeleteConfirm(d => ({ ...d, ['session_' + s.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, padding: '3px 8px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
                      ) : (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => deleteSession(s.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '3px 10px' }}>Confirm delete</button>
                          <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['session_' + s.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '3px 8px' }}>✕</button>
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
            <div key={tt.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{tt.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>Party of {tt.party_cap} · {tt.credits_per_person} credits/person · {tt.credits_per_person * tt.party_cap} total</div>
                {tt.description && <div style={{ fontSize: 12, color: '#aaa' }}>{tt.description}</div>}
              </div>
              {!deleteConfirm['tt_' + tt.id] ? (
                <button onClick={() => setDeleteConfirm(d => ({ ...d, ['tt_' + tt.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 10px', color: '#c0392b', borderColor: '#f5c0c0' }}>Delete</button>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => deleteTicketType(tt.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                  <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['tt_' + tt.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
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
            <button onClick={addEvent} disabled={addingEvent} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingEvent ? 'Creating...' : 'Create event'}
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Events</div>
          {events.map(ev => (
            <div key={ev.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{ev.name}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{ev.location} · {ev.start_date} to {ev.end_date}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    {['upcoming', 'active', 'past'].map(s => (
                      <button key={s} onClick={() => updateEventField(ev.id, 'status', s)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, border: '0.5px solid', borderColor: ev.status === s ? '#1a1a1a' : '#d0d0d0', background: ev.status === s ? '#1a1a1a' : '#fff', color: ev.status === s ? '#fff' : '#666', cursor: 'pointer', textTransform: 'capitalize' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label style={lbl}>Registration opens</label>
                <input type="datetime-local" defaultValue={ev.registration_opens_at?.slice(0, 16) || ''}
                  onBlur={e => updateEventField(ev.id, 'registration_opens_at', e.target.value)}
                  style={{ ...inp, maxWidth: 300 }} />
                {ev.registration_opens_at && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                    {new Date(ev.registration_opens_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── INSTRUCTORS ── */}
      {activeTab === 'instructors' && role === 'super' && (
        <div>
          <div style={{ maxWidth: 480, marginBottom: 28 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Add instructor access</div>
            <Msg msg={instructorMsg} />
            <div style={fw}><label style={lbl}>Name</label><input type="text" value={newInstructor.name} onChange={e => setNewInstructor(i => ({ ...i, name: e.target.value }))} placeholder="Thaan" style={inp} /></div>
            <div style={fw}><label style={lbl}>PIN</label><input type="text" value={newInstructor.pin} onChange={e => setNewInstructor(i => ({ ...i, pin: e.target.value }))} placeholder="thaan2026" style={inp} /></div>
            <div style={fw}>
              <label style={lbl}>Workshop</label>
              <select value={newInstructor.workshop_id} onChange={e => setNewInstructor(i => ({ ...i, workshop_id: e.target.value }))} style={inp}>
                <option value="">Select...</option>
                {workshops.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <button onClick={addInstructor} disabled={addingInstructor} style={{ ...btn('#1a1a1a', '#fff'), width: '100%', padding: '10px' }}>
              {addingInstructor ? 'Adding...' : 'Add instructor'}
            </button>
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>Instructors</div>
          {instructorPins.map(ip => (
            <div key={ip.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{ip.name}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{ip.workshops?.name} · PIN: {ip.pin}</div>
              </div>
              {!deleteConfirm['instr_' + ip.id] ? (
                <button onClick={() => setDeleteConfirm(d => ({ ...d, ['instr_' + ip.id]: true }))} style={{ ...btn('#fff'), fontSize: 11, color: '#c0392b', borderColor: '#f5c0c0' }}>Remove</button>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => deleteInstructor(ip.id)} style={{ ...btn('#c0392b', '#fff'), fontSize: 11, padding: '4px 10px' }}>Confirm</button>
                  <button onClick={() => setDeleteConfirm(d => { const n = { ...d }; delete n['instr_' + ip.id]; return n })} style={{ ...btn('#fff'), fontSize: 11, padding: '4px 8px' }}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── SHOPIFY ── */}
      {activeTab === 'shopify' && role === 'super' && (
        <div style={{ maxWidth: 580 }}>
          <div style={{ padding: 14, background: '#f9f9f9', borderRadius: 8, marginBottom: 20, fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ fontWeight: 500, marginBottom: 6 }}>Setup instructions</div>
            <div style={{ color: '#555' }}>
              1. In Shopify: Settings → Notifications → Webhooks → Create webhook<br />
              2. Event: <strong>Order created</strong> · Format: <strong>JSON</strong><br />
              3. URL: <code style={{ background: '#eee', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>{typeof window !== 'undefined' ? window.location.origin.replace('/admin', '') : ''}/api/shopify-webhook</code><br />
              4. Copy the webhook signing secret and paste it below<br />
              5. Map each Shopify product name to a ticket type below
            </div>
          </div>
          <Msg msg={shopifyMsg} />
          <div style={fw}>
            <label style={lbl}>Shopify webhook signing secret</label>
            <input type="text" value={shopifySecret} onChange={e => setShopifySecret(e.target.value)} placeholder="whsec_..." style={inp} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, marginTop: 16 }}>Product → Ticket type mapping</div>
          {shopifyMap.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
              <input type="text" value={row.product} onChange={e => setShopifyMap(m => m.map((r, j) => j === i ? { ...r, product: e.target.value } : r))}
                placeholder="Exact Shopify product name" style={{ ...inp, fontSize: 12 }} />
              <select value={row.ticket_type_id} onChange={e => setShopifyMap(m => m.map((r, j) => j === i ? { ...r, ticket_type_id: e.target.value } : r))} style={{ ...inp, fontSize: 12 }}>
                <option value="">Select ticket type...</option>
                {ticketTypes.map(tt => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
              </select>
              <button onClick={() => setShopifyMap(m => m.filter((_, j) => j !== i))} style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid #f5c0c0', background: '#fff', color: '#c0392b', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <button onClick={() => setShopifyMap(m => [...m, { product: '', ticket_type_id: '' }])} style={{ ...btn('#fff'), marginBottom: 16 }}>+ Add mapping</button>
          <div><button onClick={saveShopify} disabled={savingShopify} style={{ ...btn('#1a1a1a', '#fff'), padding: '10px 24px' }}>{savingShopify ? 'Saving...' : 'Save Shopify settings'}</button></div>
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
            <strong>Super admin</strong> — ticket types, events, Shopify, instructors, PINs, everything<br />
            <strong>Admin</strong> — guests, workshops, time slots, dashboard<br />
            <strong>Instructor</strong> — read-only roster for their workshop
          </div>
        </div>
      )}
    </div>
  )
}