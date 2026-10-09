import { Archivo, Archivo_Black, JetBrains_Mono } from "next/font/google";

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

export const fontVariables = `${archivoBlack.variable} ${archivo.variable} ${jetbrainsMono.variable}`;
