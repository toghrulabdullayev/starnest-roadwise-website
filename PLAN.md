# Roadwise web — implementation plan

**Status:** 0.2 done. Next: 0.3 (i18n).
**Scope:** website + API + AI instructor + eval, then the learning loop (weakness profile, practice plan, quiz, adaptive exam brief; Phase 8) and the live in-game instructor (chat and voice; Phase 9). The Unity game is built by other agents; this repo only provides `docs/GAME_INTEGRATION.md` for them.

Rules for whoever executes this plan:
- Before each step, load the skills it names (`.claude/skills/roadwise-*`) and, for any UI step, the project's **design skill**.
- After each step: tick the box, update **Status** with the next step, and commit (`feat(step-id): …`). A fresh context must be able to resume from this file alone.
- Run the step's check before ticking. If a check fails, fix it before moving on.
- Do not start stretch work until every MVP box is ticked.

## Phase 0 — Scaffold
- [x] **0.1** Next.js (App Router, TS strict, ESLint) in the repo root; Vitest; zod; `@libsql/client`; `@google/genai`; Recharts; styling per design skill. `.env.example`, `.gitignore` (`data/`, `.env*.local`). — skills: roadwise-web §1–3, design — check: `npm run dev` serves a page; `npm run typecheck` green.
- [x] **0.2** `lib/db.ts`, `db/migrations/0001_init.sql`, `scripts/migrate.ts`, npm scripts `db:migrate`, `db:reset`. — roadwise-web §4 — check: migrate twice locally, second run is a no-op; tables exist.
- [ ] **0.3** i18n: `[locale]` segment, middleware redirect, `messages/{en,ru,az}.json`, `getDictionary`, language switcher in layout. — roadwise-web §7 — check: `/` → `/en`; switching to `/ru` and `/az` changes nav text.

## Phase 1 — Contracts and fixtures
- [ ] **1.1** `lib/rules/catalog.ts` (keys, EN/RU/AZ names, severities, fines, speeding bands). — roadwise-platform §3.
- [ ] **1.2** `lib/telemetry/schema.ts` (zod for `roadwise.drive.v1`) + `contracts/roadwise.drive.v1.schema.json`. — roadwise-platform §8 — check: unit tests accept the skill's example and reject unknown rule keys, bad `fields`, duplicate event ids.
- [ ] **1.3** `scripts/make-fixtures.ts` → `fixtures/*.json` + `*.expected.json` (clean_drive, speeder, red_light_runner, nervous, mixed_exam_fail, progress_series_1..3). — roadwise-ai-instructor §7 — check: all fixtures validate.

## Phase 2 — Auth
- [ ] **2.1** `password.ts`, `session.ts`, `rateLimit.ts` + tests (hash/verify, wrong password, expiry, renewal). — roadwise-web §5.
- [ ] **2.2** Sign-up, log-in, log-out pages and server actions; `requireUser()`; protected-route redirects that return to the original page. — design skill for UI — check: sign up → `/en/profile`; log out → protected page redirects to login; wrong password shows generic error.
- [ ] **2.3** Device link: `/api/device/start`, `/[locale]/link` + `approveDevice`, `/api/device/token`, `gameToken.ts`, `/api/me`. — roadwise-platform §7, roadwise-web §5–6 — check: `scripts/device-flow.sh` passes; tests for expired, double-consume and revoked tokens.

## Phase 3 — Ingest and analytics
- [ ] **3.1** `metrics.ts` + one test per metric. — roadwise-ai-instructor §2 — check: fixture expectations match.
- [ ] **3.2** `readiness.ts`, `history.ts` + tests. — §3–4 — check: `progress_series` shows improvements; bands match expectations.
- [ ] **3.3** `lib/drives/ingest.ts`; `POST/GET /api/drives`, `GET /api/drives/:id`. — roadwise-web §6 — check: `scripts/upload.sh fixtures/speeder.json` → 200; re-upload → same id; broken file → 422.
- [ ] **3.4** Mistake records: migration `0002_drive_events.sql` adds `drive_events` (`id`, `drive_id` FK cascade, `user_id`, `rule` catalog key, `severity`, `t_s`, `x`, `z`, `street_id`, `junction_id`, `mode`, `fields` JSON; indexes on `(user_id, rule)` and `(drive_id)`). `ingestDrive()` writes one row per failed check in the same transaction as the drive; re-upload replaces them, never duplicates. — roadwise-web §4, §6 — check: after `upload.sh fixtures/speeder.json` the row count equals the fixture's failed checks; re-upload keeps the count; `DELETE` of the drive removes its events.

## Phase 4 — AI instructor
- [ ] **4.1** Read the current Gemini structured-output docs; `prompts/debrief.ts` (PROMPT_VERSION), `instructor.ts` with token/latency logging, locale parameter. — roadwise-ai-instructor §5 — check: `red_light_runner` debrief cites its red-light event in EN, RU and AZ.
- [ ] **4.2** `grounding.ts` (6 checks) + retry + `fallback.ts`; wire into `after()`; regenerate route. — §6 — check: tests feed bad outputs (unknown event, unknown rule, invented number, uncovered major) and each is rejected; with `GEMINI_API_KEY` unset the drive gets a localized fallback.

## Phase 5 — Pages (design skill for every step)
- [ ] **5.1** Profile: readiness + breakdown, KPI tiles, progress chart, violations by rule, exam history, drive list, devices with Revoke, language preference. — roadwise-web §8 — check: renders with 0, 1, many drives in all locales.
- [ ] **5.2** Drive page: TraceMap, EventTimeline, metrics, DebriefCard, deltas, pending polling, regenerate, sample badge. — check: clicking an issue highlights its marker and timeline row.
- [ ] **5.3** Landing and download pages. — check: mobile width has no horizontal scroll; all links work.

## Phase 6 — Game handoff
- [ ] **6.1** Finalise `docs/GAME_INTEGRATION.md` against the implemented endpoints (copy real request/response examples from tests). — check: every endpoint and error code in the doc exists and matches.

## Phase 7 — Evidence and deploy
- [ ] **7.1** `scripts/seed-demo.ts` through `ingestDrive()`. — check: demo account shows a progress story.
- [ ] **7.2** `npm run eval` → `eval/REPORT.md` + `report.json` (all measures in roadwise-ai-instructor §7, rules-only vs fallback vs AI side by side, with vs without history, failure examples, cost per debrief from logged tokens). — check: report generated from a real run, numbers not hand-written.
- [ ] **7.3** Deploy: Turso database, Vercel env vars, build command `npm run db:migrate && next build`. — check: `device-flow.sh` and `upload.sh` pass against the production URL; sign-up works there.
- [ ] **7.4** When real game drives arrive: calibrate thresholds (`eval/CALIBRATION.md`), add them to `eval/real/`, rerun eval.

## Phase 8 — Learning loop (after every MVP box above is ticked)
Principle for every step: code computes weaknesses, scores and routes; the model only chooses wording, priorities among options code supplies, and quiz text. Every model output goes through a validator and has a deterministic fallback, as in Phase 4. The game never trusts the model for pass/fail or fines.

- [ ] **8.1** Weakness profile: `lib/profile/focus.ts` aggregates `drive_events` into per-rule weights (recent drives weigh more, resolved weaknesses decay) and exposes `GET /api/me/focus` (Bearer or session) returning `[{ rule, weight, count, last_seen, trend }]`. Pure code, no model. — roadwise-ai-instructor §3–4 — check: `progress_series_1..3` give a falling weight for the rule that improves; a user with no drives gets an empty list.
- [ ] **8.2** Learning plan: migration `0003_learning.sql` adds `practice_plans` (`id`, `user_id`, `locale`, `focus` JSON, `plan` JSON, `status`, `model`, `prompt_version`, token/latency columns, `validation_errors`, `created_at`). `lib/learning/plan.ts` asks the model to order the weakness rules and write a short explanation per rule; it returns rule keys and tag priorities only, never locations. Validator: every rule is a catalog key present in the focus input, every number appears in the input, fallback orders by weight. `POST /api/me/plan`, `GET /api/me/plan/latest`. — roadwise-ai-instructor §5–6 — check: tests reject an unknown rule and an invented number; with `GEMINI_API_KEY` unset the plan comes from the fallback in all three locales.
- [ ] **8.3** Practice-route contract: define `contracts/roadwise.roadcatalog.v1.schema.json`, the tagged junction and segment catalog the game exports (`id`, `kind`, `tags` as rule keys, `x`, `z`). `POST /api/game/roadcatalog` stores it per game version; `GET /api/me/plan/latest` includes the plan's rule keys so the game picks real locations itself. The website never invents location ids. — roadwise-platform §8 — check: schema tests accept a sample and reject unknown rule tags; documented in `docs/GAME_INTEGRATION.md`.
- [ ] **8.4** Quiz: migration `0004_quiz.sql` adds `quiz_questions` (`id`, `rule`, `locale`, `body` JSON, `source` `bank`/`generated`, `prompt_version`), `quiz_attempts`, `quiz_answers`. Seed `fixtures/quiz_bank.json` (hand-written, reviewed questions per catalog rule, EN/RU/AZ). `lib/quiz/generate.ts` builds a set from the focus weights plus a random general share, and may ask the model for extra questions from catalog text only. Validator: exactly one correct option, no duplicate options or questions, `rule` is a catalog key, explanation cites that rule. `GET /api/quiz/next`, `POST /api/quiz/answer`; wrong answers are stored in `quiz_answers` and counted into the 8.1 weights as a smaller signal than real drive faults. — roadwise-ai-instructor §6 — check: tests reject two correct options, a duplicate and an unknown rule; a user weak in `red_light` gets mostly red-light questions; with the key unset the bank alone still works.
- [ ] **8.5** Adaptive exam: `lib/exam/adaptive.ts` turns the focus weights into an exam brief `{ focus_rules, difficulty, target_length_m }` with no model needed; the game builds the route from its own graph. `GET /api/me/exam-brief`. After each exam drive, `lib/profile/compare.ts` records improved, same or worse per focus rule against the previous brief. — roadwise-ai-instructor §4 — check: a fixture user who fixes a weakness gets "improved" and a lower weight in the next brief.
- [ ] **8.6** Pages (design skill): Plan card and quiz on the profile, quiz page, "next exam focus" card, per-rule improvement badges. — roadwise-web §8 — check: renders with no data, one drive and many drives in all locales.
- [ ] **8.7** Eval: extend `npm run eval` with plan validity and grounding, quiz validity and wrong-answer rate, and brief correctness against the expected weaknesses. — roadwise-ai-instructor §7 — check: numbers appear in `eval/REPORT.md` from a real run.

## Phase 9 — Live instructor (needs the game to send a context snapshot)
- [ ] **9.1** `POST /api/chat` (Bearer for the game, session for the website): input is the question plus a snapshot `{ mode, speed_kmh, limit_kmh, street_id, next_sign, recent_faults }` validated by zod; the context also includes the user's focus weights and rules glossary. Answer is one or two sentences in the user's locale citing rule keys. In `mode: "exam"` the prompt allows directions only and refuses rule hints. Validator: rule keys are catalog keys, numbers appear in the snapshot or catalog; fallback is a short canned answer. Rate limit per user. — roadwise-ai-instructor §8 — check: tests for exam-mode refusal, unknown rule key and rate limit; unset key returns the canned answer.
- [ ] **9.2** Streaming: stream the answer to the game and log first-token latency. — check: p50 first token is recorded in logs; the game can show partial text.
- [ ] **9.3** Voice: audio question in, audio answer out through the Gemini audio features, behind a flag. Read the current Gemini audio docs first; record latency and cost per exchange. — check: a recorded question returns a spoken answer in EN, RU and AZ; the AZ output is flagged for native review.
- [ ] **9.4** Update `docs/GAME_INTEGRATION.md` with the snapshot, focus, plan, road catalog, exam brief and chat contracts, with real examples from tests. — check: every endpoint and error code in the doc exists.

## Cut lines (drop in this order if behind)
1. Landing polish. 2. Exam history table and device revoke. 3. Regenerate-in-locale. 4. With/without-history comparison. 5. Voice (9.3). 6. Streaming (9.2).
Never cut: auth, device link, drive upload, mistake records (3.4), grounded debrief + fallback, profile progress, drive page, three languages, eval report.
