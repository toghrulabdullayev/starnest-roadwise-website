import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useTempDb } from "./helpers/db";
import { createUser, type User } from "@/lib/auth/users";
import { getDb, query, resetDbClient, run } from "@/lib/db";
import { ingestDrive } from "@/lib/drives/ingest";
import { loadDriveFaults } from "@/lib/drives/faults";
import { computeFocus } from "@/lib/profile/focus";
import { parseTelemetry, type DriveTelemetry } from "@/lib/telemetry/schema";

const fixture = (n: string): DriveTelemetry => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(n);
  return r.data;
};

const failedChecks = (t: DriveTelemetry) =>
  t.events.filter((e) => e.type === "rule_check" && e.outcome === "fail").length;

let user: User;
beforeAll(async () => {
  await useTempDb();
  user = await createUser({ email: "events@example.com", password: "password123", displayName: "Events", locale: "en" });
});

describe("drive_events", () => {
  it("stores one row per failed check, with the drive's mode and date", async () => {
    const t = fixture("speeder");
    const r = await ingestDrive(user, t);
    const rows = await query<{ rule: string; severity: string; mode: string; started_at: string; fine_azn: number }>(
      "SELECT rule, severity, mode, started_at, fine_azn FROM drive_events WHERE drive_id = ?",
      [r.id],
    );
    expect(rows).toHaveLength(failedChecks(t));
    expect(rows.every((x) => x.rule === "speeding" && x.mode === "free")).toBe(true);
    expect(rows.map((x) => x.fine_azn).sort((a, b) => a - b)).toEqual([10, 50, 200]);
  });

  it("does not duplicate rows when the same drive is uploaded again", async () => {
    const t = fixture("red_light_runner");
    const first = await ingestDrive(user, t);
    await ingestDrive(user, t);
    const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM drive_events WHERE drive_id = ?", [first.id]);
    expect(n).toBe(failedChecks(t));
  });

  it("stores nothing for a clean drive", async () => {
    const r = await ingestDrive(user, fixture("clean_drive"));
    const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM drive_events WHERE drive_id = ?", [r.id]);
    expect(n).toBe(0);
  });

  it("disappears with its drive", async () => {
    const r = await ingestDrive(user, fixture("mixed_exam_fail"));
    await run("DELETE FROM drives WHERE id = ?", [r.id]);
    const [{ n }] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM drive_events WHERE drive_id = ?", [r.id]);
    expect(n).toBe(0);
  });
});

describe("loadDriveFaults", () => {
  it("returns newest first, includes clean drives, and matches focus computed from telemetry", async () => {
    await useTempDb();
    const u = await createUser({ email: "faults@example.com", password: "password123", displayName: "Faults", locale: "en" });
    for (const n of ["progress_series_1", "progress_series_2", "progress_series_3"]) await ingestDrive(u, fixture(n));
    await ingestDrive(u, fixture("clean_drive"));

    const faults = await loadDriveFaults(u.id);
    expect(faults).toHaveLength(4);
    expect(faults.map((f) => f.started_at)).toEqual([...faults.map((f) => f.started_at)].sort().reverse());
    expect(faults.some((f) => f.faults.length === 0)).toBe(true);

    const focus = computeFocus(faults);
    expect(focus.length).toBeGreaterThan(0);
    expect(focus.map((f) => f.rule)).toContain("pedestrian_crossing");
  });

  it("respects the window and handles a user without drives", async () => {
    const u = await createUser({ email: "empty@example.com", password: "password123", displayName: "Empty", locale: "en" });
    expect(await loadDriveFaults(u.id)).toEqual([]);
    await ingestDrive(u, fixture("progress_series_1"));
    await ingestDrive(u, fixture("progress_series_2"));
    const latest = await loadDriveFaults(u.id, 1);
    expect(latest).toHaveLength(1);
    expect(latest[0].started_at).toBe(new Date(fixture("progress_series_2").drive.started_at).toISOString());
  });
});

describe("migration 0002 backfill", () => {
  it("creates events for drives stored before the table existed", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roadwise-backfill-"));
    process.env.DATABASE_URL = `file:${path.join(dir, "old.db")}`;
    process.env.DATABASE_AUTH_TOKEN = "";
    resetDbClient();
    const db = await getDb();
    await db.executeMultiple(readFileSync("db/migrations/0001_init.sql", "utf8"));
    await db.execute("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
    await db.execute("INSERT INTO _migrations (name) VALUES ('0001_init.sql')");

    const t = fixture("progress_series_1");
    await db.execute({ sql: "INSERT INTO users (id, email, password_hash, display_name) VALUES ('u1', 'old@example.com', 'x', 'Old')", args: [] });
    await db.execute({
      sql: `INSERT INTO drives (id, user_id, client_drive_id, source, mode, district, started_at, duration_s, distance_m, telemetry, metrics, readiness)
            VALUES ('d1', 'u1', 'c1', 'game', 'free', 'baku-center', ?, 1, 1, ?, '{}', '{}')`,
      args: [t.drive.started_at, JSON.stringify(t)],
    });

    const { migrate } = await import("@/scripts/migrate");
    expect(await migrate(() => {})).toContain("0002_drive_events.sql");
    const rows = await query<{ rule: string }>("SELECT rule FROM drive_events WHERE drive_id = 'd1'");
    expect(rows).toHaveLength(failedChecks(t));
    expect(rows.map((r) => r.rule)).toContain("pedestrian_crossing");
  });
});
