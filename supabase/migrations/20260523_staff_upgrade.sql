-- Run this in Supabase SQL editor

-- 1. Add staff_id to staff_assignments so Snow Peak staff can be assigned
--    (instructor_pin_id stays for vendor/instructor assignments)
ALTER TABLE staff_assignments
  ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;

-- 2. Create staff_event_assignments junction table
CREATE TABLE IF NOT EXISTS staff_event_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID REFERENCES staff(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  UNIQUE(staff_id, event_id)
);

ALTER TABLE staff_event_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sea_select" ON staff_event_assignments FOR SELECT USING (true);
CREATE POLICY "sea_insert" ON staff_event_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "sea_delete" ON staff_event_assignments FOR DELETE USING (true);

-- 3. RLS for staff table (run if not already configured)
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select" ON staff FOR SELECT USING (true);
CREATE POLICY "staff_insert" ON staff FOR INSERT WITH CHECK (true);
CREATE POLICY "staff_update" ON staff FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "staff_delete" ON staff FOR DELETE USING (true);
