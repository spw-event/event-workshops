-- Controls the display order of gear list sections (categories) per event.
-- gear_items.category stays a free-text field on each item; this table is
-- purely an ordering index, looked up by (event_id, name). Categories with
-- no row here yet fall back to alphabetical order in the app.
create table if not exists gear_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);
