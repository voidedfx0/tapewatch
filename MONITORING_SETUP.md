# TapeWatch monitoring setup

This branch adds a scheduled runner for the existing read-only website monitor and a safe, additive index migration.

## 1. Database

The existing Supabase project already contains the five required tables:
- `websites`
- `website_checks`
- `website_changes`
- `website_monitoring_settings`
- `website_intelligence_profiles`

The unique indexes required for the monitoring-settings and intelligence-profile upserts are already present. Run `supabase/migrations/20261118090000_monitoring_foundation.sql` in the Supabase SQL Editor to add only the five non-unique query-performance indexes.

The migration does not create or replace tables, modify records, or change existing RLS policies. Existing row-level security remains in place.

Anonymous sign-in must remain enabled in Supabase Authentication because the current workspace creates an anonymous session.

## 2. Configure server environment variables

Set these in the deployment environment that serves TapeWatch:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never expose it as a NEXT_PUBLIC variable)
- `CRON_SECRET` (a long random secret)

Redeploy after adding or changing environment variables.

## 3. Enable the scheduled runner

Add these GitHub Actions repository secrets:

- `TAPEWATCH_APP_URL`: the deployed app origin
- `CRON_SECRET`: exactly the same value configured in the deployment environment

The workflow runs every 15 minutes and processes up to 25 due websites per run. It can also be started manually from Actions.

## 4. Turn on daily monitoring

Open a website in TapeWatch, open its Settings tab, and enable daily monitoring. The first run becomes due immediately; later runs are scheduled approximately 24 hours apart.

## Important deployment note

The GitHub Actions scheduler calls the deployed app. It does not deploy the app or configure Supabase automatically. Merge the PR, configure the deployment and repository secrets, and enable the workflow before expecting scheduled records to appear. GitHub scheduled workflows can start late under load.
