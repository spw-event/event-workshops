-- Security pass: admin writes and guest data behind Supabase Auth.
--
-- Before this, every table had permissive anon policies, so anyone holding
-- the public anon key (it ships in the page) could edit workshops, read staff
-- PINs, and list every guest. After it:
--
--   • Admin/catalog tables: anyone can read, only signed-in admins can write.
--   • staff: only signed-in admins can read or write. Everyone else gets
--     staff_login(email) (their own record, no PIN) and staff_directory()
--     (id/name/is_vendor, for "who else is assigned").
--   • guests, registrations, guest_events: readable only by signed-in admins
--     and check-in staff. Guests reach their own rows through token-checked
--     functions (guest_session, guest_registrations, guest_register, ...).
--     Email-only staff get staff_registrations(email), which only names
--     guests on sessions they're assigned to.
--   • instructor_pins: no access (PIN login is gone).
--   • admin_settings, admins: no access. Leftovers from the old shared admin
--     PIN; nothing in the app reads them, but both were world-readable and
--     admin_settings was world-writable.
--
-- Requires 20260918_atomic_credit_enforcement.sql (apply_registration_credit_delta).
--
-- "Signed in" means a Supabase Auth user with a confirmed email that matches
-- an active staff row and isn't waiting on a password change. Sign-ins are
-- created by admins from the admin page (app/api/staff/reset-password), so
-- new sign-ups MUST be disabled (Authentication → Sign In / Providers) —
-- otherwise anyone could sign up with an admin's email address.
--
-- Untouched on purpose (still anon read/write): guest_moment_saves,
-- guest_gear_checks.

-- ── Who is calling ─────────────────────────────────────────

-- Accounts an admin has reset to the shared default password carry
-- app_metadata.must_change_password until their owner picks a new one
-- (app/api/staff/*). Until then they map to no staff row, so the default
-- password grants nothing beyond the change-password screen. Read live from
-- auth.users, so a reset takes effect even for sessions already open.
create or replace function public.current_staff_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.staff s
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and coalesce((u.raw_app_meta_data ->> 'must_change_password')::boolean, false) = false
    and s.is_active
    and lower(s.email) = lower(u.email)
  order by s.id
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select coalesce(s.is_admin, false) or coalesce(s.is_super_admin, false)
    from public.staff s
    where s.id = public.current_staff_id()
  ), false)
$$;

create or replace function public.can_access_guests()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select coalesce(s.is_admin, false) or coalesce(s.is_super_admin, false) or coalesce(s.is_checkin, false)
    from public.staff s
    where s.id = public.current_staff_id()
  ), false)
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select coalesce(s.is_super_admin, false)
    from public.staff s
    where s.id = public.current_staff_id()
  ), false)
$$;

-- Admins may edit staff, but only super admins may grant super admin or
-- touch a super admin's row — otherwise any admin could promote themselves,
-- or take over a super admin by resetting their password. Applies only to
-- signed-in app users; the service role and SQL editor (no auth.uid()) are
-- unaffected.
create or replace function public.guard_super_admin_rows()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_super_admin() then
    return coalesce(new, old);
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and coalesce(old.is_super_admin, false))
     or (tg_op in ('INSERT', 'UPDATE') and coalesce(new.is_super_admin, false)) then
    raise exception 'SUPER_ADMIN_ONLY: only a super admin can grant super admin or change a super admin';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_super_admin_rows on public.staff;
create trigger trg_guard_super_admin_rows
  before insert or update or delete on public.staff
  for each row execute function public.guard_super_admin_rows();

-- ── Staff-facing functions ─────────────────────────────────

-- The signed-in user's own staff record (no PIN), or null.
create or replace function public.my_staff()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(s) - 'pin'
  from public.staff s
  where s.id = public.current_staff_id()
$$;

-- Email-only sign-in lookup: one active staff record, without PIN, phone or
-- notes. Replaces the client reading the staff table directly.
create or replace function public.staff_login(p_email text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(s) - 'pin' - 'phone' - 'notes'
  from public.staff s
  where s.is_active
    and lower(s.email) = lower(trim(p_email))
  order by s.id
  limit 1
$$;

-- Names for "who else is assigned" on the staff schedule.
create or replace function public.staff_directory()
returns table (id uuid, name text, is_vendor boolean)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name::text, coalesce(s.is_vendor, false)
  from public.staff s
$$;

-- Confirmed registrations for the email-only staff app: every row (so
-- session counts stay right), but guest names only on sessions this staff
-- member is assigned to, directly or through a workshop-wide assignment.
-- Shaped like registrations.select('*, guests(name)') minus guest_id.
create or replace function public.staff_registrations(p_email text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with me as (
    select s.id
    from public.staff s
    where s.is_active and lower(s.email) = lower(trim(p_email))
    order by s.id
    limit 1
  ),
  assigned as (
    select sa.session_id
    from public.staff_assignments sa
    join me on sa.staff_id = me.id
    where sa.session_id is not null
    union
    select se.id
    from public.sessions se
    join public.staff_workshop_assignments swa on swa.workshop_id = se.workshop_id
    join me on swa.staff_id = me.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'session_id', r.session_id,
    'event_id', r.event_id,
    'party_size', r.party_size,
    'status', r.status,
    'guests', case when r.session_id in (select session_id from assigned)
                   then jsonb_build_object('name', g.name) end
  )), '[]'::jsonb)
  from public.registrations r
  left join public.guests g on g.id = r.guest_id
  where r.status = 'confirmed'
    and exists (select 1 from me)
$$;

-- ── Guest-facing functions ─────────────────────────────────
-- A guest proves who they are with their invite token (or, as before, their
-- email on the email-entry screen). These replace direct reads/writes on
-- guests, guest_events and registrations.

-- Internal: { guest: {..., ticket_types}, guest_events: [{..., events}] }.
create or replace function public.guest_payload(p_guest_id public.guests.id%type)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'guest', to_jsonb(g) || jsonb_build_object(
      'ticket_types', (select to_jsonb(tt) from public.ticket_types tt where tt.id = g.ticket_type_id)
    ),
    'guest_events', coalesce((
      select jsonb_agg(to_jsonb(ge) || jsonb_build_object(
        'events', (select to_jsonb(e) from public.events e where e.id = ge.event_id)
      ))
      from public.guest_events ge
      where ge.guest_id = g.id
    ), '[]'::jsonb)
  )
  from public.guests g
  where g.id = p_guest_id
$$;
revoke all on function public.guest_payload(public.guests.id%type) from public, anon, authenticated;

create or replace function public.guest_session(p_token text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.guest_payload(g.id)
  from public.guests g
  where p_token is not null and p_token <> '' and g.token::text = p_token
  order by g.id
  limit 1
$$;

create or replace function public.guest_login(p_email text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.guest_payload(g.id)
  from public.guests g
  where lower(g.email) = lower(trim(p_email))
  order by g.id
  limit 1
$$;

-- Non-cancelled registrations for one guest + event, with session and
-- workshop embedded (same shape as select('*, sessions(*, workshops(*))')).
create or replace function public.guest_registrations(p_token text, p_event_id public.events.id%type)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(
    to_jsonb(r) || jsonb_build_object(
      'sessions', to_jsonb(s) || jsonb_build_object('workshops', to_jsonb(w))
    )
  ), '[]'::jsonb)
  from public.guests g
  join public.registrations r on r.guest_id = g.id
  left join public.sessions s on s.id = r.session_id
  left join public.workshops w on w.id = s.workshop_id
  where p_token is not null and p_token <> '' and g.token::text = p_token
    and r.event_id = p_event_id
    and r.status <> 'cancelled'
$$;

-- Capacity and credits are still enforced by the registrations triggers;
-- their SESSION_FULL / CREDITS_EXCEEDED errors pass straight through.
create or replace function public.guest_register(
  p_token text,
  p_session_id public.sessions.id%type,
  p_event_id public.events.id%type,
  p_party_size integer
)
returns public.registrations.id%type
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_guest_id public.guests.id%type;
  v_id public.registrations.id%type;
begin
  if p_party_size is null or p_party_size < 1 then
    raise exception 'INVALID_PARTY_SIZE';
  end if;
  select g.id into v_guest_id
  from public.guests g
  where p_token is not null and p_token <> '' and g.token::text = p_token
  order by g.id
  limit 1;
  if v_guest_id is null then
    raise exception 'INVALID_GUEST';
  end if;
  insert into public.registrations (guest_id, session_id, event_id, status, party_size)
  values (v_guest_id, p_session_id, p_event_id, 'confirmed', p_party_size)
  returning id into v_id;
  return v_id;
end;
$$;

-- Deletes (not status = cancelled) to match the old client behavior; the
-- credits trigger refunds on delete.
create or replace function public.guest_cancel(p_token text, p_registration_id public.registrations.id%type)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from public.registrations r
  using public.guests g
  where r.id = p_registration_id
    and r.guest_id = g.id
    and p_token is not null and p_token <> '' and g.token::text = p_token;
  if not found then
    raise exception 'REGISTRATION_NOT_FOUND';
  end if;
end;
$$;

-- ── Functions that must keep seeing all rows ───────────────
-- Trigger functions run as the caller. Once guests can't read sessions,
-- registrations or guest_events directly, check_session_capacity()'s
-- `select ... for update` would find nothing and silently skip the capacity
-- check. Running them as owner keeps enforcement intact.
alter function public.check_session_capacity() security definer set search_path = public;
alter function public.apply_registration_credit_delta() security definer set search_path = public;

-- Same for the guest app's existing read helpers (created in the dashboard,
-- so matched by name rather than exact signature).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname in ('get_party_credits_used', 'get_party_credits_total', 'get_session_availability')
  loop
    execute format('alter function %s security definer set search_path = public', f.sig);
  end loop;
end $$;

-- ── Policies ───────────────────────────────────────────────
do $$
declare
  t text;
  p record;
  admin_tables text[] := array[
    'events', 'workshops', 'sessions', 'open_moments', 'event_partners',
    'event_info_sections', 'gear_items', 'gear_categories', 'ticket_types',
    'staff_shifts', 'staff_assignments', 'staff_event_assignments',
    'staff_workshop_assignments', 'staff_resources'
  ];
  guest_tables text[] := array['guests', 'registrations', 'guest_events'];
  locked_tables text[] := array['instructor_pins', 'admin_settings', 'admins'];
  all_tables text[] := admin_tables || guest_tables || array['staff'] || locked_tables;
begin
  -- Drop every existing policy on these tables, whatever its name — several
  -- were created in the dashboard rather than in migrations.
  for p in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any(all_tables)
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;

  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  -- Public read, admin-only write.
  foreach t in array admin_tables loop
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_admin()))', t || '_admin_delete', t);
  end loop;

  -- Guest data: admins do everything; check-in staff can read, and update
  -- (check-in status, waiver) but not insert or delete.
  foreach t in array guest_tables loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_access_guests()))', t || '_staff_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_admin()))', t || '_admin_delete', t);
  end loop;
  execute 'create policy guests_staff_update on public.guests for update to authenticated using ((select public.can_access_guests())) with check ((select public.can_access_guests()))';
  execute 'create policy guest_events_staff_update on public.guest_events for update to authenticated using ((select public.can_access_guests())) with check ((select public.can_access_guests()))';
  execute 'create policy registrations_admin_update on public.registrations for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))';

  -- staff: admins only.
  execute 'create policy staff_admin_all on public.staff for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))';

  -- locked_tables: RLS on, no policies → no client access at all.
end $$;
