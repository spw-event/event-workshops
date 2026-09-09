-- Replaces the guest/staff-only boolean with a three-way visibility field so
-- gear items can be designated "guests" only, "staff" only, or "both".
alter table gear_items add column if not exists visibility text not null default 'both';

update gear_items set visibility = 'staff' where is_staff_only = true;

alter table gear_items add constraint gear_items_visibility_check
  check (visibility in ('guests', 'staff', 'both'));

alter table gear_items drop column if exists is_staff_only;
