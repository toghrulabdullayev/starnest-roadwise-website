import type { DriveMetrics } from "@/lib/metrics";
import type { History } from "@/lib/history";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import { fmt } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { fmtAzn, fmtKmh, fmtNumber, fmtPercent } from "@/lib/i18n/format";
import { ruleName } from "@/lib/rules/catalog";

export function MetricGroups({ m, locale, dict }: { m: DriveMetrics; locale: Locale; dict: Dictionary }) {
  const t = dict.drive.metrics;
  const g = dict.drive.groups;
  const kmh = (v: number) => fmtKmh(locale, v);
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: g.rules,
      rows: [
        [t.checks, `${m.checks_passed} / ${m.checks_total}`],
        [t.compliance, fmtPercent(locale, m.compliance_rate)],
        [t.fines, fmtAzn(locale, m.fines_total_azn)],
        [t.faults, `${m.major_count} / ${m.minor_count}`],
      ],
    },
    {
      title: g.speed,
      rows: [
        [t.avgSpeed, kmh(m.avg_speed_kmh)],
        [t.maxSpeed, kmh(m.max_speed_kmh)],
        [t.overspeed, fmtPercent(locale, m.overspeed_time_share)],
        [t.meanOver, kmh(m.mean_overspeed_kmh)],
      ],
    },
    {
      title: g.smoothness,
      rows: [
        [t.harshBrake, fmtNumber(locale, m.harsh_brake_count)],
        [t.harshAccel, fmtNumber(locale, m.harsh_accel_count)],
        [t.jerk, `${fmtNumber(locale, m.jerk_rms, 2)} ${dict.units.mps3}`],
      ],
    },
    {
      title: g.control,
      rows: [
        [t.reversals, fmtNumber(locale, m.steer_reversals_per_min, 1)],
        [t.collisions, fmtNumber(locale, m.collisions)],
        [t.handbrake, fmtNumber(locale, m.handbrake_uses)],
      ],
    },
    {
      title: g.composure,
      rows: [
        [t.composureIndex, `${m.composure_index} / 100`],
        [t.hesitation, fmtNumber(locale, m.hesitation_stops)],
        [t.speedCv, fmtNumber(locale, m.speed_cv, 2)],
      ],
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((grp) => (
        <section key={grp.title} className="border-2 border-surface bg-canvas p-4">
          <h3 className="font-sans text-sm font-bold uppercase tracking-wide">{grp.title}</h3>
          <dl className="mt-2 flex flex-col">
            {grp.rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-1.5 last:border-0">
                <dt className="text-sm text-text-muted">{k}</dt>
                <dd className="whitespace-nowrap font-mono text-sm font-bold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

const arrow = { improved: "▲", worse: "▼", same: "■" } as const;
const tone = { improved: "text-success-ink", worse: "text-danger-ink", same: "text-text-muted" } as const;

export function Deltas({ history, locale, dict }: { history: History | null; locale: Locale; dict: Dictionary }) {
  const t = dict.drive;
  if (!history) return <p className="text-text-muted">{t.deltasFirst}</p>;
  const value = (key: string, v: number) =>
    key === "compliance_rate" || key === "overspeed_time_share"
      ? fmtPercent(locale, v)
      : key === "fines_azn"
        ? fmtAzn(locale, v)
        : fmtNumber(locale, v, 1);
  const rows = [
    ...history.deltas.map((d) => ({ key: d.key, label: dict.history.keys[d.key], cur: value(d.key, d.current), prev: value(d.key, d.previous_mean), dir: d.direction })),
    ...history.rules.map((r) => ({
      key: r.rule,
      label: ruleName(r.rule, locale),
      cur: fmtNumber(locale, r.current),
      prev: fmtNumber(locale, r.previous_mean, 1),
      dir: r.direction,
    })),
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">{fmt(t.deltasBasis, { n: history.previous_count })}</p>
      <ul className="grid min-w-0 gap-2 lg:grid-cols-2">
        {rows.map((r) => (
          <li key={r.key} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-2 border-surface bg-canvas px-3 py-2">
            <span className="font-semibold">{r.label}</span>
            <span className="flex flex-wrap items-center gap-x-2">
              <span className="whitespace-nowrap font-mono text-sm tabular-nums">
                {r.cur} <span className="whitespace-nowrap text-text-muted">({t.previous} {r.prev})</span>
              </span>
              <span className={`whitespace-nowrap font-mono text-sm font-bold ${tone[r.dir]}`}>
                {arrow[r.dir]} {dict.history[r.dir]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
