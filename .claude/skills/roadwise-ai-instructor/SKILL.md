---
name: roadwise-ai-instructor
description: Use when working on Roadwise analytics and AI — deterministic driving metrics, the exam-readiness score, cross-drive history, the LLM debrief (prompt, JSON schema, grounding validator, retry, template fallback), EN/RU/AZ output, token and cost logging, and the evaluation harness that produces the quality-testing evidence. Assumes roadwise-platform is loaded.
---

# Roadwise — metrics and AI instructor

## 1. Pipeline (server-side, `lib/`)

```
upload ─► zod validate ─► metrics.ts ─► readiness.ts ─► history.ts ─► instructor.ts ─► grounding.ts ─► store
                          pure + tested   pure + tested   previous ≤4     LLM             reject → 1 retry → fallback.ts
```

- `POST /api/drives` runs validate → metrics → readiness → history synchronously and returns them. The debrief runs inside `after()` (from `next/server`) and is read with `GET /api/drives/:id` (`status: pending | ready | fallback | error`).
- Everything except `instructor.ts` is pure and deterministic.

## 2. Metrics (`lib/metrics.ts`)

Thresholds live in one `METRIC_CONFIG`; defaults are **starting values to calibrate** on real drives (the car is arcade-kinematic). Record calibration in `eval/CALIBRATION.md`. "Moving" = speed > 2 km/h.

| Group | Metric | Definition |
|---|---|---|
| Rules | `checks_total`, `checks_passed`, `compliance_rate` | `rule_check` events; rate = passed/total, null if 0 |
| Rules | `violations_by_rule` | `{ rule: { count, fines_azn } }` |
| Rules | `fines_total_azn`, `major_count`, `minor_count` | failed checks |
| Speed | `overspeed_time_share` | share of moving time with speed > limit + 11 |
| Speed | `mean_overspeed_kmh`, `avg_speed_kmh`, `max_speed_kmh` | moving samples |
| Smoothness | `harsh_brake_count`, `harsh_accel_count` | Δv/Δt beyond ±3.5 m/s², 1 s debounce |
| Smoothness | `jerk_rms` | RMS of d²v/dt² while moving |
| Control | `steer_reversals_per_min` | steer sign changes with |Δ| > 0.3 per moving minute |
| Control | `collisions`, `handbrake_uses` | |
| Composure | `hesitation_stops` | stops (< 1 km/h, ≥ 1.5 s) with no rule_check within 15 m / 3 s |
| Composure | `speed_cv` | std/mean of moving speed |
| Composure | `composure_index` 0–100 | 100 − weighted penalties (harsh events/min, reversals/min, hesitation stops, speed_cv). UI label: "Composure (from driving signals)". |
| Exam | `exam` | copied from upload |
| Context | `duration_s`, `distance_m`, `moving_time_s`, `mode`, `district` | |

One unit test per metric on a tiny hand-built sample array.

## 3. Readiness score (`lib/readiness.ts`)

Deterministic and explainable. Input: metrics of the latest ≤5 drives, weights 0.35/0.25/0.2/0.12/0.08 renormalised.

```
score = 100
  − 25 × majors per drive − 8 × minors per drive
  − 30 × (1 − compliance_rate) − 20 × overspeed_time_share
  − 2 × harsh events per 10 min − 0.15 × (100 − composure_index)
  + 5 if the latest exam drive passed
clamp 0..100 · bands: <50 not_ready · 50–74 almost · ≥75 ready
```

Return `{ score, band, components: [{ key, value, points }] }`; the UI renders the breakdown with translated labels.

## 4. History (`lib/history.ts`)

Current drive vs mean of up to 4 previous drives: compliance_rate, fines, overspeed share, harsh events/10 min, composure, per-rule counts. Each delta: `improved | worse | same` with a minimum-change threshold. First drive → `null`.

## 5. LLM debrief (`lib/instructor/`; the shared call is `lib/ai/llm.ts`)

- Provider: OpenRouter chat completions through plain `fetch` (no SDK) with `response_format: json_schema` (`strict: false`, `provider.require_parameters: true`; our zod validators are the real check). Model `google/gemini-3.5-flash-lite`; `reasoning.effort` is `low` (`minimal` for the live chat). Live runs: `npm run ai:check`, `npm run ai:live -- en|ru|az`.
- Env: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
- Temperature 0.2. Log `model, prompt_version, input_tokens, output_tokens, latency_ms, attempts` per call. Cost per debrief = logged tokens × the model price on the OpenRouter models page; never hard-code prices.

**Input** (never raw samples, email or name): context, metrics, readiness breakdown, history deltas, events trimmed to failed checks + up to 10 passes (`id, time mm:ss, rule, outcome, severity, street, detail`), and a rules glossary for the rules present (key, localized name, fine, severity).

**System prompt (core, `lib/prompts/debrief.ts`, `PROMPT_VERSION`):**
> You are a calm, precise driving instructor in Baku preparing a student for the driving exam. Use only the data provided. Every issue must cite at least one event id from `events` and one rule key from `rules`. Never compute or invent numbers; quote numbers only as they appear in the input. Order issues by safety: major before minor, repeated before one-off. Give concrete, actionable advice. Write all text in {language: English | Russian | Azerbaijani}. Output JSON only.

**Output schema:**
```json
{
  "summary": "2–3 sentences",
  "strengths": [{ "text": "...", "event_ids": ["e1"] }],
  "issues": [{ "title": "...", "severity": "major|minor", "rule": "red_light", "event_ids": ["e2"], "why_it_matters": "...", "how_to_fix": "..." }],
  "progress": { "improved": ["..."], "worse": ["..."] },
  "next_drive": { "focus": "...", "mode": "free|exam", "drills": ["..."] },
  "readiness_comment": "explains the given score via its components"
}
```
`progress` is `null` on the first drive.

**Language:** generated in the user's `locale` at upload time; the drive page offers "Regenerate in <current language>" when they differ. Store debriefs keyed by `(drive_id, locale)`.

## 6. Grounding validator (`lib/grounding.ts`)

Reject → one retry with the error list appended → template fallback, if:
1. JSON fails the zod schema.
2. An `event_ids` entry is not in the drive's events.
3. A `rule` is not a catalog key present in the input.
4. An issue cites an event that is not a failed check; a strength cites one that is not a pass.
5. A number in free text does not appear in the serialised input (digits regex; allow mm:ss present in input).
6. A major failed check in the input is not covered by any issue.

`lib/fallback.ts`: deterministic debrief (top 3 faults by severity, best metric as strength, history deltas, next focus = most frequent fault), localized from dictionaries, stored with `status: "fallback"`. The UI never shows an error to the user.

Store every rejection reason in `validation_errors` — these are the "examples of failures".

## 7. Evaluation harness (`eval/`)

**Fixtures** (`fixtures/`, generated by `scripts/make-fixtures.ts`): `clean_drive`, `speeder`, `red_light_runner`, `nervous` (many reversals, hesitations, no violations), `mixed_exam_fail`, `progress_series_1..3` (improving). Each has `*.expected.json` (expected violations, issues that must appear, readiness band).

**Real drives:** export recorded drives (no personal data) to `eval/real/`.

**`npm run eval`** (needs `OPENROUTER_API_KEY`): each fixture/real drive × 3 runs × each language → `eval/REPORT.md` + `eval/report.json`:

| Measure | Definition |
|---|---|
| Schema validity | % valid on first attempt |
| Grounding rate | % passing all validator checks on first attempt |
| Hallucinated references | unknown event ids / rule keys / unseen numbers |
| Major-fault recall | % of major faults covered by an issue |
| Prioritisation | % where issue #1 is the most severe fault |
| Consistency | same top issue across 3 runs |
| Fallback rate | % ending in fallback |
| Language check | % outputs whose script matches the locale (Cyrillic for RU, Latin with ə/ğ/ı for AZ) |
| Latency, tokens, cost | p50 / max per debrief |

**Comparison with the current approach:** the game today shows only a list of fines (rules-only baseline). For each drive, put the rules-only output, the template fallback and the AI debrief side by side; count actionable recommendations, cross-drive insights and correctly prioritised faults. Also report the debrief **with vs without history** to show what cross-drive context adds.

**Failure examples:** paste 2–3 real rejected outputs with the validator reason and the corrected retry into `eval/REPORT.md`.

## 8. Stretch: "Ask your instructor"

`POST /api/chat` → context = latest 5 drives' metrics + debriefs + rules glossary (fits in context, no vector DB) → answer in the user's locale citing drive ids and rule keys; validator checks 2–3. Only after MVP is green.

## 9. Rules

- Prompts versioned; bump `PROMPT_VERSION` and rerun eval on any change.
- The LLM never produces metrics or the readiness score.
- RU and AZ outputs are flagged for native review in the report.
