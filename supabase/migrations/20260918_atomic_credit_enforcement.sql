-- Credit deduction was only done client-side (read guest_events.credits_used
-- into React state, then write back credits_used + delta), the same
-- read-modify-write race the session capacity trigger already fixed on the
-- seats side. Two registrations from the same guest close together (e.g.
-- both submitted right as registration opened) could each read the same
-- stale credits_used and clobber each other's update instead of adding to
-- it — this produced real drift in production (several WA guests found
-- with credits_used far from what their actual confirmed registrations
-- added up to, in both directions).
--
-- This moves the increment/decrement into the database, locking the
-- guest_events row first so concurrent attempts serialize instead of
-- racing past a stale read — and, while here, rejects an insert that would
-- push a guest over their credit total, mirroring check_session_capacity().
create or replace function apply_registration_credit_delta()
returns trigger as $$
declare
  cost_per_person integer;
  delta integer;
  current_used integer;
  total_credits integer;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'confirmed' or new.session_id is null then
      return new;
    end if;

    select w.credit_cost into cost_per_person
    from sessions s
    join workshops w on w.id = s.workshop_id
    where s.id = new.session_id;

    delta := coalesce(new.party_size, 1) * coalesce(cost_per_person, 1);

    select ge.credits_used, coalesce(ge.credits_total, tt.credits_per_person * tt.party_cap)
      into current_used, total_credits
    from guest_events ge
    join guests g on g.id = ge.guest_id
    left join ticket_types tt on tt.id = g.ticket_type_id
    where ge.guest_id = new.guest_id and ge.event_id = new.event_id
    for update of ge;

    if current_used is null then
      -- No guest_events row tracking this guest/event — nothing to enforce.
      return new;
    end if;

    if total_credits is not null and current_used + delta > total_credits then
      raise exception 'CREDITS_EXCEEDED: only % credit(s) remaining', greatest(total_credits - current_used, 0);
    end if;

    update guest_events
    set credits_used = current_used + delta
    where guest_id = new.guest_id and event_id = new.event_id;

    return new;

  elsif tg_op = 'DELETE' then
    if old.status <> 'confirmed' or old.session_id is null then
      return old;
    end if;

    select w.credit_cost into cost_per_person
    from sessions s
    join workshops w on w.id = s.workshop_id
    where s.id = old.session_id;

    delta := coalesce(old.party_size, 1) * coalesce(cost_per_person, 1);

    update guest_events
    set credits_used = greatest(0, credits_used - delta)
    where guest_id = old.guest_id and event_id = old.event_id;

    return old;
  end if;

  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_registration_credit_insert on registrations;
create trigger trg_registration_credit_insert
  before insert on registrations
  for each row
  execute function apply_registration_credit_delta();

drop trigger if exists trg_registration_credit_delete on registrations;
create trigger trg_registration_credit_delete
  after delete on registrations
  for each row
  execute function apply_registration_credit_delta();
