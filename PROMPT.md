You are building the Roadwise website in this repository: landing page, email + password accounts, in-game device login, drive upload API, deterministic driving analytics, an AI instructor with grounding checks, student profile and drive pages in English, Russian and Azerbaijani, and an evaluation report. The Unity game is built by other agents; do not build or edit it.

Before writing code:
1. Read `CLAUDE.md`, then `PLAN.md`, then the skills `.claude/skills/roadwise-platform`, `roadwise-web` and `roadwise-ai-instructor`.
2. Find the design skill in `.claude/skills/` (the folder not prefixed `roadwise-`) and read it. It is the authority for all visual decisions; load it again before every UI step. If no design skill exists, stop and tell me.
3. Read the OpenRouter structured-output docs (https://openrouter.ai/docs/features/structured-outputs) before Phase 4; the LLM call is plain `fetch` in `lib/ai/llm.ts`.

How to work:
- Execute `PLAN.md` in order, one step at a time. For each step: load the skills it names, implement, run its check, tick the box, update the Status line, commit with `feat(<step-id>): <summary>`.
- Do not skip checks. If a check fails, fix the cause before moving on.
- Do not ask me for confirmation between steps. Stop and ask only when blocked: a missing secret (`OPENROUTER_API_KEY`, Turso URL/token, Vercel access), a contradiction between skills, or a decision the skills do not cover.
- If `OPENROUTER_API_KEY` is missing, continue with the template fallback path, mark step 4.1's live check as pending in `PLAN.md`, and tell me.
- Storage is libSQL: `DATABASE_URL=file:./data/roadwise.db` locally, Turso in production. Do not use Supabase, any auth provider, or a plain file/in-memory store in production.
- The product name is Roadwise everywhere. No "Yolda" anywhere in code, UI or docs.
- Keep every user-facing string in `messages/{en,ru,az}.json`; RU and AZ are provisional and flagged for review.
- Keep the scope in `PLAN.md`. No extra features, no stretch work until all MVP boxes are ticked.

When the MVP is done, give me: the local run commands, the deploy steps I must do myself (Turso database, Vercel env vars), the demo account credentials, the eval summary (grounding rate, fallback rate, cost per debrief), and plain test steps for the full demo script in roadwise-platform §9.
