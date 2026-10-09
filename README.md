# Roadwise — website, API and AI instructor

Website, API and AI driving instructor for **Roadwise**, a Baku driving-school simulator (the Unity game lives in a separate repository; its integration guide is [`docs/GAME_INTEGRATION.md`](docs/GAME_INTEGRATION.md)).

Next.js (App Router) · libSQL (SQLite file locally, Turso in production) · own email + password sessions · Gemini via `@google/genai` · EN / RU / AZ.

## Run locally

```bash
npm install
cp .env.example .env.local          # then fill GEMINI_API_KEY (optional — without it debriefs use the template fallback)
npm run db:migrate                  # creates data/roadwise.db
npm run seed:demo                   # demo@roadwise.app / roadwise-demo-2026 with a 7-drive progress story
npm run dev                         # http://localhost:3000
```

If `.env.local` points `DATABASE_URL` at Turso, create `.env.development.local` with `DATABASE_URL=file:./data/roadwise.db` so local dev never touches production (`db:reset` refuses non-file databases anyway).

| Command | What it does |
|---|---|
| `npm test` | Vitest: metrics, readiness, history, schema, auth, device flow, ingest, grounding, fallback, docs/API sync |
| `npm run typecheck` · `npm run lint` | type and lint checks |
| `npm run db:migrate` · `npm run db:reset` | apply migrations · wipe the local DB file and re-migrate |
| `npm run fixtures` | regenerate `fixtures/*.json` + expectations (deterministic) |
| `npm run contracts` | regenerate `contracts/roadwise.drive.v1.schema.json` from the zod schema |
| `npm run seed:demo [-- --reset]` | demo account through the real ingest + debrief pipeline |
| `npm run gemini:check` | one tiny structured-output call to verify `GEMINI_API_KEY` / `GEMINI_MODEL` |
| `npm run eval` | AI evaluation → `eval/REPORT.md` + `eval/report.json` (set `GEMINI_PRICE_*_PER_M` for cost) |
| `scripts/device-flow.sh` | end-to-end device-link login over HTTP (`BASE_URL=…` for a deployment) |
| `scripts/upload.sh <file>` | upload a telemetry file with the saved game token |

## Deploy (Vercel + Turso)

1. Turso: `turso db create roadwise` → `turso db show roadwise --url` (→ `DATABASE_URL`) and `turso db tokens create roadwise` (→ `DATABASE_AUTH_TOKEN`).
2. Vercel: import this GitHub repo. `vercel.json` sets the build command `npm run db:migrate && next build`, so migrations run on every deploy.
3. Environment variables (Production): `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `GEMINI_API_KEY`, `GEMINI_MODEL` (e.g. `gemini-3.8-flash`), `NEXT_PUBLIC_SITE_URL` (the production URL, no trailing slash — used for device-link URLs and the CSRF origin check), `NEXT_PUBLIC_DOWNLOAD_URL` (GitHub Releases asset), optionally `NEXT_PUBLIC_GAME_VERSION`.
4. Seed the demo account against production: `DATABASE_URL=… DATABASE_AUTH_TOKEN=… GEMINI_API_KEY=… npm run seed:demo`.
5. Verify: `BASE_URL=https://<site> scripts/device-flow.sh` (authorise in the browser when asked), then `BASE_URL=https://<site> scripts/upload.sh fixtures/red_light_runner.json`, and sign up on the site.

## Layout

`app/` pages and API routes · `lib/` auth, db, metrics, readiness, history, instructor (prompt, Gemini client, grounding, fallback, pipeline) · `messages/` EN/RU/AZ strings (RU/AZ provisional, `"_review": true`) · `fixtures/` synthetic drives · `eval/` harness and report · `docs/GAME_INTEGRATION.md` for the game team · `PLAN.md` build plan and status.
