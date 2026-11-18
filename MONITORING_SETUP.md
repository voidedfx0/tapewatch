# TapeWatch monitoring setup

This branch adds the database migration and the scheduled runner for the existing read-only website monitor.

## 1. Apply the database migration

In the Supabase SQL Editor, run the contents of:

`supabase/migrations/20261118090000_monitoring_foundation.sql`

The migration is additive and does not delete existing website records. It creates the check history, change history, monitoring schedule, and intelligence-profile tables used by the app. It also enables row-level security for user-owned records.

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

- `TAPEWATCH_APP_URL`: the deployed app origin, for example `https://tapewatch-seven.vercel.app`
- `CRON_SECRET`: exactly the same value configured in the deployment environment

The workflow runs every 15 minutes and processes up to 25 due websites per run. It can also be started manually from Actions.

## 4. Turn on daily monitoring

Open a website in TapeWatch, open its Settings tab, and enable daily monitoring. The first run becomes due immediately; later runs are scheduled approximately 24 hours apart.

## Important deployment note

The GitHub Actions scheduler calls the deployed app. It does not deploy the app or configure Supabase automatically. Apply the SQL and add the secrets before expecting scheduled records to appear. GitHub scheduled workflows can start late under load.
