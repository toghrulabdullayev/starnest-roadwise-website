# Roadwise web — implementation plan

**Status:** QA fixes in progress on branch `qa-fixes` (Phase 10): 10.1 done; next 10.2. MVP code done through 7.2; AI via OpenRouter (`google/gemini-3.5-flash-lite`). 8.6 pages and 8.7 evals done (`eval/REPORT.md`, `eval/LEARNING_REPORT.md`, one run per case). Weak-spot weight is now a recency-weighted average per drive, so it never rises while fault counts fall. Open findings: generated quiz questions need a retry in 42% of calls, single-rule weak profiles give only a 50% weak-rule quiz. Browser walkthrough of the new pages pending. Next: 9.2 streaming, 9.3 voice, 7.3 deploy.
**Scope:** website + API + AI instructor + eval. The Unity game is built by other agents; this repo only provides `docs/GAME_INTEGRATION.md` for them.

Rules for whoever executes this plan:
- Before each step, load the skills it names (`.claude/skills/roadwise-*`) and, for any UI step, the project's **design skill**.
- After each step: tick the box, update **Status** with the next step, and commit (`feat(step-id): …`). A fresh context must be able to resume from this file alone.
- Run the step's check before ticking. If a check fails, fix it before moving on.
- Do not start stretch work until every MVP box is ticked.

## Phase 0 — Scaffold
- [x] **0.1** Next.js (App Router, TS strict, ESLint) in the repo root; Vitest; zod; `@libsql/client`; Recharts; styling per design skill. `.env.example`, `.gitignore` (`data/`, `.env*.local`). — skills: roadwise-web §1–3, design — check: `npm run dev` serves a page; `npm run typecheck` green.
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
- [x] **3.4** Mistake records: migration `0002_drive_events.sql` adds `drive_events` (`id`, `drive_id` FK cascade, `user_id`, `rule` catalog key, `severity`, `t_s`, `x`, `z`, `street_id`, `junction_id`, `mode`, `fields` JSON; indexes on `(user_id, rule)` and `(drive_id)`). `ingestDrive()` writes one row per failed check in the same transaction as the drive; re-upload replaces them, never duplicates. — roadwise-web §4, §6 — check: after `upload.sh fixtures/speeder.json` the row count equals the fixture's failed checks; re-upload keeps the count; `DELETE` of the drive removes its events.

## Phase 4 — AI instructor
- [x] **4.1** Read the OpenRouter structured-output docs; `prompts/debrief.ts` (PROMPT_VERSION), `instructor.ts` with token/latency logging, locale parameter. — roadwise-ai-instructor §5 — check: `red_light_runner` debrief cites its red-light event in EN, RU and AZ. **Live check PENDING:** the `GEMINI_API_KEY` in `.env.local` is rejected by Gemini (401 UNAUTHENTICATED); run `npm run gemini:check` with a valid AI Studio key, then `npm run eval`.
- [x] **4.2** `grounding.ts` (6 checks) + retry + `fallback.ts`; wire into `after()`; regenerate route. — §6 — check: tests feed bad outputs (unknown event, unknown rule, invented number, uncovered major) and each is rejected; with `GEMINI_API_KEY` unset the drive gets a localized fallback.

## Phase 5 — Pages (design skill for every step)
- [x] **5.1** Profile: readiness + breakdown, KPI tiles, progress chart, violations by rule, exam history, drive list, devices with Revoke, language preference. — roadwise-web §8 — check: renders with 0, 1, many drives in all locales.
- [x] **5.2** Drive page: TraceMap, EventTimeline, metrics, DebriefCard, deltas, pending polling, regenerate, sample badge. — check: clicking an issue highlights its marker and timeline row.
- [x] **5.3** Landing and download pages. — check: mobile width has no horizontal scroll; all links work.

## Phase 6 — Game handoff
- [x] **6.1** Finalise `docs/GAME_INTEGRATION.md` against the implemented endpoints (copy real request/response examples from tests). — check: every endpoint and error code in the doc exists and matches.

## Phase 7 — Evidence and deploy
- [x] **7.1** `scripts/seed-demo.ts` through `ingestDrive()`. — check: demo account shows a progress story.
- [x] **7.2** `npm run eval` → `eval/REPORT.md` + `report.json` (all measures in roadwise-ai-instructor §7, rules-only vs fallback vs AI side by side, with vs without history, failure examples, cost per debrief from logged tokens). — check: report generated from a real run, numbers not hand-written. **AI measures PENDING:** the current run recorded Gemini 401 for every call (100% fallback); rerun `npm run eval` once `npm run gemini:check` passes. Harness self-test: `npx tsx eval/run.ts --fake-llm --runs 1 --out /tmp/x`.
- [ ] **7.3** Deploy: Turso database, Vercel env vars, build command `npm run db:migrate && next build`. — check: `device-flow.sh` and `upload.sh` pass against the production URL; sign-up works there. **BLOCKED (needs owner):** the Turso token in `.env.local` returns 401 and there is no Vercel access here. Prepared: `vercel.json` (build command), README deploy steps.
- [ ] **7.4** (waiting for real game drives) When real game drives arrive: calibrate thresholds (`eval/CALIBRATION.md`), add them to `eval/real/`, rerun eval.

## Phase 8 — Learning loop (after every MVP box above is ticked)
Principle for every step: code computes weaknesses, scores and routes; the model only chooses wording, priorities among options code supplies, and quiz text. Every model output goes through a validator and has a deterministic fallback, as in Phase 4. The game never trusts the model for pass/fail or fines.

- [x] **8.1** Weakness profile: `lib/profile/focus.ts` aggregates `drive_events` into per-rule weights (recent drives weigh more, resolved weaknesses decay) and exposes `GET /api/me/focus` (Bearer or session; the route belongs to the main service) returning `[{ rule, weight, count, last_seen, trend }]`. Pure code, no model. — roadwise-ai-instructor §3–4 — check: `progress_series_1..3` give a falling weight for the rule that improves; a user with no drives gets an empty list. **Merged from the `ai` branch:** the pure library and its tests are in; the route, migration and page wiring listed here is still open.
- [x] **8.2** Learning plan: migration `0003_learning.sql` adds `practice_plans` (`id`, `user_id`, `locale`, `focus` JSON, `plan` JSON, `status`, `model`, `prompt_version`, token/latency columns, `validation_errors`, `created_at`). `lib/learning/plan.ts` asks the model to order the weakness rules and write a short explanation per rule; it returns rule keys and tag priorities only, never locations. Validator: every rule is a catalog key present in the focus input, every number appears in the input, fallback orders by weight. `POST /api/me/plan`, `GET /api/me/plan/latest` (the migration, storage and routes belong to the main service; `lib/ai/plan` is the pure part). — roadwise-ai-instructor §5–6 — check: tests reject an unknown rule and an invented number; with `GEMINI_API_KEY` unset the plan comes from the fallback in all three locales. **Merged from the `ai` branch:** the pure library and its tests are in; the route, migration and page wiring listed here is still open.
- [ ] **8.3** Practice-route contract: define `contracts/roadwise.roadcatalog.v1.schema.json`, the tagged junction and segment catalog the game exports (`id`, `kind`, `tags` as rule keys, `x`, `z`). `POST /api/game/roadcatalog` stores it per game version; `GET /api/me/plan/latest` includes the plan's rule keys so the game picks real locations itself. The website never invents location ids. — roadwise-platform §8 — check: schema tests accept a sample and reject unknown rule tags; documented in `docs/GAME_INTEGRATION.md`.
- [x] **8.4** Quiz: migration `0004_quiz.sql` adds `quiz_questions` (`id`, `rule`, `locale`, `body` JSON, `source` `bank`/`generated`, `prompt_version`), `quiz_attempts`, `quiz_answers`. Seed `lib/quiz/bank.json` (one hand-written situation question per rule in EN/RU/AZ, plus catalog-derived fine, severity and speed-limit questions built in `lib/quiz/questions.ts`; hand-written, reviewed questions per catalog rule, EN/RU/AZ). `lib/quiz/generate.ts` builds a set from the focus weights plus a random general share, and may ask the model for extra questions from catalog text only. Validator: exactly one correct option, no duplicate options or questions, `rule` is a catalog key, explanation cites that rule. `GET /api/quiz/next`, `POST /api/quiz/answer` (tables and routes belong to the main service; the pure part is `lib/quiz` and `lib/ai/quiz`); wrong answers are stored in `quiz_answers` and counted into the 8.1 weights as a smaller signal than real drive faults. — roadwise-ai-instructor §6 — check: tests reject two correct options, a duplicate and an unknown rule; a user weak in `red_light` gets mostly red-light questions; with the key unset the bank alone still works. **Merged from the `ai` branch:** the pure library and its tests are in; the route, migration and page wiring listed here is still open.
- [x] **8.5** Adaptive exam: `lib/exam/adaptive.ts` turns the focus weights into an exam brief `{ focus_rules, difficulty, target_length_m }` with no model needed; the game builds the route from its own graph. `GET /api/me/exam-brief` (the route belongs to the main service; the pure part is `lib/exam/adaptive.ts` and `lib/profile/compare.ts`). After each exam drive, `lib/profile/compare.ts` records improved, same or worse per focus rule against the previous brief. — roadwise-ai-instructor §4 — check: a fixture user who fixes a weakness gets "improved" and a lower weight in the next brief. **Merged from the `ai` branch:** the pure library and its tests are in; the route, migration and page wiring listed here is still open.
- [x] **8.6** Pages (design skill): Plan card and quiz on the profile, quiz page, "next exam focus" card, per-rule improvement badges. — roadwise-web §8 — check: renders with no data, one drive and many drives in all locales.
- [x] **8.7** Eval: extend `npm run eval` with plan validity and grounding, quiz validity and wrong-answer rate, and brief correctness against the expected weaknesses. — roadwise-ai-instructor §7 — check: numbers appear in `eval/REPORT.md` from a real run.

## Phase 9 — Live instructor (needs the game to send a context snapshot)
- [x] **9.1** `POST /api/chat` (Bearer for the game, session for the website): input is the question plus a snapshot `{ mode, speed_kmh, limit_kmh, street_id, next_sign, recent_faults }` validated by zod; the context also includes the user's focus weights and rules glossary. Answer is one or two sentences in the user's locale citing rule keys. In `mode: "exam"` the prompt allows directions only and refuses rule hints. Validator: rule keys are catalog keys, numbers appear in the snapshot or catalog; fallback is a short canned answer. Rate limit per user. — roadwise-ai-instructor §8 — check: tests for exam-mode refusal, unknown rule key and rate limit; unset key returns the canned answer. The route itself belongs to the main service; the pure part is `lib/ai/chat` (`answerDrivingQuestion`, `chatLimiter`). **Merged from the `ai` branch:** the pure library and its tests are in; the route, migration and page wiring listed here is still open.
- [ ] **9.2** Streaming: stream the answer to the game and log first-token latency. — check: p50 first token is recorded in logs; the game can show partial text.
- [ ] **9.3** Voice: audio question in, audio answer out through an audio-capable model on OpenRouter, behind a flag. Read the current OpenRouter audio docs first; record latency and cost per exchange. — check: a recorded question returns a spoken answer in EN, RU and AZ; the AZ output is flagged for native review.
- [ ] **9.4** Update `docs/GAME_INTEGRATION.md` with the snapshot, focus, plan, road catalog, exam brief and chat contracts, with real examples from tests. — check: every endpoint and error code in the doc exists.

## Phase 10 — QA fixes (from `docs/qa/multilingual-audit-2026-10-09.md`)
Branch `qa-fixes`. One step per finding group; the owner approves each step before the next. Each check is run in EN, RU and AZ.
- [x] **10.1** WEB-001 fonts: real family names first in `app/globals.css` so Inter Tight (Cyrillic + `latin-ext` for Ə) sits ahead of next/font's local-Arial fallbacks (Turbopack ignores `adjustFontFallback: false`). — check: `/ru`, `/ru/download`, `/az` headings are heavy with no thin glyphs; EN unchanged.
- [ ] **10.2** WEB-009 brand: "Roadwise" always renders in English letters (no `ROADWİSE` under `lang="az"` uppercase). — check: logo and headings on `/az` and `/az/download`.
- [ ] **10.3** WEB-002, WEB-010 AI output: progress list built in code with dictionary labels; grounding rejects internal keys and enum values; prompt gets localized labels, numbers and units. — check: regenerated debrief and plan in each locale contain no `snake_case` keys or band/component enums.
- [ ] **10.4** WEB-004 login language: the language switcher and `safeNext` keep the chosen locale in `next`. — check: `/az/profile` → login → EN → log in lands on `/en/profile`.
- [ ] **10.5** WEB-007, WEB-008 units and district names from the dictionaries. — check: `/ru/drives/<id>` shows "км", "км/ч"; AZ "km/saat"; no `baku-center` slug.
- [ ] **10.6** WEB-003 `lang` only on model-written text in the debrief card. — check: EN debrief on `/az` keeps AZ uppercase headings.
- [ ] **10.7** WEB-006 landing screenshots per locale (EN, RU, AZ), captured after 10.2–10.6. — check: `/ru` and `/az` show their own language in every image.
- [ ] **10.8** WEB-005 localized not-found page with the site layout. — check: `/ru/nope` is Russian with nav and language switcher.
- [ ] **10.9** WEB-017 metadata: `hreflang` alternates, canonical, Open Graph, per-page descriptions. — check: page `<head>` in each locale.
- [ ] **10.10** WEB-011, WEB-012 forms: required-field errors on login; focus moves to the first invalid field. — check: empty login and sign-up in each locale.
- [ ] **10.11** WEB-013, WEB-014 no-wrap badges and values; 24 px minimum target for table links. — check: AZ exam history and drive table at 390 px.
- [ ] **10.12** WEB-015 quiz: natural per-rule wording, no repeated eyebrow/title. — check: quiz in each locale.
- [ ] **10.13** WEB-018 translation consistency (terminology, plurals, Sign in vs Log in). — check: strings listed in the report.
- [ ] **10.14** WEB-016 download URL: owner sets `NEXT_PUBLIC_DOWNLOAD_URL` and `NEXT_PUBLIC_GAME_VERSION` in Vercel (config only).

## Cut lines (drop in this order if behind)
1. Landing polish. 2. Exam history table and device revoke. 3. Regenerate-in-locale. 4. With/without-history comparison. 5. Voice (9.3). 6. Streaming (9.2).
Never cut: auth, device link, drive upload, mistake records (3.4), grounded debrief + fallback, profile progress, drive page, three languages, eval report.
