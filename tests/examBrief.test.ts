import { beforeAll, describe, expect, it, vi } from "vitest";
import { useTempDb } from "./helpers/db";
import { bearer, fixture, newPlayer } from "./helpers/api";
import { ingestDrive } from "@/lib/drives/ingest";
import { query } from "@/lib/db";
import { GET as getBrief } from "@/app/api/me/exam-brief/route";
import { GET as getDrive } from "@/app/api/drives/[id]/route";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

beforeAll(async () => {
  await useTempDb();
});

const driveRequest = (token: string, id: string) =>
  getDrive(bearer(token), { params: Promise.resolve({ id }) } as Parameters<typeof getDrive>[1]);

describe("exam brief and comparison", () => {
  it("remembers each issued brief", async () => {
    const { user, token } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));
    const { brief_id, brief } = await (await getBrief(bearer(token))).json();
    expect(brief.reason).toBe("weaknesses");
    const rows = await query<{ drive_id: string | null }>("SELECT drive_id FROM exam_briefs WHERE id = ?", [brief_id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].drive_id).toBeNull();
  });

  it("compares the next exam with the latest brief, once", async () => {
    const { user, token } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));
    const { brief } = await (await getBrief(bearer(token))).json();

    const exam = await ingestDrive(user, fixture("mixed_exam_fail"));
    const res = await driveRequest(token, exam.id);
    const body = await res.json();
    expect(body.exam_comparison).not.toBeNull();
    expect(body.exam_comparison.brief.focus_rules).toEqual(brief.focus_rules);
    const results = body.exam_comparison.comparison.results as { rule: string; outcome: string; faults_in_exam: number }[];
    expect(results.map((r) => r.rule)).toEqual(brief.focus_rules.map((r: { rule: string }) => r.rule));
    expect(results.every((r) => ["improved", "same", "worse"].includes(r.outcome))).toBe(true);
    for (const r of results) {
      if (r.faults_in_exam === 0) expect(r.outcome).toBe("improved");
    }

    const second = await ingestDrive(user, fixture("progress_series_3"));
    const later = await (await driveRequest(token, second.id)).json();
    expect(later.exam_comparison).toBeNull();
  });

  it("does nothing for free drives or when no brief was issued", async () => {
    const { user, token } = await newPlayer();
    const free = await ingestDrive(user, fixture("progress_series_1"));
    expect((await (await driveRequest(token, free.id)).json()).exam_comparison).toBeNull();

    const exam = await ingestDrive(user, fixture("mixed_exam_fail"));
    expect((await (await driveRequest(token, exam.id)).json()).exam_comparison).toBeNull();
  });

  it("marks a fixed weakness improved after a clean exam", async () => {
    const { user, token } = await newPlayer();
    await ingestDrive(user, fixture("progress_series_1"));
    await getBrief(bearer(token));
    const clean = fixture("clean_drive");
    clean.drive.mode = "exam";
    clean.drive.client_drive_id = "clean-exam-1";
    clean.drive.started_at = "2026-10-20T09:00:00Z";
    clean.drive.exam = { passed: true, minor_faults: 0, major_faults: 0, checkpoints_reached: 5, checkpoints_total: 5 };
    const exam = await ingestDrive(user, clean);
    const body = await (await driveRequest(token, exam.id)).json();
    expect(body.exam_comparison.comparison.worse).toBe(0);
    expect(body.exam_comparison.comparison.improved).toBe(body.exam_comparison.brief.focus_rules.length);
  });
});
