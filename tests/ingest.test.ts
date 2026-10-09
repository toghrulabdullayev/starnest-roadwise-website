import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { useTempDb } from "./helpers/db";
import { createUser, type User } from "@/lib/auth/users";
import { ingestDrive } from "@/lib/drives/ingest";
import { getDebrief, listDrives } from "@/lib/drives/queries";
import { parseTelemetry, type DriveTelemetry } from "@/lib/telemetry/schema";

const fixture = (n: string): DriveTelemetry => {
  const r = parseTelemetry(JSON.parse(readFileSync(`fixtures/${n}.json`, "utf8")));
  if (!r.ok) throw new Error(n);
  return r.data;
};

let user: User;
beforeAll(async () => {
  await useTempDb();
  user = await createUser({ email: "ingest@example.com", password: "password123", displayName: "Ingest", locale: "ru" });
});

describe("ingestDrive", () => {
  it("stores metrics, readiness, a pending debrief in the user's locale; first drive has no history", async () => {
    const r = await ingestDrive(user, fixture("progress_series_1"), { source: "fixture" });
    expect(r.created).toBe(true);
    expect(r.history).toBeNull();
    expect(r.readiness.band).toBe("not_ready");
    const { record } = await getDebrief(r.id, "ru");
    expect(record).toMatchObject({ locale: "ru", status: "pending" });
  });
  it("is idempotent on client_drive_id, also under concurrent uploads", async () => {
    const t = fixture("progress_series_2");
    const [a, b] = await Promise.all([ingestDrive(user, t), ingestDrive(user, t)]);
    expect(a.id).toBe(b.id);
    const again = await ingestDrive(user, t);
    expect(again).toMatchObject({ id: a.id, created: false });
    expect((await listDrives(user.id)).length).toBe(2);
  });
  it("later drives get history against earlier ones and a rising readiness", async () => {
    const r3 = await ingestDrive(user, fixture("progress_series_3"));
    expect(r3.history?.previous_count).toBe(2);
    expect(r3.readiness.band).toBe("ready");
    const list = await listDrives(user.id);
    expect(list.map((d) => d.readiness_score)).toEqual([...list.map((d) => d.readiness_score)].sort((a, b) => b - a));
  });
});
