import type { ProfileData } from "@/lib/drives/profile";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { fmtDate } from "@/lib/i18n/format";
import { Badge } from "@/components/ui";

export function ExamHistory({ exams, locale, dict }: { exams: ProfileData["exams"]; locale: Locale; dict: Dictionary }) {
  const t = dict.profile;
  if (exams.length === 0) return <p className="text-text-muted">{t.examEmpty}</p>;
  return (
    <div className="relative overflow-x-auto border-2 border-surface">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-surface text-text-on-dark">
          <tr>
            {[t.examCols.date, t.examCols.result, t.examCols.faults, t.examCols.checkpoints].map((h) => (
              <th key={h} scope="col" className="px-3 py-3 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {exams.map((d) => {
            const e = d.metrics.exam;
            return (
              <tr key={d.id} className="border-t-2 border-line-soft">
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(locale, d.started_at)}</td>
                <td className="px-3 py-2">
                  <Badge tone={e?.passed ? "success" : "danger"}>{e?.passed ? `✓ ${t.passed}` : `✕ ${t.failed}`}</Badge>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {e?.major_faults ?? 0} / {e?.minor_faults ?? 0}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {e?.checkpoints_reached ?? 0} / {e?.checkpoints_total ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
