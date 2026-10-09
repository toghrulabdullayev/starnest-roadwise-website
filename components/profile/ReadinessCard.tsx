import type { Readiness, ReadinessBand } from "@/lib/readiness";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import { fmt } from "@/lib/i18n/getDictionary";
import { fmtNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";

const bandStyle: Record<ReadinessBand, { fill: string; track: string; ink: string; icon: string }> = {
  not_ready: { fill: "bg-danger", track: "bg-[#fecaca]", ink: "text-[#fca5a5]", icon: "✕" },
  almost: { fill: "bg-warning", track: "bg-[#fde68a]", ink: "text-[#fcd34d]", icon: "!" },
  ready: { fill: "bg-success", track: "bg-[#bbf7d0]", ink: "text-[#86efac]", icon: "✓" },
};

export function ReadinessCard({ readiness, locale, dict }: { readiness: Readiness; locale: Locale; dict: Dictionary }) {
  const t = dict.profile;
  const s = bandStyle[readiness.band];
  return (
    <section aria-labelledby="readiness-title" className="on-dark border-2 border-surface bg-surface text-text-on-dark shadow-bold">
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-3">
          <h2 id="readiness-title" className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary-on-dark">
            {t.readinessTitle}
          </h2>
          <p className="flex items-baseline gap-2">
            <span className="font-display text-7xl leading-none">{readiness.score}</span>
            <span className="text-xl text-text-on-dark-muted">/ 100</span>
          </p>
          <p className={`flex items-center gap-2 text-lg font-bold uppercase ${s.ink}`}>
            <span aria-hidden="true" className={`inline-flex size-6 items-center justify-center rounded-full ${s.fill} text-sm text-surface`}>
              {s.icon}
            </span>
            {dict.readiness.bands[readiness.band]}
          </p>
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={readiness.score}
            aria-label={t.readinessTitle}
            className={`h-3 w-full ${s.track}`}
          >
            <div className={`h-3 ${s.fill}`} style={{ width: `${readiness.score}%` }} />
          </div>
          <p className="text-sm text-text-on-dark-muted">{fmt(t.readinessBasis, { n: readiness.drives_considered })}</p>
        </div>
        <div>
          <h3 className="mb-2 font-sans text-sm font-bold uppercase tracking-wide text-text-on-dark-muted">{t.readinessBreakdown}</h3>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-surface-2">
                <th scope="row" className="py-2 pr-2 text-left font-normal">{t.readinessStart}</th>
                <td className="py-2 text-right font-mono tabular-nums">100</td>
              </tr>
              {readiness.components.map((c) => (
                <tr key={c.key} className="border-b border-surface-2 last:border-0">
                  <th scope="row" className="py-2 pr-2 text-left font-normal">
                    {dict.readiness.components[c.key]}
                  </th>
                  <td
                    className={`whitespace-nowrap py-2 pl-2 text-right font-mono tabular-nums ${
                      c.points < 0 ? "text-[#fca5a5]" : c.points > 0 ? "text-[#86efac]" : "text-text-on-dark-muted"
                    }`}
                  >
                    {c.points === 0 ? t.noDeduction : `${c.points > 0 ? "+" : "−"}${fmtNumber(locale, Math.abs(c.points), 1)} ${t.points}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
