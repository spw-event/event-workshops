-- Generic, label-able links on gear items, replacing the hardcoded
-- Rent/Shop pair. rental_link/product_link are kept for backwards
-- compatibility but the UI stops reading/writing them after this migration.
alter table gear_items add column if not exists link_1_label text;
alter table gear_items add column if not exists link_1_url text;
alter table gear_items add column if not exists link_2_label text;
alter table gear_items add column if not exists link_2_url text;

update gear_items set link_1_label = 'Rent', link_1_url = rental_link
  where rental_link is not null and rental_link <> '' and link_1_url is null;

update gear_items set link_2_label = 'Shop', link_2_url = product_link
  where product_link is not null and product_link <> '' and link_2_url is null;
