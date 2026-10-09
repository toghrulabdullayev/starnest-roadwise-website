import { setPreferredLocaleAction } from "@/app/actions/auth";
import { locales, localeNames, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/getDictionary";
import { buttonClass } from "@/components/ui";

export function LanguagePreference({ current, dict, saved }: { current: Locale; dict: Dictionary; saved: boolean }) {
  const t = dict.profile;
  return (
    <form action={setPreferredLocaleAction} className="flex flex-col gap-3">
      <p className="text-text-muted">{t.languageLead}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="preferred" className="sr-only">
          {t.languageTitle}
        </label>
        <select
          id="preferred"
          name="preferred"
          defaultValue={current}
          className="min-h-11 min-w-48 border-2 border-surface bg-canvas px-3 font-semibold"
        >
          {locales.map((l) => (
            <option key={l} value={l} lang={l}>
              {localeNames[l]}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass("dark")}>
          {t.save}
        </button>
        {saved && (
          <span role="status" className="font-semibold text-success-ink">
            ✓ {t.saved}
          </span>
        )}
      </div>
    </form>
  );
}
