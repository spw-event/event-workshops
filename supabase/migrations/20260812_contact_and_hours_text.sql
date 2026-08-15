-- Additional per-event contact fields shown alongside questions_contact in
-- the guest Guide tab's Questions callout.
alter table events add column if not exists contact_email text;
alter table events add column if not exists contact_phone_dayof text;

-- Free-text hours for amenity open_moments, replacing the start_time/end_time
-- pair on the Site tab (amenities often have irregular per-day hours that
-- don't fit a single start/end range).
alter table open_moments add column if not exists hours_text text;
