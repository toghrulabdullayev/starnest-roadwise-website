import { queryOne } from "@/lib/db";
import { listGameTokens } from "@/lib/auth/gameToken";
import { RULE_KEYS, type RuleKey } from "@/lib/rules/catalog";
import { driveSeries } from "./queries";

export async function getProfileData(userId: string) {
  const [series, totals, devices] = await Promise.all([
    driveSeries(userId, 50),
    queryOne<{ drives: number; distance_m: number | null; passed: number | null; total: number | null; fines: number | null }>(
      `SELECT COUNT(*) AS drives, SUM(distance_m) AS distance_m,
              SUM(json_extract(metrics, '$.checks_passed')) AS passed,
              SUM(json_extract(metrics, '$.checks_total')) AS total,
              SUM(json_extract(metrics, '$.fines_total_azn')) AS fines
       FROM drives WHERE user_id = ?`,
      [userId],
    ),
    listGameTokens(userId),
  ]);

  const violations = new Map<RuleKey, { count: number; fines: number }>();
  for (const d of series)
    for (const k of RULE_KEYS) {
      const v = d.metrics.violations_by_rule[k];
      if (!v) continue;
      const agg = violations.get(k) ?? { count: 0, fines: 0 };
      agg.count += v.count;
      agg.fines += v.fines_azn;
      violations.set(k, agg);
    }

  const latest = series.at(-1) ?? null;
  return {
    series,
    latest,
    totals: {
      drives: Number(totals?.drives ?? 0),
      distance_m: Number(totals?.distance_m ?? 0),
      compliance: totals?.total ? Number(totals.passed) / Number(totals.total) : null,
      fines: Number(totals?.fines ?? 0),
    },
    violations: [...violations.entries()].map(([rule, v]) => ({ rule, ...v })).sort((a, b) => b.count - a.count),
    exams: series.filter((d) => d.mode === "exam").reverse(),
    devices,
  };
}
export type ProfileData = Awaited<ReturnType<typeof getProfileData>>;
