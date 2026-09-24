// One owner of the bundled-asset resolution policy: packaged assets/ dir first,
// sibling skills/ (or none for the engine) as dev fallback. Every consumer of
// bundled content — skill markdown, command metadata, palette, detector engine —
// resolves through this seam so the policy exists exactly once.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type BundledKind = "skill" | "ux-designer" | "engine";

interface BundledLocation {
  bundled: string;
  dev: string | null;
  probe: string;
  label: string;
}

const LOCATIONS: Record<BundledKind, BundledLocation> = {
  skill: {
    bundled: join("assets", "skill"),
    dev: join("..", "skills", "designer-skill"),
    probe: "SKILL.md",
    label: "designer-skill content",
  },
  "ux-designer": {
    bundled: join("assets", "ux-designer"),
    dev: join("..", "skills", "ux-designer"),
    probe: "SKILL.md",
    label: "ux-designer content",
  },
  engine: {
    bundled: join("assets", "engine"),
    dev: null, // the engine is vendored, not synced from skills/
    probe: "registry/antipatterns.mjs",
    label: "detector engine",
  },
};

/** Package root (dist/ or src/ → parent), stable in build, dev, and tests. */
function pkgRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Root dir for a bundled kind: packaged copy if present, else the dev source. */
export function bundledRoot(kind: BundledKind): string {
  const loc = LOCATIONS[kind];
  const root = pkgRoot();
  const bundled = join(root, loc.bundled);
  if (existsSync(join(bundled, loc.probe))) return bundled;
  if (loc.dev) {
    const dev = resolve(root, loc.dev);
    if (existsSync(join(dev, loc.probe))) return dev;
  }
  throw new Error(
    `${loc.label} not found. Looked in:\n  ${join(bundled, loc.probe)}${loc.dev ? `\n  ${join(resolve(root, loc.dev), loc.probe)}` : ""}\nRun "npm run sync-skill" to bundle it.`,
  );
}

/** Resolve one file inside a bundled kind's root. */
export function bundledFile(kind: BundledKind, file: string): string {
  return join(bundledRoot(kind), file);
}
