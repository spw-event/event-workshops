-- Add map image URL and info HTML to events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS map_image_url TEXT,
  ADD COLUMN IF NOT EXISTS info_html TEXT;
