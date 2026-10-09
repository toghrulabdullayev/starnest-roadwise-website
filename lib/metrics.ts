/**
 * Deterministic driving metrics (roadwise-ai-instructor §2). Pure: telemetry in, numbers out.
 * Thresholds are starting values to calibrate on real drives — see eval/CALIBRATION.md.
 */
import type { RuleKey, Severity } from "@/lib/rules/catalog";
import { isRuleCheck, toSamples, type DriveTelemetry, type RuleCheckEvent, type Sample } from "@/lib/telemetry/schema";

export const METRIC_CONFIG = {
  /** km/h: a sample counts as moving above this speed */
  movingKmh: 2,
  /** km/h over the posted limit that counts as overspeed (same trigger as the speeding fine) */
  overspeedMarginKmh: 11,
  /** m/s²: |Δv/Δt| beyond this is a harsh brake / harsh acceleration */
  harshAccelMs2: 3.5,
  /** s: harsh events closer than this are one event */
  harshDebounceS: 1,
  /** steering: a reversal is a sign change whose swing exceeds this */
  steerReversalDelta: 0.3,
  /** steering values within ±deadband count as centred */
  steerDeadband: 0.05,
  /** stops: below this speed for at least stopMinS */
  stopKmh: 1,
  stopMinS: 1.5,
  /** a stop is explained by a rule check within this distance or time */
  stopExplainM: 15,
  stopExplainS: 3,
  /** composure penalties (points) */
  composure: {
    perHarshPerMin: 12,
    harshCap: 30,
    perReversalPerMin: 2.5,
    reversalCap: 30,
    perHesitation: 6,
    hesitationCap: 24,
    speedCvFree: 0.45,
    perSpeedCvAbove: 40,
    speedCvCap: 16,
  },
} as const;

export interface RuleViolation {
  count: number;
  fines_azn: number;
}

export interface DriveMetrics {
  // rules
  checks_total: number;
  checks_passed: number;
  compliance_rate: number | null;
  violations_by_rule: Partial<Record<RuleKey, RuleViolation>>;
  fines_total_azn: number;
  major_count: number;
  minor_count: number;
  // speed
  overspeed_time_share: number;
  mean_overspeed_kmh: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  // smoothness
  harsh_brake_count: number;
  harsh_accel_count: number;
  jerk_rms: number;
  // control
  steer_reversals_per_min: number;
  collisions: number;
  handbrake_uses: number;
  // composure
  hesitation_stops: number;
  speed_cv: number;
  composure_index: number;
  // exam
  exam: DriveTelemetry["drive"]["exam"];
  // context
  duration_s: number;
  distance_m: number;
  moving_time_s: number;
  mode: "free" | "exam";
  district: string | null;
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** Duration each sample represents: gap to the next sample (last one: 1/hz). */
export function sampleDurations(samples: Sample[], hz: number): number[] {
  return samples.map((s, i) => (i + 1 < samples.length ? Math.max(0, samples[i + 1].t - s.t) : 1 / hz));
}

export function ruleMetrics(events: DriveTelemetry["events"]) {
  const checks = events.filter(isRuleCheck);
  const failed = checks.filter((e) => e.outcome === "fail");
  const violations: Partial<Record<RuleKey, RuleViolation>> = {};
  for (const e of failed) {
    const v = (violations[e.rule] ??= { count: 0, fines_azn: 0 });
    v.count += 1;
    v.fines_azn += e.fine_azn ?? 0;
  }
  const sev = (s: Severity) => failed.filter((e) => e.severity === s).length;
  return {
    checks_total: checks.length,
    checks_passed: checks.length - failed.length,
    compliance_rate: checks.length ? round((checks.length - failed.length) / checks.length, 4) : null,
    violations_by_rule: violations,
    fines_total_azn: failed.reduce((a, e) => a + (e.fine_azn ?? 0), 0),
    major_count: sev("major"),
    minor_count: sev("minor"),
    collisions: failed.filter((e) => e.rule === "collision").length,
  };
}

export function speedMetrics(samples: Sample[], dts: number[]) {
  const { movingKmh, overspeedMarginKmh } = METRIC_CONFIG;
  let moving = 0;
  let over = 0;
  let sum = 0;
  let max = 0;
  let excessSum = 0;
  let excessN = 0;
  const speeds: number[] = [];
  samples.forEach((s, i) => {
    max = Math.max(max, s.speed_kmh);
    if (s.speed_kmh <= movingKmh) return;
    moving += dts[i];
    sum += s.speed_kmh * dts[i];
    speeds.push(s.speed_kmh);
    if (s.speed_kmh > s.limit_kmh + overspeedMarginKmh) over += dts[i];
    if (s.speed_kmh > s.limit_kmh) {
      excessSum += s.speed_kmh - s.limit_kmh;
      excessN += 1;
    }
  });
  const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const sd = speeds.length ? Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length) : 0;
  return {
    moving_time_s: round(moving, 1),
    overspeed_time_share: moving ? round(over / moving, 4) : 0,
    /** mean km/h above the limit over samples that exceed it */
    mean_overspeed_kmh: excessN ? round(excessSum / excessN, 1) : 0,
    avg_speed_kmh: moving ? round(sum / moving, 1) : 0,
    max_speed_kmh: round(max, 1),
    speed_cv: mean ? round(sd / mean, 3) : 0,
  };
}

/** Acceleration between consecutive samples (m/s²), aligned to the later sample. */
function accelerations(samples: Sample[]): number[] {
  return samples.map((s, i) => {
    if (i === 0) return 0;
    const dt = s.t - samples[i - 1].t;
    return dt > 0 ? (s.speed_kmh - samples[i - 1].speed_kmh) / 3.6 / dt : 0;
  });
}

export function smoothnessMetrics(samples: Sample[]) {
  const { harshAccelMs2, harshDebounceS, movingKmh } = METRIC_CONFIG;
  const acc = accelerations(samples);
  let brakes = 0;
  let accels = 0;
  let lastBrake = -Infinity;
  let lastAccel = -Infinity;
  acc.forEach((a, i) => {
    const t = samples[i].t;
    if (a < -harshAccelMs2) {
      if (t - lastBrake >= harshDebounceS) brakes++;
      lastBrake = t;
    } else if (a > harshAccelMs2) {
      if (t - lastAccel >= harshDebounceS) accels++;
      lastAccel = t;
    }
  });
  // jerk = d(acc)/dt, RMS over moving samples
  let sq = 0;
  let n = 0;
  for (let i = 2; i < samples.length; i++) {
    if (samples[i].speed_kmh <= movingKmh) continue;
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0) continue;
    const j = (acc[i] - acc[i - 1]) / dt;
    sq += j * j;
    n++;
  }
  return { harsh_brake_count: brakes, harsh_accel_count: accels, jerk_rms: n ? round(Math.sqrt(sq / n), 2) : 0 };
}

export function controlMetrics(samples: Sample[], movingTimeS: number) {
  const { steerReversalDelta, steerDeadband, movingKmh } = METRIC_CONFIG;
  let reversals = 0;
  let sign = 0;
  let extreme = 0;
  let handbrake = 0;
  samples.forEach((s, i) => {
    if (s.handbrake >= 0.5 && (i === 0 || samples[i - 1].handbrake < 0.5)) handbrake++;
    if (s.speed_kmh <= movingKmh || Math.abs(s.steer) <= steerDeadband) return;
    const sg = Math.sign(s.steer);
    if (sign === 0) {
      sign = sg;
      extreme = s.steer;
      return;
    }
    if (sg === sign) {
      if (Math.abs(s.steer) > Math.abs(extreme)) extreme = s.steer;
      return;
    }
    if (Math.abs(s.steer - extreme) > steerReversalDelta) reversals++;
    sign = sg;
    extreme = s.steer;
  });
  return {
    steer_reversals_per_min: movingTimeS > 0 ? round(reversals / (movingTimeS / 60), 2) : 0,
    handbrake_uses: handbrake,
  };
}

/** Stops (< 1 km/h for ≥ 1.5 s) mid-drive that no rule check explains (15 m / 3 s). */
export function hesitationStops(samples: Sample[], checks: RuleCheckEvent[]): number {
  const { stopKmh, stopMinS, stopExplainM, stopExplainS, movingKmh } = METRIC_CONFIG;
  const firstMove = samples.findIndex((s) => s.speed_kmh > movingKmh);
  if (firstMove < 0) return 0;
  let count = 0;
  let i = firstMove;
  while (i < samples.length) {
    if (samples[i].speed_kmh >= stopKmh) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].speed_kmh < stopKmh) j++;
    const start = samples[i];
    const end = samples[j];
    const endsDrive = j === samples.length - 1;
    if (!endsDrive && end.t - start.t >= stopMinS) {
      const explained = checks.some(
        (e) =>
          (e.t >= start.t - stopExplainS && e.t <= end.t + stopExplainS) ||
          Math.hypot(e.x - start.x, e.z - start.z) <= stopExplainM,
      );
      if (!explained) count++;
    }
    i = j + 1;
  }
  return count;
}

export function composureIndex(input: {
  harshPerMin: number;
  reversalsPerMin: number;
  hesitationStops: number;
  speedCv: number;
}): number {
  const c = METRIC_CONFIG.composure;
  const penalty =
    Math.min(c.harshCap, input.harshPerMin * c.perHarshPerMin) +
    Math.min(c.reversalCap, input.reversalsPerMin * c.perReversalPerMin) +
    Math.min(c.hesitationCap, input.hesitationStops * c.perHesitation) +
    Math.min(c.speedCvCap, Math.max(0, input.speedCv - c.speedCvFree) * c.perSpeedCvAbove);
  return Math.round(Math.max(0, Math.min(100, 100 - penalty)));
}

export function computeMetrics(telemetry: DriveTelemetry): DriveMetrics {
  const samples = toSamples(telemetry);
  const dts = sampleDurations(samples, telemetry.samples.hz);
  const rules = ruleMetrics(telemetry.events);
  const speed = speedMetrics(samples, dts);
  const smooth = smoothnessMetrics(samples);
  const control = controlMetrics(samples, speed.moving_time_s);
  const checks = telemetry.events.filter(isRuleCheck);
  const hesitation = hesitationStops(samples, checks);
  const movingMin = speed.moving_time_s / 60;
  const composure = composureIndex({
    harshPerMin: movingMin > 0 ? (smooth.harsh_brake_count + smooth.harsh_accel_count) / movingMin : 0,
    reversalsPerMin: control.steer_reversals_per_min,
    hesitationStops: hesitation,
    speedCv: speed.speed_cv,
  });
  return {
    checks_total: rules.checks_total,
    checks_passed: rules.checks_passed,
    compliance_rate: rules.compliance_rate,
    violations_by_rule: rules.violations_by_rule,
    fines_total_azn: rules.fines_total_azn,
    major_count: rules.major_count,
    minor_count: rules.minor_count,
    overspeed_time_share: speed.overspeed_time_share,
    mean_overspeed_kmh: speed.mean_overspeed_kmh,
    avg_speed_kmh: speed.avg_speed_kmh,
    max_speed_kmh: speed.max_speed_kmh,
    harsh_brake_count: smooth.harsh_brake_count,
    harsh_accel_count: smooth.harsh_accel_count,
    jerk_rms: smooth.jerk_rms,
    steer_reversals_per_min: control.steer_reversals_per_min,
    collisions: rules.collisions,
    handbrake_uses: control.handbrake_uses,
    hesitation_stops: hesitation,
    speed_cv: speed.speed_cv,
    composure_index: composure,
    exam: telemetry.drive.exam,
    duration_s: telemetry.drive.duration_s,
    distance_m: telemetry.drive.distance_m,
    moving_time_s: speed.moving_time_s,
    mode: telemetry.drive.mode,
    district: telemetry.drive.district ?? null,
  };
}

/** Harsh events per 10 moving minutes (used by readiness and history). */
export function harshPer10Min(m: DriveMetrics): number {
  return m.moving_time_s > 0 ? ((m.harsh_brake_count + m.harsh_accel_count) / m.moving_time_s) * 600 : 0;
}
