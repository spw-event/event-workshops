-- Production schema snapshot taken 2026-10-01 with scripts/schema-snapshot.sql.
-- Reference / test-project bootstrap only — not a migration.

-- ===== extensions (reference only) =====

-- extension pg_stat_statements 1.11 (schema extensions)
-- extension pgcrypto 1.3 (schema extensions)
-- extension plpgsql 1.0 (schema pg_catalog)
-- extension supabase_vault 0.3.1 (schema vault)
-- extension uuid-ossp 1.1 (schema extensions)

set check_function_bodies = off;

-- ===== types =====

-- ===== sequences =====

-- ===== functions =====

CREATE OR REPLACE FUNCTION public.check_session_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  session_capacity integer;
  current_confirmed integer;
begin
  if new.status <> 'confirmed' or new.session_id is null then
    return new;
  end if;

  select capacity into session_capacity
  from sessions
  where id = new.session_id
  for update;

  if session_capacity is null then
    return new;
  end if;

  select coalesce(sum(party_size), 0) into current_confirmed
  from registrations
  where session_id = new.session_id
    and status = 'confirmed'
    and id <> new.id;

  if current_confirmed + coalesce(new.party_size, 1) > session_capacity then
    raise exception 'SESSION_FULL: only % spot(s) remaining', greatest(session_capacity - current_confirmed, 0);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_party_credits_total(p_guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  root_id uuid;
  tt_id uuid;
  credits_per_person int;
  party_cap int;
begin
  select coalesce(invited_by, id) into root_id
  from guests where id = p_guest_id;

  select ticket_type_id into tt_id
  from guests where id = root_id;

  select t.credits_per_person, t.party_cap
  into credits_per_person, party_cap
  from ticket_types t where id = tt_id;

  return credits_per_person * party_cap;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_party_credits_total(p_guest_id uuid, p_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  root_id uuid;
  tt_id uuid;
  credits_per_person int;
  party_cap int;
  override_total int;
begin
  select coalesce(invited_by, id) into root_id
  from guests where id = p_guest_id;

  -- Check for override on guest_events
  select credits_total into override_total
  from guest_events
  where guest_id = root_id and event_id = p_event_id;

  if override_total is not null then
    return override_total;
  end if;

  -- Fall back to ticket type calculation
  select ticket_type_id into tt_id
  from guests where id = root_id;

  select t.credits_per_person, t.party_cap
  into credits_per_person, party_cap
  from ticket_types t where id = tt_id;

  return credits_per_person * party_cap;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_party_credits_used(p_guest_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  root_id uuid;
  total_used int;
begin
  -- Find root (lead) of the party
  select coalesce(invited_by, id) into root_id
  from guests where id = p_guest_id;

  -- Sum credits used by entire party
  select coalesce(sum(credits_used), 0) into total_used
  from guests
  where id = root_id or invited_by = root_id;

  return total_used;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_party_credits_used(p_guest_id uuid, p_event_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  root_id uuid;
  total_used int;
begin
  select coalesce(invited_by, id) into root_id
  from guests where id = p_guest_id;

  select coalesce(sum(ge.credits_used), 0) into total_used
  from guests g
  join guest_events ge on ge.guest_id = g.id and ge.event_id = p_event_id
  where g.id = root_id or g.invited_by = root_id;

  return total_used;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_session_availability(p_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  cap int;
  confirmed int;
begin
  select capacity into cap from sessions where id = p_session_id;
  select coalesce(sum(party_size), 0) into confirmed from registrations
  where session_id = p_session_id and status = 'confirmed';
  return cap - confirmed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_credits_on_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Refund credits when status changes to cancelled
  if NEW.status = 'cancelled' and OLD.status = 'confirmed' then
    update guest_events
    set credits_used = greatest(0, credits_used - coalesce(OLD.party_size, 1))
    where guest_id = OLD.guest_id
    and event_id = OLD.event_id;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refund_credits_on_registration_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- Refund credits when a confirmed registration is deleted
  if OLD.status = 'confirmed' then
    update guest_events
    set credits_used = greatest(0, credits_used - coalesce(OLD.party_size, 1))
    where guest_id = OLD.guest_id
    and event_id = OLD.event_id;
  end if;
  return OLD;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

-- ===== tables =====

create table if not exists public.admin_settings (
  id uuid not null default uuid_generate_v4(),
  key text not null,
  value text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.admins (
  id uuid not null default uuid_generate_v4(),
  email text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.event_info_sections (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  title text not null,
  content text not null,
  icon text default '📄'::text,
  sort_order integer default 0,
  section_type text default 'general'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.event_partners (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  name text not null,
  description text,
  website_url text,
  logo_url text,
  sort_order integer default 0,
  created_at timestamp with time zone default now()
);

create table if not exists public.events (
  id uuid not null default uuid_generate_v4(),
  name text not null,
  description text,
  location text,
  start_date date not null,
  end_date date not null,
  status text default 'upcoming'::text,
  created_at timestamp with time zone default now(),
  registration_opens_at timestamp with time zone,
  map_image_url text,
  info_html text,
  checkin_time text,
  checkout_time text,
  checkin_notes text,
  is_archived boolean default false,
  registration_timezone text default 'America/New_York'::text,
  questions_contact text,
  contact_email text,
  contact_phone_dayof text
);

create table if not exists public.gear_categories (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.gear_items (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  name text not null,
  category text not null,
  description text,
  rental_link text,
  product_link text,
  is_available_to_rent boolean default false,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  link_1_label text,
  link_1_url text,
  link_2_label text,
  link_2_url text,
  visibility text not null default 'both'::text
);

create table if not exists public.guest_events (
  id uuid not null default uuid_generate_v4(),
  guest_id uuid,
  event_id uuid,
  credits_used integer default 0,
  credits_total integer,
  checkin_status text default 'not_arrived'::text,
  credit_notes text,
  booking_summary text
);

create table if not exists public.guest_gear_checks (
  id uuid not null default uuid_generate_v4(),
  guest_id uuid,
  gear_item_id uuid,
  checked_at timestamp with time zone default now()
);

create table if not exists public.guest_moment_saves (
  id uuid not null default uuid_generate_v4(),
  guest_id uuid,
  moment_id uuid,
  saved_at timestamp with time zone default now()
);

create table if not exists public.guests (
  id uuid not null default uuid_generate_v4(),
  name text not null,
  email text not null,
  token text not null default encode(gen_random_bytes(12), 'hex'::text),
  ticket_type_id uuid,
  invited_by uuid,
  credits_used integer default 0,
  created_at timestamp with time zone default now(),
  waiver_signed boolean default false
);

create table if not exists public.instructor_pins (
  id uuid not null default uuid_generate_v4(),
  pin text not null,
  workshop_id uuid,
  name text,
  created_at timestamp with time zone default now()
);

create table if not exists public.open_moments (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  name text not null,
  description text,
  location text,
  date date,
  start_time time without time zone,
  end_time time without time zone,
  moment_type text default 'optional'::text,
  created_at timestamp with time zone default now(),
  staff_notes text,
  hours_text text
);

create table if not exists public.registrations (
  id uuid not null default uuid_generate_v4(),
  guest_id uuid,
  session_id uuid,
  status text default 'confirmed'::text,
  registered_at timestamp with time zone default now(),
  party_size integer default 1,
  event_id uuid
);

create table if not exists public.sessions (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  workshop_id uuid,
  date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  capacity integer not null default 30,
  created_at timestamp with time zone default now(),
  staff_notes text
);

create table if not exists public.staff (
  id uuid not null default uuid_generate_v4(),
  name text not null,
  pin text not null,
  role text,
  email text,
  phone text,
  notes text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  is_vendor boolean default false,
  vendor_name text,
  is_admin boolean default false,
  is_super_admin boolean default false,
  is_checkin boolean default false
);

create table if not exists public.staff_assignments (
  id uuid not null default uuid_generate_v4(),
  instructor_pin_id uuid,
  session_id uuid,
  moment_id uuid,
  shift_id uuid,
  notes text,
  created_at timestamp with time zone default now(),
  staff_id uuid
);

create table if not exists public.staff_event_assignments (
  id uuid not null default uuid_generate_v4(),
  staff_id uuid,
  event_id uuid
);

create table if not exists public.staff_resources (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  title text not null,
  description text,
  image_url text,
  category text,
  sort_order integer default 0,
  created_at timestamp with time zone default now(),
  is_global boolean default false,
  hidden_from_vendors boolean not null default false
);

create table if not exists public.staff_shifts (
  id uuid not null default uuid_generate_v4(),
  event_id uuid,
  title text not null,
  description text,
  location text,
  shift_date date not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  shift_type text default 'general'::text,
  created_at timestamp with time zone default now()
);

create table if not exists public.staff_workshop_assignments (
  id uuid not null default uuid_generate_v4(),
  staff_id uuid,
  workshop_id uuid
);

create table if not exists public.ticket_types (
  id uuid not null default uuid_generate_v4(),
  name text not null,
  party_cap integer not null,
  credits_per_person integer not null,
  description text,
  created_at timestamp with time zone default now(),
  display_name text
);

create table if not exists public.workshops (
  id uuid not null default uuid_generate_v4(),
  name text not null,
  category text,
  description text,
  instructor text,
  is_paid boolean default false,
  price numeric(10,2) default 0,
  max_per_guest integer default 1,
  created_at timestamp with time zone default now(),
  location text,
  credit_cost integer not null default 1
);

-- ===== constraints =====

alter table public.admin_settings add constraint admin_settings_key_key UNIQUE (key);
alter table public.admin_settings add constraint admin_settings_pkey PRIMARY KEY (id);
alter table public.admins add constraint admins_email_key UNIQUE (email);
alter table public.admins add constraint admins_pkey PRIMARY KEY (id);
alter table public.event_info_sections add constraint event_info_sections_pkey PRIMARY KEY (id);
alter table public.event_partners add constraint event_partners_pkey PRIMARY KEY (id);
alter table public.events add constraint events_pkey PRIMARY KEY (id);
alter table public.events add constraint events_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'active'::text, 'past'::text])));
alter table public.gear_categories add constraint gear_categories_event_id_name_key UNIQUE (event_id, name);
alter table public.gear_categories add constraint gear_categories_pkey PRIMARY KEY (id);
alter table public.gear_items add constraint gear_items_pkey PRIMARY KEY (id);
alter table public.gear_items add constraint gear_items_visibility_check CHECK ((visibility = ANY (ARRAY['guests'::text, 'staff'::text, 'both'::text])));
alter table public.guest_events add constraint guest_events_guest_id_event_id_key UNIQUE (guest_id, event_id);
alter table public.guest_events add constraint guest_events_pkey PRIMARY KEY (id);
alter table public.guest_gear_checks add constraint guest_gear_checks_guest_id_gear_item_id_key UNIQUE (guest_id, gear_item_id);
alter table public.guest_gear_checks add constraint guest_gear_checks_pkey PRIMARY KEY (id);
alter table public.guest_moment_saves add constraint guest_moment_saves_guest_id_moment_id_key UNIQUE (guest_id, moment_id);
alter table public.guest_moment_saves add constraint guest_moment_saves_pkey PRIMARY KEY (id);
alter table public.guests add constraint guests_email_key UNIQUE (email);
alter table public.guests add constraint guests_pkey PRIMARY KEY (id);
alter table public.guests add constraint guests_token_key UNIQUE (token);
alter table public.instructor_pins add constraint instructor_pins_pin_key UNIQUE (pin);
alter table public.instructor_pins add constraint instructor_pins_pkey PRIMARY KEY (id);
alter table public.open_moments add constraint open_moments_moment_type_check CHECK ((moment_type = ANY (ARRAY['mandatory'::text, 'optional'::text, 'amenity'::text, 'staff_only'::text])));
alter table public.open_moments add constraint open_moments_pkey PRIMARY KEY (id);
alter table public.registrations add constraint registrations_guest_id_session_id_key UNIQUE (guest_id, session_id);
alter table public.registrations add constraint registrations_pkey PRIMARY KEY (id);
alter table public.registrations add constraint registrations_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'cancelled'::text, 'waitlisted'::text])));
alter table public.sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table public.staff add constraint staff_pin_key UNIQUE (pin);
alter table public.staff add constraint staff_pkey PRIMARY KEY (id);
alter table public.staff_assignments add constraint staff_assignments_pkey PRIMARY KEY (id);
alter table public.staff_event_assignments add constraint staff_event_assignments_pkey PRIMARY KEY (id);
alter table public.staff_event_assignments add constraint staff_event_assignments_staff_id_event_id_key UNIQUE (staff_id, event_id);
alter table public.staff_resources add constraint staff_resources_pkey PRIMARY KEY (id);
alter table public.staff_shifts add constraint staff_shifts_pkey PRIMARY KEY (id);
alter table public.staff_shifts add constraint staff_shifts_shift_type_check CHECK ((shift_type = ANY (ARRAY['setup'::text, 'breakdown'::text, 'travel'::text, 'driving'::text, 'general'::text, 'briefing'::text])));
alter table public.staff_workshop_assignments add constraint staff_workshop_assignments_pkey PRIMARY KEY (id);
alter table public.staff_workshop_assignments add constraint staff_workshop_assignments_staff_id_workshop_id_key UNIQUE (staff_id, workshop_id);
alter table public.ticket_types add constraint ticket_types_pkey PRIMARY KEY (id);
alter table public.workshops add constraint workshops_credit_cost_positive CHECK ((credit_cost > 0));
alter table public.workshops add constraint workshops_pkey PRIMARY KEY (id);
alter table public.event_info_sections add constraint event_info_sections_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.event_partners add constraint event_partners_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.gear_categories add constraint gear_categories_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.gear_items add constraint gear_items_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.guest_events add constraint guest_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.guest_events add constraint guest_events_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
alter table public.guest_gear_checks add constraint guest_gear_checks_gear_item_id_fkey FOREIGN KEY (gear_item_id) REFERENCES gear_items(id) ON DELETE CASCADE;
alter table public.guest_gear_checks add constraint guest_gear_checks_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
alter table public.guest_moment_saves add constraint guest_moment_saves_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
alter table public.guest_moment_saves add constraint guest_moment_saves_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES open_moments(id) ON DELETE CASCADE;
alter table public.guests add constraint guests_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES guests(id);
alter table public.guests add constraint guests_ticket_type_id_fkey FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(id);
alter table public.instructor_pins add constraint instructor_pins_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES workshops(id);
alter table public.open_moments add constraint open_moments_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.registrations add constraint registrations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id);
alter table public.registrations add constraint registrations_guest_id_fkey FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
alter table public.registrations add constraint registrations_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.sessions add constraint sessions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.sessions add constraint sessions_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE;
alter table public.staff_assignments add constraint staff_assignments_instructor_pin_id_fkey FOREIGN KEY (instructor_pin_id) REFERENCES instructor_pins(id) ON DELETE CASCADE;
alter table public.staff_assignments add constraint staff_assignments_moment_id_fkey FOREIGN KEY (moment_id) REFERENCES open_moments(id) ON DELETE CASCADE;
alter table public.staff_assignments add constraint staff_assignments_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.staff_assignments add constraint staff_assignments_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES staff_shifts(id) ON DELETE CASCADE;
alter table public.staff_assignments add constraint staff_assignments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
alter table public.staff_event_assignments add constraint staff_event_assignments_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.staff_event_assignments add constraint staff_event_assignments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
alter table public.staff_resources add constraint staff_resources_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.staff_shifts add constraint staff_shifts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
alter table public.staff_workshop_assignments add constraint staff_workshop_assignments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES staff(id) ON DELETE CASCADE;
alter table public.staff_workshop_assignments add constraint staff_workshop_assignments_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE;

-- ===== indexes =====

-- ===== views =====

-- ===== triggers =====

CREATE TRIGGER enforce_session_capacity BEFORE INSERT ON public.registrations FOR EACH ROW WHEN ((new.status = 'confirmed'::text)) EXECUTE FUNCTION check_session_capacity();
CREATE TRIGGER refund_credits_on_delete BEFORE DELETE ON public.registrations FOR EACH ROW EXECUTE FUNCTION refund_credits_on_registration_delete();
CREATE TRIGGER refund_credits_on_status_change BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION refund_credits_on_cancellation();
CREATE TRIGGER trg_check_session_capacity BEFORE INSERT OR UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION check_session_capacity();

-- ===== rls =====

alter table public.admin_settings enable row level security;
alter table public.admins enable row level security;
alter table public.event_info_sections enable row level security;
alter table public.event_partners enable row level security;
alter table public.events enable row level security;
alter table public.gear_categories enable row level security;
alter table public.gear_items enable row level security;
alter table public.guest_events enable row level security;
alter table public.guest_gear_checks enable row level security;
alter table public.guest_moment_saves enable row level security;
alter table public.guests enable row level security;
alter table public.instructor_pins enable row level security;
alter table public.open_moments enable row level security;
alter table public.registrations enable row level security;
alter table public.sessions enable row level security;
alter table public.staff enable row level security;
alter table public.staff_assignments enable row level security;
alter table public.staff_event_assignments enable row level security;
alter table public.staff_resources enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.staff_workshop_assignments enable row level security;
alter table public.ticket_types enable row level security;
alter table public.workshops enable row level security;

-- ===== policies =====

create policy "Anyone can insert admin settings" on public.admin_settings as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can read admin settings" on public.admin_settings as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update admin settings" on public.admin_settings as PERMISSIVE for UPDATE to public using (true);
create policy "Admins are viewable" on public.admins as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete event info sections" on public.event_info_sections as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert event info sections" on public.event_info_sections as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select event info sections" on public.event_info_sections as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update event info sections" on public.event_info_sections as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete event partners" on public.event_partners as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert event partners" on public.event_partners as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select event partners" on public.event_partners as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update event partners" on public.event_partners as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete events" on public.events as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert events" on public.events as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update events" on public.events as PERMISSIVE for UPDATE to public using (true);
create policy "Public can view events" on public.events as PERMISSIVE for SELECT to public using (true);
create policy anon_delete_gear_categories on public.gear_categories as PERMISSIVE for DELETE to public using (true);
create policy anon_insert_gear_categories on public.gear_categories as PERMISSIVE for INSERT to public with check (true);
create policy anon_select_gear_categories on public.gear_categories as PERMISSIVE for SELECT to public using (true);
create policy anon_update_gear_categories on public.gear_categories as PERMISSIVE for UPDATE to public using (true) with check (true);
create policy "Anyone can delete gear items" on public.gear_items as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert gear items" on public.gear_items as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select gear items" on public.gear_items as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update gear items" on public.gear_items as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete guest events" on public.guest_events as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert guest events" on public.guest_events as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update guest events" on public.guest_events as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can view guest events" on public.guest_events as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete gear checks" on public.guest_gear_checks as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert gear checks" on public.guest_gear_checks as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select gear checks" on public.guest_gear_checks as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete moment saves" on public.guest_moment_saves as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert moment saves" on public.guest_moment_saves as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select moment saves" on public.guest_moment_saves as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete guests" on public.guests as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert guests" on public.guests as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update guests" on public.guests as PERMISSIVE for UPDATE to public using (true);
create policy "Guests can be inserted" on public.guests as PERMISSIVE for INSERT to public with check (true);
create policy "Guests can update own credits" on public.guests as PERMISSIVE for UPDATE to public using (true);
create policy "Guests can view own record" on public.guests as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete instructor pins" on public.instructor_pins as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert instructor pins" on public.instructor_pins as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can read instructor pins" on public.instructor_pins as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update instructor pins" on public.instructor_pins as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete open moments" on public.open_moments as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert open moments" on public.open_moments as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select open moments" on public.open_moments as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update open moments" on public.open_moments as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete registrations" on public.registrations as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert registrations" on public.registrations as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update registrations" on public.registrations as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can view registrations" on public.registrations as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete sessions" on public.sessions as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can update sessions" on public.sessions as PERMISSIVE for UPDATE to public using (true);
create policy "Public can view sessions" on public.sessions as PERMISSIVE for SELECT to public using (true);
create policy anon_delete_sessions on public.sessions as PERMISSIVE for DELETE to public using (true);
create policy anon_insert_sessions on public.sessions as PERMISSIVE for INSERT to public with check (true);
create policy anon_select_sessions on public.sessions as PERMISSIVE for SELECT to public using (true);
create policy anon_update_sessions on public.sessions as PERMISSIVE for UPDATE to public using (true) with check (true);
create policy "Anyone can delete staff" on public.staff as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert staff" on public.staff as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select staff" on public.staff as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update staff" on public.staff as PERMISSIVE for UPDATE to public using (true);
create policy staff_delete on public.staff as PERMISSIVE for DELETE to public using (true);
create policy staff_insert on public.staff as PERMISSIVE for INSERT to public with check (true);
create policy staff_select on public.staff as PERMISSIVE for SELECT to public using (true);
create policy staff_update on public.staff as PERMISSIVE for UPDATE to public using (true) with check (true);
create policy "Anyone can delete staff assignments" on public.staff_assignments as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert staff assignments" on public.staff_assignments as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select staff assignments" on public.staff_assignments as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update staff assignments" on public.staff_assignments as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete" on public.staff_event_assignments as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert" on public.staff_event_assignments as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select" on public.staff_event_assignments as PERMISSIVE for SELECT to public using (true);
create policy sea_delete on public.staff_event_assignments as PERMISSIVE for DELETE to public using (true);
create policy sea_insert on public.staff_event_assignments as PERMISSIVE for INSERT to public with check (true);
create policy sea_select on public.staff_event_assignments as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete staff resources" on public.staff_resources as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert staff resources" on public.staff_resources as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select staff resources" on public.staff_resources as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update staff resources" on public.staff_resources as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete staff shifts" on public.staff_shifts as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert staff shifts" on public.staff_shifts as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select staff shifts" on public.staff_shifts as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can update staff shifts" on public.staff_shifts as PERMISSIVE for UPDATE to public using (true);
create policy "Anyone can delete" on public.staff_workshop_assignments as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert" on public.staff_workshop_assignments as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can select" on public.staff_workshop_assignments as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete ticket types" on public.ticket_types as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert ticket types" on public.ticket_types as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update ticket types" on public.ticket_types as PERMISSIVE for UPDATE to public using (true);
create policy "Public can view ticket types" on public.ticket_types as PERMISSIVE for SELECT to public using (true);
create policy "Anyone can delete workshops" on public.workshops as PERMISSIVE for DELETE to public using (true);
create policy "Anyone can insert workshops" on public.workshops as PERMISSIVE for INSERT to public with check (true);
create policy "Anyone can update workshops" on public.workshops as PERMISSIVE for UPDATE to public using (true);
create policy "Public can view workshops" on public.workshops as PERMISSIVE for SELECT to public using (true);

-- ===== storage policies (reference only) =====
