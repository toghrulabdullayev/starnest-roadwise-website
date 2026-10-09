/**
 * Deterministic template debrief (roadwise-ai-instructor §6): used when the model is not
 * configured, fails, or produces output the grounding validator rejects twice.
 * Built only from the model input, so it always passes the validator itself.
 */
import type { Debrief } from "@/lib/prompts/debrief";
import { fmt, getDictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import type { RuleKey } from "@/lib/rules/catalog";
import type { DebriefEvent, DebriefInput } from "./input";

const MAX_ISSUES = 3;

interface RuleGroup {
  rule: RuleKey;
  events: DebriefEvent[];
  major: boolean;
}

/** Failed checks grouped by rule, most important first: major, then repeated, then earliest. */
export function rankFaults(input: DebriefInput): RuleGroup[] {
  const groups = new Map<RuleKey, RuleGroup>();
  for (const e of input.events) {
    if (e.outcome !== "fail") continue;
    const g = groups.get(e.rule) ?? { rule: e.rule, events: [], major: false };
    g.events.push(e);
    g.major ||= e.severity === "major";
    groups.set(e.rule, g);
  }
  const first = (g: RuleGroup) => g.events[0].time;
  return [...groups.values()].sort(
    (a, b) => Number(b.major) - Number(a.major) || b.events.length - a.events.length || first(a).localeCompare(first(b)),
  );
}

export function buildFallbackDebrief(input: DebriefInput, locale: Locale): Debrief {
  const dict = getDictionary(locale);
  const t = dict.instructor;
  const ruleName = (k: RuleKey) => input.rules.find((r) => r.key === k)?.name ?? k;
  const m = input.metrics;
  const ranked = rankFaults(input);
  const majorGroups = ranked.filter((g) => g.major).length;
  const kept = ranked.slice(0, Math.max(MAX_ISSUES, majorGroups));

  const summary =
    !m.checks_total
      ? t.summaryNoChecks
      : ranked.length === 0
        ? fmt(t.summaryClean, { passed: m.checks_passed ?? 0 })
        : fmt(t.summaryFaults, {
            passed: m.checks_passed ?? 0,
            total: m.checks_total,
            fines: m.fines_total_azn ?? 0,
            rule: ruleName(ranked[0].rule),
          });

  const issues: Debrief["issues"] = kept.map((g) => {
    const e = g.events[0];
    const title =
      g.events.length > 1
        ? fmt(t.issueRepeated, { rule: ruleName(g.rule) })
        : e.street
          ? fmt(t.issueTitleStreet, { rule: ruleName(g.rule), street: e.street, time: e.time })
          : fmt(t.issueTitle, { rule: ruleName(g.rule), time: e.time });
    const text = t.rules[g.rule];
    return {
      title,
      severity: g.major ? "major" : "minor",
      rule: g.rule,
      event_ids: g.events.map((x) => x.id),
      why_it_matters: text.why,
      how_to_fix: text.how,
    };
  });

  const strengths: Debrief["strengths"] = [];
  const passByRule = new Map<RuleKey, DebriefEvent>();
  for (const e of input.events) if (e.outcome === "pass" && !passByRule.has(e.rule)) passByRule.set(e.rule, e);
  const passes = [...passByRule.values()].slice(0, 3);
  if (passes.length)
    strengths.push({ text: fmt(t.strengthPasses, { rules: passes.map((e) => t.rules[e.rule].topic).join(", ") }), event_ids: passes.map((e) => e.id) });
  if (m.checks_total && !ranked.some((g) => g.rule === "speeding") && (m.overspeed_time_pct ?? 0) === 0)
    strengths.push({ text: t.strengthNoSpeeding, event_ids: [] });
  if ((m.composure_index ?? 0) >= 75) strengths.push({ text: fmt(t.strengthComposure, { composure: m.composure_index ?? 0 }), event_ids: [] });

  const progress: Debrief["progress"] = input.history
    ? {
        improved: input.history.changes
          .filter((c) => c.direction === "improved")
          .map((c) => fmt(t.progressItem, { label: dict.history.keys[c.key as keyof typeof dict.history.keys] ?? c.key, direction: dict.history.improved })),
        worse: input.history.changes
          .filter((c) => c.direction === "worse")
          .map((c) => fmt(t.progressItem, { label: dict.history.keys[c.key as keyof typeof dict.history.keys] ?? c.key, direction: dict.history.worse })),
      }
    : null;

  // Most frequent fault decides the next focus; ties go to the more severe.
  const byFrequency = [...ranked].sort((a, b) => b.events.length - a.events.length || Number(b.major) - Number(a.major));
  const top = byFrequency[0];
  const nervous = (m.composure_index ?? 100) < 60;
  const next_drive: Debrief["next_drive"] = top
    ? {
        focus: t.rules[top.rule].focus,
        mode: "free",
        drills: [t.rules[top.rule].drill, ...(byFrequency[1] ? [t.rules[byFrequency[1].rule].drill] : [])],
      }
    : nervous
      ? { focus: t.composureFocus, mode: "free", drills: [t.composureDrill] }
      : { focus: t.cleanFocus, mode: input.readiness.band === "ready" ? "exam" : "free", drills: [t.cleanDrill] };

  const deductions = input.readiness.components
    .filter((c) => c.points < 0)
    .sort((a, b) => a.points - b.points)
    .slice(0, 2)
    .map((c) => dict.readiness.components[c.key as keyof typeof dict.readiness.components] ?? c.key);
  const readiness_comment = deductions.length
    ? fmt(t.readinessComment, { score: input.readiness.score, list: deductions.join(", ") })
    : fmt(t.readinessClean, { score: input.readiness.score });

  return { summary, strengths, issues, progress, next_drive, readiness_comment };
}
