-- TapeWatch monitoring foundation
-- Safe, additive migration. Existing website records are preserved.

create table if not exists public.website_checks (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now(),
  status text not null default 'unreachable',
  http_status integer,
  final_url text,
  content_hash text,
  page_title text,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.website_changes (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  previous_check_id uuid references public.website_checks(id) on delete set null,
  current_check_id uuid not null references public.website_checks(id) on delete cascade,
  detected_at timestamptz not null default now(),
  change_type text not null default 'content_changed',
  previous_hash text,
  current_hash text,
  previous_title text,
  current_title text,
  created_at timestamptz not null default now()
);

create table if not exists public.website_monitoring_settings (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null unique references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.website_intelligence_profiles (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null unique references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text,
  summary text,
  purpose text,
  products jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  features jsonb not null default '[]'::jsonb,
  identity_type text,
  alternate_names jsonb not null default '[]'::jsonb,
  field_evidence jsonb not null default '{}'::jsonb,
  contact_emails jsonb not null default '[]'::jsonb,
  contact_phones jsonb not null default '[]'::jsonb,
  locations jsonb not null default '[]'::jsonb,
  pricing_details jsonb not null default '[]'::jsonb,
  technologies jsonb not null default '[]'::jsonb,
  integrations jsonb not null default '[]'::jsonb,
  discovery_evidence jsonb not null default '[]'::jsonb,
  target_audience text,
  key_topics jsonb not null default '[]'::jsonb,
  important_pages jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  social_profiles jsonb not null default '[]'::jsonb,
  pages_analyzed jsonb not null default '[]'::jsonb,
  confidence text,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

alter table public.website_checks enable row level security;
alter table public.website_changes enable row level security;
alter table public.website_monitoring_settings enable row level security;
alter table public.website_intelligence_profiles enable row level security;

drop policy if exists "Users can read their website checks" on public.website_checks;
create policy "Users can read their website checks" on public.website_checks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can add their website checks" on public.website_checks;
create policy "Users can add their website checks" on public.website_checks
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can read their website changes" on public.website_changes;
create policy "Users can read their website changes" on public.website_changes
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can add their website changes" on public.website_changes;
create policy "Users can add their website changes" on public.website_changes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can manage their monitoring settings" on public.website_monitoring_settings;
create policy "Users can manage their monitoring settings" on public.website_monitoring_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage their intelligence profiles" on public.website_intelligence_profiles;
create policy "Users can manage their intelligence profiles" on public.website_intelligence_profiles
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert on public.website_checks to authenticated;
grant select, insert on public.website_changes to authenticated;
grant select, insert, update, delete on public.website_monitoring_settings to authenticated;
grant select, insert, update, delete on public.website_intelligence_profiles to authenticated;
