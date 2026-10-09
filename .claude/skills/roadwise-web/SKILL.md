---
name: roadwise-web
description: Use when building or changing the Roadwise website and API — Next.js App Router on Vercel, libSQL/SQLite storage (local file in dev, Turso in production), self-built email+password session auth, device-link and game-token endpoints, drive ingest routes, EN/RU/AZ localization, profile and drive pages, landing and download pages, seeding and deployment. Visual design comes from the project's design skill. Assumes roadwise-platform is loaded.
---

# Roadwise — website and API

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js, App Router, TypeScript strict | Site + API in one Vercel deploy, Node.js runtime for all routes |
| Database | **libSQL (SQLite)** via `@libsql/client` | `DATABASE_URL=file:./data/roadwise.db` locally; `libsql://…` (Turso free tier) on Vercel. Same code, same SQL. |
| Auth | **Own implementation**: email + password, `node:crypto` scrypt, DB-backed session cookie | No auth provider, no Supabase |
| Validation | `zod` | Shared by API and telemetry |
| i18n | `[locale]` route segment + JSON dictionaries | `en` (default), `ru`, `az` |
| UI | **Follow the design skill in `.claude/skills/`** | It decides styling, components, typography, colour. Where it is silent: Tailwind + Recharts. |
| AI | OpenRouter, model `google/gemini-3.8-flash`, plain `fetch` (`lib/ai/llm.ts`) | See roadwise-ai-instructor |
| Tests | Vitest | |
| Game files | GitHub Releases link | Nothing large on Vercel |

**Why not a plain SQLite file or in-memory JSON on Vercel:** Vercel functions have a read-only filesystem (only `/tmp`, which is per-instance and wiped), and each request can hit a different instance. Users and drives would disappear or diverge. libSQL keeps SQLite semantics and a local file for development while production writes go to a hosted SQLite (Turso).

## 2. Layout

```
app/
  [locale]/
    layout.tsx                 html lang, nav, language switcher
    page.tsx                   landing
    login/page.tsx  signup/page.tsx
    download/page.tsx
    link/page.tsx              device authorisation (login required)
    profile/page.tsx           dashboard (login required)
    drives/[id]/page.tsx       drive detail (owner only)
  api/
    device/start/route.ts  device/token/route.ts
    me/route.ts
    drives/route.ts            POST (game) · GET list
    drives/[id]/route.ts       GET
    drives/[id]/regenerate/route.ts  POST (cookie) — debrief in current locale
proxy.ts                       locale redirect (/ → /en), cookie-presence redirect for protected pages
lib/
  db.ts                        libSQL client singleton
  auth/password.ts session.ts gameToken.ts rateLimit.ts
  rules/catalog.ts             from roadwise-platform §3
  telemetry/schema.ts          zod for roadwise.drive.v1
  i18n/config.ts getDictionary.ts
  metrics.ts readiness.ts history.ts instructor.ts grounding.ts fallback.ts prompts/
  drives/ingest.ts             one function used by the API route, the seed script and eval
messages/en.json ru.json az.json
db/migrations/0001_init.sql
scripts/migrate.ts seed-demo.ts make-fixtures.ts device-flow.sh upload.sh
fixtures/  eval/  tests/  docs/GAME_INTEGRATION.md
data/                          local DB file (gitignored)
```

## 3. Environment

```
DATABASE_URL=file:./data/roadwise.db     # prod: libsql://<db>.turso.io
DATABASE_AUTH_TOKEN=                     # prod only
OPENROUTER_API_KEY=
OPENROUTER_MODEL=                       # default google/gemini-3.8-flash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DOWNLOAD_URL=                # GitHub Releases latest asset
```
Provide `.env.example`; never commit `.env.local` or `data/`.

## 4. Schema (`db/migrations/0001_init.sql`)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                       -- uuid
  email TEXT NOT NULL UNIQUE,                -- lower-cased, trimmed
  password_hash TEXT NOT NULL,               -- scrypt$N$r$p$salt$hash (base64url)
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ru','az')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,           -- sha256 of cookie value
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);
CREATE TABLE device_links (
  id TEXT PRIMARY KEY,
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','consumed','expired')),
  client TEXT, client_version TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE game_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  client TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE drives (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_drive_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'game' CHECK (source IN ('game','fixture')),
  mode TEXT NOT NULL, district TEXT, route_id TEXT,
  started_at TEXT, duration_s REAL, distance_m REAL, exam_passed INTEGER,
  telemetry TEXT NOT NULL,                   -- raw JSON
  metrics TEXT, readiness TEXT, history TEXT,-- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, client_drive_id)
);
CREATE INDEX drives_user_started ON drives(user_id, started_at DESC);
CREATE TABLE drive_debriefs (
  drive_id TEXT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','fallback','error')),
  debrief TEXT,                              -- JSON
  model TEXT, prompt_version TEXT,
  input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER, attempts INTEGER DEFAULT 0,
  validation_errors TEXT,                    -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (drive_id, locale)
);
```

`scripts/migrate.ts` applies `db/migrations/*.sql` in order, tracked in a `_migrations` table, idempotent. Enable `PRAGMA foreign_keys = ON` per connection. Vercel build command: `npm run db:migrate && next build`.

## 5. Auth (`lib/auth/`)

- **Passwords:** `scrypt(password, salt16, 64, { N: 16384, r: 8, p: 1 })`; store `scrypt$16384$8$1$<salt>$<hash>`; verify with `timingSafeEqual`. Min length 8; email validated and lower-cased.
- **Sessions:** on sign-up/log-in create 32 random bytes → cookie `rw_session` (httpOnly, `secure` in production, `sameSite: lax`, path `/`, 30 days); store only its SHA-256 in `auth_sessions`. `getCurrentUser()` (server-only, cached per request) looks it up and checks expiry; sliding renewal when < 15 days left. Log out deletes the row and the cookie. Changing password deletes all sessions.
- **Forms:** server actions with zod; generic error "Email or password is incorrect"; in-memory per-instance rate limit on login (5 tries / 10 min per email+IP) — documented as best-effort.
- **Protection:** `proxy.ts` (Next 16 name for middleware) only redirects when the cookie is absent (no DB in middleware); every protected page and API route calls `requireUser()` / `requireGameUser()` for the real check.
- **CSRF:** server actions are origin-checked by Next. Cookie-authenticated `POST` route handlers verify `Origin` equals `NEXT_PUBLIC_SITE_URL`.
- **Game tokens:** `rw_` + 32 random bytes base64url; SHA-256 in `game_tokens`; `requireGameUser(req)` reads `Authorization: Bearer`, rejects revoked, updates `last_used_at`. User codes: 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown `XXXX-XXXX`.

## 6. API

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/device/start` | none | Create link (10 min). Response per Contract A; `verify_url` uses the default locale. |
| `POST /api/device/token` | none | `pending` → 400 `authorization_pending`; expired → 400 `expired_token`; approved → set `consumed`, issue game token, 200; already consumed/unknown → 400 `invalid_grant`. |
| server action `approveDevice(userCode)` | session | On `/link`: pending + unexpired → `approved`, `user_id`. |
| `GET /api/me` | Bearer | `{ id, display_name, locale }` |
| `POST /api/drives` | Bearer | zod → 422 with issues; `ingestDrive()` upserts by `client_drive_id`, computes metrics/readiness/history, inserts debrief `pending` in user locale, schedules generation with `after()`. Returns `{ id, metrics, readiness, history, debrief_status, url }`. Set `export const maxDuration` high enough for the Gemini call. |
| `GET /api/drives` | session or Bearer | Latest 50, summary fields only. |
| `GET /api/drives/:id?locale=` | session or Bearer, owner | Drive + metrics + readiness + history + debrief for locale (falls back to any available). |
| `POST /api/drives/:id/regenerate` | session | Debrief in the current locale. |

## 7. Localization

- Locales `en | ru | az`; `/` redirects to the `NEXT_LOCALE` cookie or `Accept-Language` match, else `en`.
- All UI strings in `messages/*.json` (no literals in components); `getDictionary(locale)` server-side.
- Switcher keeps the current path; when logged in it also updates `users.locale` (used for new debriefs).
- Rule names come from `lib/rules/catalog.ts`. Numbers/dates via `Intl` with the locale; currency "AZN".
- RU and AZ strings are provisional; keep a `"_review": true` marker at the top of those files.

## 8. Pages (content; visuals per the design skill)

- **Landing:** hero (one sentence + game screenshot), the problem, how it works (drive → AI instructor → progress), product screenshots (debrief, profile), "real Baku streets, real Azerbaijani rules", CTAs Sign up / Download. No unverified statistics.
- **Download:** OS button → `NEXT_PUBLIC_DOWNLOAD_URL`, version, "Run anyway" note for unsigned builds, 3-step "log in from the game".
- **Link:** shows code + client; Authorise button; success "Return to the game"; expired/invalid states.
- **Profile:** readiness card with component breakdown; KPI tiles (drives, km, compliance %, fines); progress chart per drive (compliance, fines, composure); violations by rule; exam history; drive list; connected devices with Revoke; language preference.
- **Drive:** header (mode, district, date, duration, pass/fail); `TraceMap` (SVG polyline of `x,z`, coloured by overspeed, markers on failed checks; click marker ↔ timeline row); `EventTimeline`; metric groups; `DebriefCard` (issues link to events); deltas vs previous; poll every 3 s while `pending`; "sample data" badge when `source='fixture'`.

TraceMap: `+z` is south, so plot `(x, z)` straight into SVG; fit viewBox to bounds + padding; downsample to ≤1,500 points.

## 9. Seed and demo safety

- `scripts/seed-demo.ts` creates `demo@roadwise.app` and ingests fixtures through `ingestDrive()` with `source='fixture'`, so metrics and debriefs are real outputs.
- `scripts/upload.sh <file>` uploads any telemetry with a game token — the stage backup if the game misbehaves.

## 10. Done checks

- `npm run typecheck && npm run lint && npm test` green.
- `scripts/device-flow.sh` passes against local and the Vercel deployment.
- Every fixture uploads (200); a broken fixture returns 422; re-upload returns the same id.
- Pages render with 0, 1 and many drives, in all three locales.
- Verified on the deployed Vercel URL with the Turso database, not only localhost.
