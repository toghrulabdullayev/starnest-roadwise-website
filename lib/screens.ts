/**
 * Landing-page product screenshots, one set per language. Each set is captured from the demo
 * account in that language (see docs/SCREENSHOTS.md), so the images match the page around them.
 * Static imports give Next the real width and height of every file.
 */
import type { StaticImageData } from "next/image";
import type { Locale } from "@/lib/i18n/config";
import enDebrief from "../public/screens/en/debrief.png";
import enReadiness from "../public/screens/en/readiness.png";
import enRoute from "../public/screens/en/route.png";
import enProgress from "../public/screens/en/progress.png";
import ruDebrief from "../public/screens/ru/debrief.png";
import ruReadiness from "../public/screens/ru/readiness.png";
import ruRoute from "../public/screens/ru/route.png";
import ruProgress from "../public/screens/ru/progress.png";
import azDebrief from "../public/screens/az/debrief.png";
import azReadiness from "../public/screens/az/readiness.png";
import azRoute from "../public/screens/az/route.png";
import azProgress from "../public/screens/az/progress.png";

export type ScreenKey = "readiness" | "route" | "progress" | "debrief";

export const screens: Record<Locale, Record<ScreenKey, StaticImageData>> = {
  en: { readiness: enReadiness, route: enRoute, progress: enProgress, debrief: enDebrief },
  ru: { readiness: ruReadiness, route: ruRoute, progress: ruProgress, debrief: ruDebrief },
  az: { readiness: azReadiness, route: azRoute, progress: azProgress, debrief: azDebrief },
};
