alter table events add column if not exists registration_timezone
  text default 'America/New_York';
