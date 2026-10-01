-- Audit trail for POST /api/admin/import (docs/admin-import-spec.md). Every
-- non-dry-run call is logged with its summary and per-record results.
-- RLS is on with no policies, so only the service role can read or write it.
create table if not exists import_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  event_id uuid,
  source text,
  dry_run boolean,
  summary jsonb,
  results jsonb
);

alter table import_log enable row level security;
