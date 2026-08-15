-- Partner organizations shown to guests on the Guide tab's "Our Partners"
-- accordion section — presented as collaborators, not sponsors.
create table if not exists event_partners (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  description text,
  website_url text,
  logo_url text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
