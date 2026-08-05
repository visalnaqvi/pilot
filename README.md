# MockPilot

MockPilot is a Next.js application backed by Neon PostgreSQL and Drizzle. Firebase is used only for Authentication and temporary object storage.

## Local setup

Copy `.env.example` to `.env.local` and configure:

```bash
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
DATABASE_URL_DIRECT=postgresql://.../neondb?sslmode=require
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
```

`DATABASE_URL` is Neon's pooled application connection. `DATABASE_URL_DIRECT` is the direct connection used only by schema migration commands.

Keep the Firebase Admin variables for ID-token verification and signed Storage operations. Never expose database or Admin credentials through `NEXT_PUBLIC_*`.

## Per-client branding

Branding is configured in `config/branding.ts`, which is committed with the branch. Checking out a client branch therefore switches its logo, identity, and palette without changing local environment variables. The primary and accent colors automatically produce the full shade scales used by buttons, links, tabs, focus states, calendars, charts, and badges.

```ts
const branding = {
  name: 'Example Academy',
  shortName: 'EXAMPLE',
  logoUrl: '/example-academy/logo.svg',
  logoAlt: 'Example Academy',
  primaryColor: '#0f766e',
  accentColor: '#ea580c',
  tagline: 'Learn with confidence.',
  description: 'Practice tests from Example Academy.',
}
```

For that example, store the asset at `public/example-academy/logo.svg`. Next.js serves files inside `public` from the site root, so the canonical config URL is `/example-academy/logo.svg`. The loader also normalizes `public/example-academy/logo.svg` and `/public/example-academy/logo.svg` to the correct URL. Absolute HTTP(S) URLs are supported as well.

Use 3- or 6-digit hex values for the colors. If `logoUrl` is empty, the configured short name is shown as a text wordmark. `EMAIL_FROM_NAME` remains an optional environment override and otherwise defaults to the configured brand name; notification templates use the configured name and primary color.

## Database

```bash
npm run db:generate
npm run db:check
npm run db:migrate
npm run db:seed
npm run db:studio
```

The migration command refuses to run without `DATABASE_URL_DIRECT`. The application and deterministic seed use the pooled `DATABASE_URL`. Apply migrations before deploying the application version.

The first Firebase account matching `BOOTSTRAP_ADMIN_EMAIL` becomes the administrator when it signs in. Set `BOOTSTRAP_ADMIN_UID` as well if the administrator must be inserted by the seed before first sign-in.

## AI test generation

Configure `OPENAI_API_KEY`, `OPENAI_EXAM_RESOLUTION_MODEL`, `OPENAI_TEST_GENERATION_MODEL`, `OPENAI_WEBHOOK_SECRET`, and `AI_TEST_GENERATION_ENABLED`. The OpenAI webhook endpoint is `/api/openai/webhooks`.

Browser uploads use short-lived signed Google Cloud Storage URLs. Apply the
bucket CORS configuration once for each Firebase Storage bucket:

```bash
npm run storage:cors
```

The included rule permits cross-origin `PUT` requests only when the caller has
a valid signed URL. Firebase Storage rules remain closed to direct browser SDK
writes.

## Email workers

Configure the SendGrid, app URL, time-zone, and cron variables from `.env.example`. Run the local polling worker with:

```bash
npm run email:poll
```

New task and assignment notices are processed immediately after their creation
response. The poller handles start/deadline reminders, retries, and consolidated
timetable agendas. A timetable agenda is queued once per organization and class
date for 7:00 AM in the timetable time zone; a poll after 7:00 AM sends that due
agenda once. Publishing a timetable does not send an email announcement.

## Development

```bash
npm install
npm run dev
```

Before deployment:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
