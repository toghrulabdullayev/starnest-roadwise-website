import type en from "../../messages/en.json";
import type { Locale } from "./config";

export type Dictionary = typeof en;

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import("../../messages/en.json").then((m) => m.default),
  ru: () => import("../../messages/ru.json").then((m) => m.default),
  az: () => import("../../messages/az.json").then((m) => m.default),
};

export const getDictionary = (locale: Locale): Promise<Dictionary> =>
  dictionaries[locale]();
