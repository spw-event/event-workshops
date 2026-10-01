import 'server-only'
import { randomInt } from 'node:crypto'
import { fetchAll, loadEventData, normalizeTime } from './adminApi'

// Import pipeline for POST /api/admin/import (spec: docs/admin-import-spec.md).
//
//   validateInput()  — shape/type checks only, no database access
//   planImport()     — matches records against the database and builds the
//                      diff (results) plus the writes needed (ops); it also
//                      reports conflicts that need the database to detect
//   applyPlan()      — runs the ops in order. Never deletes anything.
//
// Nothing is written unless validation and planning both come back with zero
// errors, and the caller passes dry_run: false.

const DEFAULT_SESSION_CAPACITY = 30 // same default as the admin UI

const STAFF_SCHEMA = {
  name: { type: 'string', required: true },
  email: { type: 'email', nullable: true },
  phone: { type: 'string', nullable: true },
  notes: { type: 'string', nullable: true },
  is_vendor: { type: 'boolean' },
  vendor_name: { type: 'string', nullable: true },
  is_checkin: { type: 'boolean' },
  pin: { type: 'pin', nullable: true }
}
const STAFF_UPDATE_FIELDS = ['name', 'email', 'phone', 'notes', 'is_vendor', 'vendor_name', 'is_checkin']

const WORKSHOP_SCHEMA = {
  name: { type: 'string', required: true },
  // Part of the match key, so it has to be stated even when there is none.
  instructor: { type: 'string', nullable: true, required: true },
  category: { type: 'string', nullable: true },
  location: { type: 'string', nullable: true },
  description: { type: 'string', nullable: true },
  max_per_guest: { type: 'int', min: 1 },
  credit_cost: { type: 'int', min: 1 },
  sessions: { type: 'array' }
}
const WORKSHOP_UPDATE_FIELDS = ['name', 'instructor', 'category', 'location', 'description', 'max_per_guest', 'credit_cost']

const SESSION_SCHEMA = {
  date: { type: 'date', required: true },
  start_time: { type: 'time', required: true },
  end_time: { type: 'time' },
  capacity: { type: 'int', min: 1 }
}

const PARTNER_SCHEMA = {
  name: { type: 'string', required: true },
  description: { type: 'string', nullable: true },
  website_url: { type: 'string', nullable: true },
  logo_url: { type: 'string', nullable: true },
  sort_order: { type: 'int' }
}
const PARTNER_UPDATE_FIELDS = ['name', 'description', 'website_url', 'logo_url', 'sort_order']

// open_moments. Dateless/timeless moments are fine (amenities with hours_text).
const MOMENT_SCHEMA = {
  name: { type: 'string', required: true },
  date: { type: 'date', nullable: true },
  start_time: { type: 'time', nullable: true },
  end_time: { type: 'time', nullable: true },
  moment_type: { type: 'enum', values: ['mandatory', 'optional', 'amenity', 'staff_only'] },
  location: { type: 'string', nullable: true },
  description: { type: 'string', nullable: true },
  hours_text: { type: 'string', nullable: true },
  staff_notes: { type: 'string', nullable: true }
}
const MOMENT_UPDATE_FIELDS = ['end_time', 'moment_type', 'location', 'description', 'hours_text', 'staff_notes']

// staff_shifts. `date` maps to the shift_date column.
const SHIFT_SCHEMA = {
  title: { type: 'string', required: true },
  date: { type: 'date', required: true },
  start_time: { type: 'time', required: true },
  end_time: { type: 'time' },
  shift_type: { type: 'enum', values: ['setup', 'breakdown', 'travel', 'driving', 'general', 'briefing'] },
  location: { type: 'string', nullable: true },
  description: { type: 'string', nullable: true }
}
const SHIFT_UPDATE_FIELDS = ['end_time', 'shift_type', 'location', 'description']

// Admin flags can never be set through the API; they're dropped and the
// result says so. Read-only fields that /api/admin/export emits are dropped
// silently so an export can be edited and posted straight back.
const STAFF_REPORTED_IGNORED = ['is_admin', 'is_super_admin']
const STAFF_SILENT_IGNORED = ['is_active']
const SESSION_SILENT_IGNORED = ['registered']

const TOP_LEVEL_FIELDS = ['event', 'dry_run', 'source', 'staff', 'workshops', 'partners', 'moments', 'shifts']
const TOP_LEVEL_SILENT_IGNORED = ['event_name'] // emitted by export

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

// ── Validation ─────────────────────────────────────────────

function checkValue(value, spec) {
  if (value === null) return spec.nullable ? { value: null } : { error: 'cannot be null' }
  switch (spec.type) {
    case 'string':
    case 'email':
    case 'pin': {
      if (typeof value !== 'string') return { error: 'must be a string' }
      const v = value.trim()
      if (!v) return spec.nullable ? { value: null } : { error: 'cannot be empty' }
      if (spec.type === 'email') {
        const email = v.toLowerCase()
        return EMAIL_RE.test(email) ? { value: email } : { error: 'is not a valid email address' }
      }
      if (spec.type === 'pin' && /\s/.test(v)) return { error: 'cannot contain spaces' }
      return { value: v }
    }
    case 'boolean':
      return typeof value === 'boolean' ? { value } : { error: 'must be true or false' }
    case 'int':
      if (!Number.isInteger(value)) return { error: 'must be a whole number' }
      if (spec.min != null && value < spec.min) return { error: `must be at least ${spec.min}` }
      return { value }
    case 'date': {
      const valid = typeof value === 'string' && DATE_RE.test(value) &&
        !isNaN(Date.parse(value + 'T00:00:00Z')) &&
        new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
      return valid ? { value } : { error: 'must be a date like 2026-10-17' }
    }
    case 'time':
      return typeof value === 'string' && TIME_RE.test(value)
        ? { value: value.slice(0, 5) }
        : { error: 'must be a 24-hour time like 14:30' }
    case 'array':
      return Array.isArray(value) ? { value } : { error: 'must be an array' }
    case 'enum':
      return spec.values.includes(value) ? { value } : { error: 'must be one of: ' + spec.values.join(', ') }
    default:
      return { error: 'unsupported field' }
  }
}

function validateFields(raw, schema, path, errors, { reportedIgnored = [], silentIgnored = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ path, message: 'must be an object' })
    return null
  }
  const values = {}
  const ignored = []
  for (const [field, value] of Object.entries(raw)) {
    const spec = schema[field]
    if (!spec) {
      if (reportedIgnored.includes(field)) ignored.push(field)
      else if (!silentIgnored.includes(field)) errors.push({ path: `${path}.${field}`, message: 'unknown field' })
      continue
    }
    const result = checkValue(value, spec)
    if (result.error) errors.push({ path: `${path}.${field}`, message: result.error })
    else values[field] = result.value
  }
  for (const [field, spec] of Object.entries(schema)) {
    if (spec.required && !(field in raw)) {
      errors.push({ path: `${path}.${field}`, message: spec.nullable ? 'is required (use null if there is none)' : 'is required' })
    }
  }
  return { values, ignored }
}

// Shape and type checks for the whole request body. Returns { errors, input };
// input is only meaningful when errors is empty.
export function validateInput(body) {
  const errors = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [{ path: 'body', message: 'must be a JSON object' }], input: null }
  }
  for (const field of Object.keys(body)) {
    if (!TOP_LEVEL_FIELDS.includes(field) && !TOP_LEVEL_SILENT_IGNORED.includes(field)) errors.push({ path: field, message: 'unknown field' })
  }
  if ('dry_run' in body && typeof body.dry_run !== 'boolean') {
    errors.push({ path: 'dry_run', message: 'must be true or false' })
  }
  if ('source' in body && body.source !== null && typeof body.source !== 'string') {
    errors.push({ path: 'source', message: 'must be a string' })
  }
  for (const list of ['staff', 'workshops', 'partners', 'moments', 'shifts']) {
    if (list in body && !Array.isArray(body[list])) errors.push({ path: list, message: 'must be an array' })
  }
  const arrayOf = list => (Array.isArray(body[list]) ? body[list] : [])

  const staff = arrayOf('staff').map((raw, i) =>
    validateFields(raw, STAFF_SCHEMA, `staff[${i}]`, errors, {
      reportedIgnored: STAFF_REPORTED_IGNORED,
      silentIgnored: STAFF_SILENT_IGNORED
    }))

  const partners = arrayOf('partners').map((raw, i) =>
    validateFields(raw, PARTNER_SCHEMA, `partners[${i}]`, errors)?.values)

  const workshops = arrayOf('workshops').map((raw, i) => {
    const path = `workshops[${i}]`
    const parsed = validateFields(raw, WORKSHOP_SCHEMA, path, errors)
    if (!parsed) return null
    const { sessions = [], ...fields } = parsed.values
    return {
      fields,
      sessions: sessions.map((s, j) =>
        validateFields(s, SESSION_SCHEMA, `${path}.sessions[${j}]`, errors, { silentIgnored: SESSION_SILENT_IGNORED })?.values)
    }
  })

  const moments = arrayOf('moments').map((raw, i) =>
    validateFields(raw, MOMENT_SCHEMA, `moments[${i}]`, errors)?.values)

  const shifts = arrayOf('shifts').map((raw, i) =>
    validateFields(raw, SHIFT_SCHEMA, `shifts[${i}]`, errors)?.values)

  return {
    errors,
    input: {
      event: body.event,
      dryRun: body.dry_run !== false,
      source: typeof body.source === 'string' ? body.source.trim() || null : null,
      staff,
      workshops,
      partners,
      moments,
      shifts
    }
  }
}

// ── Planning ───────────────────────────────────────────────

const lower = v => (v ?? '').trim().toLowerCase()

function groupBy(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  return map
}

// Field-by-field diff limited to fields present in the payload — absent
// fields are left alone, an explicit null clears.
function diff(existing, values, fields, normalize = v => v ?? null) {
  const changes = {}
  for (const field of fields) {
    if (!(field in values)) continue
    const before = normalize(existing[field], field)
    if (before !== values[field]) changes[field] = [before, values[field]]
  }
  return changes
}

const patchFrom = changes => Object.fromEntries(Object.entries(changes).map(([f, [, after]]) => [f, after]))

async function insertRow(db, table, row) {
  const { data, error } = await db.from(table).insert(row).select('id').single()
  if (error) throw new Error(`${table} insert failed: ${error.message}`)
  return data
}

async function updateRow(db, table, id, patch) {
  const { error } = await db.from(table).update(patch).eq('id', id)
  if (error) throw new Error(`${table} update failed: ${error.message}`)
}

// Registers an update (or "unchanged") result plus its write.
function planUpdate(ctx, { type, key, table, id, changes, extra = {} }) {
  if (Object.keys(changes).length === 0) {
    ctx.results.push({ type, key, action: 'unchanged', ...extra })
    return
  }
  const result = { type, key, action: 'update', changes, ...extra }
  ctx.results.push(result)
  const patch = patchFrom(changes)
  ctx.ops.push({ result, run: db => updateRow(db, table, id, patch) })
}

// Rejects a second record with the same match key in one payload — the two
// would race to create/update the same row.
function checkDuplicate(ctx, seen, key, path) {
  if (seen.has(key)) {
    ctx.errors.push({ path, message: `same match key as ${seen.get(key)}` })
    return true
  }
  seen.set(key, path)
  return false
}

function planPartners(ctx, partners) {
  const byName = groupBy(ctx.data.partners, p => lower(p.name))
  const seen = new Map()
  partners.forEach((p, i) => {
    const path = `partners[${i}]`
    const key = lower(p.name)
    if (checkDuplicate(ctx, seen, key, path)) return
    const matches = byName.get(key) || []
    if (matches.length > 1) {
      ctx.errors.push({ path, message: `matches ${matches.length} existing partners named "${p.name}" on this event; remove the duplicate in the admin UI first` })
      return
    }
    if (matches.length === 0) {
      const row = {
        event_id: ctx.event.id,
        name: p.name,
        description: p.description ?? null,
        website_url: p.website_url ?? null,
        logo_url: p.logo_url ?? null,
        sort_order: p.sort_order ?? 0
      }
      const result = { type: 'partner', key: p.name, action: 'create' }
      ctx.results.push(result)
      ctx.ops.push({ result, run: db => insertRow(db, 'event_partners', row) })
      return
    }
    const existing = matches[0]
    planUpdate(ctx, {
      type: 'partner', key: p.name, table: 'event_partners', id: existing.id,
      changes: diff(existing, p, PARTNER_UPDATE_FIELDS)
    })
  })
}

const nameVendorKey = (name, vendorName) => `${lower(name)} / ${lower(vendorName)}`

function generatePin(takenPins) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const pin = String(randomInt(100000, 1000000))
    if (!takenPins.has(pin)) return pin
  }
  throw new Error('Could not generate a unique PIN.')
}

async function planStaff(ctx, db, staff) {
  const allStaff = await fetchAll(() => db.from('staff')
    .select('id, name, email, phone, notes, is_vendor, vendor_name, is_checkin, is_active, pin')
    .order('id'))
  // Staff PINs are unique, and instructor_pins still work as logins, so a new
  // PIN has to avoid both.
  const instructorPins = await fetchAll(() => db.from('instructor_pins').select('id, pin').order('id'))
  const takenPins = new Set([...allStaff, ...instructorPins].map(r => r.pin).filter(Boolean).map(String))

  const byEmail = groupBy(allStaff.filter(s => s.email), s => lower(s.email))
  const byNameVendor = groupBy(allStaff, s => nameVendorKey(s.name, s.vendor_name))
  const byName = groupBy(allStaff, s => lower(s.name))
  const seen = new Map()

  staff.forEach(({ values: s, ignored }, i) => {
    const path = `staff[${i}]`
    const key = s.email || nameVendorKey(s.name, s.vendor_name)
    if (checkDuplicate(ctx, seen, key, path)) return
    const matches = (s.email ? byEmail.get(s.email) : byNameVendor.get(key)) || []
    if (matches.length > 1) {
      ctx.errors.push({ path, message: `matches ${matches.length} existing staff records (${key}); merge them in the admin UI first` })
      return
    }
    const warnings = []
    if (ignored.length) warnings.push(`ignored ${ignored.join(', ')}: admin access can only be granted in the admin UI`)

    if (matches.length === 0) {
      let pin = s.pin ?? null
      const generated = !pin
      if (pin && takenPins.has(pin)) {
        ctx.errors.push({ path: `${path}.pin`, message: 'is already in use' })
        return
      }
      if (generated) pin = generatePin(takenPins)
      takenPins.add(pin)

      // Same person already on file under a different (or no) email?
      // Matching stays strict per the spec; this just flags it in the diff.
      for (const other of byName.get(lower(s.name)) || []) {
        warnings.push(`possible duplicate of existing staff "${other.name}"${other.email ? ` <${other.email}>` : ' (no email)'}`)
      }

      const row = {
        name: s.name,
        email: s.email ?? null,
        phone: s.phone ?? null,
        notes: s.notes ?? null,
        is_vendor: s.is_vendor ?? false,
        vendor_name: s.vendor_name ?? null,
        is_checkin: s.is_checkin ?? false,
        pin,
        is_active: true
      }
      const result = { type: 'staff', key, action: 'create' }
      if (generated) {
        // Only hand out the PIN once it actually exists.
        if (ctx.dryRun) result.pin = 'generated on write'
        else result.generated_pin = pin
      }
      if (warnings.length) result.warnings = warnings
      ctx.results.push(result)
      ctx.ops.push({
        result,
        run: async db => {
          const created = await insertRow(db, 'staff', row)
          await insertRow(db, 'staff_event_assignments', { staff_id: created.id, event_id: ctx.event.id })
        }
      })
      return
    }

    const existing = matches[0]
    const changes = diff(existing, s, STAFF_UPDATE_FIELDS, (v, field) => (field === 'email' ? (v ? lower(v) : null) : v ?? null))

    // An existing PIN is never changed or cleared; a missing one may be filled.
    if ('pin' in s) {
      if (existing.pin && s.pin !== String(existing.pin)) {
        warnings.push('pin ignored: existing PINs are never changed')
      } else if (!existing.pin && s.pin) {
        if (takenPins.has(s.pin)) {
          ctx.errors.push({ path: `${path}.pin`, message: 'is already in use' })
          return
        }
        takenPins.add(s.pin)
        changes.pin = [null, s.pin]
      }
    }
    if (!existing.is_active) warnings.push('staff record is inactive; reactivate it in the admin UI before they can log in')

    const needsAssignment = !ctx.data.assignedStaffIds.has(existing.id)
    const extra = warnings.length ? { warnings } : {}
    if (!needsAssignment) {
      planUpdate(ctx, { type: 'staff', key, table: 'staff', id: existing.id, changes, extra })
      return
    }
    const patch = patchFrom(changes)
    const result = { type: 'staff', key, action: 'update', changes: { ...changes, event_assignment: [false, true] }, ...extra }
    ctx.results.push(result)
    ctx.ops.push({
      result,
      run: async db => {
        if (Object.keys(patch).length) await updateRow(db, 'staff', existing.id, patch)
        await insertRow(db, 'staff_event_assignments', { staff_id: existing.id, event_id: ctx.event.id })
      }
    })
  })
}

const workshopKey = (name, instructor) => `${lower(name)} / ${lower(instructor)}`
const sessionKey = (date, startTime) => `${date} ${startTime}`

// Workshops have no event_id; they belong to an event through their
// sessions. Matching is limited to workshops that already have a session on
// this event, because copying an event duplicates its workshops — an
// update must never bleed into another event's copy.
function planWorkshops(ctx, workshops) {
  const eventWorkshops = new Map()
  for (const s of ctx.data.sessions) if (s.workshops) eventWorkshops.set(s.workshop_id, s.workshops)
  const byKey = groupBy([...eventWorkshops.values()], w => workshopKey(w.name, w.instructor))
  const sessionsByWorkshop = groupBy(ctx.data.sessions, s => s.workshop_id)
  const seen = new Map()

  workshops.forEach(({ fields: w, sessions }, i) => {
    const path = `workshops[${i}]`
    const key = workshopKey(w.name, w.instructor)
    if (checkDuplicate(ctx, seen, key, path)) return
    const matches = byKey.get(key) || []
    if (matches.length > 1) {
      ctx.errors.push({ path, message: `matches ${matches.length} workshops on this event (${key}); merge them in the admin UI first` })
      return
    }
    const label = w.instructor ? `${w.name} (${w.instructor})` : w.name

    // Shared with this workshop's session ops; a new workshop's id is filled
    // in when its insert runs, which always precedes its sessions' inserts.
    const ref = { id: null }
    let existingSessions = []
    if (matches.length === 0) {
      const row = {
        name: w.name,
        instructor: w.instructor,
        category: w.category ?? null,
        location: w.location ?? null,
        description: w.description ?? null,
        max_per_guest: w.max_per_guest ?? 1,
        credit_cost: w.credit_cost ?? 1,
        is_paid: false,
        price: 0
      }
      const result = { type: 'workshop', key: label, action: 'create' }
      ctx.results.push(result)
      ctx.ops.push({ result, run: async db => { ref.id = (await insertRow(db, 'workshops', row)).id } })
    } else {
      const existing = matches[0]
      ref.id = existing.id
      existingSessions = sessionsByWorkshop.get(existing.id) || []
      planUpdate(ctx, {
        type: 'workshop', key: label, table: 'workshops', id: existing.id,
        changes: diff(existing, w, WORKSHOP_UPDATE_FIELDS)
      })
    }
    planSessions(ctx, { path, workshopName: w.name, ref, existingSessions, sessions })
  })
}

function planSessions(ctx, { path: workshopPath, workshopName, ref, existingSessions, sessions }) {
  const byKey = groupBy(existingSessions, s => sessionKey(s.date, normalizeTime(s.start_time)))
  const { start_date: eventStart, end_date: eventEnd } = ctx.event
  const seen = new Map()

  // Start times per date for this workshop, from the database and this
  // payload, so a new session landing on a day that already has one gets
  // flagged. Usually intentional (morning + afternoon runs), but it's also
  // what a mistyped start time looks like, since start time is the match key.
  const startTimesByDate = new Map()
  const addStart = (date, time) => {
    if (!startTimesByDate.has(date)) startTimesByDate.set(date, new Set())
    startTimesByDate.get(date).add(time)
  }
  existingSessions.forEach(s => addStart(s.date, normalizeTime(s.start_time)))
  sessions.forEach(s => addStart(s.date, s.start_time))

  sessions.forEach((s, j) => {
    const path = `${workshopPath}.sessions[${j}]`
    const k = sessionKey(s.date, s.start_time)
    if (checkDuplicate(ctx, seen, k, path)) return
    const key = `${workshopName} ${k}`
    const matches = byKey.get(k) || []
    if (matches.length > 1) {
      ctx.errors.push({ path, message: `matches ${matches.length} existing sessions at ${k}; remove the duplicate in the admin UI first` })
      return
    }

    if (matches.length === 0) {
      if (!s.end_time) {
        ctx.errors.push({ path: `${path}.end_time`, message: 'is required for a new session' })
        return
      }
      if (s.end_time <= s.start_time) {
        ctx.errors.push({ path: `${path}.end_time`, message: 'must be after start_time' })
        return
      }
      const row = {
        event_id: ctx.event.id,
        date: s.date,
        start_time: s.start_time,
        end_time: s.end_time,
        capacity: s.capacity ?? DEFAULT_SESSION_CAPACITY
      }
      const result = { type: 'session', key, action: 'create' }
      const warnings = []
      if (eventStart && eventEnd && (s.date < eventStart || s.date > eventEnd)) {
        warnings.push(`date is outside the event (${eventStart} to ${eventEnd})`)
      }
      const sameDay = [...startTimesByDate.get(s.date)].filter(t => t !== s.start_time).sort()
      if (sameDay.length) {
        warnings.push(`${workshopName} already has a session on ${s.date} at ${sameDay.join(', ')}; check this isn't a changed start time (that would add a second session, not move the existing one)`)
      }
      if (warnings.length) result.warnings = warnings
      ctx.results.push(result)
      ctx.ops.push({ result, run: db => insertRow(db, 'sessions', { ...row, workshop_id: ref.id }) })
      return
    }

    const existing = matches[0]
    const registered = ctx.data.seatsBySession[existing.id] || 0
    const changes = diff(existing, s, ['end_time', 'capacity'], (v, field) => (field === 'end_time' ? normalizeTime(v) : v ?? null))

    // date + start_time are the match key, so end_time is the only time that
    // can change on a matched session.
    if (changes.end_time) {
      if (changes.end_time[1] <= s.start_time) {
        ctx.errors.push({ path: `${path}.end_time`, message: 'must be after start_time' })
        return
      }
      if (registered > 0) {
        ctx.results.push({
          type: 'session', key, action: 'skip',
          reason: `end_time ${changes.end_time[0]} → ${changes.end_time[1]} on a session with ${registered} registered seat(s) needs a manual decision`
        })
        return
      }
    }

    const skipped = []
    if (changes.capacity && changes.capacity[1] < registered) {
      skipped.push(`capacity ${changes.capacity[1]} < ${registered} registered seat(s)`)
      delete changes.capacity
    }
    if (Object.keys(changes).length === 0 && skipped.length) {
      ctx.results.push({ type: 'session', key, action: 'skip', reason: skipped.join('; ') })
      return
    }
    planUpdate(ctx, {
      type: 'session', key, table: 'sessions', id: existing.id, changes,
      extra: skipped.length ? { skipped } : {}
    })
  })
}

// ── Moments and shifts ─────────────────────────────────────
// Both are single-table, event-scoped schedule items matched on (name,
// date, start time) — the same rule as sessions: a changed start time adds
// an item rather than moving one, so new items on a day that already has a
// same-named item get the same-day warning.
function planScheduleItems(ctx, items, cfg) {
  const { type, listName, table, nameField, dateColumn, existingRows, updateFields, defaults, requiredForCreate } = cfg
  // DB rows → API shape (`date`, HH:MM times) and back.
  const toApi = row => ({ ...row, date: row[dateColumn] ?? null, start_time: normalizeTime(row.start_time), end_time: normalizeTime(row.end_time) })
  const toColumns = values => Object.fromEntries(Object.entries(values).map(([f, v]) => [f === 'date' ? dateColumn : f, v]))
  const existing = existingRows.map(toApi)
  const keyOf = x => `${lower(x[nameField])} | ${x.date || ''} | ${x.start_time || ''}`
  const byKey = groupBy(existing, keyOf)

  const startsByNameDate = new Map()
  const addStart = x => {
    if (!x.date) return
    const k = `${lower(x[nameField])} | ${x.date}`
    if (!startsByNameDate.has(k)) startsByNameDate.set(k, new Set())
    startsByNameDate.get(k).add(x.start_time || 'no set time')
  }
  existing.forEach(addStart)
  items.forEach(addStart)

  const { start_date: eventStart, end_date: eventEnd } = ctx.event
  const seen = new Map()

  items.forEach((item, i) => {
    const path = `${listName}[${i}]`
    if (checkDuplicate(ctx, seen, keyOf(item), path)) return
    const label = [item[nameField], item.date, item.start_time].filter(Boolean).join(' ')
    const matches = byKey.get(keyOf(item)) || []
    if (matches.length > 1) {
      ctx.errors.push({ path, message: `matches ${matches.length} existing ${type}s (${label}); remove the duplicate in the admin UI first` })
      return
    }

    if (matches.length === 0) {
      for (const field of requiredForCreate) {
        if (item[field] == null) {
          ctx.errors.push({ path: `${path}.${field}`, message: `is required for a new ${type}` })
          return
        }
      }
      if (item.start_time && item.end_time && item.end_time <= item.start_time) {
        ctx.errors.push({ path: `${path}.end_time`, message: 'must be after start_time' })
        return
      }
      const result = { type, key: label, action: 'create' }
      const warnings = []
      if (item.date && eventStart && eventEnd && (item.date < eventStart || item.date > eventEnd)) {
        warnings.push(`date is outside the event (${eventStart} to ${eventEnd})`)
      }
      const own = item.start_time || 'no set time'
      const sameDay = item.date ? [...startsByNameDate.get(`${lower(item[nameField])} | ${item.date}`)].filter(t => t !== own).sort() : []
      if (sameDay.length) {
        warnings.push(`"${item[nameField]}" already has an entry on ${item.date} at ${sameDay.join(', ')}; check this isn't a changed start time (that would add a second ${type}, not move the existing one)`)
      }
      if (warnings.length) result.warnings = warnings
      ctx.results.push(result)
      const row = toColumns({ ...defaults, ...item, event_id: ctx.event.id })
      ctx.ops.push({ result, run: db => insertRow(db, table, row) })
      return
    }

    const existingItem = matches[0]
    const endTime = 'end_time' in item ? item.end_time : existingItem.end_time
    if (existingItem.start_time && endTime && endTime <= existingItem.start_time) {
      ctx.errors.push({ path: `${path}.end_time`, message: 'must be after start_time' })
      return
    }
    planUpdate(ctx, {
      type, key: label, table, id: existingItem.id,
      changes: diff(existingItem, item, updateFields)
    })
  })
}

function planMoments(ctx, moments) {
  planScheduleItems(ctx, moments, {
    type: 'moment', listName: 'moments', table: 'open_moments',
    nameField: 'name', dateColumn: 'date',
    existingRows: ctx.data.moments,
    updateFields: MOMENT_UPDATE_FIELDS,
    defaults: { moment_type: 'optional' },
    requiredForCreate: []
  })
}

function planShifts(ctx, shifts) {
  planScheduleItems(ctx, shifts, {
    type: 'shift', listName: 'shifts', table: 'staff_shifts',
    nameField: 'title', dateColumn: 'shift_date',
    existingRows: ctx.data.shifts,
    updateFields: SHIFT_UPDATE_FIELDS,
    defaults: { shift_type: 'general' },
    requiredForCreate: ['end_time']
  })
}

// Matches the validated input against the database. Returns
// { errors, results, ops }; ops is empty-safe to ignore on a dry run.
export async function planImport(db, event, input) {
  const ctx = {
    event,
    dryRun: input.dryRun,
    data: await loadEventData(db, event.id),
    errors: [],
    results: [],
    ops: []
  }
  // Order matters for the writes: partners → staff → workshops/sessions →
  // moments → shifts.
  planPartners(ctx, input.partners)
  if (input.staff.length) await planStaff(ctx, db, input.staff)
  planWorkshops(ctx, input.workshops)
  planMoments(ctx, input.moments)
  planShifts(ctx, input.shifts)
  return { errors: ctx.errors, results: ctx.results, ops: ctx.ops }
}

// Copy of the results safe to persist in import_log: generated PINs go back
// to the caller once and are never stored, only noted as generated.
export function resultsForLog(results) {
  return results.map(r => {
    if (!('generated_pin' in r)) return r
    const copy = { ...r, pin_generated: true }
    delete copy.generated_pin
    return copy
  })
}

export function summarize(results) {
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: 0 }
  const bucket = { create: 'created', update: 'updated', unchanged: 'unchanged', skip: 'skipped' }
  for (const r of results) summary[bucket[r.action]]++
  return summary
}

// Runs the planned writes in order. supabase-js has no multi-statement
// transactions, so a mid-run failure leaves earlier writes in place; on
// failure every result with writes gets `applied: true|false` so the caller
// can see exactly what landed. Returns null on success.
export async function applyPlan(db, ops) {
  for (let i = 0; i < ops.length; i++) {
    try {
      await ops[i].run(db)
    } catch (err) {
      const notApplied = new Set(ops.slice(i).map(op => op.result))
      for (const op of ops) op.result.applied = !notApplied.has(op.result)
      return { message: err.message, failed: { type: ops[i].result.type, key: ops[i].result.key } }
    }
  }
  return null
}
