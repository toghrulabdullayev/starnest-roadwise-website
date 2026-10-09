import Link from "next/link";
import type { DriveSummary } from "@/lib/drives/queries";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { fmtAzn, fmtDate, fmtPercent } from "@/lib/i18n/format";
import { Badge } from "@/components/ui";

/** Doubles as the table view for the progress charts. */
export function DriveTable({ drives, locale, dict }: { drives: DriveSummary[]; locale: Locale; dict: Dictionary }) {
  const t = dict.profile;
  const c = t.driveCols;
  return (
    <div className="relative overflow-x-auto border-2 border-surface">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <thead className="bg-surface text-text-on-dark">
          <tr>
            {[c.date, c.mode, c.compliance, c.fines, c.composure, c.readiness].map((h) => (
              <th key={h} scope="col" className="px-3 py-3 font-bold">
                {h}
              </th>
            ))}
            <th scope="col" className="px-3 py-3">
              <span className="sr-only">{t.open}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {drives.map((d) => (
            <tr key={d.id} className="border-t-2 border-line-soft hover:bg-canvas-2">
              <td className="px-3 py-2 whitespace-nowrap">
                {fmtDate(locale, d.started_at)}
                {d.source === "fixture" && (
                  <span className="ml-2">
                    <Badge>{t.sample}</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {t.modes[d.mode]}
                {d.exam_passed !== null && (
                  <span className="ml-2">
                    <Badge tone={d.exam_passed ? "success" : "danger"}>{d.exam_passed ? `✓ ${t.passed}` : `✕ ${t.failed}`}</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2 font-mono tabular-nums">{fmtPercent(locale, d.compliance_rate)}</td>
              <td className="px-3 py-2 font-mono tabular-nums">{fmtAzn(locale, d.fines_total_azn)}</td>
              <td className="px-3 py-2 font-mono tabular-nums">{d.composure_index}</td>
              <td className="px-3 py-2 font-mono tabular-nums">{d.readiness_score}</td>
              <td className="px-3 py-2 text-right">
                <Link
                  href={`/${locale}/drives/${d.id}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center font-bold text-primary-ink underline decoration-2 underline-offset-4 hover:text-primary-hover"
                >
                  {t.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
