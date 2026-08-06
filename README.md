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

### Firebase email verification

Email verification is required before any account can access application data. In the Firebase console, enable the Email/Password sign-in provider and add every local, preview, and production hostname to Authentication → Settings → Authorized domains. Firebase Admin generates the secure action link, the application sends a client-branded message through SendGrid, and Firebase's hosted action handler returns users to `/verify-email`.

Firebase's console verification-email body is not used for application-triggered verification messages. The generated Firebase action link must remain intact, and the configured application domain must be authorized in Firebase.

## Per-client branding

Branding is configured once in the shared `brandingByClient` registry in `config/branding.ts`. The app selects a client from the incoming hostname, so client branches and client-specific environment variables are not required. Unknown hostnames safely use MockPilot. The primary, secondary, and accent colors automatically produce the shade scales used by buttons, links, tabs, focus states, calendars, charts, and badges.

```ts
export const brandingByClient = {
  'example-academy': {
    hostnames: ['piloy.example-academy.com'],
    name: 'Example Academy',
    shortName: 'EXAMPLE',
    logoUrl: '/example-academy/logo.svg',
    logoAlt: 'Example Academy',
    primaryColor: '#0f766e',
    secondaryColor: '#e9f5e9',
    accentColor: '#ea580c',
    tagline: 'Learn with confidence.',
    description: 'Practice tests from Example Academy.',
    email: {
      fromAddress: 'accounts@example-academy.com',
      fromName: 'Example Academy',
    },
  },
}
```

For that example, add `piloy.example-academy.com` to the Vercel project's Domains settings and store the asset at `public/example-academy/logo.svg`. All configured domains point to the same production deployment. Next.js serves files inside `public` from the site root, so the canonical config URL is `/example-academy/logo.svg`. The loader also normalizes `public/example-academy/logo.svg` and `/public/example-academy/logo.svg` to the correct URL. Absolute HTTP(S) URLs are supported as well.

To preview a client locally, add its registry ID to `.env.local` and restart the development server:

```bash
LOCAL_BRAND_CLIENT_ID=aggarwal-education
```

Remove the value (or use `mockpilot`) to return to the default local brand. This override is ignored by production builds, where the request hostname always selects the branding.

Use 3- or 6-digit hex values for the colors. If `logoUrl` is empty, the configured short name is shown as a text wordmark. All SendGrid messages prefer `email.fromAddress` and `email.fromName`; `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` remain independent deployment fallbacks, with the brand name as the final sender-name fallback. Every configured sender address or domain must be verified in the active SendGrid account.

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
