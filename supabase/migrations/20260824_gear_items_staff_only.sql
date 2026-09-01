-- Marks gear items visible only to staff (e.g. radios, first-aid kits) so
-- they can be referenced from the Staff Guide's Packing List section
-- without appearing on the guest-facing Packing List tab.
alter table gear_items add column if not exists is_staff_only boolean not null default false;
