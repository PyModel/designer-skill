// Brand-seed palette picker — imports the bundled palette.mjs logic.
// The module is loaded once and cached; no child process per call.
import { pathToFileURL } from "node:url";
import { bundledFile } from "./assets.js";

interface PaletteModule {
  renderPalette(options: { id?: string; from?: string }): string;
}

let paletteModule: Promise<PaletteModule> | null = null;

function loadPalette(): Promise<PaletteModule> {
  return (paletteModule ??= import(
    pathToFileURL(bundledFile("skill", "scripts/palette.mjs")).href
  ) as Promise<PaletteModule>);
}

export async function getPaletteSeed(options: { id?: string; from?: string } = {}): Promise<string> {
  const mod = await loadPalette();
  return mod.renderPalette(options).trim();
}
