This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Server configuration

Copy `.env.example` to `.env.local` and set the OpenAI API key plus Firebase Admin credentials. These values are used only by the protected exam-resolution route; do not expose them as `NEXT_PUBLIC_*` variables.

For Vercel, set the service-account key as the complete `private_key` value.
Both a real multiline value and a value containing literal `\n` separators are
accepted. The preferred variable is `FIREBASE_ADMIN_PRIVATE_KEY`; the existing
name `FIREBASE_PRIVATE_KEY` is also supported. Do not add a `NEXT_PUBLIC_`
prefix.

### AI test generation

Uploaded-material generation uses three background OpenAI Responses: analysis,
question generation, and independent verification. Configure these server-only
variables:

```bash
OPENAI_API_KEY=
OPENAI_TEST_GENERATION_MODEL=gpt-5.6-terra
OPENAI_WEBHOOK_SECRET=
AI_TEST_GENERATION_ENABLED=true
```

Create an OpenAI project webhook for
`https://your-domain.example/api/openai/webhooks` and subscribe it to response
completed, failed, incomplete, and cancelled events. The webhook signing secret
must exactly match `OPENAI_WEBHOOK_SECRET`. Deploy `firestore.rules`,
`storage.rules`, and `firestore.indexes.json` before enabling the feature.

Existing inline question keys can be audited and migrated to the private
`questionKeys` collection with:

```bash
npm run migrate:question-keys
npm run migrate:question-keys -- --write
```

The first command is a dry run. Back up Firestore before using `--write`.

### Task and timetable notification emails

Task, assignment, and timetable emails use SendGrid and durable Firestore queues. Configure
these server-only variables locally and in Vercel:

```bash
SENDGRID_API_KEY=
EMAIL_FROM_ADDRESS=notifications@example.com
EMAIL_FROM_NAME=MockPilot
APP_BASE_URL=https://your-production-domain.example
APP_TIME_ZONE=Asia/Kolkata
CRON_SECRET=
```

`EMAIL_FROM_ADDRESS` must be a verified SendGrid sender or belong to an
authenticated sending domain. Generate `CRON_SECRET` as a random value of at
least 16 characters. Never expose either secret through a `NEXT_PUBLIC_`
variable.

Task and assignment creation requests immediately process their `assigned`
email on Vercel. Timetables do not send email when they are created, edited,
published, or archived; students receive only the consolidated 7:00 AM agenda
on class days. Time-based task messages, timetable agendas, and failed-delivery
retries remain in Firestore until a worker checks the queues.

Vercel Hobby does not support a cron that runs more than once per day. To poll
the production queue from a local machine, add the following to the ignored
`.env.local` file. The secret must exactly match `CRON_SECRET` in Vercel:

```bash
TASK_EMAIL_CRON_URL=https://your-app.vercel.app/api/cron/task-emails
TASK_EMAIL_POLL_INTERVAL=15m
CRON_SECRET=
```

Start the continuous poller with its 15-minute default, or choose another
interval from 30 seconds through 24 hours:

```bash
npm run email:poll
npm run email:poll -- --interval 5m
npm run email:poll -- --interval 1h
npm run email:poll -- --once
```

The poller checks both task and timetable queues once immediately, then waits after each request so calls do
not overlap. Temporary failures are logged and retried on the next interval.
Press `Ctrl+C` to stop it. Closing the terminal, shutting down the computer, or
losing internet access pauses processing; due jobs stay queued and are handled
when the poller starts again. The local poller needs only the production URL and
cron secret—SendGrid and Firebase Admin credentials can remain in Vercel.

Deploy the Firestore rules and indexes before enabling task creation:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

New task and assignment writes go through authenticated server routes. The
browser can no longer create those Firestore documents directly. Email jobs and
per-recipient delivery records are server-only collections.

### Exam information ingestion

The exam dashboard uses OpenAI live web search to compare the latest cited
information with the currently published exam cycle. Supported changes are
published immediately with an `awaiting admin verification` label. An
administrator can verify them or reject and automatically restore the previous
section from `/admin/exam-updates`.

Refresh is a dry run unless `--write` is provided:

```bash
npm run exam:refresh -- --exam <catalog-id>
npm run exam:refresh -- --all
npm run exam:refresh -- --all --write
```

Each exam is checked with one structured request covering dates, applications,
eligibility, pattern, syllabus, and official resources. Every changed field
must cite a URL returned by the web-search tool or the refresh is rejected.
Only one unreviewed provisional refresh can exist for an exam at a time.

For daily local execution on Windows, create a Task Scheduler action that runs
`npm.cmd run exam:refresh -- --all --write` with this project as its working
directory. Keep `.env` on that machine and do not commit service-account or API
credentials.

After deploying the GPT web-refresh flow, preview the one-time legacy cleanup:

```bash
npm run exam:cleanup-legacy
npm run exam:cleanup-legacy -- --write
```

The cleanup is limited to old source documents, crawler runs and expired locks,
legacy pending revisions, and Firebase Storage objects under
`exam-ingestion/`. It does not remove published exam cycles or updates.

To preview the legacy personal-exam migration, run `npm run migrate:exam-catalog`. Run `npm run migrate:exam-catalog -- --write` only after reviewing the dry-run count and backing up Firestore.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
