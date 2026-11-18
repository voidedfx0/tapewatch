-- TapeWatch monitoring foundation
-- Existing tables, records, constraints, and RLS policies are already present.
-- This migration adds only non-unique indexes used by monitoring queries.
-- It deliberately does not alter table definitions or existing security policies.

create index if not exists website_checks_user_time_idx
  on public.website_checks(user_id, checked_at desc);

create index if not exists website_checks_site_time_idx
  on public.website_checks(website_id, checked_at desc);

create index if not exists website_changes_user_time_idx
  on public.website_changes(user_id, detected_at desc);

create index if not exists website_changes_site_time_idx
  on public.website_changes(website_id, detected_at desc);

create index if not exists website_monitoring_due_idx
  on public.website_monitoring_settings(next_run_at)
  where enabled = true;
