# Roadwise web — implementation plan

**Status:** 7.1 done (4.1 live check pending: Gemini key rejected). Next: **7.2** (eval report).
**Scope:** website + API + AI instructor + eval. The Unity game is built by other agents; this repo only provides `docs/GAME_INTEGRATION.md` for them.

Rules for whoever executes this plan:
- Before each step, load the skills it names (`.claude/skills/roadwise-*`) and, for any UI step, the project's **design skill**.
- After each step: tick the box, update **Status** with the next step, and commit (`feat(step-id): …`). A fresh context must be able to resume from this file alone.
- Run the step's check before ticking. If a check fails, fix it before moving on.
- Do not start stretch work until every MVP box is ticked.

## Phase 0 — Scaffold
- [x] **0.1** Next.js (App Router, TS strict, ESLint) in the repo root; Vitest; zod; `@libsql/client`; `@google/genai`; Recharts; styling per design skill. `.env.example`, `.gitignore` (`data/`, `.env*.local`). — skills: roadwise-web §1–3, design — check: `npm run dev` serves a page; `npm run typecheck` green.
- [x] **0.2** `lib/db.ts`, `db/migrations/0001_init.sql`, `scripts/migrate.ts`, npm scripts `db:migrate`, `db:reset`. — roadwise-web §4 — check: migrate twice locally, second run is a no-op; tables exist.
- [x] **0.3** i18n: `[locale]` segment, middleware redirect, `messages/{en,ru,az}.json`, `getDictionary`, language switcher in layout. — roadwise-web §7 — check: `/` → `/en`; switching to `/ru` and `/az` changes nav text.

## Phase 1 — Contracts and fixtures
- [x] **1.1** `lib/rules/catalog.ts` (keys, EN/RU/AZ names, severities, fines, speeding bands). — roadwise-platform §3.
- [x] **1.2** `lib/telemetry/schema.ts` (zod for `roadwise.drive.v1`) + `contracts/roadwise.drive.v1.schema.json`. — roadwise-platform §8 — check: unit tests accept the skill's example and reject unknown rule keys, bad `fields`, duplicate event ids.
- [x] **1.3** `scripts/make-fixtures.ts` → `fixtures/*.json` + `*.expected.json` (clean_drive, speeder, red_light_runner, nervous, mixed_exam_fail, progress_series_1..3). — roadwise-ai-instructor §7 — check: all fixtures validate.

## Phase 2 — Auth
- [x] **2.1** `password.ts`, `session.ts`, `rateLimit.ts` + tests (hash/verify, wrong password, expiry, renewal). — roadwise-web §5.
- [x] **2.2** Sign-up, log-in, log-out pages and server actions; `requireUser()`; protected-route redirects that return to the original page. — design skill for UI — check: sign up → `/en/profile`; log out → protected page redirects to login; wrong password shows generic error.
- [x] **2.3** Device link: `/api/device/start`, `/[locale]/link` + `approveDevice`, `/api/device/token`, `gameToken.ts`, `/api/me`. — roadwise-platform §7, roadwise-web §5–6 — check: `scripts/device-flow.sh` passes; tests for expired, double-consume and revoked tokens.

## Phase 3 — Ingest and analytics
- [x] **3.1** `metrics.ts` + one test per metric. — roadwise-ai-instructor §2 — check: fixture expectations match.
- [x] **3.2** `readiness.ts`, `history.ts` + tests. — §3–4 — check: `progress_series` shows improvements; bands match expectations.
- [x] **3.3** `lib/drives/ingest.ts`; `POST/GET /api/drives`, `GET /api/drives/:id`. — roadwise-web §6 — check: `scripts/upload.sh fixtures/speeder.json` → 200; re-upload → same id; broken file → 422.

## Phase 4 — AI instructor
- [x] **4.1** Read the current Gemini structured-output docs; `prompts/debrief.ts` (PROMPT_VERSION), `instructor.ts` with token/latency logging, locale parameter. — roadwise-ai-instructor §5 — check: `red_light_runner` debrief cites its red-light event in EN, RU and AZ. **Live check PENDING:** the `GEMINI_API_KEY` in `.env.local` is rejected by Gemini (401 UNAUTHENTICATED); run `npm run gemini:check` with a valid AI Studio key, then `npm run eval`.
- [x] **4.2** `grounding.ts` (6 checks) + retry + `fallback.ts`; wire into `after()`; regenerate route. — §6 — check: tests feed bad outputs (unknown event, unknown rule, invented number, uncovered major) and each is rejected; with `GEMINI_API_KEY` unset the drive gets a localized fallback.

## Phase 5 — Pages (design skill for every step)
- [x] **5.1** Profile: readiness + breakdown, KPI tiles, progress chart, violations by rule, exam history, drive list, devices with Revoke, language preference. — roadwise-web §8 — check: renders with 0, 1, many drives in all locales.
- [x] **5.2** Drive page: TraceMap, EventTimeline, metrics, DebriefCard, deltas, pending polling, regenerate, sample badge. — check: clicking an issue highlights its marker and timeline row.
- [x] **5.3** Landing and download pages. — check: mobile width has no horizontal scroll; all links work.

## Phase 6 — Game handoff
- [x] **6.1** Finalise `docs/GAME_INTEGRATION.md` against the implemented endpoints (copy real request/response examples from tests). — check: every endpoint and error code in the doc exists and matches.

## Phase 7 — Evidence and deploy
- [x] **7.1** `scripts/seed-demo.ts` through `ingestDrive()`. — check: demo account shows a progress story.
- [ ] **7.2** `npm run eval` → `eval/REPORT.md` + `report.json` (all measures in roadwise-ai-instructor §7, rules-only vs fallback vs AI side by side, with vs without history, failure examples, cost per debrief from logged tokens). — check: report generated from a real run, numbers not hand-written.
- [ ] **7.3** Deploy: Turso database, Vercel env vars, build command `npm run db:migrate && next build`. — check: `device-flow.sh` and `upload.sh` pass against the production URL; sign-up works there.
- [ ] **7.4** When real game drives arrive: calibrate thresholds (`eval/CALIBRATION.md`), add them to `eval/real/`, rerun eval.

## Cut lines (drop in this order if behind)
1. Landing polish. 2. Exam history table and device revoke. 3. Regenerate-in-locale. 4. With/without-history comparison.
Never cut: auth, device link, drive upload, grounded debrief + fallback, profile progress, drive page, three languages, eval report.

## Stretch
- "Ask your instructor" chat (roadwise-ai-instructor §8).
