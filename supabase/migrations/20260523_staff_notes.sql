-- Add staff-facing activity notes to sessions and open_moments
-- staff_shifts already has a description field used for the same purpose

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS staff_notes TEXT;
ALTER TABLE open_moments ADD COLUMN IF NOT EXISTS staff_notes TEXT;
