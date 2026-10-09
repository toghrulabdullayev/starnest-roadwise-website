---
name: roadwise-platform
description: Read first for any Roadwise work — what the Roadwise game is (Baku driving simulator, Unity), product scope for the hackathon, judging criteria, architecture, the canonical rule catalog, and the two contracts shared by the game and the website (device-link login, drive telemetry v1). Then load roadwise-web or roadwise-ai-instructor for the area you are touching.
---

# Roadwise — platform overview

## 1. Product

**Roadwise** is a driving-school simulator set in Baku, Azerbaijan, with an AI instructor and analytics. The student drives a 3D city that enforces real Azerbaijani traffic rules. The game records each drive (rules followed and broken, speed, braking, steering). The website turns that into measured driving metrics, an AI instructor debrief, cross-drive progress and an exam-readiness score in the student's personal profile.

- Single player. One user type: the **student driver**.
- Desktop game download; login on the website and inside the game (browser-based device link).
- Website languages: **English (default), Russian, Azerbaijani.**

## 2. The game (context only — the web project never edits it)

- Built in **Unity 6** by other AI agents in a separate repository. The website team only consumes its uploads through Contract B and gives it Contract A.
- Baku city streets from OpenStreetMap; right-hand traffic; units km/h, metres, AZN.
- **Modes:** *Free drive* (sandbox with live fines) and *Exam* (checkpoint routes; a major fault fails instantly, minor faults accumulate; currently 2 minor faults allowed).
- An "examiner" system detects: speeding, red lights, STOP lines, pedestrian crossings, wrong way on one-way streets, give-way, collisions. Fines follow real İXM (Administrative Offences Code) rates; some are provisional.
- Positions are reported in **map metres**: +x east, +z south (SVG-friendly, no flip).

## 3. Rule catalog (canonical keys — the game must emit exactly these)

| key | EN | RU | AZ | fail severity | fine AZN |
|---|---|---|---|---|---|
| `speeding` | Speeding | Превышение скорости | Sürət həddinin aşılması | by band | by band |
| `red_light` | Running a red light | Проезд на красный свет | Qırmızı işıqda keçmə | major | 100 |
| `stop_sign` | Not stopping at STOP | Непроезд знака «STOP» без остановки | STOP nişanında dayanmamaq | minor | 40 |
| `pedestrian_crossing` | Not yielding to pedestrians | Непредоставление преимущества пешеходам | Piyadalara yol verməmək | minor | 50 |
| `wrong_way` | Wrong way on a one-way street | Движение во встречном направлении по односторонней дороге | Birtərəfli yolda əks istiqamətdə hərəkət | major | 150 |
| `give_way` | Not giving way | Непредоставление преимущества | Yol verməmək | major | 100 (provisional) |
| `collision` | Collision | Столкновение | Toqquşma | major | 100 (provisional) |

Speeding bands (over the posted limit; trigger above +11 km/h): +11–20 → 10 AZN minor · +21–40 → 50 minor · +41–60 → 200 major · +61+ → 300 major. Limits: living zone 20, city 60, outside built-up 90, motorway 110.

RU/AZ names are provisional pending native review. The web project stores this table in `lib/rules/catalog.ts` and the AI grounding validator rejects any other key.

## 4. Hackathon context (drives scope)

AI Gaming + AI Enterprise tracks. Round 1 is scored by GPT and Claude reading the project; the finals by a human jury on the same card. Goal: **a working end-to-end scenario with real results**, no over-engineering.

| Criterion | Pts | Evidence Roadwise provides |
|---|---|---|
| Value for the user | 25 | Learners get objective, rule-specific feedback after every drive and know whether they are exam-ready. |
| Prototype + use of AI | 30 | Live: drive → upload → AI debrief in game and on web. AI explains, prioritises, compares drives, plans the next one; all numbers come from deterministic code. |
| Quality testing | 20 | Unit tests on metrics; AI eval harness (schema validity, grounding rate, hallucinated references, major-fault recall); real failure examples; comparison vs rules-only baseline (what the game shows today). |
| Feasibility | 15 | Data = telemetry the game already produces; measured tokens and cost per debrief; free hosting tiers; clear next step. |
| Originality | 10 | Real Baku streets + real İXM fines + an instructor that cites the exact moment and rule. |

## 5. Scope

**MVP:** landing · sign up / log in (own email + password sessions) · download page · in-game login via device link · drive upload · deterministic metrics + readiness · LLM debrief (structured, grounded, with fallback) · profile with progress · drive detail page with trace map, timeline, debrief · EN/RU/AZ · eval report.
**Stretch:** "Ask your instructor" chat grounded in the user's drives.
**Out:** live LLM calls while driving, biometrics, payments, mobile, multi-role accounts, microservices.

## 6. Architecture

```
Unity game ── POST /api/device/start ─► opens browser /{locale}/link?code=ABCD-EFGH ─► user authorises
           ── POST /api/device/token (poll) ─► rw_ game token
           ── POST /api/drives (Bearer) ─► metrics + readiness now, AI debrief async
           ── GET  /api/drives/:id ─► debrief for the end-of-drive screen

Vercel: Next.js (App Router, TypeScript) — website + API
  lib/auth      email+password, scrypt, DB-backed session cookie, game tokens
  lib/db        libSQL (SQLite): local file in dev, Turso in production
  lib/metrics   deterministic, tested
  lib/readiness deterministic score with breakdown
  lib/instructor LLM (OpenRouter) → JSON debrief → grounding validator → fallback
Game installers: GitHub Releases (link only)
```

Rule: **the LLM never computes numbers.** It explains and prioritises numbers produced by code, citing event ids and rule keys that exist in its input.

## 7. Contract A — device-link login

1. `POST /api/device/start` `{ "client": "roadwise-unity", "client_version": "0.1.0" }`
   → `{ "device_code": "<random>", "user_code": "ABCD-EFGH", "verify_url": "https://<site>/en/link?code=ABCD-EFGH", "interval": 3, "expires_in": 600 }`
2. Game opens `verify_url` in the system browser and shows `user_code`.
3. User logs in if needed, clicks **Authorise this device**.
4. Game polls `POST /api/device/token` `{ "device_code": "..." }` every `interval` s:
   `400 {"error":"authorization_pending"}` · `400 {"error":"expired_token"}` · `400 {"error":"invalid_grant"}` · `200 {"access_token":"rw_...","token_type":"Bearer","user":{"id","display_name","locale"}}`
5. Game sends `Authorization: Bearer rw_...` on every game call; `GET /api/me` validates it.

Server stores only SHA-256 hashes of device codes and tokens.

## 8. Contract B — drive telemetry v1

One JSON per drive, uploaded once at the end (client keeps it on disk and retries if offline).

```json
{
  "schema": "roadwise.drive.v1",
  "client": { "name": "roadwise-unity", "version": "0.1.0" },
  "drive": {
    "client_drive_id": "uuid-v4",
    "mode": "free",
    "district": "baku-center",
    "route_id": null,
    "car_type": "sedan",
    "time_of_day": "day",
    "started_at": "2026-10-09T15:00:00Z",
    "duration_s": 412.6,
    "distance_m": 3120.4,
    "exam": null
  },
  "samples": {
    "hz": 5,
    "fields": ["t", "x", "z", "speed_kmh", "limit_kmh", "throttle", "brake", "steer", "handbrake"],
    "rows": [[0.0, 12.3, -40.1, 0.0, 60, 0.0, 0.0, 0.0, 0]]
  },
  "events": [
    { "id": "e1", "t": 34.2, "type": "rule_check", "rule": "stop_sign", "outcome": "pass", "x": 80.1, "z": -12.0, "street": "Nizami küç." },
    { "id": "e2", "t": 51.0, "type": "rule_check", "rule": "speeding", "outcome": "fail", "severity": "minor", "fine_azn": 50, "x": 140.0, "z": -15.2, "street": "Bakıxanov küç.", "detail": { "speed_kmh": 84, "limit_kmh": 60 } },
    { "id": "e3", "t": 77.4, "type": "rule_check", "rule": "collision", "outcome": "fail", "severity": "major", "fine_azn": 100, "x": 210.0, "z": -30.0, "detail": { "with": "building" } },
    { "id": "e4", "t": 90.0, "type": "checkpoint", "index": 3 }
  ]
}
```

- `mode`: `free | exam`. `exam` (exam mode only): `{ "passed": bool, "minor_faults": int, "major_faults": int, "checkpoints_reached": int, "checkpoints_total": int }`.
- `time_of_day`: `day | dusk | night`. `throttle`, `brake` 0..1; `steer` −1..1; `handbrake` 0/1. `rows` follow `fields` order.
- `rule_check` **includes passes** (stopped at STOP, waited at red, yielded, gave way) — "rules followed" is a headline metric.
- Event `id`s unique per drive. `rule` ∈ catalog keys. `street` optional.
- Server validates with zod and answers `422 { "issues": [...] }` on mismatch. Upload is idempotent on `client_drive_id`.

The full integration guide for the game agents lives in `docs/GAME_INTEGRATION.md`.

## 9. Demo script (definition of done)

1. Landing → sign up → empty profile.
2. Download → game → **Log in** → browser `/link` → Authorise → game shows "Signed in as …".
3. Drive (run one red light, speed once) → end screen shows the AI debrief within ~10 s, citing the red light by time and street.
4. Profile: new drive on top, progress chart moved, readiness score with breakdown, trace map with fault markers.
5. Switch language EN → RU → AZ; UI and new debriefs follow.
6. Show the eval report: tests, grounding rate, a real failure the validator caught.

## 10. Working rules

- Naming: the product is **Roadwise** everywhere (code, UI, env vars, token prefix `rw_`, schema `roadwise.drive.v1`).
- Contracts change only by bumping the schema version and updating fixtures, validation and `docs/GAME_INTEGRATION.md` together.
- Never commit secrets or the local database file.
- Honest labels: "composure (from driving signals)", never "stress measured"; seeded data shows a "sample data" badge.
