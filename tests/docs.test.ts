import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const doc = readFileSync("docs/GAME_INTEGRATION.md", "utf8");

function routeFile(apiPath: string): string {
  // /api/drives/{id} → app/api/drives/[id]/route.ts
  const segs = apiPath.split("?")[0].replace(/\{(\w+)\}/g, "[$1]").replace(/^\//, "");
  return path.join("app", segs, "route.ts");
}

function allSource(dir: string): string {
  return readdirSync(dir)
    .map((f) => path.join(dir, f))
    .map((p) => (statSync(p).isDirectory() ? allSource(p) : /\.(ts|tsx)$/.test(p) ? readFileSync(p, "utf8") : ""))
    .join("\n");
}
const code = allSource("app") + allSource("lib");

describe("docs/GAME_INTEGRATION.md matches the implementation", () => {
  const endpoints = [...doc.matchAll(/`(GET|POST) (\/api\/[^`\s]+)`/g)].map((m) => ({ method: m[1], path: m[2] }));

  it("documents the game-facing endpoints", () => {
    expect(new Set(endpoints.map((e) => `${e.method} ${e.path.split("?")[0]}`))).toEqual(
      new Set([
        "POST /api/device/start",
        "POST /api/device/token",
        "GET /api/me",
        "POST /api/drives",
        "GET /api/drives",
        "GET /api/drives/{id}",
        "GET /api/me/focus",
        "GET /api/me/exam-brief",
        "POST /api/me/plan",
        "GET /api/me/plan/latest",
        "GET /api/quiz/next",
        "POST /api/quiz/answer",
        "POST /api/chat",
      ]),
    );
  });

  for (const { method, path: p } of endpoints) {
    it(`${method} ${p} exists`, () => {
      const file = routeFile(p);
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(new RegExp(`export async function ${method}\\b`));
    });
  }

  const docErrors = new Set([...doc.matchAll(/"error":"(\w+)"|`(authorization_pending|expired_token|invalid_grant|invalid_request|slow_down|unauthorized|not_found|rate_limited|already_answered|forbidden)`/g)].map((m) => m[1] ?? m[2]));

  it("every documented error code is produced by the code", () => {
    for (const e of docErrors) expect(code.includes(`"${e}"`), e).toBe(true);
  });

  it("every error code the game API can return is documented", () => {
    const gameRoutes = [
      "app/api/device/start/route.ts",
      "app/api/device/token/route.ts",
      "app/api/me/route.ts",
      "app/api/drives/route.ts",
      "app/api/drives/[id]/route.ts",
      "app/api/me/focus/route.ts",
      "app/api/me/exam-brief/route.ts",
      "app/api/me/plan/route.ts",
      "app/api/me/plan/latest/route.ts",
      "app/api/quiz/next/route.ts",
      "app/api/quiz/answer/route.ts",
      "app/api/chat/route.ts",
      "lib/http.ts",
      "lib/ai/http.ts",
      "lib/quiz/store.ts",
      "lib/auth/deviceLink.ts",
    ];
    const produced = new Set<string>();
    for (const f of gameRoutes)
      for (const m of readFileSync(f, "utf8").matchAll(/error: "(\w+)"|error:\s*"(\w+)"|"(authorization_pending|expired_token|invalid_grant)"/g)) produced.add(m[1] ?? m[2] ?? m[3]);
    for (const e of produced) expect(docErrors.has(e), e).toBe(true);
  });

  it("documented status codes appear in the routes", () => {
    for (const s of ["413", "422", "429", "404", "401"]) expect(doc).toContain(s);
    const drives = readFileSync("app/api/drives/route.ts", "utf8");
    expect(drives).toContain("413");
    expect(drives).toContain("422");
    expect(readFileSync("app/api/device/start/route.ts", "utf8")).toContain("429");
  });

  it("documented sample fields and rule keys match the schema", async () => {
    const { SAMPLE_FIELDS } = await import("@/lib/telemetry/schema");
    const { RULE_KEYS } = await import("@/lib/rules/catalog");
    for (const f of SAMPLE_FIELDS) expect(doc).toContain(`\`${f}\``);
    expect(doc).toContain(RULE_KEYS.join(" | "));
  });
});
