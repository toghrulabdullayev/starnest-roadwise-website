import type { ProfileData } from "@/lib/drives/profile";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { fmtAzn, fmtKm, fmtNumber, fmtPercent } from "@/lib/i18n/format";

export function KpiTiles({ totals, locale, dict }: { totals: ProfileData["totals"]; locale: Locale; dict: Dictionary }) {
  const t = dict.profile.kpi;
  const tiles = [
    { label: t.drives, value: fmtNumber(locale, totals.drives) },
    { label: t.distance, value: fmtKm(locale, totals.distance_m) },
    { label: t.compliance, value: fmtPercent(locale, totals.compliance) },
    { label: t.fines, value: fmtAzn(locale, totals.fines) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((x) => (
        <div key={x.label} className="flex flex-col gap-1 border-2 border-surface bg-canvas p-4 shadow-bold-sm">
          <dt className="text-sm font-semibold text-text-muted">{x.label}</dt>
          <dd className="font-display text-2xl sm:text-3xl">{x.value}</dd>
        </div>
      ))}
    </dl>
  );
}
