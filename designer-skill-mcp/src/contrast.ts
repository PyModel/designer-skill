// Contrast for explicit color pairs: WCAG 2.x ratio plus APCA Lc (advisory).
// Colors are parsed by the detector's own parser so both agree on syntax.
import { pathToFileURL } from "node:url";
import { bundledFile } from "./assets.js";

interface Rgba { r: number; g: number; b: number; a: number }
interface ColorModule {
  parseCssColor(input: string): Rgba | null;
  contrastRatio(a: Rgba, b: Rgba): number;
}

export interface ContrastPair { foreground: string; background: string; fontSizePx?: number; bold?: boolean }
export interface ContrastResult {
  foreground: string;
  background: string;
  /** Set when a color could not be evaluated; every other field is then absent. */
  error?: string;
  ratio?: number;
  /** APCA lightness contrast (0.0.98G-4g). Advisory: WCAG 2.2 conformance uses `ratio`. */
  apcaLc?: number;
  largeText?: boolean;
  requiredRatio?: number;
  passesAA?: boolean;
  passesAAA?: boolean;
}

let colorModule: Promise<ColorModule> | undefined;
function loadColor(): Promise<ColorModule> {
  colorModule ??= (import(pathToFileURL(bundledFile("engine", "shared/color.mjs")).href) as Promise<ColorModule>)
    .catch((error) => { colorModule = undefined; throw error; });
  return colorModule;
}

/** Source-over compositing: what a translucent color looks like on an opaque one. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** APCA-W3 0.0.98G-4g. Positive Lc: dark text on light; negative: light text on dark. */
export function apcaLc(text: Rgba, background: Rgba): number {
  const y = ({ r, g, b }: Rgba) => {
    const lum = 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
    return lum > 0.022 ? lum : lum + (0.022 - lum) ** 1.414;
  };
  const yText = y(text);
  const yBg = y(background);
  if (Math.abs(yBg - yText) < 0.0005) return 0;
  if (yBg > yText) {
    const sapc = (yBg ** 0.56 - yText ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yBg ** 0.65 - yText ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export async function checkContrast(pairs: ContrastPair[]): Promise<ContrastResult[]> {
  const color = await loadColor();
  return pairs.map(({ foreground, background, fontSizePx = 16, bold = false }) => {
    const fg = color.parseCssColor(foreground);
    const bg = color.parseCssColor(background);
    const base = { foreground, background };
    if (!fg) return { ...base, error: `foreground "${foreground}" is not a concrete CSS color (var(), color-mix() and relative colors cannot be evaluated here).` };
    if (!bg) return { ...base, error: `background "${background}" is not a concrete CSS color (var(), color-mix() and relative colors cannot be evaluated here).` };
    if (bg.a < 1) return { ...base, error: "background must be opaque: composite it over the surface behind it first." };
    const text = over(fg, bg);
    const ratio = color.contrastRatio(text, bg);
    // WCAG large text: 18pt (24px) regular or 14pt (18.66px) bold.
    const largeText = fontSizePx >= 24 || (bold && fontSizePx >= 18.66);
    const requiredRatio = largeText ? 3 : 4.5;
    return {
      ...base, ratio: round(ratio, 2), apcaLc: round(apcaLc(text, bg), 1), largeText, requiredRatio,
      passesAA: ratio >= requiredRatio, passesAAA: ratio >= (largeText ? 4.5 : 7),
    };
  });
}

export function formatContrast(results: ContrastResult[]): string {
  return results.map((r) => r.error
    ? `${r.foreground} on ${r.background}: NOT_EVALUATED (${r.error})`
    : `${r.foreground} on ${r.background}: ${r.ratio}:1 (AA ${r.passesAA ? "pass" : "FAIL"}, needs ${r.requiredRatio}:1${r.largeText ? " large text" : ""}; AAA ${r.passesAAA ? "pass" : "fail"}; APCA Lc ${r.apcaLc})`).join("\n");
}
