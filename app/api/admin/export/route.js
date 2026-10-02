import { checkAuth, fetchAll, json, loadEventData, normalizeTime, resolveEvent } from '@/lib/adminApi'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/export?event=<id|name> — read-only snapshot of an event's
// staff (no PINs), workshops + sessions with registered seat counts,
// partners, open moments, staff shifts, and shift/session assignments, in the same shape
// POST /api/admin/import accepts, so it can be diffed against or edited and
// posted back.
export async function GET(request) {
  const unauthorized = checkAuth(request)
  if (unauthorized) return unauthorized

  try {
    const db = getSupabaseAdmin()
    const { event, error: eventError } = await resolveEvent(db, request.nextUrl.searchParams.get('event'))
    if (eventError) return json({ error: eventError }, 400)

    const data = await loadEventData(db, event.id)

    const staffIds = [...data.assignedStaffIds]
    const staffRows = []
    for (let i = 0; i < staffIds.length; i += 100) {
      const chunk = staffIds.slice(i, i + 100)
      staffRows.push(...await fetchAll(() => db.from('staff')
        .select('name, email, phone, notes, is_vendor, vendor_name, is_checkin, is_active')
        .in('id', chunk)
        .order('id')))
    }
    staffRows.sort((a, b) => a.name.localeCompare(b.name))

    const workshops = new Map()
    for (const s of data.sessions) {
      if (!s.workshops) continue
      if (!workshops.has(s.workshop_id)) {
        const w = s.workshops
        workshops.set(s.workshop_id, {
          name: w.name,
          category: w.category,
          instructor: w.instructor,
          location: w.location,
          description: w.description,
          max_per_guest: w.max_per_guest,
          credit_cost: w.credit_cost,
          sessions: []
        })
      }
      workshops.get(s.workshop_id).sessions.push({
        date: s.date,
        start_time: normalizeTime(s.start_time),
        end_time: normalizeTime(s.end_time),
        capacity: s.capacity,
        registered: data.seatsBySession[s.id] || 0
      })
    }
    const byStart = (a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`)
    const workshopList = [...workshops.values()]
    workshopList.forEach(w => w.sessions.sort(byStart))
    workshopList.sort((a, b) => byStart(a.sessions[0], b.sessions[0]) || a.name.localeCompare(b.name))

    const partners = data.partners
      .map(p => ({ name: p.name, description: p.description, website_url: p.website_url, logo_url: p.logo_url, sort_order: p.sort_order }))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))

    const bySchedule = (a, b) => `${a.date || ''} ${a.start_time || ''}`.localeCompare(`${b.date || ''} ${b.start_time || ''}`)
    const moments = data.moments
      .map(m => ({
        name: m.name,
        date: m.date,
        start_time: normalizeTime(m.start_time),
        end_time: normalizeTime(m.end_time),
        moment_type: m.moment_type,
        location: m.location,
        description: m.description,
        hours_text: m.hours_text,
        staff_notes: m.staff_notes
      }))
      .sort((a, b) => bySchedule(a, b) || a.name.localeCompare(b.name))
    const shifts = data.shifts
      .map(s => ({
        title: s.title,
        date: s.shift_date,
        start_time: normalizeTime(s.start_time),
        end_time: normalizeTime(s.end_time),
        shift_type: s.shift_type,
        location: s.location,
        description: s.description
      }))
      .sort((a, b) => bySchedule(a, b) || a.title.localeCompare(b.title))

    // Current shift/session assignments, keyed the way the import matches
    // them (staff email + title/workshop + date + start time).
    const assignedStaffIds = [...new Set(data.staffAssignments.map(a => a.staff_id))]
    const emailById = new Map()
    for (let i = 0; i < assignedStaffIds.length; i += 100) {
      const rows = await fetchAll(() => db.from('staff')
        .select('id, email')
        .in('id', assignedStaffIds.slice(i, i + 100))
        .order('id'))
      for (const r of rows) emailById.set(r.id, r.email)
    }
    const shiftById = new Map(data.shifts.map(s => [s.id, s]))
    const sessionById = new Map(data.sessions.map(s => [s.id, s]))
    const assignments = []
    const listed = new Set()
    let withoutEmail = 0
    let momentAssignments = 0
    let duplicates = 0
    const add = entry => {
      const k = JSON.stringify(entry)
      if (listed.has(k)) { duplicates++; return }
      listed.add(k)
      assignments.push(entry)
    }
    for (const a of data.staffAssignments) {
      if (a.moment_id) { momentAssignments++; continue }
      const email = emailById.get(a.staff_id)
      if (!email) { withoutEmail++; continue }
      if (a.shift_id && shiftById.has(a.shift_id)) {
        const s = shiftById.get(a.shift_id)
        add({ email: email.trim().toLowerCase(), shift: { title: s.title, date: s.shift_date, start_time: normalizeTime(s.start_time) } })
      } else if (a.session_id && sessionById.get(a.session_id)?.workshops) {
        const s = sessionById.get(a.session_id)
        add({ email: email.trim().toLowerCase(), session: { workshop: s.workshops.name, date: s.date, start_time: normalizeTime(s.start_time) } })
      }
    }
    const assignmentSortKey = a => {
      const t = a.shift || a.session
      return `${t.date} ${t.start_time} ${a.shift ? t.title : t.workshop} ${a.email}`
    }
    assignments.sort((a, b) => assignmentSortKey(a).localeCompare(assignmentSortKey(b)))
    const exportNotes = []
    if (momentAssignments) exportNotes.push(`${momentAssignments} moment assignment(s) not listed: the import doesn't support moment assignments`)
    if (withoutEmail) exportNotes.push(`${withoutEmail} assignment(s) not listed: the staff member has no email`)
    if (duplicates) exportNotes.push(`${duplicates} duplicate assignment row(s) listed once; remove the extras in the admin page`)

    return json({
      event: event.id,
      event_name: event.name,
      ...(exportNotes.length ? { export_notes: exportNotes } : {}),
      staff: staffRows,
      workshops: workshopList,
      partners,
      moments,
      shifts,
      assignments
    })
  } catch (err) {
    return json({ error: err.message || 'Export failed.' }, 500)
  }
}
