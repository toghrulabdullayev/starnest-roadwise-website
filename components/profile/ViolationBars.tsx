import type { ProfileData } from "@/lib/drives/profile";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { ruleName } from "@/lib/rules/catalog";
import { fmtAzn, fmtNumber } from "@/lib/i18n/format";

/** Single-series horizontal bars: count per rule, value at the tip (dataviz mark specs). */
export function ViolationBars({ rows, locale, dict }: { rows: ProfileData["violations"]; locale: Locale; dict: Dictionary }) {
  if (rows.length === 0) return <p className="text-text-muted">{dict.profile.violationsEmpty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.rule} className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:gap-4">
          <span className="text-sm font-semibold">{ruleName(r.rule, locale)}</span>
          <span className="flex items-center gap-2" title={`${ruleName(r.rule, locale)}: ${r.count}${dict.profile.times}, ${fmtAzn(locale, r.fines)}`}>
            <span className="h-4 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(4, (r.count / max) * 70)}%` }} />
            <span className="whitespace-nowrap font-mono text-sm tabular-nums text-text">
              {fmtNumber(locale, r.count)}
              {dict.profile.times} · {fmtAzn(locale, r.fines)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
