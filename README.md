# Clinic booking

A small Express + TypeScript API, React booking page, and Postgres database in one repository. The API runs on Render; the page and its server-side API proxy run on Vercel. Supabase provides production Postgres. No browser receives the API key.

All five assessment levels are implemented. The assessment Swagger page was inaccessible from the development environment, so the contract below follows the supplied levels; exact compatibility with that Swagger contract is **not verified**. No assessment API endpoints were called.

## Local development

Use Node 24, npm, and Docker Compose. Run from the repository root:

```sh
npm ci
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev:api
```

In another terminal, from the same root:

```sh
npm run dev:web
```

Vite serves the page on port 5173; the API uses port 3001. `backend/.env` and `frontend/.env` must use the same `API_KEY`. Local sample credentials are for local development only. Database data is retained in ignored `.data/postgres`; do not delete it if you want to retain bookings. Use the existing checkout in cloud tasks; a separate worktree is unnecessary.

`db:migrate` creates the schema without deleting data and can run again safely. `db:seed` inserts demo appointments for the next 14 days, 09:00–16:30 UTC, without duplicating slots. Seeding is explicit rather than automatic on every restart. The page displays appointment times in the visitor's timezone; date filtering uses UTC.

## API contract

All `/api/*` routes require `X-API-Key`. `/health` is public and checks database connectivity. Requests and responses use JSON. Dates are ISO 8601 UTC strings. IDs are UUIDs.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/health` | `200 {"status":"ok"}` |
| GET | `/api/slots?page=1&limit=20&date=2026-11-16` | Available future slots; `date` is optional |
| POST | `/api/bookings` | Create a booking; `201` |
| GET | `/api/bookings/:id` | Look up your booking; `200` |
| DELETE | `/api/bookings/:id` | Cancel your booking; `200` |
| GET | `/api/bookings?page=1&limit=10` | Page through your bookings, including cancelled ones |

Example booking request:

```http
POST /api/bookings
X-API-Key: <server API key>
Idempotency-Key: <a unique UUID for this booking attempt>
Content-Type: application/json

{"slot_id":"<slot UUID>","patient_name":"Ada Okafor","patient_email":"ada@example.com"}
```

Example response (values abbreviated for readability):

```json
{
  "data": {
    "id": "<booking UUID>",
    "slot_id": "<slot UUID>",
    "patient_name": "Ada Okafor",
    "patient_email": "ada@example.com",
    "status": "confirmed",
    "created_at": "2026-11-15T12:00:00.000Z",
    "cancelled_at": null,
    "starts_at": "2026-11-16T09:00:00.000Z",
    "ends_at": "2026-11-16T09:30:00.000Z"
  },
  "patient_token": "<64-character private access code>"
}
```

Keep `patient_token` private. Send it as `X-Patient-Token` for lookup, cancellation, listing, and subsequent bookings to associate visits with the same person. Without one, creating a booking generates a new access code. Access codes are hashed on booking records. They are bearer credentials, not email verification or user accounts. The page retains the code in local storage and offers manual transfer to another browser. A booking reference alone cannot expose patient details. No confirmation email is sent.

List responses contain `{ "data": [], "page": 1, "limit": 20, "has_more": false }`; maximum limit is 100. Slots sort by start time; bookings sort newest first with an ID tie-breaker. Offset pagination is intentionally simple; newly inserted bookings can shift later pages.

Errors have `{ "error": { "code": "...", "message": "..." } }`. Validation errors also include `details`. Responses include `400` for invalid input, `401` for missing/invalid API key or patient access code, `404` for unknown/inaccessible records, `409` for a taken/past slot or reused idempotency key with changed details, and `429` for the booking rate limit. `429` includes `Retry-After: 60`. Unexpected failures return `500` without database details.

### Level guarantees

1. **Persistence:** all slots and bookings live in Postgres, not application memory.
2. **Authentication and validation:** API key checked before API requests; strict request validation rejects missing, malformed, oversized, and unknown booking fields.
3. **Concurrency and cancellation:** a partial unique index permits only one confirmed booking per slot. Transactions and row locks serialize competing requests. Cancellation preserves the record and releases the slot; repeated cancellation is safe.
4. **Retries and pagination:** send the same `Idempotency-Key` (8–128 letters, numbers, `_` or `-`) with the same normalized body and patient header on retries. A transaction-scoped database lock and durable response record return the original `201` response with `Idempotency-Replayed: true`. Changing details returns `409`. Failed attempts do not reserve the key. Keys are retained indefinitely, so do not reuse them for new bookings. The UI reuses its pending key after network failures. Paginated booking lists require the private access code.
5. **Spam protection:** persistent fixed one-minute windows allow 10 booking attempts per client IP and 100 total attempts per minute, across API instances. Invalid and retried submissions count. The global cap limits callers rotating IPs. The Vercel function supplies the platform-observed client IP; only trusted API-key holders may supply `X-Client-IP`. This is basic assessment protection, not a complete abuse prevention service.

## Verification

Tests require a **separate, disposable** database named `clinic_test`. They erase its tables and refuse other database names.

```sh
docker compose exec -T db psql -U clinic -d postgres -c 'CREATE DATABASE clinic_test'
TEST_DATABASE_URL=postgresql://clinic:clinic_local_only@127.0.0.1:5432/clinic_test npm test
npm run build
```

The API suite covers every level, including 20 competing booking requests, concurrent idempotent retries, cancellation/rebooking, validation, patient isolation, pagination, and limits shared by multiple application instances.

For browser tests, seed the **local** development database first. These tests create a demo booking and cancel it; never point them at production:

```sh
npm exec playwright install chromium
npm run build
npm run db:migrate
npm run db:seed
npm run test:e2e
```

If Chromium is already installed, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`. Browser tests run the built page and the actual Vercel proxy handler, covering booking, confirmation, reload persistence, lookup, cancellation, mobile layout, and empty availability. Test servers stop afterward. Do not run parallel test invocations against the same test database.

## Deploy: Supabase → Render → Vercel

Deployment needs your hosting accounts and a GitHub copy of this code. No hosting deployment has been performed by this repository alone.

### 1. Supabase

Create a free Supabase project. Copy its Postgres connection string from **Connect**. For Render, use the **session pooler** connection string if the direct host requires IPv6. Use the database owner connection, not the public anon key. URL-encode special characters in the password. Require SSL using the provider's verified connection instructions (for example, `sslmode=verify-full` with a trusted certificate). Do not disable certificate or TLS verification.

Save the URL securely as `DATABASE_URL` in Render's environment settings. Never put it in frontend code, Git, or chat. Migrations enable row-level security on all application tables with no public policies; the backend database owner operates on them. The Supabase public/anon API is not used.

### 2. Render API

Push this repository to GitHub, then create a Render Blueprint using `render.yaml`. It defines a free Node web service with:

- Build: `npm ci && npm run build -w backend`
- Start: `npm run db:migrate && npm start -w backend`
- Health check: `/health`
- `DATABASE_URL`: your secure Supabase Postgres connection string
- `API_KEY`: generated by Render; keep it private and copy the same value to Vercel

Keep the root directory at the repository root. After deploying, verify the HTTPS `/health` response. Create initial demo availability by running `npm run db:seed` from the root with the production `DATABASE_URL` securely injected. If your free plan has no shell, run this locally with the production URL in the ignored `backend/.env`, then restore your local URL. Seeding is additive; it does not delete bookings.

### 3. Vercel page

Import the GitHub repository into Vercel:

- Root directory: `frontend`
- Framework: Vite
- Include source files outside the root directory for the npm workspace
- `frontend/vercel.json` supplies installation, build, and output settings
- Server-only environment variables: `API_URL=https://<your-render-service>.onrender.com` and the same `API_KEY` as Render

Neither variable should start with `VITE_`. Redeploy after changing variables. The `/api/*` server function forwards allowed requests to Render; the browser communicates only with its own Vercel origin, so cross-origin API access is unnecessary. Render free services can sleep; the page displays failures and lets the patient retry safely with the same booking key.

### 4. Live acceptance check

At the Vercel HTTPS URL, select a slot, book it, save the confirmation, reload, find it in My appointments, look it up by reference, then cancel it. Confirm the slot is available again. Call the Render API without an API key and verify `401`. Test deployed concurrency and rate limiting only against disposable demo slots. Published HTTPS behavior is not verified until these checks pass on your actual services.

This is an assessment booking flow for one clinic schedule. It intentionally excludes hospital administration, staff accounts, payments, medical records, and email delivery.
