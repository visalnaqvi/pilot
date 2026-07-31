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
