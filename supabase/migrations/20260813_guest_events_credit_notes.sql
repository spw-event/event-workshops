-- Optional admin-facing reason for a guest credit override, shown alongside
-- the "Custom" badge in the Guests list so admins don't have to remember
-- (or go dig up) why a manual credits_total was set.
alter table guest_events add column if not exists credit_notes text;
