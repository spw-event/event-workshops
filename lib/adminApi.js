import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'

// Shared plumbing for the token-authenticated admin API routes
// (app/api/admin/*). Everything here runs with the service-role client, so
// it must stay server-only.

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

// Returns an error Response, or null when the bearer token matches
// ADMIN_IMPORT_TOKEN. Both sides are hashed first so timingSafeEqual always
// compares equal-length buffers and the token length isn't leaked either.
export function checkAuth(request) {
  const expected = process.env.ADMIN_IMPORT_TOKEN
  if (!expected || expected.length < 32) {
    return json({ error: 'Admin import API is not configured.' }, 503)
  }
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  const given = match ? match[1] : ''
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!given || !timingSafeEqual(a, b)) {
    return json({ error: 'Unauthorized' }, 401)
  }
  return null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `ref` is an events.id or an exact events.name. Returns { event } or
// { error } (always a 400-level problem with the reference itself).
export async function resolveEvent(db, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    return { error: '`event` is required (events.id or exact events.name).' }
  }
  const value = ref.trim()
  const query = db.from('events').select('*')
  const { data, error } = UUID_RE.test(value)
    ? await query.eq('id', value)
    : await query.eq('name', value)
  if (error) throw error
  if (!data || data.length === 0) return { error: `No event found for "${value}".` }
  if (data.length > 1) return { error: `"${value}" matches ${data.length} events; pass the event id instead.` }
  return { event: data[0] }
}

// PostgREST caps responses (1000 rows by default), so page through anything
// that could plausibly grow past that. makeQuery must return a fresh,
// deterministically ordered query each call.
export async function fetchAll(makeQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
}

// Postgres `time` columns come back as "HH:MM:SS"; the API speaks "HH:MM".
export function normalizeTime(t) {
  return typeof t === 'string' ? t.slice(0, 5) : t ?? null
}

// Everything about one event that both import (for diffing) and export need.
export async function loadEventData(db, eventId) {
  const sessions = await fetchAll(() => db.from('sessions')
    .select('id, workshop_id, date, start_time, end_time, capacity, workshops(*)')
    .eq('event_id', eventId)
    .order('id'))

  // Seats held per session by every non-cancelled registration — capacity is
  // counted in seats (party_size), matching check_session_capacity().
  const seatsBySession = {}
  const ids = sessions.map(s => s.id)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const regs = await fetchAll(() => db.from('registrations')
      .select('id, session_id, party_size')
      .in('session_id', chunk)
      .neq('status', 'cancelled')
      .order('id'))
    for (const r of regs) {
      seatsBySession[r.session_id] = (seatsBySession[r.session_id] || 0) + (r.party_size ?? 1)
    }
  }

  const partners = await fetchAll(() => db.from('event_partners')
    .select('*')
    .eq('event_id', eventId)
    .order('id'))

  const assignments = await fetchAll(() => db.from('staff_event_assignments')
    .select('staff_id')
    .eq('event_id', eventId)
    .order('id'))

  const moments = await fetchAll(() => db.from('open_moments')
    .select('*')
    .eq('event_id', eventId)
    .order('id'))

  const shifts = await fetchAll(() => db.from('staff_shifts')
    .select('*')
    .eq('event_id', eventId)
    .order('id'))

  return {
    sessions,
    seatsBySession,
    partners,
    moments,
    shifts,
    assignedStaffIds: new Set(assignments.map(a => a.staff_id))
  }
}
