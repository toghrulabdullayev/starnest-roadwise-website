import type { Dictionary } from "../../i18n/getDictionary";
import { ruleName, type RuleKey } from "../../rules/catalog.ts";
import type { Locale } from "../../i18n/config";
import type { DebriefInput } from "./input";
import type { Debrief } from "./schema";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function buildFallbackDebrief(
  input: DebriefInput,
  locale: Locale,
  dict: Dictionary["debrief"],
): Debrief {
  const { metrics } = input;
  const fails = input.events.filter((e) => e.outcome === "fail");
  const passes = input.events.filter((e) => e.outcome === "pass");

  const grouped = new Map<RuleKey, typeof fails>();
  for (const f of fails) grouped.set(f.rule, [...(grouped.get(f.rule) ?? []), f]);

  const ranked = [...grouped.entries()]
    .map(([rule, events]) => ({
      rule,
      events,
      major: events.some((e) => e.severity === "major"),
      fines: events.reduce((n, e) => n + (e.fine_azn ?? 0), 0),
    }))
    .sort(
      (a, b) =>
        Number(b.major) - Number(a.major) ||
        b.events.length - a.events.length ||
        b.fines - a.fines,
    );

  const issues = ranked.slice(0, 3).map((g) => ({
    title: ruleName(g.rule, locale),
    severity: g.major ? ("major" as const) : ("minor" as const),
    rule: g.rule,
    event_ids: g.events.slice(0, 10).map((e) => e.id),
    why_it_matters: g.major ? dict.whyMajor : dict.whyMinor,
    how_to_fix: dict.tips[g.rule],
  }));

  const summary =
    metrics.checks_total === 0
      ? dict.summaryNoChecks
      : fails.length === 0
        ? fill(dict.summaryClean, { checks: metrics.checks_total })
        : fill(dict.summaryFaults, {
            passed: metrics.checks_passed,
            checks: metrics.checks_total,
            fines: metrics.fines_total_azn,
            major: metrics.major_count,
            minor: metrics.minor_count,
          });

  const strengths =
    passes.length > 0
      ? [
          {
            text: fill(dict.strengthPasses, {
              passed: metrics.checks_passed,
              checks: metrics.checks_total,
            }),
            event_ids: passes.slice(0, 3).map((e) => e.id),
          },
        ]
      : [];

  const top = ranked[0];
  return {
    summary,
    strengths,
    issues,
    progress: null,
    next_drive: {
      focus: top
        ? fill(dict.focusFault, { rule: ruleName(top.rule, locale) })
        : dict.focusClean,
      mode: "free",
      drills: ranked.slice(0, 3).map((g) => dict.tips[g.rule]),
    },
  };
}
