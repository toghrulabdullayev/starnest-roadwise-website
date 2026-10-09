# Roadwise web — project memory

Website, API and AI instructor for **Roadwise**, a Baku driving-school simulator (Unity game built separately by other agents).

- Start every session by reading `PLAN.md` (the **Status** line says what is next).
- Skills: `roadwise-platform` (product, game facts, contracts, rule catalog) → then `roadwise-web` or `roadwise-ai-instructor`. All UI follows the project's design skill in `.claude/skills/`.
- Stack: Next.js App Router on Vercel · libSQL (local file in dev, Turso in prod) · own email+password session auth · Gemini · EN/RU/AZ.
- Never: commit secrets or `data/`; let the LLM produce numbers; invent rule keys; edit the game.
- One step at a time; check → tick → update Status → commit.
- Finish each session with how to test what changed, in plain steps.
