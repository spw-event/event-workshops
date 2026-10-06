# Admin Import API: Spec

Goal: let Claude (Cowork or Claude Code) load staff/vendor contacts, workshops + sessions, partners, open moments, staff shifts, and staff assignments into the SPW app safely, without handing out database keys.

## Scope

- New route: `POST /api/admin/import` (App Router: `app/api/admin/import/route.js`)
- New route: `GET /api/admin/export?event=<id|name>` (read-only, for diffing before import)
- Server-only Supabase client using the service role key
- No UI changes required

## Auth

- Header: `Authorization: Bearer <ADMIN_IMPORT_TOKEN>`
- Compare with constant-time check. Reject with 401 otherwise.
- New Vercel env vars (server-only, never `NEXT_PUBLIC_`):
  - `ADMIN_IMPORT_TOKEN`: long random string, separate from all PINs and Supabase keys
  - `SUPABASE_SERVICE_ROLE_KEY`
- New file `lib/supabaseAdmin.js` that creates the service-role client. Must never be imported from a client component.

## Request body

```json
{
  "event": "Snow Peak Way Big Sur",
  "dry_run": true,
  "staff": [],
  "workshops": [],
  "partners": [],
  "moments": [],
  "shifts": [],
  "assignments": []
}
```

- `event`: events.id or exact events.name. 400 if not found or ambiguous.
- `dry_run` defaults to **true**. Writes only happen when explicitly `false`.
- All arrays optional.

### staff[] → `staff` (+ `staff_event_assignments`)

```json
{
  "name": "Byron Hughes",
  "email": "byronhughes916@gmail.com",
  "phone": "9162239858",
  "notes": "Thaan x Restaurant XO. Riverside Cabin One",
  "is_vendor": true,
  "vendor_name": "Thaan Charcoal",
  "is_checkin": false,
  "pin": null
}
```

- Match key: lowercase `email`; if no email, `name` + `vendor_name`.
- On create: `is_active = true`. If `pin` missing, generate a unique 6-digit PIN and return it in the response.
- On update: **never change an existing PIN**. Only overwrite fields present in the payload.
- Never set `is_admin` / `is_super_admin` through this API. Ignore them if sent.
- Ensure a `staff_event_assignments` row exists for (staff_id, event_id).

### workshops[] → `workshops` + `sessions`

```json
{
  "name": "Camp Cooking with Thaan Charcoal",
  "category": "Food",
  "instructor": "Byron Hughes",
  "location": "Workshop Area, Site 106",
  "description": "Hands-on charcoal cooking...",
  "credit_cost": 1,
  "sessions": [
    { "date": "2026-10-17", "start_time": "10:00", "end_time": "11:00", "capacity": 25 }
  ]
}
```

- Workshop match key: `name` (case-insensitive) + `instructor`. Defaults on create: `is_paid=false`, `price=0`, `credit_cost=1`. (`max_per_guest` was removed — it was never enforced; older files that include it are accepted and it's ignored.)
- Session match key: (event_id, workshop_id, date, start_time).
- Session safety rules:
  - Never delete sessions.
  - Never lower `capacity` below the current count of non-cancelled `registrations`. Skip the change and report it.
  - If a session with registrations would change date/time, skip and report. It needs a manual decision.

### partners[] → `event_partners`

```json
{ "name": "Magna", "description": "...", "website_url": "https://drinkmagna.com", "logo_url": null, "sort_order": 1 }
```

- Match key: (event_id, lowercase name).

### moments[] → `open_moments`

```json
{ "name": "Campfire Social", "date": "2026-10-17", "start_time": "19:00", "end_time": "21:00",
  "moment_type": "optional", "location": "Fire Circle", "description": "...", "hours_text": null, "staff_notes": null }
```

- `moment_type`: `mandatory` | `optional` | `amenity` | `staff_only` (default `optional`).
- `date`, `start_time`, `end_time` are optional; amenities can use `hours_text` instead.
- Match key: (event_id, lowercase name, date, start_time). Changing date or start time therefore adds a new moment; a new moment on a day that already has a same-named one gets a dry-run warning.
- Updatable on a match: `end_time`, `moment_type`, `location`, `description`, `hours_text`, `staff_notes`.

### shifts[] → `staff_shifts`

```json
{ "title": "Site Setup", "date": "2026-10-16", "start_time": "08:00", "end_time": "12:00",
  "shift_type": "setup", "location": "Main Lot", "description": "..." }
```

- `date` maps to `staff_shifts.shift_date`. `date` and `start_time` required; `end_time` required for a new shift.
- `shift_type`: `setup` | `breakdown` | `travel` | `driving` | `general` | `briefing` (default `general`).
- Match key: (event_id, lowercase title, date, start_time), with the same same-day warning as moments.
- Updatable on a match: `end_time`, `shift_type`, `location`, `description`.

### assignments[] → `staff_assignments` (+ `staff_event_assignments`)

```json
{ "email": "sean@snowpeak.com", "shift": { "title": "Nighttime Volume Sweep", "date": "2026-10-16", "start_time": "22:00" } }
{ "email": "yui@snowpeak.com", "session": { "workshop": "Fly Fishing for Beginners", "date": "2026-10-17", "start_time": "09:00" } }
```

- Each entry needs `email` and exactly one of `shift` or `session` (moment assignments aren't supported).
- Staff: matched by lowercase email against all staff, including staff created under `staff[]` in the same request.
- Shift: matched within the event on (lowercase title, date, start_time), the shift import's key. Session: matched on (lowercase workshop name, date, start_time) among this event's workshops. Shifts and sessions created in the same request can be targeted.
- A staff member or target that can't be found (or matches more than one record) is a 400 for the whole request; nothing is written.
- An assignment that already exists is `unchanged`. Never removes assignments — that stays in the admin UI. No database uniqueness is enforced, so the import is what avoids duplicates.
- A staff member not yet on the event roster is added to it (result shows `adds_to_event_roster: true`).
- Warnings, not errors: the new assignment's time overlaps another of that person's assignments on this event (existing shifts, sessions, or moments, or an earlier entry in the same request — each overlapping pair is reported once, on the later entry); the staff member is inactive. Back-to-back times don't overlap.

## Behavior

- Validate everything first. If any record fails validation, return 400 with per-record errors and write nothing.
- Process in order: partners → staff → workshops/sessions → moments → shifts → assignments.
- Never delete anything. Removal stays manual in the admin UI.
- Partial updates: fields not in the payload are left alone. `null` explicitly clears a field.

## Response

```json
{
  "dry_run": true,
  "event": { "id": "...", "name": "SPW Big Sur" },
  "summary": { "created": 5, "updated": 3, "unchanged": 12, "skipped": 1 },
  "results": [
    { "type": "staff", "key": "byronhughes916@gmail.com", "action": "create", "generated_pin": "482913" },
    { "type": "session", "key": "Camp Cooking 2026-10-17 10:00", "action": "update", "changes": { "capacity": [20, 25] } },
    { "type": "session", "key": "...", "action": "skip", "reason": "capacity 10 < 14 registrations" }
  ]
}
```

## Audit log

New migration `supabase/migrations/2026XXXX_import_log.sql`:

```sql
create table if not exists import_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  event_id uuid,
  source text,
  dry_run boolean,
  summary jsonb,
  results jsonb
);
alter table import_log enable row level security;
```

- No RLS policies, so only the service role can read or write it.
- Log every non-dry-run call. Optional `source` field in the body (e.g., "cowork", "claude-code").

## Export

`GET /api/admin/export?event=...` with the same auth. Returns the event's staff (no PINs), workshops + sessions with current registration counts, partners, moments, shifts, and shift/session assignments, in the same shape as the import body. Assignments that can't be expressed in import form (moment assignments, staff without an email) are counted in `export_notes` instead of listed; duplicate assignment rows are listed once. The import ignores `event_name` and `export_notes`, so an export posts back as a no-op. Lets Claude diff before writing.

## Testing

1. Local: `npm run dev`, then curl with `dry_run: true` against the real project and check the diff looks right.
2. Test rules: re-running the same payload should return all "unchanged". Capacity-below-registrations should skip. Missing auth should return 401.
3. Real write on one test record, then confirm it in the admin page.

## Deploy

- Add both env vars in Vercel (Production + Preview).
- Commit to GitHub **before** `vercel --prod`, so local, GitHub, and prod don't diverge.
- After deploy: allowlist `spw.snowpeak.com` in Claude Admin settings → Capabilities so Cowork can call it.

## Out of scope / follow-ups

- **Security check:** `app/admin/page.js` currently inserts into `staff`, `workshops`, `sessions`, and `event_partners` from the browser with the anon key. That only works if RLS lets anon write those tables, which would mean anyone with the public key could edit them or read staff PINs. Worth checking the policies, and moving admin writes behind server routes like this one.
- Guest/registration imports: not included on purpose.
