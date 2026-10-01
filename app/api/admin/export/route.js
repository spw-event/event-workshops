import { checkAuth, fetchAll, json, loadEventData, normalizeTime, resolveEvent } from '@/lib/adminApi'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/admin/export?event=<id|name> — read-only snapshot of an event's
// staff (no PINs), workshops + sessions with registered seat counts, and
// partners, in the same shape POST /api/admin/import accepts, so it can be
// diffed against or edited and posted back.
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

    return json({
      event: event.id,
      event_name: event.name,
      staff: staffRows,
      workshops: workshopList,
      partners
    })
  } catch (err) {
    return json({ error: err.message || 'Export failed.' }, 500)
  }
}
