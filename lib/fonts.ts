import { Archivo, Archivo_Black, Inter_Tight, JetBrains_Mono } from "next/font/google";

// Design skill: primary/display = Archivo Black, mono = JetBrains Mono.
// Body copy uses Archivo (same family, variable weights 100–900) for legibility.
export const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin", "latin-ext"],
  variable: "--font-archivo-black",
  display: "swap",
});

export const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  variable: "--font-archivo",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext", "cyrillic"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/**
 * Archivo / Archivo Black have no Cyrillic, and Archivo Black has no Azerbaijani Ə/ə.
 * Inter Tight (a close grotesque) sits second in both stacks (see app/globals.css), so those
 * glyphs are drawn per glyph in a matching heavy face instead of a thin system fallback.
 * No basic `latin` subset: Latin text stays in Archivo; `latin-ext` is only reached for
 * glyphs Archivo lacks (Ə).
 */
export const interTightCyrillic = Inter_Tight({
  subsets: ["latin-ext", "cyrillic", "cyrillic-ext"],
  variable: "--font-cyrillic",
  display: "swap",
});

export const fontVariables = `${archivoBlack.variable} ${archivo.variable} ${jetbrainsMono.variable} ${interTightCyrillic.variable}`;
