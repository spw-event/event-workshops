-- Per-event "Questions" contact info shown in the guest Guide tab's callout
-- row. Previously hardcoded to a single global phone number for every event.
alter table events add column if not exists questions_contact text;
