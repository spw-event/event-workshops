-- Permissive anon policies, matching this project's PIN-based-auth convention
-- (no per-row user isolation) — same pattern as event_info_sections/gear_categories.
alter table event_partners enable row level security;

create policy "event_partners_select" on event_partners for select using (true);
create policy "event_partners_insert" on event_partners for insert with check (true);
create policy "event_partners_update" on event_partners for update using (true) with check (true);
create policy "event_partners_delete" on event_partners for delete using (true);
