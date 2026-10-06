-- Early access: handpicked guests can book workshops before the event's
-- registration opens.
--
-- guest_events.early_access_opens_at is stored the same way as
-- events.registration_opens_at: the digits are wall-clock time in the
-- event's registration_timezone (saved from a datetime-local input, so
-- Postgres labels them UTC). A guest's effective opening time is the earlier
-- of the two; null means they follow the event.
--
-- Until now the opening time was only checked in the guest's browser, so a
-- direct API call could book early. guest_register now enforces it, and also
-- rejects a session from a different event or a guest who isn't invited to
-- the event (previously possible, and the credit trigger skips guests with
-- no guest_events row).

alter table public.guest_events
  add column if not exists early_access_opens_at timestamptz;

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
  v_event public.events%rowtype;
  v_invited boolean;
  v_early timestamptz;
  v_session_event public.events.id%type;
  v_tz text;
  v_opens timestamptz;
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

  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'INVALID_EVENT';
  end if;

  select true, ge.early_access_opens_at into v_invited, v_early
  from public.guest_events ge
  where ge.guest_id = v_guest_id and ge.event_id = p_event_id;
  if v_invited is null then
    raise exception 'NOT_INVITED';
  end if;

  -- Legacy sessions with no event_id are still allowed.
  select s.event_id into v_session_event from public.sessions s where s.id = p_session_id;
  if not found or (v_session_event is not null and v_session_event <> p_event_id) then
    raise exception 'INVALID_SESSION';
  end if;

  -- Opening time: wall-clock digits read in the event's timezone. No event
  -- opening time means registration is open (early access is moot).
  if v_event.registration_opens_at is not null then
    v_tz := coalesce(v_event.registration_timezone, 'America/New_York');
    v_opens := (v_event.registration_opens_at at time zone 'UTC') at time zone v_tz;
    if v_early is not null then
      v_opens := least(v_opens, (v_early at time zone 'UTC') at time zone v_tz);
    end if;
    if now() < v_opens then
      raise exception 'REGISTRATION_NOT_OPEN';
    end if;
  end if;

  insert into public.registrations (guest_id, session_id, event_id, status, party_size)
  values (v_guest_id, p_session_id, p_event_id, 'confirmed', p_party_size)
  returning id into v_id;
  return v_id;
end;
$$;
