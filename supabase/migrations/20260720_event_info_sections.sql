-- Structured info sections for the guest-facing Info tab accordion
-- (event-specific, replaces free-form info_html parsing)
CREATE TABLE IF NOT EXISTS event_info_sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

alter table event_info_sections add column if not exists icon text default '📄';
