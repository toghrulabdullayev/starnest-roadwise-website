import type { DeviceRow } from "@/lib/auth/gameToken";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import { fmt } from "@/lib/i18n/getDictionary";
import type { Locale } from "@/lib/i18n/config";
import { fmtDate } from "@/lib/i18n/format";
import { revokeDeviceAction } from "@/app/actions/device";
import { buttonClass } from "@/components/ui";

const iso = (sqlite: string) => (sqlite.includes("T") ? sqlite : `${sqlite.replace(" ", "T")}Z`);

export function Devices({ devices, locale, dict }: { devices: DeviceRow[]; locale: Locale; dict: Dictionary }) {
  const t = dict.profile;
  if (devices.length === 0) return <p className="text-text-muted">{t.devicesEmpty}</p>;
  return (
    <ul className="flex flex-col divide-y-2 divide-line-soft border-2 border-surface">
      {devices.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-bold">{d.client ?? t.unknownDevice}</p>
            <p className="text-sm text-text-muted">
              {fmt(t.connected, { date: fmtDate(locale, iso(d.created_at)) })} ·{" "}
              {d.last_used_at ? fmt(t.lastUsed, { date: fmtDate(locale, iso(d.last_used_at)) }) : t.neverUsed}
            </p>
          </div>
          <form action={revokeDeviceAction}>
            <input type="hidden" name="id" value={d.id} />
            <button type="submit" className={buttonClass("danger")}>
              {t.revoke}
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
