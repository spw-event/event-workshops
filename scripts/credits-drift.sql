-- Credit balances vs. what confirmed registrations actually cost.
--
-- Production never got 20260918_atomic_credit_enforcement.sql, while the app
-- stopped writing credits_used itself on 2026-09-18. Registrations since then
-- haven't deducted credits (cancellations still refunded), so credits_used
-- has drifted. Step 1 is read-only.

-- 1. Preview: every guest/event whose balance is off.
select g.name, g.email, e.name as event,
       ge.credits_used as recorded,
       coalesce(r.cost, 0) as actual,
       coalesce(r.cost, 0) - coalesce(ge.credits_used, 0) as difference
from guest_events ge
join guests g on g.id = ge.guest_id
join events e on e.id = ge.event_id
left join (
  select r.guest_id, r.event_id, sum(coalesce(r.party_size, 1) * w.credit_cost) as cost
  from registrations r
  join sessions s on s.id = r.session_id
  join workshops w on w.id = s.workshop_id
  where r.status = 'confirmed'
  group by r.guest_id, r.event_id
) r on r.guest_id = ge.guest_id and r.event_id = ge.event_id
where coalesce(ge.credits_used, 0) <> coalesce(r.cost, 0)
order by e.name, g.name;

-- 2. Fix (run only after the migrations, once you've reviewed step 1):
-- update guest_events ge
-- set credits_used = coalesce((
--   select sum(coalesce(r.party_size, 1) * w.credit_cost)
--   from registrations r
--   join sessions s on s.id = r.session_id
--   join workshops w on w.id = s.workshop_id
--   where r.status = 'confirmed' and r.guest_id = ge.guest_id and r.event_id = ge.event_id
-- ), 0);
