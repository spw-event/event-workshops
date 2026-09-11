-- Capacity was only checked client-side (against a snapshot of
-- sessionAvailability fetched on page load), so two guests registering
-- around the same time — or even one guest with a stale tab open — could
-- both pass the local check and both get inserted, overbooking the
-- session. This enforces it atomically in the database: the trigger locks
-- the session row first, so concurrent registration attempts serialize
-- through it instead of racing past a stale read.
create or replace function check_session_capacity()
returns trigger as $$
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
$$ language plpgsql;

drop trigger if exists trg_check_session_capacity on registrations;
create trigger trg_check_session_capacity
  before insert or update on registrations
  for each row
  execute function check_session_capacity();
