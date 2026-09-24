// Brand-seed palette picker — imports the bundled palette.mjs logic.
// The module is loaded once and cached; no child process per call.
import { pathToFileURL } from "node:url";
import { bundledFile } from "./assets.js";
import { DesignError } from "./scope.js";

interface PaletteModule {
  renderPalette(options: { id?: string; from?: string }): string;
  SEED_IDS: readonly string[];
}

let paletteModule: Promise<PaletteModule> | undefined;

function loadPalette(): Promise<PaletteModule> {
  paletteModule ??= (import(pathToFileURL(bundledFile("skill", "scripts/palette.mjs")).href) as Promise<PaletteModule>)
    .catch((error) => {
      paletteModule = undefined; // a transient failure must not poison the process
      throw error;
    });
  return paletteModule;
}

export async function getPaletteSeed(options: { id?: string; from?: string } = {}): Promise<string> {
  const mod = await loadPalette();
  try {
    return mod.renderPalette(options).trim();
  } catch (error) {
    if ((error as { code?: string }).code === "UNKNOWN_SEED") {
      throw new DesignError("UNKNOWN_SEED", (error as Error).message, { knownIds: mod.SEED_IDS.length });
    }
    throw error;
  }
}
