# Roadwise — game integration guide (for the Unity agents)

The website owns accounts, analytics and the AI instructor. The game needs three things: **log in**, **record a drive**, **upload it and show the debrief**. Base URL: `https://<roadwise-site>` (set in a config asset; `http://localhost:3000` for local testing).

Draft — the web team updates it with real examples once the endpoints ship (PLAN.md step 6.1).

## 1. Log in (device link)

1. `POST /api/device/start` body `{ "client": "roadwise-unity", "client_version": "<Application.version>" }`
   → `{ device_code, user_code, verify_url, interval, expires_in }`
2. `Application.OpenURL(verify_url)`; show "Finish signing in in your browser — code ABCD-EFGH".
3. Every `interval` seconds `POST /api/device/token` `{ "device_code": "..." }`:
   - 400 `authorization_pending` → keep polling
   - 400 `expired_token` / `invalid_grant` → stop, offer "Try again"
   - 200 `{ access_token, token_type: "Bearer", user: { id, display_name, locale } }` → save, show "Signed in as …"
4. Save the token to `Path.Combine(Application.persistentDataPath, "roadwise_token.json")`. On launch, call `GET /api/me` with `Authorization: Bearer <token>`; 401 → signed out.

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

## 2. Record a drive

- **Samples at 5 Hz** (fixed timer, not per frame): `t` (s since start), `x`, `z` (map metres, +x east, +z south), `speed_kmh`, `limit_kmh`, `throttle` 0..1, `brake` 0..1, `steer` −1..1, `handbrake` 0/1.
- **Events** with unique ids (`e1`, `e2`, …):
  - `rule_check` with `rule` ∈ `speeding | red_light | stop_sign | pedestrian_crossing | wrong_way | give_way | collision`, `outcome` `pass | fail`; on fail add `severity`, `fine_azn`, and `detail` (speeding: `speed_kmh`, `limit_kmh`; collision: `with`).
  - **Passes matter:** emit `pass` when the driver correctly stopped at a STOP line, waited at a red light, yielded at a crossing, or gave way.
  - `checkpoint` with `index` (exam mode).
  - Add `street` when known.
- At the end, fill `drive` (mode, district, route_id, car_type, time_of_day, started_at ISO UTC, duration_s, distance_m, and `exam` for exam mode).

Full schema and example: `.claude/skills/roadwise-platform/SKILL.md` §8 and `contracts/roadwise.drive.v1.schema.json`.

## 3. Upload and show the debrief

1. Save the JSON to `persistentDataPath/pending/<client_drive_id>.json`.
2. `POST /api/drives` with the Bearer token. 200 → delete the pending file; 401 → ask to log in; network error → keep the file and retry on next launch (upload is idempotent on `client_drive_id`); 422 → log `issues` (schema bug).
3. Response gives `id`, `metrics`, `readiness` immediately. Poll `GET /api/drives/{id}?locale=<ui locale>` every 2 s (max 30 s) until `debrief.status` is `ready` or `fallback`.
4. End-of-drive screen: summary, top 3 issues (title + how_to_fix), `next_drive.focus`, readiness score, and a button "Open full report" → `Application.OpenURL(url)`.

## 4. Test without the website team

`fixtures/*.json` in the web repo are valid uploads; compare your output's shape with them.
