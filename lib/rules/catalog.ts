/**
 * Canonical rule catalog — roadwise-platform §3. The game must emit exactly
 * these keys; the telemetry schema and the AI grounding validator reject others.
 * RU/AZ names are provisional pending native review.
 */
import type { Locale } from "@/lib/i18n/config";

export const RULE_KEYS = [
  "speeding",
  "red_light",
  "stop_sign",
  "pedestrian_crossing",
  "wrong_way",
  "give_way",
  "collision",
] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export type Severity = "major" | "minor";

export interface RuleDef {
  key: RuleKey;
  names: Record<Locale, string>;
  /** null → depends on the speeding band */
  severity: Severity | null;
  /** null → depends on the speeding band */
  fineAzn: number | null;
  provisionalFine: boolean;
}

export const RULES: Record<RuleKey, RuleDef> = {
  speeding: {
    key: "speeding",
    names: { en: "Speeding", ru: "Превышение скорости", az: "Sürət həddinin aşılması" },
    severity: null,
    fineAzn: null,
    provisionalFine: false,
  },
  red_light: {
    key: "red_light",
    names: { en: "Running a red light", ru: "Проезд на красный свет", az: "Qırmızı işıqda keçmə" },
    severity: "major",
    fineAzn: 100,
    provisionalFine: false,
  },
  stop_sign: {
    key: "stop_sign",
    names: { en: "Not stopping at STOP", ru: "Непроезд знака «STOP» без остановки", az: "STOP nişanında dayanmamaq" },
    severity: "minor",
    fineAzn: 40,
    provisionalFine: false,
  },
  pedestrian_crossing: {
    key: "pedestrian_crossing",
    names: {
      en: "Not yielding to pedestrians",
      ru: "Непредоставление преимущества пешеходам",
      az: "Piyadalara yol verməmək",
    },
    severity: "minor",
    fineAzn: 50,
    provisionalFine: false,
  },
  wrong_way: {
    key: "wrong_way",
    names: {
      en: "Wrong way on a one-way street",
      ru: "Движение во встречном направлении по односторонней дороге",
      az: "Birtərəfli yolda əks istiqamətdə hərəkət",
    },
    severity: "major",
    fineAzn: 150,
    provisionalFine: false,
  },
  give_way: {
    key: "give_way",
    names: { en: "Not giving way", ru: "Непредоставление преимущества", az: "Yol verməmək" },
    severity: "major",
    fineAzn: 100,
    provisionalFine: true,
  },
  collision: {
    key: "collision",
    names: { en: "Collision", ru: "Столкновение", az: "Toqquşma" },
    severity: "major",
    fineAzn: 100,
    provisionalFine: true,
  },
};

/** Speeding bands over the posted limit. Triggers above +11 km/h. */
export const SPEEDING_TRIGGER_OVER_KMH = 11;
export const SPEEDING_BANDS: { minOver: number; maxOver: number | null; fineAzn: number; severity: Severity }[] = [
  { minOver: 11, maxOver: 20, fineAzn: 10, severity: "minor" },
  { minOver: 21, maxOver: 40, fineAzn: 50, severity: "minor" },
  { minOver: 41, maxOver: 60, fineAzn: 200, severity: "major" },
  { minOver: 61, maxOver: null, fineAzn: 300, severity: "major" },
];

/** Posted limits (km/h). */
export const SPEED_LIMITS = { living_zone: 20, city: 60, outside_built_up: 90, motorway: 110 } as const;

export function isRuleKey(value: unknown): value is RuleKey {
  return typeof value === "string" && (RULE_KEYS as readonly string[]).includes(value);
}

export function ruleName(key: RuleKey, locale: Locale): string {
  return RULES[key].names[locale];
}

/** Band for a given overspeed (km/h above the limit), or null if under the trigger. */
export function speedingBand(overKmh: number) {
  if (overKmh < SPEEDING_TRIGGER_OVER_KMH) return null;
  const over = Math.round(overKmh);
  return SPEEDING_BANDS.find((b) => over >= b.minOver && (b.maxOver === null || over <= b.maxOver)) ?? SPEEDING_BANDS[0];
}

/** Expected severity and fine for a rule (speeding needs the overspeed). */
export function ruleOutcome(key: RuleKey, overKmh?: number): { severity: Severity; fineAzn: number } | null {
  if (key === "speeding") {
    const band = overKmh === undefined ? null : speedingBand(overKmh);
    return band ? { severity: band.severity, fineAzn: band.fineAzn } : null;
  }
  const r = RULES[key];
  return { severity: r.severity!, fineAzn: r.fineAzn! };
}
