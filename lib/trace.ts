/**
 * Trace geometry for the drive page (roadwise-web §8): map metres plotted straight into
 * SVG (+x east, +z south — no flip), viewBox fitted to the bounds, ≤ 1,500 points,
 * runs split by overspeed, markers on rule checks.
 */
import { METRIC_CONFIG } from "@/lib/metrics";
import { isRuleCheck, toSamples, type DriveTelemetry } from "@/lib/telemetry/schema";
import type { RuleKey } from "@/lib/rules/catalog";

export const MAX_TRACE_POINTS = 1500;

export interface TraceMarker {
  id: string;
  x: number;
  z: number;
  kind: "major" | "minor" | "pass";
  rule: RuleKey;
  t: number;
}

export interface Trace {
  viewBox: [number, number, number, number];
  runs: { over: boolean; points: [number, number][] }[];
  markers: TraceMarker[];
  start: [number, number] | null;
  end: [number, number] | null;
}

export function buildTrace(telemetry: DriveTelemetry): Trace {
  const all = toSamples(telemetry);
  const stride = Math.max(1, Math.ceil(all.length / MAX_TRACE_POINTS));
  const samples = all.filter((_, i) => i % stride === 0 || i === all.length - 1);

  const markers: TraceMarker[] = telemetry.events.filter(isRuleCheck).map((e) => ({
    id: e.id,
    x: e.x,
    z: e.z,
    kind: e.outcome === "pass" ? "pass" : e.severity === "major" ? "major" : "minor",
    rule: e.rule,
    t: e.t,
  }));

  const xs = [...samples.map((s) => s.x), ...markers.map((m) => m.x)];
  const zs = [...samples.map((s) => s.z), ...markers.map((m) => m.z)];
  if (xs.length === 0) return { viewBox: [0, 0, 100, 100], runs: [], markers, start: null, end: null };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const span = Math.max(maxX - minX, maxZ - minZ, 50);
  const pad = span * 0.08;

  const runs: Trace["runs"] = [];
  const margin = METRIC_CONFIG.overspeedMarginKmh;
  for (const s of samples) {
    const over = s.speed_kmh > s.limit_kmh + margin;
    const p: [number, number] = [Math.round(s.x * 10) / 10, Math.round(s.z * 10) / 10];
    const last = runs.at(-1);
    if (last && last.over === over) last.points.push(p);
    else {
      // start each run at the previous run's last point so the line has no gaps
      runs.push({ over, points: last ? [last.points.at(-1)!, p] : [p] });
    }
  }
  return {
    viewBox: [minX - pad, minZ - pad, maxX - minX + 2 * pad, maxZ - minZ + 2 * pad],
    runs,
    markers,
    start: samples.length ? [samples[0].x, samples[0].z] : null,
    end: samples.length ? [samples.at(-1)!.x, samples.at(-1)!.z] : null,
  };
}
