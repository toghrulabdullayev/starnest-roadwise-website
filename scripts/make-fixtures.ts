import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDriveTelemetry,
  SAMPLE_FIELDS,
  type DriveTelemetry,
} from "../lib/telemetry/schema.ts";
import {
  expectedOutcome,
  speedingBand,
  type RuleKey,
  type Severity,
} from "../lib/rules/catalog.ts";

const HZ = 5;
const DT = 1 / HZ;
const ACC = 2.0;
const DEC = 2.5;
const CORNER_KMH = 25;
const STREETS = [
  "Nizami küç.",
  "Bakıxanov küç.",
  "Heydər Əliyev pr.",
  "Neftçilər pr.",
  "Rəsul Rza küç.",
];

const BASE_ROUTE: [number, number][] = [
  [0, 0],
  [700, 0],
  [700, -450],
  [1400, -450],
  [1400, -1000],
  [2100, -1000],
  [2100, -400],
  [2800, -400],
];

type PointEvent = {
  s: number;
  rule: RuleKey;
  outcome: "pass" | "fail";
  stopHoldS?: number;
  rollKmh?: number;
};
type SpeedSegment = { from: number; to: number; kmh: number };
type Scenario = {
  id: string;
  seed: number;
  mode: "free" | "exam";
  timeOfDay: "day" | "dusk" | "night";
  carType: string;
  startedAt: string;
  events: PointEvent[];
  speeding: SpeedSegment[];
  hesitations: { s: number; holdS: number }[];
  checkpoints: number[];
  endS?: number;
  cruiseKmh: number;
  nervous: boolean;
  exam: DriveTelemetry["drive"]["exam"];
  routeId: string | null;
  previous: string | null;
};

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

function uuidFrom(seed: number): string {
  const rand = mulberry32(seed * 7919 + 13);
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(rand() * 4)]}${hex(3)}-${hex(12)}`;
}

function buildPath(offset: [number, number]) {
  const pts = BASE_ROUTE.map(([x, z]) => [x + offset[0], z + offset[1]] as [number, number]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const at = (s: number) => {
    const c = Math.min(Math.max(s, 0), cum[cum.length - 1] - 1e-6);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < c) i++;
    const u = (c - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return {
      x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u,
      z: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u,
      heading: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]),
      street: STREETS[(i - 1) % STREETS.length],
    };
  };
  return { cum, length: cum[cum.length - 1], at };
}

function wrap(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

type Gate = { s: number; v: number; hold: number; ev?: PointEvent; done?: boolean };

function simulate(sc: Scenario) {
  const rand = mulberry32(sc.seed);
  const offset: [number, number] = [(sc.seed % 7) * 13, -(sc.seed % 5) * 9];
  const path = buildPath(offset);
  const L = sc.endS ?? path.length;

  const gates: Gate[] = [];
  for (let i = 1; i < path.cum.length - 1; i++) {
    gates.push({ s: path.cum[i], v: CORNER_KMH / 3.6, hold: -1 });
  }
  for (const e of sc.events) {
    if (e.stopHoldS) gates.push({ s: e.s, v: 0, hold: e.stopHoldS, ev: e });
    else if (e.rollKmh) gates.push({ s: e.s, v: e.rollKmh / 3.6, hold: -1 });
  }
  for (const h of sc.hesitations) gates.push({ s: h.s, v: 0, hold: h.holdS });
  gates.sort((a, b) => a.s - b.s);

  type RawEvent = {
    t: number;
    type: "rule_check" | "checkpoint";
    rule?: RuleKey;
    outcome?: "pass" | "fail";
    x: number;
    z: number;
    street: string;
    index?: number;
    speed?: number;
    segment?: number;
  };
  const raw: RawEvent[] = [];
  const fired = new Set<PointEvent>();
  const cpFired = new Set<number>();
  const segMax = sc.speeding.map(() => 0);
  const segEvent: (RawEvent | null)[] = sc.speeding.map(() => null);
  const rows: number[][] = [];
  const phase = rand() * 6;

  let t = 0;
  let s = 0;
  let v = 0;
  let hs = path.at(0).heading;
  let holdLeft = 0;
  let holdGate: Gate | null = null;
  let prevV = 0;
  let steps = 0;

  const record = (v0: number, v1: number, hold: boolean) => {
    const p = path.at(s);
    const a = (v1 - v0) / DT;
    const throttle = hold || v1 < 0.1 ? 0 : a > 0.05 ? Math.min(1, 0.3 + (a / ACC) * 0.7) : a < -0.05 ? 0 : 0.25;
    const brake = a < -0.05 ? Math.min(1, -a / 5) : 0;
    let steer = Math.max(-1, Math.min(1, wrap(p.heading - hs) * 2));
    steer += 0.02 * Math.sin(t * 1.3 + phase);
    if (sc.nervous) steer += 0.55 * Math.sin((2 * Math.PI * t) / 3.2 + phase);
    steer = Math.max(-1, Math.min(1, steer));
    rows.push([
      r2(t),
      r1(p.x),
      r1(p.z),
      r1(v1 * 3.6),
      60,
      r2(throttle),
      r2(brake),
      r2(steer),
      0,
    ]);
  };

  while (s < L - 0.5 && steps < 200_000) {
    steps++;
    const p = path.at(s);
    hs += wrap(p.heading - hs) * Math.min(1, DT * 3);

    if (holdLeft > 0) {
      record(0, 0, true);
      holdLeft -= DT;
      t += DT;
      if (holdLeft <= 0 && holdGate) {
        holdGate = null;
      }
      continue;
    }

    const seg = sc.speeding.findIndex((g) => s >= g.from && s < g.to);
    const noise = sc.nervous ? 0.35 * Math.sin((2 * Math.PI * t) / 9 + phase) : 0;
    let target = ((seg >= 0 ? sc.speeding[seg].kmh : sc.cruiseKmh) / 3.6) * (1 + noise);
    for (const g of gates) {
      if (g.done || g.s + 10 < s) continue;
      const d = Math.max(0, g.s - s);
      target = Math.min(target, Math.sqrt(g.v * g.v + 2 * DEC * d));
    }
    const nextV = Math.max(0, v + Math.max(-DEC * DT, Math.min(ACC * DT, target - v)));
    prevV = v;
    v = nextV;
    s += v * DT;

    const stop = gates.find((g) => g.hold > 0 && !g.done && s >= g.s - 0.6 && v < 0.5);
    if (stop) {
      s = stop.s;
      record(prevV, v, false);
      v = 0;
      stop.done = true;
      holdLeft = stop.hold;
      holdGate = stop;
      t += DT;
      if (stop.ev) {
        const q = path.at(s);
        raw.push({
          t: t + stop.hold * 0.4,
          type: "rule_check",
          rule: stop.ev.rule,
          outcome: stop.ev.outcome,
          x: q.x,
          z: q.z,
          street: q.street,
        });
        fired.add(stop.ev);
      }
      continue;
    }

    const q = path.at(s);
    for (const e of sc.events) {
      if (e.stopHoldS || fired.has(e) || s < e.s) continue;
      fired.add(e);
      raw.push({
        t,
        type: "rule_check",
        rule: e.rule,
        outcome: e.outcome,
        x: q.x,
        z: q.z,
        street: q.street,
        speed: Math.round(v * 3.6),
      });
    }
    sc.checkpoints.forEach((c, i) => {
      if (s >= c && !cpFired.has(i)) {
        cpFired.add(i);
        raw.push({ t, type: "checkpoint", index: i, x: q.x, z: q.z, street: q.street });
      }
    });
    if (seg >= 0) {
      segMax[seg] = Math.max(segMax[seg], v * 3.6);
      if (!segEvent[seg] && v * 3.6 > 60 + 11) {
        const ev: RawEvent = {
          t,
          type: "rule_check",
          rule: "speeding",
          outcome: "fail",
          x: q.x,
          z: q.z,
          street: q.street,
          segment: seg,
        };
        segEvent[seg] = ev;
        raw.push(ev);
      }
    }
    t += DT;
    record(prevV, v, false);
  }

  raw.sort((a, b) => a.t - b.t);
  const events: DriveTelemetry["events"] = raw.map((e, i) => {
    const id = `e${i + 1}`;
    if (e.type === "checkpoint") {
      return { id, t: r1(e.t), type: "checkpoint", index: e.index!, x: r1(e.x), z: r1(e.z) };
    }
    const base = {
      id,
      t: r1(e.t),
      type: "rule_check" as const,
      rule: e.rule!,
      outcome: e.outcome!,
      x: r1(e.x),
      z: r1(e.z),
      street: e.street,
    };
    if (e.outcome === "pass") return base;
    if (e.rule === "speeding") {
      const max = Math.round(segMax[e.segment!]);
      const band = speedingBand(max - 60)!;
      return {
        ...base,
        severity: band.severity as Severity,
        fine_azn: band.fineAzn,
        detail: { speed_kmh: max, limit_kmh: 60 },
      };
    }
    const out = expectedOutcome(e.rule!)!;
    return {
      ...base,
      severity: out.severity,
      fine_azn: out.fineAzn,
      detail: { speed_kmh: e.speed ?? 0 },
    };
  });

  const telemetry: DriveTelemetry = {
    schema: "roadwise.drive.v1",
    client: { name: "roadwise-unity", version: "0.1.0" },
    drive: {
      client_drive_id: uuidFrom(sc.seed),
      mode: sc.mode,
      district: "baku-center",
      route_id: sc.routeId,
      car_type: sc.carType,
      time_of_day: sc.timeOfDay,
      started_at: sc.startedAt,
      duration_s: r1(t),
      distance_m: r1(s),
      exam: sc.exam,
    },
    samples: { hz: HZ, fields: [...SAMPLE_FIELDS], rows },
    events,
  };
  return telemetry;
}

function severityRank(s?: Severity) {
  return s === "major" ? 2 : s === "minor" ? 1 : 0;
}

function expectedFor(sc: Scenario, t: DriveTelemetry) {
  const checks = t.events.filter((e) => e.type === "rule_check");
  const fails = checks.filter((e) => e.outcome === "fail");
  const byRule: Record<string, { count: number; fines_azn: number }> = {};
  for (const f of fails) {
    byRule[f.rule] ??= { count: 0, fines_azn: 0 };
    byRule[f.rule].count++;
    byRule[f.rule].fines_azn += f.fine_azn ?? 0;
  }
  const ranked = Object.entries(byRule).sort(([ra, a], [rb, b]) => {
    const sa = Math.max(...fails.filter((f) => f.rule === ra).map((f) => severityRank(f.severity)));
    const sb = Math.max(...fails.filter((f) => f.rule === rb).map((f) => severityRank(f.severity)));
    return sb - sa || b.count - a.count || b.fines_azn - a.fines_azn;
  });
  return {
    fixture: sc.id,
    previous: sc.previous,
    checks_total: checks.length,
    checks_passed: checks.length - fails.length,
    violations_by_rule: byRule,
    fines_total_azn: fails.reduce((n, f) => n + (f.fine_azn ?? 0), 0),
    major_count: fails.filter((f) => f.severity === "major").length,
    minor_count: fails.filter((f) => f.severity === "minor").length,
    collisions: fails.filter((f) => f.rule === "collision").length,
    required_issue_rules: Object.keys(byRule),
    top_issue_rule: ranked[0]?.[0] ?? null,
    hesitation_stops: sc.hesitations.length,
    nervous: sc.nervous,
    readiness_band: null as string | null,
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /\[\s*(-?\d[\d.eE+-]*(?:,\s*-?\d[\d.eE+-]*)*)\s*\]/g,
    (_, inner: string) => `[${inner.replace(/\s+/g, " ")}]`,
  );
}

const pass = (s: number, rule: RuleKey, stopHoldS?: number): PointEvent => ({
  s,
  rule,
  outcome: "pass",
  stopHoldS,
});
const fail = (s: number, rule: RuleKey, rollKmh?: number): PointEvent => ({
  s,
  rule,
  outcome: "fail",
  rollKmh,
});

const base = {
  mode: "free" as const,
  timeOfDay: "day" as const,
  carType: "sedan",
  speeding: [] as SpeedSegment[],
  hesitations: [] as { s: number; holdS: number }[],
  checkpoints: [] as number[],
  cruiseKmh: 50,
  nervous: false,
  exam: null,
  routeId: null,
  previous: null,
};

const scenarios: Scenario[] = [
  {
    ...base,
    id: "clean_drive",
    seed: 101,
    startedAt: "2026-10-01T09:00:00Z",
    events: [
      pass(300, "stop_sign", 2.5),
      pass(900, "red_light", 6),
      pass(1500, "pedestrian_crossing", 3),
      pass(2200, "give_way", 2.5),
      pass(2800, "red_light", 5),
      pass(3400, "stop_sign", 2.5),
    ],
  },
  {
    ...base,
    id: "speeder",
    seed: 102,
    startedAt: "2026-10-02T09:00:00Z",
    events: [pass(400, "stop_sign", 2.5), pass(2000, "red_light", 5), pass(3000, "pedestrian_crossing", 3)],
    speeding: [
      { from: 1000, to: 1500, kmh: 75 },
      { from: 2300, to: 2800, kmh: 92 },
      { from: 3750, to: 4300, kmh: 115 },
    ],
  },
  {
    ...base,
    id: "red_light_runner",
    seed: 103,
    carType: "hatchback",
    timeOfDay: "dusk",
    startedAt: "2026-10-03T17:30:00Z",
    events: [
      pass(600, "red_light", 5),
      fail(1000, "red_light"),
      fail(2000, "stop_sign", 18),
      pass(3000, "pedestrian_crossing", 3),
      pass(3500, "stop_sign", 2.5),
    ],
  },
  {
    ...base,
    id: "nervous",
    seed: 104,
    carType: "compact",
    startedAt: "2026-10-04T10:00:00Z",
    nervous: true,
    cruiseKmh: 40,
    events: [pass(500, "stop_sign", 2.5), pass(1800, "red_light", 5)],
    hesitations: [
      { s: 1000, holdS: 2.6 },
      { s: 2600, holdS: 2.6 },
      { s: 3300, holdS: 2.6 },
    ],
  },
  {
    ...base,
    id: "mixed_exam_fail",
    seed: 105,
    mode: "exam",
    routeId: "baku-center-1",
    startedAt: "2026-10-05T11:00:00Z",
    events: [
      pass(300, "red_light", 5),
      pass(1200, "pedestrian_crossing", 3),
      fail(1500, "stop_sign", 20),
      fail(2100, "give_way"),
    ],
    speeding: [{ from: 450, to: 1000, kmh: 78 }],
    checkpoints: [400, 900, 1400, 1800, 2050],
    endS: 2140,
    exam: {
      passed: false,
      minor_faults: 2,
      major_faults: 1,
      checkpoints_reached: 5,
      checkpoints_total: 8,
    },
  },
  {
    ...base,
    id: "progress_series_1",
    seed: 111,
    startedAt: "2026-10-02T09:00:00Z",
    events: [
      pass(300, "stop_sign", 2.5),
      fail(900, "red_light"),
      fail(1500, "pedestrian_crossing"),
      fail(3300, "stop_sign", 20),
    ],
    speeding: [
      { from: 2300, to: 2800, kmh: 87 },
      { from: 3800, to: 4300, kmh: 105 },
    ],
  },
  {
    ...base,
    id: "progress_series_2",
    seed: 112,
    startedAt: "2026-10-05T09:00:00Z",
    previous: "progress_series_1",
    events: [
      pass(300, "stop_sign", 2.5),
      pass(900, "red_light", 5),
      pass(1500, "pedestrian_crossing", 3),
      fail(3300, "stop_sign", 20),
    ],
    speeding: [{ from: 2300, to: 2800, kmh: 76 }],
  },
  {
    ...base,
    id: "progress_series_3",
    seed: 113,
    startedAt: "2026-10-08T09:00:00Z",
    previous: "progress_series_2",
    events: [
      pass(300, "stop_sign", 2.5),
      pass(900, "red_light", 5),
      pass(1500, "pedestrian_crossing", 3),
      pass(2200, "give_way", 2.5),
      pass(3300, "stop_sign", 2.5),
    ],
  },
];

const outDir = join(process.cwd(), "fixtures");
mkdirSync(outDir, { recursive: true });
for (const sc of scenarios) {
  const telemetry = simulate(sc);
  const parsed = parseDriveTelemetry(telemetry);
  if (!parsed.ok) {
    console.error(sc.id, parsed.issues.slice(0, 5));
    process.exit(1);
  }
  writeFileSync(join(outDir, `${sc.id}.json`), stringify(telemetry) + "\n");
  writeFileSync(join(outDir, `${sc.id}.expected.json`), stringify(expectedFor(sc, telemetry)) + "\n");
  console.log(
    `${sc.id}: ${telemetry.drive.duration_s}s ${telemetry.drive.distance_m}m rows=${telemetry.samples.rows.length} events=${telemetry.events.length}`,
  );
}
