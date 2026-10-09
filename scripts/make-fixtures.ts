/**
 * Generates deterministic telemetry fixtures (roadwise.drive.v1) and their expectations.
 *   npm run fixtures   → fixtures/<name>.json + fixtures/<name>.expected.json (+ fixtures/invalid/*)
 *
 * Each scenario is a scripted route through central Baku: legs on named streets made of
 * segments (cruise speed, posted limit, how the segment ends). A simple kinematic model
 * turns that into 5 Hz samples, and rule_check events are emitted where the script says.
 * Expected violations are written by hand per scenario and asserted against the output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseTelemetry, SAMPLE_FIELDS, type DriveTelemetry } from "../lib/telemetry/schema";
import { ruleOutcome, type RuleKey, type Severity } from "../lib/rules/catalog";

const HZ = 5;
const DT = 1 / HZ;
const ACCEL = 2.0; // m/s², normal
const DECEL = 2.5; // m/s², normal

type Heading = "N" | "E" | "S" | "W";
const DIR: Record<Heading, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }; // +z is south

type Check = { rule: RuleKey; outcome: "pass" | "fail"; detail?: Record<string, string | number> };

interface Segment {
  length: number; // m
  cruise: number; // km/h
  limit: number; // km/h
  /** how the segment ends: speed at the end (km/h) and how long to wait there */
  endSpeed?: number;
  wait?: number;
  /** deceleration used to reach endSpeed (m/s²); > 3.5 is a harsh brake */
  decel?: number;
  accel?: number;
  /** rule checks emitted at the segment end */
  checks?: Check[];
  /** emit a speeding fail when the car first reaches cruise speed */
  speedingFail?: boolean;
  /** exam checkpoint at the end */
  checkpoint?: boolean;
  /** steering oscillation amplitude while in this segment (nervous driving) */
  wobble?: number;
  handbrakeAtEnd?: boolean;
}

interface Leg {
  street: string;
  heading: Heading;
  segments: Segment[];
}

interface Scenario {
  name: string;
  seed: number;
  mode: "free" | "exam";
  district: string;
  route_id: string | null;
  time_of_day: "day" | "dusk" | "night";
  started_at: string;
  start: [number, number];
  legs: Leg[];
  /** hand-written expectations */
  expected: {
    description: string;
    violations: Partial<Record<RuleKey, number>>;
    major_count: number;
    minor_count: number;
    /** rules that the debrief must raise as issues */
    must_raise_rules: RuleKey[];
    /** the rule the top issue should be about (most severe) */
    top_issue_rule: RuleKey | null;
    readiness_band: "not_ready" | "almost" | "ready";
    /** for nervous: composure should be clearly low */
    composure_max?: number;
    composure_min?: number;
    exam_passed?: boolean | null;
  };
  /** exam mode: computed from events unless overridden */
  exam?: { checkpoints_total: number };
  /** progress series: expected improvements vs previous drives */
  series?: { index: number; expect_improved: string[] };
}

// ---------- deterministic helpers ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeUuid(seed: number): string {
  const r = mulberry32(seed * 7919 + 17);
  const hex = Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[Math.floor(r() * 4)]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- simulation ----------
function simulate(s: Scenario): DriveTelemetry {
  const rand = mulberry32(s.seed);
  const rows: number[][] = [];
  const events: DriveTelemetry["events"] = [];
  let t = 0;
  let v = 0; // m/s
  let [x, z] = s.start;
  let distance = 0;
  let steerTurn = 0; // remaining turn steer seconds
  let turnSign = 0;
  let prevHeading: Heading | null = null;
  let checkpointIndex = 0;
  let eventN = 0;

  const push = (seg: Segment, a: number, steerExtra: number, handbrake = 0) => {
    const throttle = a > 0.05 ? Math.min(1, 0.25 + a / 3) : v > 0.5 && Math.abs(a) <= 0.05 ? 0.2 : 0;
    const brake = a < -0.05 ? Math.min(1, -a / 6) : 0;
    const noise = (rand() - 0.5) * 0.04;
    let steer = noise + steerExtra;
    if (steerTurn > 0) {
      steer += 0.6 * turnSign * Math.sin((Math.PI * (2 - steerTurn)) / 2);
      steerTurn -= DT;
    }
    steer = Math.max(-1, Math.min(1, steer));
    rows.push([r2(t), r1(x), r1(z), r1(v * 3.6), seg.limit, r2(throttle), r2(brake), r2(steer), handbrake]);
  };

  const addEvent = (check: Check, street: string, seg: Segment, speedKmh?: number) => {
    eventN += 1;
    const id = `e${eventN}`;
    const base = { id, t: r2(t), type: "rule_check" as const, rule: check.rule, outcome: check.outcome, x: r1(x), z: r1(z), street };
    if (check.outcome === "pass") {
      events.push({ ...base, ...(check.detail ? { detail: check.detail } : {}) });
      return;
    }
    let detail = check.detail;
    let outcome: { severity: Severity; fineAzn: number } | null;
    if (check.rule === "speeding") {
      const speed = Math.round(speedKmh ?? v * 3.6);
      detail = { speed_kmh: speed, limit_kmh: seg.limit, ...(detail ?? {}) };
      outcome = ruleOutcome("speeding", speed - seg.limit);
    } else {
      outcome = ruleOutcome(check.rule);
    }
    if (!outcome) throw new Error(`${s.name}: speeding fail below trigger at t=${t}`);
    events.push({ ...base, severity: outcome.severity, fine_azn: outcome.fineAzn, ...(detail ? { detail } : {}) });
  };

  for (const leg of s.legs) {
    const [dx, dz] = DIR[leg.heading];
    if (prevHeading && prevHeading !== leg.heading) {
      const order: Heading[] = ["N", "E", "S", "W"];
      const diff = (order.indexOf(leg.heading) - order.indexOf(prevHeading) + 4) % 4;
      turnSign = diff === 1 ? 1 : diff === 3 ? -1 : 0;
      steerTurn = turnSign ? 2 : 0;
    }
    prevHeading = leg.heading;

    for (const seg of leg.segments) {
      const target = seg.cruise / 3.6;
      const vEnd = (seg.endSpeed ?? seg.cruise) / 3.6;
      const decel = seg.decel ?? DECEL;
      const accel = seg.accel ?? ACCEL;
      let travelled = 0;
      let speedingDone = !seg.speedingFail;
      let peak = 0;
      let wobblePhase = 0;
      let guard = 0;
      while (travelled < seg.length - 0.05) {
        if (++guard > 100000) throw new Error(`${s.name}: simulation stuck`);
        const remaining = seg.length - travelled;
        const brakeDist = v > vEnd ? (v * v - vEnd * vEnd) / (2 * decel) : 0;
        let a: number;
        if (remaining <= brakeDist + v * DT) a = -decel;
        else if (v < target - 0.05) a = accel;
        else if (v > target + 0.3) a = -DECEL * 0.6;
        else a = 0;
        let nv = Math.max(0, v + a * DT);
        if (a < 0 && nv < vEnd && remaining <= brakeDist + v * DT) nv = Math.max(vEnd, nv);
        // never stall before the end of the segment
        if (nv < 0.5 && remaining > 0.5) nv = Math.min(0.5 + a * 0, 1.0);
        let step = ((v + nv) / 2) * DT;
        if (step > remaining) step = remaining;
        const realA = (nv - v) / DT;
        v = nv;
        travelled += step;
        distance += step;
        x += dx * step;
        z += dz * step;
        t += DT;
        wobblePhase += DT;
        const wobble = seg.wobble ? seg.wobble * Math.sign(Math.sin(wobblePhase * Math.PI * 1.1)) : 0;
        push(seg, realA, wobble);
        peak = Math.max(peak, v * 3.6);
        if (!speedingDone && v * 3.6 >= seg.cruise - 1) {
          addEvent({ rule: "speeding", outcome: "fail" }, leg.street, seg, seg.cruise);
          speedingDone = true;
        }
      }
      if (!speedingDone) addEvent({ rule: "speeding", outcome: "fail" }, leg.street, seg, peak);
      if (seg.endSpeed === 0) {
        // finish braking at the same rate (a few metres past the line) instead of snapping to 0
        while (v > 0) {
          const nv = Math.max(0, v - decel * DT);
          const step = ((v + nv) / 2) * DT;
          const realA = (nv - v) / DT;
          v = nv;
          distance += step;
          x += dx * step;
          z += dz * step;
          t += DT;
          push(seg, realA, 0);
        }
        const wait = seg.wait ?? 0;
        for (let w = 0; w < wait; w += DT) {
          t += DT;
          push(seg, 0, seg.wobble ? (rand() - 0.5) * 0.1 : 0, seg.handbrakeAtEnd ? 1 : 0);
        }
      }
      for (const c of seg.checks ?? []) addEvent(c, leg.street, seg);
      if (seg.checkpoint) {
        eventN += 1;
        events.push({ id: `e${eventN}`, t: r2(t), type: "checkpoint", index: checkpointIndex++ });
      }
    }
  }

  const failed = events.filter((e) => e.type === "rule_check" && e.outcome === "fail") as Extract<
    DriveTelemetry["events"][number],
    { type: "rule_check" }
  >[];
  const majors = failed.filter((e) => e.severity === "major").length;
  const minors = failed.filter((e) => e.severity === "minor").length;
  const exam =
    s.mode === "exam"
      ? {
          passed: majors === 0 && minors <= 2,
          minor_faults: minors,
          major_faults: majors,
          checkpoints_reached: checkpointIndex,
          checkpoints_total: s.exam?.checkpoints_total ?? checkpointIndex,
        }
      : null;

  return {
    schema: "roadwise.drive.v1",
    client: { name: "roadwise-fixtures", version: "0.1.0" },
    drive: {
      client_drive_id: fakeUuid(s.seed),
      mode: s.mode,
      district: s.district,
      route_id: s.route_id,
      car_type: "sedan",
      time_of_day: s.time_of_day,
      started_at: s.started_at,
      duration_s: r1(t),
      distance_m: r1(distance),
      exam,
    },
    samples: { hz: HZ, fields: [...SAMPLE_FIELDS], rows },
    events,
  };
}

// ---------- building blocks ----------
const cruise = (length: number, kmh: number, limit = 60, extra: Partial<Segment> = {}): Segment => ({
  length,
  cruise: kmh,
  limit,
  ...extra,
});
const stopSign = (outcome: "pass" | "fail", limit = 60): Segment =>
  outcome === "pass"
    ? { length: 60, cruise: 30, limit, endSpeed: 0, wait: 2, checks: [{ rule: "stop_sign", outcome }] }
    : { length: 60, cruise: 30, limit, endSpeed: 14, checks: [{ rule: "stop_sign", outcome }] };
const redLight = (outcome: "pass" | "fail", limit = 60, wait = 8): Segment =>
  outcome === "pass"
    ? { length: 80, cruise: 40, limit, endSpeed: 0, wait, checks: [{ rule: "red_light", outcome }] }
    : { length: 80, cruise: 45, limit, endSpeed: 42, checks: [{ rule: "red_light", outcome }] };
const crossing = (outcome: "pass" | "fail", limit = 60): Segment =>
  outcome === "pass"
    ? { length: 50, cruise: 35, limit, endSpeed: 0, wait: 4, checks: [{ rule: "pedestrian_crossing", outcome }] }
    : { length: 50, cruise: 38, limit, endSpeed: 35, checks: [{ rule: "pedestrian_crossing", outcome }] };
const giveWay = (outcome: "pass" | "fail", limit = 60): Segment =>
  outcome === "pass"
    ? { length: 50, cruise: 30, limit, endSpeed: 0, wait: 2, checks: [{ rule: "give_way", outcome }] }
    : { length: 50, cruise: 35, limit, endSpeed: 30, checks: [{ rule: "give_way", outcome }] };
const speeding = (length: number, kmh: number, limit = 60): Segment => ({ length, cruise: kmh, limit, speedingFail: true });
const hesitate = (length: number, limit = 60, wobble = 0): Segment => ({
  length,
  cruise: 25,
  limit,
  endSpeed: 0,
  wait: 2.5,
  wobble,
});
const harshStop = (length: number, kmh: number, check: Check, limit = 60): Segment => ({
  length,
  cruise: kmh,
  limit,
  endSpeed: 0,
  wait: 3,
  decel: 6,
  checks: [check],
});

// ---------- scenarios ----------
const scenarios: Scenario[] = [
  {
    name: "clean_drive",
    seed: 101,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "day",
    started_at: "2026-10-01T09:00:00Z",
    start: [0, 0],
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(250, 45), stopSign("pass"), cruise(200, 45), crossing("pass")] },
      { street: "Rəşid Behbudov küç.", heading: "S", segments: [cruise(300, 50), redLight("pass"), cruise(200, 48)] },
      { street: "Füzuli küç.", heading: "W", segments: [cruise(200, 45), giveWay("pass"), cruise(250, 50), crossing("pass")] },
      { street: "Bülbül pr.", heading: "N", segments: [cruise(300, 50), redLight("pass", 60, 6), cruise(150, 40, 60, { endSpeed: 0 })] },
    ],
    expected: {
      description: "Calm, legal drive: every rule check passed, smooth speed.",
      violations: {},
      major_count: 0,
      minor_count: 0,
      must_raise_rules: [],
      top_issue_rule: null,
      readiness_band: "ready",
      composure_min: 75,
    },
  },
  {
    name: "speeder",
    seed: 202,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "day",
    started_at: "2026-10-02T17:30:00Z",
    start: [0, 0],
    legs: [
      { street: "Neftçilər pr.", heading: "E", segments: [cruise(150, 55), speeding(500, 84), cruise(150, 60), redLight("pass")] },
      { street: "Azadlıq pr.", heading: "N", segments: [speeding(600, 104), harshStop(120, 70, { rule: "stop_sign", outcome: "pass" })] },
      { street: "Bakıxanov küç.", heading: "W", segments: [cruise(100, 40), speeding(350, 75), cruise(200, 55), crossing("pass")] },
      { street: "Səməd Vurğun küç.", heading: "S", segments: [cruise(250, 55), giveWay("pass"), cruise(100, 40, 60, { endSpeed: 0 })] },
    ],
    expected: {
      description: "Repeated speeding, one far over the limit (major band); other rules respected.",
      violations: { speeding: 3 },
      major_count: 1,
      minor_count: 2,
      must_raise_rules: ["speeding"],
      top_issue_rule: "speeding",
      readiness_band: "not_ready",
    },
  },
  {
    name: "red_light_runner",
    seed: 303,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "dusk",
    started_at: "2026-10-03T18:10:00Z",
    start: [0, 0],
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(200, 45), stopSign("pass"), cruise(250, 50), crossing("pass")] },
      { street: "Üzeyir Hacıbəyov küç.", heading: "S", segments: [cruise(200, 50), redLight("fail"), cruise(150, 50)] },
      { street: "İstiqlaliyyət küç.", heading: "W", segments: [cruise(100, 50), speeding(300, 75), cruise(150, 50), redLight("pass")] },
      { street: "Zərifə Əliyeva küç.", heading: "N", segments: [cruise(250, 45), giveWay("pass"), cruise(150, 40, 60, { endSpeed: 0 })] },
    ],
    expected: {
      description: "Runs one red light (major) and speeds once (minor); otherwise legal.",
      violations: { red_light: 1, speeding: 1 },
      major_count: 1,
      minor_count: 1,
      must_raise_rules: ["red_light", "speeding"],
      top_issue_rule: "red_light",
      readiness_band: "almost",
    },
  },
  {
    name: "nervous",
    seed: 404,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "night",
    started_at: "2026-10-04T20:00:00Z",
    start: [0, 0],
    legs: [
      {
        street: "Füzuli küç.",
        heading: "E",
        segments: [
          cruise(120, 30, 60, { wobble: 0.4, accel: 4.2 }),
          hesitate(80, 60, 0.4),
          cruise(100, 35, 60, { wobble: 0.4 }),
          harshStop(80, 35, { rule: "stop_sign", outcome: "pass" }),
          cruise(120, 30, 60, { wobble: 0.45 }),
          hesitate(60, 60, 0.4),
        ],
      },
      {
        street: "Rəşid Behbudov küç.",
        heading: "S",
        segments: [
          cruise(150, 32, 60, { wobble: 0.4 }),
          harshStop(70, 35, { rule: "pedestrian_crossing", outcome: "pass" }),
          hesitate(70, 60, 0.4),
          cruise(150, 30, 60, { wobble: 0.45 }),
          harshStop(80, 38, { rule: "red_light", outcome: "pass" }),
        ],
      },
      {
        street: "Bülbül pr.",
        heading: "W",
        segments: [
          cruise(120, 28, 60, { wobble: 0.4 }),
          hesitate(60, 60, 0.4),
          giveWay("pass"),
          cruise(150, 30, 60, { wobble: 0.4, endSpeed: 0, decel: 5.5 }),
        ],
      },
    ],
    expected: {
      description: "No violations, but jerky: harsh braking, steering wobble, hesitation stops, uneven speed.",
      violations: {},
      major_count: 0,
      minor_count: 0,
      must_raise_rules: [],
      top_issue_rule: null,
      readiness_band: "almost",
      composure_max: 55,
    },
  },
  {
    name: "mixed_exam_fail",
    seed: 505,
    mode: "exam",
    district: "baku-center",
    route_id: "exam-route-1",
    time_of_day: "day",
    started_at: "2026-10-05T10:00:00Z",
    start: [0, 0],
    exam: { checkpoints_total: 5 },
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(200, 40), stopSign("fail"), cruise(150, 45, 60, { checkpoint: true })] },
      { street: "Rəşid Behbudov küç.", heading: "S", segments: [cruise(250, 45), redLight("pass"), cruise(100, 45, 60, { checkpoint: true })] },
      {
        street: "Kiçik Qala küç.",
        heading: "W",
        segments: [
          cruise(30, 25, 20, { checks: [{ rule: "wrong_way", outcome: "fail" }] }),
          cruise(170, 20, 20, { checkpoint: true }),
        ],
      },
      { street: "Füzuli küç.", heading: "N", segments: [cruise(200, 45), crossing("fail"), cruise(150, 45, 60, { endSpeed: 0, handbrakeAtEnd: true, wait: 2 })] },
    ],
    expected: {
      description: "Exam: wrong way on a one-way street (major, instant fail), rolled a STOP and did not yield to a pedestrian.",
      violations: { wrong_way: 1, stop_sign: 1, pedestrian_crossing: 1 },
      major_count: 1,
      minor_count: 2,
      must_raise_rules: ["wrong_way", "stop_sign", "pedestrian_crossing"],
      top_issue_rule: "wrong_way",
      readiness_band: "not_ready",
      exam_passed: false,
    },
  },
  {
    name: "progress_series_1",
    seed: 601,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "day",
    started_at: "2026-10-06T09:00:00Z",
    start: [0, 0],
    series: { index: 1, expect_improved: [] },
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(150, 45), speeding(350, 78), stopSign("fail"), cruise(150, 45)] },
      {
        street: "Rəşid Behbudov küç.",
        heading: "S",
        segments: [cruise(200, 50), harshStop(100, 50, { rule: "red_light", outcome: "pass" }), speeding(300, 76), crossing("fail")],
      },
      { street: "Füzuli küç.", heading: "W", segments: [cruise(250, 45), giveWay("pass"), cruise(150, 40, 60, { endSpeed: 0 })] },
    ],
    expected: {
      description: "First drive of an improving series: two speeding minors, a rolled STOP, missed a pedestrian.",
      violations: { speeding: 2, stop_sign: 1, pedestrian_crossing: 1 },
      major_count: 0,
      minor_count: 4,
      must_raise_rules: ["speeding", "stop_sign", "pedestrian_crossing"],
      top_issue_rule: "speeding",
      readiness_band: "not_ready",
    },
  },
  {
    name: "progress_series_2",
    seed: 602,
    mode: "free",
    district: "baku-center",
    route_id: null,
    time_of_day: "day",
    started_at: "2026-10-07T09:00:00Z",
    start: [0, 0],
    series: { index: 2, expect_improved: ["compliance_rate", "fines_azn"] },
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(150, 45), cruise(350, 55), stopSign("pass"), cruise(150, 45)] },
      {
        street: "Rəşid Behbudov küç.",
        heading: "S",
        segments: [cruise(200, 50), redLight("pass"), speeding(300, 74), crossing("pass")],
      },
      { street: "Füzuli küç.", heading: "W", segments: [cruise(250, 45), giveWay("pass"), cruise(150, 40, 60, { endSpeed: 0 })] },
    ],
    expected: {
      description: "Second drive: STOP and crossing now correct, still one speeding minor.",
      violations: { speeding: 1 },
      major_count: 0,
      minor_count: 1,
      must_raise_rules: ["speeding"],
      top_issue_rule: "speeding",
      readiness_band: "almost",
    },
  },
  {
    name: "progress_series_3",
    seed: 603,
    mode: "exam",
    district: "baku-center",
    route_id: "exam-route-1",
    time_of_day: "day",
    started_at: "2026-10-08T09:00:00Z",
    start: [0, 0],
    series: { index: 3, expect_improved: ["compliance_rate", "fines_azn", "overspeed_time_share"] },
    exam: { checkpoints_total: 3 },
    legs: [
      { street: "Nizami küç.", heading: "E", segments: [cruise(150, 45), cruise(350, 55), stopSign("pass"), cruise(150, 45, 60, { checkpoint: true })] },
      {
        street: "Rəşid Behbudov küç.",
        heading: "S",
        segments: [cruise(200, 50), redLight("pass"), cruise(300, 55), crossing("pass"), cruise(50, 30, 60, { checkpoint: true })],
      },
      { street: "Füzuli küç.", heading: "W", segments: [cruise(250, 45), giveWay("pass"), cruise(150, 40, 60, { endSpeed: 0, checkpoint: true })] },
    ],
    expected: {
      description: "Third drive (exam): clean pass — every check passed.",
      violations: {},
      major_count: 0,
      minor_count: 0,
      must_raise_rules: [],
      top_issue_rule: null,
      readiness_band: "ready",
      exam_passed: true,
    },
  },
];

// ---------- main ----------
function countViolations(d: DriveTelemetry) {
  const v: Partial<Record<RuleKey, number>> = {};
  let major = 0;
  let minor = 0;
  for (const e of d.events) {
    if (e.type !== "rule_check" || e.outcome !== "fail") continue;
    v[e.rule] = (v[e.rule] ?? 0) + 1;
    if (e.severity === "major") major++;
    else minor++;
  }
  return { v, major, minor };
}

function main() {
  const dir = path.join(process.cwd(), "fixtures");
  mkdirSync(path.join(dir, "invalid"), { recursive: true });
  let failures = 0;
  for (const s of scenarios) {
    const telemetry = simulate(s);
    const parsed = parseTelemetry(telemetry);
    if (!parsed.ok) {
      console.error(`${s.name}: invalid`, parsed.issues);
      failures++;
      continue;
    }
    const { v, major, minor } = countViolations(telemetry);
    const sameViolations = JSON.stringify(Object.entries(v).sort()) === JSON.stringify(Object.entries(s.expected.violations).sort());
    if (!sameViolations || major !== s.expected.major_count || minor !== s.expected.minor_count) {
      console.error(`${s.name}: generated faults ${JSON.stringify({ v, major, minor })} differ from expectations`);
      failures++;
    }
    if (s.expected.exam_passed !== undefined && telemetry.drive.exam?.passed !== s.expected.exam_passed) {
      console.error(`${s.name}: exam passed=${telemetry.drive.exam?.passed}, expected ${s.expected.exam_passed}`);
      failures++;
    }
    const majorEventIds = telemetry.events
      .filter((e) => e.type === "rule_check" && e.outcome === "fail" && e.severity === "major")
      .map((e) => e.id);
    writeFileSync(path.join(dir, `${s.name}.json`), JSON.stringify(telemetry) + "\n");
    writeFileSync(
      path.join(dir, `${s.name}.expected.json`),
      JSON.stringify({ name: s.name, ...s.expected, major_event_ids: majorEventIds, series: s.series ?? null }, null, 2) + "\n",
    );
    console.log(
      `${s.name.padEnd(20)} ${telemetry.samples.rows.length} samples, ${telemetry.events.length} events, ${telemetry.drive.duration_s}s, ${telemetry.drive.distance_m}m, faults ${JSON.stringify(v)}`,
    );
  }

  // Deliberately broken uploads for the 422 path.
  const base = simulate(scenarios[0]);
  const unknownRule = structuredClone(base) as unknown as { events: { rule?: string }[] };
  unknownRule.events[0].rule = "tailgating";
  writeFileSync(path.join(dir, "invalid", "unknown_rule.json"), JSON.stringify(unknownRule) + "\n");
  const badFields = structuredClone(base) as unknown as { samples: { fields: string[] } };
  badFields.samples.fields = badFields.samples.fields.slice(0, 7);
  writeFileSync(path.join(dir, "invalid", "bad_fields.json"), JSON.stringify(badFields) + "\n");
  writeFileSync(path.join(dir, "invalid", "not_json.json"), "{ this is not json\n");

  if (failures) {
    console.error(`${failures} fixture problem(s)`);
    process.exit(1);
  }
  console.log(`wrote ${scenarios.length} fixtures + 3 invalid uploads`);
}

main();
