-- Lets specific staff resource entries be excluded from the vendor/partner
-- view of the Resources tab, while remaining visible to full staff accounts.
alter table staff_resources add column if not exists hidden_from_vendors boolean not null default false;
