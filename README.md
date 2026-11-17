# TapeWatch

TapeWatch monitors public websites, records website checks, detects content changes, and builds evidence-based website intelligence profiles.

## Tech stack

- Next.js
- React
- Supabase authentication and database
- Vercel deployment and scheduled monitoring

## Local development

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Run a production build locally before deployment:

```bash
npm run build
```

## Deployment

The production app is deployed through Vercel from the `main` branch. A new commit to `main` triggers a deployment when the Vercel Git integration is connected.

## Important environment variables

Configure required environment variables in Vercel Project Settings. Keep private server keys, including the Supabase service-role key and cron secret, server-side only. Never expose them with a `NEXT_PUBLIC_` prefix.

## Monitoring

Daily scheduled monitoring is configured through `vercel.json` and the `/api/cron/monitor` endpoint.
