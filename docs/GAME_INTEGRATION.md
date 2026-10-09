# Roadwise — game integration guide (for the Unity agents)

The website owns accounts, analytics and the AI instructor. The game needs three things: **log in**, **record a drive**, **upload it and show the debrief**. Section 5 adds the optional learning loop: weak spots, practice plan, quiz, adaptive exam brief and the live instructor chat.

- Base URL: `https://<roadwise-site>` (keep it in a config asset; `http://localhost:3000` for local testing).
- All bodies are JSON (`Content-Type: application/json`). Every response is JSON.
- The examples below are real responses from the implemented endpoints (ids and tokens shortened).
- Contract versions: device link = Contract A, telemetry = Contract B (`roadwise.drive.v1`). Changing either means a new schema version plus updated fixtures, validation and this guide.

## Endpoints at a glance

| Method & path | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/device/start` | none | 200 link | 400 `invalid_request`, 429 `slow_down` |
| `POST /api/device/token` | none | 200 token | 400 `authorization_pending`, 400 `expired_token`, 400 `invalid_grant` |
| `GET /api/me` | Bearer | 200 user | 401 `unauthorized` |
| `POST /api/drives` | Bearer | 200 drive | 401 `unauthorized`, 413 (over 4 MB), 422 `issues` |
| `GET /api/drives` | Bearer | 200 `{ drives: [...] }` (latest 50) | 401 `unauthorized` |
| `GET /api/drives/{id}?locale=en\|ru\|az` | Bearer | 200 drive + debrief | 401 `unauthorized`, 404 `not_found` |
| `GET /api/me/focus` | Bearer | 200 `{ focus, drives_considered }` | 401 `unauthorized` |
| `GET /api/me/exam-brief` | Bearer | 200 `{ brief_id, brief }` | 401 `unauthorized` |
| `POST /api/me/plan` | Bearer | 200 plan | 401 `unauthorized`, 429 `rate_limited` |
| `GET /api/me/plan/latest?locale=en\|ru\|az` | Bearer | 200 plan | 401 `unauthorized`, 404 `not_found` |
| `GET /api/quiz/next?locale=en\|ru\|az` | Bearer | 200 quiz (no answers) | 401 `unauthorized` |
| `POST /api/quiz/answer` | Bearer | 200 results | 401 `unauthorized`, 404 `not_found`, 409 `already_answered`, 422 `invalid_request` |
| `POST /api/chat` | Bearer | 200 reply | 401 `unauthorized`, 422 `invalid_request`, 429 `rate_limited` |

## 1. Log in (device link)

1. Start a link:

   ```http
   POST /api/device/start
   {"client":"roadwise-unity","client_version":"0.1.0"}
   ```
   ```json
   200 {"device_code":"jCTntRBf…Y8FA","user_code":"ZRMG-JM8V","expires_in":600,"interval":3,
        "verify_url":"https://<site>/en/link?code=ZRMG-JM8V"}
   ```

2. `Application.OpenURL(verify_url)` and show: "Finish signing in in your browser — code **ZRMG-JM8V**". The player logs in (or signs up) and clicks **Authorise this device**.

3. Every `interval` seconds:

   ```http
   POST /api/device/token
   {"device_code":"jCTntRBf…Y8FA"}
   ```
   | Response | Meaning | Game action |
   |---|---|---|
   | `400 {"error":"authorization_pending"}` | not authorised yet | keep polling |
   | `400 {"error":"expired_token"}` | 10 minutes passed | stop, offer "Try again" |
   | `400 {"error":"invalid_grant"}` | unknown or already-used code | stop, offer "Try again" |
   | `200` (below) | signed in | save the token, show "Signed in as …" |

   ```json
   200 {"access_token":"rw_dY3…","token_type":"Bearer",
        "user":{"id":"5bb35a17-…","display_name":"Aysel","locale":"az"}}
   ```
   A device code can be exchanged **once**; a second exchange returns `invalid_grant`.

4. Save the token to `Path.Combine(Application.persistentDataPath, "roadwise_token.json")`. On launch call `GET /api/me` with `Authorization: Bearer <token>`:

   ```json
   200 {"id":"5bb35a17-…","display_name":"Aysel","locale":"az"}
   401 {"error":"unauthorized"}        ← token unknown or revoked by the player: show "Log in"
   ```

   Players can revoke a game from their profile ("Connected devices"); the next call returns 401.

```csharp
IEnumerator PollToken(string deviceCode, float interval) {
    while (true) {
        yield return new WaitForSeconds(interval);
        var body = JsonUtility.ToJson(new TokenRequest { device_code = deviceCode });
        using var req = new UnityWebRequest($"{BaseUrl}/api/device/token", "POST") {
            uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)),
            downloadHandler = new DownloadHandlerBuffer()
        };
        req.SetRequestHeader("Content-Type", "application/json");
        yield return req.SendWebRequest();
        if (req.responseCode == 200) { SaveToken(JsonUtility.FromJson<TokenResponse>(req.downloadHandler.text)); yield break; }
        var err = req.downloadHandler.text;
        if (!err.Contains("authorization_pending")) { OnLoginFailed(err); yield break; }
    }
}
```

## 2. Record a drive (Contract B, `roadwise.drive.v1`)

JSON Schema: `contracts/roadwise.drive.v1.schema.json`. Valid examples: `fixtures/*.json` (e.g. `fixtures/red_light_runner.json`).

- `drive`: `client_drive_id` (UUID, generate once per drive — uploads are idempotent on it), `mode` `free|exam`, `district`, `route_id`, `car_type`, `time_of_day` `day|dusk|night`, `started_at` (ISO 8601 UTC), `duration_s`, `distance_m`, `exam` (`null` in free mode; in exam mode `{passed, minor_faults, major_faults, checkpoints_reached, checkpoints_total}`).
- **Samples at 5 Hz** (fixed timer, not per frame). `fields` must list exactly these nine, each once, and every row must have nine numbers in that order:
  `t` (s since start), `x`, `z` (map metres, +x east, +z south), `speed_kmh`, `limit_kmh`, `throttle` 0..1, `brake` 0..1, `steer` −1..1, `handbrake` 0/1.
- **Events**, ids unique per drive (`e1`, `e2`, …):
  - `rule_check`: `rule` ∈ `speeding | red_light | stop_sign | pedestrian_crossing | wrong_way | give_way | collision`; `outcome` `pass | fail`; `x`, `z`; optional `street`. A `fail` **must** include `severity` (`major|minor`) and `fine_azn`; add `detail` (speeding: `speed_kmh`, `limit_kmh`; collision: `with`).
  - **Emit passes too**: stopped at a STOP line, waited at a red light, yielded at a crossing, gave way. "Rules followed" is a headline metric and the instructor praises passes.
  - `checkpoint` with `index` (exam mode).
- Speeding fines by band over the limit (trigger above +11 km/h): +11–20 → 10 AZN minor · +21–40 → 50 minor · +41–60 → 200 major · +61+ → 300 major.

```json
{ "id": "e3", "t": 85.6, "type": "rule_check", "rule": "red_light", "outcome": "fail",
  "severity": "major", "fine_azn": 100, "x": 560, "z": 280, "street": "Üzeyir Hacıbəyov küç." }
```

## 3. Upload and show the debrief

1. Save the JSON to `persistentDataPath/pending/<client_drive_id>.json`.
2. Upload:

   ```http
   POST /api/drives
   Authorization: Bearer rw_…
   <telemetry JSON>
   ```
   ```json
   200 {"id":"1ebfff69-…","created":true,"debrief_status":"pending",
        "metrics":{"compliance_rate":0.6667,"fines_total_azn":110,"major_count":1, …},
        "readiness":{"score":46,"band":"not_ready","components":[…]},
        "history":{…} | null,
        "url":"https://<site>/az/drives/1ebfff69-…"}
   ```
   - Re-uploading the same `client_drive_id` returns the same `id` with `"created": false` — safe to retry.
   - `401` → ask the player to log in. Network error → keep the file, retry on next launch.
   - `422` → schema bug; log `issues` (paths point at the bad field):
     ```json
     422 {"issues":[{"path":"events.0.rule","message":"Invalid option: expected one of \"speeding\"|\"red_light\"|…"}]}
     ```
   - `413` → the file is over 4 MB (should not happen at 5 Hz for drives under ~1 hour).
   - On 200 delete the pending file.

3. Poll `GET /api/drives/{id}?locale=<ui locale>` every 2 s (max 30 s) until `debrief.status` is `ready` or `fallback`. If the debrief does not exist in the requested language yet, the response contains the one that exists (`debrief.locale` tells which; `debrief_locales` lists all).

   ```json
   200 {"id":"1ebfff69-…",
        "debrief":{"status":"fallback","locale":"az","model":"google/gemini-3.5-flash-lite","prompt_version":"debrief-v1",
          "content":{
            "summary":"6 qayda yoxlamasından 4 keçildi, cərimələr 110 AZN təşkil etdi. …",
            "strengths":[{"text":"…","event_ids":["e1","e2"]}],
            "issues":[{"title":"Qırmızı işıqda keçmə: Üzeyir Hacıbəyov küç., 01:26","severity":"major","rule":"red_light",
                       "event_ids":["e3"],"why_it_matters":"…","how_to_fix":"Sarı işığı dayanma siqnalı kimi qəbul edin: …"}],
            "progress":{"improved":["…"],"worse":[]} ,
            "next_drive":{"focus":"Qırmızı və sarı işıqda dayanmaq","mode":"free","drills":["…"]},
            "readiness_comment":"…"}},
        "debrief_locales":["az"],
        "readiness":{"score":46,"band":"not_ready", …},
        "url":"https://<site>/en/drives/1ebfff69-…"}
   ```
   `status`: `pending` (still writing) · `ready` (AI debrief that passed the grounding checks) · `fallback` (template debrief built from the same data — show it the same way) · `error` (not used for content; treat like pending timeout). After 90 s a stuck `pending` is replaced by the fallback automatically.

4. End-of-drive screen: `summary`, top 3 `issues` (`title` + `how_to_fix`), `next_drive.focus`, `readiness.score` / `band`, and a button **Open full report** → `Application.OpenURL(url)`.

## 4. Test without the website team

- `fixtures/*.json` are valid uploads; compare your output's shape with them. `fixtures/invalid/*.json` must be rejected with 422.
- `scripts/device-flow.sh` runs the whole login flow against any `BASE_URL`; `scripts/upload.sh <file>` uploads any telemetry file with the saved token.

## 5. Learning loop and instructor chat (optional)

All of these use `Authorization: Bearer rw_…`, answer in the player's language (`?locale=` or a `locale` field overrides it) and **never fail because the AI is down**: when the model is unavailable or its answer does not pass the grounding checks, a deterministic localized fallback is returned (`"status":"fallback"`). Numbers always come from code, never from the model. The `POST` routes also answer `forbidden` (403) to browser (cookie) requests from another origin; a game with a Bearer token never sees it.

### 5.1 Weak spots — `GET /api/me/focus`

```json
200 {"focus":[{"rule":"speeding","weight":1.38,"count":3,"last_seen":"2026-10-07T09:00:00.000Z","trend":"improved"},
              {"rule":"stop_sign","weight":0.38,"count":1,"last_seen":"2026-10-06T09:00:00.000Z","trend":"same"}],
     "drives_considered":2}
```
Rules the player breaks, heaviest first. `weight` is the player's typical number of weighted faults per drive for that rule, taken over the last 10 drives with recent drives counting more (a major fault weighs 3, a minor fault 1, a wrong quiz answer 0.5). It is an average, so it only rises when the player makes more faults than before and falls as they improve. `count` is the faults in the window, `trend` is `improved | same | worse`, and an empty list means no recurring faults.

### 5.2 Next exam — `GET /api/me/exam-brief`

```json
200 {"brief_id":"6a0c…","brief":{"version":"exam-brief-1","reason":"weaknesses","difficulty":"easy",
       "target_length_m":2500,"repeats_per_rule":3,
       "focus_rules":[{"rule":"speeding","weight":2.2,"trend":"improved"}]}}
```
`reason` is `no_history | clean | weaknesses`; `difficulty` is `easy` (struggling, at least 4 weighted faults per typical drive: short route, weak spots repeated), `standard` or `hard` (clean history: long route). **The game builds the route itself** from its road graph: pick junctions and segments tagged with the `focus_rules`, repeat each `repeats_per_rule` times, aim for `target_length_m`. After the exam is uploaded, `GET /api/drives/{id}` carries `exam_comparison` (`results[]` with `outcome` `improved | same | worse` per focus rule, plus the brief it was compared with); it is `null` for non-exam drives or when no brief was requested first.

### 5.3 Practice plan — `POST /api/me/plan`, `GET /api/me/plan/latest`

`POST` body is optional: `{"locale":"az"}`. Limit: 5 per minute per player. Takes a few seconds.

```json
200 {"id":"c3d1…","locale":"en","status":"ready","created_at":"2026-10-09T12:40:11.532Z",
     "plan":{"summary":"…","priorities":[
        {"rule":"speeding","why":"This fault happened 3 times and was last seen on 2026-10-07, …","practice":"Practice driving on central avenues while …"}]},
     "practice_tags":["speeding","stop_sign","pedestrian_crossing"],
     "focus":[…]}
```
`practice_tags` are rule keys, most important first: use them to choose where to send the player for practice. `GET …/latest` returns the newest plan (`404 not_found` when there is none).

### 5.4 Quiz — `GET /api/quiz/next`, `POST /api/quiz/answer`

```json
200 {"quiz_id":"9b2e…","locale":"en","weak_rules":["speeding","stop_sign"],
     "questions":[{"id":"tpl:limit:city","rule":"speeding","text":"What is the speed limit in this place: city (built-up area)?",
                   "options":["60 km/h","20 km/h","110 km/h","90 km/h"]}]}
```
Ten questions, about 70% on the player's weak rules. The correct answers are **not** in this response.

```http
POST /api/quiz/answer
{"quiz_id":"9b2e…","answers":[{"question_id":"tpl:limit:city","chosen_index":0}]}
```
```json
200 {"quiz_id":"9b2e…","correct":9,"total":10,
     "results":[{"question_id":"tpl:limit:city","rule":"speeding","correct":true,"chosen_index":0,"correct_index":0,
                 "explanation":"The limit for \"city (built-up area)\" is 60 km/h."}]}
```
`chosen_index` is 0–3. Unanswered questions count as wrong. A quiz can be answered once (`409 already_answered`); someone else's or an unknown quiz is `404 not_found`; a malformed body is `422 invalid_request` with `issues`.

### 5.5 Ask the instructor — `POST /api/chat`

Send the question with a snapshot of the moment (all fields in `snapshot` are validated):

```json
POST /api/chat
{"question":"Why did I just get a fine?","locale":"en",
 "snapshot":{"mode":"free","speed_kmh":72,"limit_kmh":60,"street":"Nizami küç.","next_sign":"STOP",
             "next_instruction":"Turn right in 120 m",
             "recent_faults":[{"rule":"speeding","seconds_ago":25}]}}
```
```json
200 {"status":"ready","kind":"answer","answer":"You were fined for speeding 25 seconds ago …","rules":["speeding"]}
```
- `mode`: `free` or `exam`. `limit_kmh` may be `null`. `recent_faults` holds at most 5 entries; `question` at most 300 characters.
- **Free drive:** `kind` is `answer`, one or two sentences; `rules` lists the rule keys it is about (show them as links to the rule if you like).
- **Exam:** like a real examiner the instructor does not coach. `kind` is `directions` (it repeats `next_instruction`, so **send it during exams**) or `refused`; `rules` is always empty.
- `status` is `ready` (model answer that passed the checks) or `fallback` (canned answer; in a free drive it is a tip about the last fault).
- `422 invalid_request` with `issues`. `429 rate_limited` after 12 questions in a minute, with a `Retry-After` header and a localized `message` you can show:

```json
429 {"error":"rate_limited","retry_after_s":23,"message":"Please wait a moment before asking again."}
```
Keep the question box short-lived and non-blocking: answers take 2–5 seconds.
