# DingoGo operations runbook

How to set up a database from nothing, roll the schema forward, check the deploy is healthy, find errors, and back up and restore.
Everything here is safe to run more than once unless it says otherwise.

## 1. Bootstrap a brand-new Supabase database (production)

Use this after losing a database, or for a new environment. It creates the schema, locks the database down and adds what DingoGo needs to take
bookings — **no demo data** (no fictional drivers, cafés, promo codes or demo sign-ins).

1. **Create the project** in Supabase (region `ap-southeast-2` Sydney). Note the database password.
2. **Get two connection strings** (Project Settings → Database → Connection string):
   - *Session pooler* (port 5432, `postgres.<project-ref>` user) — for migrations, bootstrap and backups. Session mode keeps one connection for the
     whole run.
   - *Transaction pooler* (port 6543) — for the API on Vercel (many short connections). The session pooler also works if you prefer one URL.
   Both end in `?sslmode=require` or contain `supabase.co`/`supabase.com` (the API then uses TLS).
3. **Bootstrap** from any computer with Node 22 and this repository:
   ```bash
   npm ci
   MIGRATION_DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres' \
   BOOTSTRAP_ADMIN_PHONE='04xx xxx xxx' BOOTSTRAP_ADMIN_NAME='Your name' \
   npm run db:bootstrap
   ```
   It runs every migration, turns on Row Level Security on every table, removes all access for Supabase's `anon`/`authenticated` roles (DingoGo never
   uses Supabase's REST API or client keys, so nobody holding the anon key can read anything), adds the base data (Alice Springs zone and the other
   NT zones switched off, fare rules, NT/SA rules with SA hidden, settings with **roof screens off**, DingoGo Pass plans, public holidays, tours) and
   makes `BOOTSTRAP_ADMIN_PHONE` an admin. Demo numbers (0400 000 0xx) are refused as the admin.
   Check it any time without changing anything: `npm run db:bootstrap -- --check` (exit code 0 = up to date and complete).
4. **Point Vercel at it** (Project → Settings → Environment Variables, Production), then redeploy:
   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the transaction pooler URL (port 6543) |
   | `MIGRATION_DATABASE_URL` | the session pooler URL (optional; only needed with `AUTO_MIGRATE` and a least-privilege `DATABASE_URL`) |
   | `AUTO_MIGRATE` | `true` (recommended: future migrations apply at the next cold start) |
   | `BOOTSTRAP_ADMIN_PHONE` | the admin's mobile (used only if the database is ever found empty) |
   | `HEALTH_TOKEN` | a long random string for your uptime monitor |
   | `JWT_SECRET`, `OTP_DEV_MODE=false`, … | as before (`services/api/.env.example`) |
   | `SENTRY_DSN` | optional, see section 4 |
5. **Sign in** to `/admin` with the admin mobile. Without Twilio the sign-in code goes to the Vercel function log (search for `[sms:dev]`); set up
   Twilio before real riders sign in.
6. **Re-enter what lived only in the old database**: admin-edited prices or driver pay rates, promo codes, business/NDIS accounts, partner cafés,
   driver applications and uploaded documents (uploads were stored in Postgres, so they went with it — drivers must upload their papers again).

**No computer with database access?** Set `DATABASE_URL` to the new database and `AUTO_MIGRATE=true` (plus `BOOTSTRAP_ADMIN_PHONE`) in Vercel and
redeploy. The first request after the deploy finds the database empty and does steps 3's work itself (migrations, RLS, base data, admin). Check with
`/api/health/deep` (section 3).

**Demo database** (for testing or a sales demo, never production): add `DEMO_DATA=true` to the bootstrap command.

### Optional: a least-privilege role for the API

`DB_API_ROLE=dingogo_api DB_API_ROLE_PASSWORD='<long random>' npm run db:bootstrap` creates a role that can read and write rows but not change
or drop tables, with RLS policies for it. Then set `DATABASE_URL` to that role (Supabase pooler user `dingogo_api.<project-ref>`) and
`MIGRATION_DATABASE_URL` to the `postgres` owner URL, so migrations still run. Bootstrap must run again (with the same `DB_API_ROLE`) after migrations
applied from somewhere other than this repo's runners; `AUTO_MIGRATE` re-applies grants itself after each migration.

## 2. Rolling the schema forward

- **Automatic (recommended):** `AUTO_MIGRATE=true`. Each cold start checks for migration files the database hasn't had and applies them one by one,
  each in its own transaction behind an advisory lock, so many instances starting at once apply each file exactly once. A migration that can't get
  its table locks within 5 s, or runs a statement longer than 20 s, is rolled back instead of stalling live requests; the API keeps serving on the old
  schema (new features stay off until the migration is in) and `/health/deep` shows `auto_migrate_failed` with the error. Fix the migration, redeploy.
- **By hand:** `npm run db:status` (what's applied, what's pending) and `npm run db:migrate` with `MIGRATION_DATABASE_URL` (or `DATABASE_URL`) set.
  Safe while the API is running — the same lock is used.
- **Supabase MCP / SQL editor:** paste the file's SQL and then `INSERT INTO schema_migrations (name) VALUES ('0NN_name.sql');` in the same
  transaction, or the runner will try the file again.
  Migrations 011 onwards are re-runnable (`IF NOT EXISTS`, no drops or renames; checked by `test/ops.test.ts`), so pasting one a second time
  is harmless. 001–010 are not: never paste those into a database that already has them.
- Migrations must stay additive and backward compatible (ground rules in `docs/improvement-rounds.md`): code that is ahead of the schema answers 503
  `migration_pending` for the affected feature, not a crash.
- `db:reset` drops everything and **refuses a non-local database** unless `ALLOW_DB_RESET=yes`. Never set that against production.

### After a deploy: browser smoke test
`node scripts/build-vercel.mjs && npm run db:reset -w services/api && npm run smoke` drives the built rider, driver and admin apps in Chromium
against the bundled serverless API on a local demo database: driver goes online, rider books Todd Mall → Hospital, driver accepts, arrives, starts
with the rider's PIN and completes, rider sees "Thanks for riding", admin approves the waiting car. CI runs it on every push (screenshots kept on
failure). It needs a throwaway database (it signs in demo accounts with 000000); never point it at production.

## 3. Is it healthy?

- `GET /api/health` — the API and database answer (`{ ok: true }`).
- `GET /api/health/deep` — `status` `ok` / `degraded` / `down`, schema version, `problems`. For the details (pending migration names, last
  auto-migrate run, base data counts, tables without RLS, which integrations are configured) send `X-Health-Token: <HEALTH_TOKEN>` or open
  admin → Reports → System health. 503 means the database can't be reached.
- Uptime monitor: poll `/api/health/deep` with the token header every 1–5 min; alert on non-200 or `status != "ok"`.
- When the database is down, every app shows "DingoGo is having a problem on our side" (rider: "In an emergency call 000"), the rider's live trip
  stays on screen, and the driver app keeps arrive/start/complete taps on the phone and sends them when it's back (no double charges: they carry
  idempotency keys).

## 4. Logs and errors

- The API writes one JSON line per request to stdout (Vercel → Project → Logs, or `docker compose logs api`): `request_id`, `method`, `route`
  (pattern only — no tokens, share links or query strings), `status`, `ms`, `user_id`. Errors carry `err` with the stack and `where`
  (`request`, `dispatch tick`, `background`, `auto-migrate`, …). `LOG_LEVEL=debug|info|warn|error` (default `info` in production).
- Every response has `X-Request-Id`; 500s show "(ref 1a2b3c4d)" in the apps. Search the logs for that id.
- **Sentry (optional):** create a Node project, copy its DSN into `SENTRY_DSN`. Unhandled errors, database outages, failed migrations and dispatch
  errors arrive with the release (Git commit), route and request id. No request bodies, phone numbers or names are sent.

## 5. Backups and restore

Supabase's free plan has **no automatic backups**, and deleting a project deletes its backups. Keep your own:

- **Take a backup** (needs `pg_dump` 16+ installed; otherwise it writes a JSON export):
  ```bash
  MIGRATION_DATABASE_URL='<session pooler URL>' npm run db:backup                 # → services/api/backups/dingogo-<time>.dump
  MIGRATION_DATABASE_URL='<session pooler URL>' npm run db:backup -- --json       # → JSON per table (no pg_dump needed)
  npm run db:backup -- --out /secure/place/dingogo.dump
  ```
  Backups contain personal information (phone numbers, addresses, driver licences): store them encrypted (e.g. an encrypted disk or a private,
  encrypted bucket), never in the repo (`backups/` and `*.dump` are git-ignored) or a shared drive. Files are written readable by you only.
- **Schedule:** daily, keep 7 daily + 4 weekly + 12 monthly. On a paid Supabase plan also turn on Point-in-Time Recovery.
- **Restore into a new database:** restore the dump straight into the new, empty project (don't bootstrap it first, or the base data would clash),
  then run bootstrap to apply any newer migrations and re-apply RLS and grants (it inserts nothing that already exists), and check.
  A "schema public already exists" message from `pg_restore` is harmless:
  ```bash
  pg_restore --no-owner --no-privileges --dbname "$NEW_SESSION_POOLER_URL" dingogo-<time>.dump
  MIGRATION_DATABASE_URL="$NEW_SESSION_POOLER_URL" npm run db:bootstrap      # applies any newer migrations, RLS, grants; inserts nothing that exists
  MIGRATION_DATABASE_URL="$NEW_SESSION_POOLER_URL" npm run db:bootstrap -- --check
  ```
  The JSON export is for records and accounting (and a last resort): it holds every row but restoring it means loading each table by hand.
- **Test a restore** every quarter into a scratch project and sign in to admin; a backup that has never been restored is a guess.
- Also export from Supabase now and then (Database → Backups, or the CLI `supabase db dump`).

## 6. Safety checklist before deleting or pausing anything

- Take a backup (section 5) and check the file opens: `pg_restore --list <file> | head`.
- Never delete a Supabase project that `DATABASE_URL` in Vercel still points at; check Vercel's Production variables first.
- Pausing a free Supabase project after a week idle stops the database: `/api/health/deep` returns 503 and the apps show the "problem on our side"
  notice. Un-pause from the Supabase dashboard.

## 7. Rider and driver safety tools (Round 14)

Migration `019_safety.sql` turns them on (AUTO_MIGRATE applies it). Until then SOS, sign-in and going online work as before and the new screens say
"needs migration 019". Rules live in admin → Safety → Policy (`safety_policy`); nothing needs an env var.

- **Every shift:** Safety → Emergency alerts (unanswered "Are you OK?" check-ins arrive here as alerts with the usual runbook), Reports (critical
  first; a critical report puts the other person on hold unless they were on a trip: then hold them from Standing when it ends), Photo checks
  (when switched on), Appeals (admins decide).
- **Fatigue limits** are on by default (12 h online then a 6 h rest; a 20 min break after 5 h). Drivers are never set offline mid-trip. Check the
  numbers against current NT and SA point-to-point guidance before launch and change them in Policy.
- **Photo check** is off by default. `photo_review` asks every driver for a selfie each day (DingoGo looks at it; they can drive meanwhile).
  `face_match` needs a provider: `FACE_MATCH_URL` (POST `{ selfie, reference }` base64 → `{ score }` 0–1), `FACE_MATCH_KEY`; without one it falls
  back to review. Consider the provider's privacy terms (biometric information is sensitive information under the Privacy Act) and update the
  privacy policy before switching it on.
- **Emergency card street address:** set `REVERSE_GEOCODE_URL` to a Pelias/openrouteservice-style reverse geocoder (the `ORS_API_KEY` is sent);
  without it the card gives the nearest landmark and GPS.
- **Account standing:** Settings → Users → Standing (or from a report) to suspend (optionally until a date), ban, warn or lift. People who are
  restricted see the reason at sign-in and can appeal; the private note is never shown to them.
