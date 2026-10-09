import type { Locale } from "../i18n/config";

export const ruleKeys = [
  "speeding",
  "red_light",
  "stop_sign",
  "pedestrian_crossing",
  "wrong_way",
  "give_way",
  "collision",
] as const;

export type RuleKey = (typeof ruleKeys)[number];
export type Severity = "minor" | "major";

export type RuleDefinition = {
  key: RuleKey;
  names: Record<Locale, string>;
  severity: Severity | "by_band";
  fineAzn: number | "by_band";
  provisional: boolean;
};

export const rules: Record<RuleKey, RuleDefinition> = {
  speeding: {
    key: "speeding",
    names: {
      en: "Speeding",
      ru: "Превышение скорости",
      az: "Sürət həddinin aşılması",
    },
    severity: "by_band",
    fineAzn: "by_band",
    provisional: false,
  },
  red_light: {
    key: "red_light",
    names: {
      en: "Running a red light",
      ru: "Проезд на красный свет",
      az: "Qırmızı işıqda keçmə",
    },
    severity: "major",
    fineAzn: 100,
    provisional: false,
  },
  stop_sign: {
    key: "stop_sign",
    names: {
      en: "Not stopping at STOP",
      ru: "Непроезд знака «STOP» без остановки",
      az: "STOP nişanında dayanmamaq",
    },
    severity: "minor",
    fineAzn: 40,
    provisional: false,
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
    provisional: false,
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
    provisional: false,
  },
  give_way: {
    key: "give_way",
    names: {
      en: "Not giving way",
      ru: "Непредоставление преимущества",
      az: "Yol verməmək",
    },
    severity: "major",
    fineAzn: 100,
    provisional: true,
  },
  collision: {
    key: "collision",
    names: {
      en: "Collision",
      ru: "Столкновение",
      az: "Toqquşma",
    },
    severity: "major",
    fineAzn: 100,
    provisional: true,
  },
};

export type SpeedingBand = {
  minOverKmh: number;
  maxOverKmh: number | null;
  severity: Severity;
  fineAzn: number;
};

export const speedingBands: readonly SpeedingBand[] = [
  { minOverKmh: 11, maxOverKmh: 20, severity: "minor", fineAzn: 10 },
  { minOverKmh: 21, maxOverKmh: 40, severity: "minor", fineAzn: 50 },
  { minOverKmh: 41, maxOverKmh: 60, severity: "major", fineAzn: 200 },
  { minOverKmh: 61, maxOverKmh: null, severity: "major", fineAzn: 300 },
];

export const speedLimitsKmh = {
  livingZone: 20,
  city: 60,
  outsideBuiltUp: 90,
  motorway: 110,
} as const;

export function isRuleKey(value: unknown): value is RuleKey {
  return typeof value === "string" && (ruleKeys as readonly string[]).includes(value);
}

export function ruleName(key: RuleKey, locale: Locale): string {
  return rules[key].names[locale];
}

export function speedingBand(overKmh: number): SpeedingBand | null {
  if (!Number.isFinite(overKmh)) return null;
  return (
    speedingBands.find(
      (band) =>
        overKmh >= band.minOverKmh &&
        (band.maxOverKmh === null || overKmh < band.maxOverKmh + 1),
    ) ?? null
  );
}

export function expectedOutcome(
  key: RuleKey,
  overKmh?: number,
): { severity: Severity; fineAzn: number } | null {
  if (key === "speeding") {
    const band = overKmh === undefined ? null : speedingBand(overKmh);
    return band ? { severity: band.severity, fineAzn: band.fineAzn } : null;
  }
  const rule = rules[key];
  if (rule.severity === "by_band" || rule.fineAzn === "by_band") return null;
  return { severity: rule.severity, fineAzn: rule.fineAzn };
}
