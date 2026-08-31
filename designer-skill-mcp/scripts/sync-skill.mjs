// Copies the canonical skills/designer-skill/ and skills/ux-designer/ folders into
// assets/skill + assets/ux-designer so the published npm package is self-contained.
// skills/ folders remain the single source of truth.
import { existsSync, rmSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

function syncSkillModule(skillName, destName, refSubdir) {
  const src = resolve(pkgRoot, "..", "skills", skillName);
  const dest = join(pkgRoot, "assets", destName);

  if (!existsSync(join(src, "SKILL.md"))) {
    if (existsSync(join(dest, "SKILL.md"))) {
      console.log(`[sync-skill] source not found at ${src}; using bundled assets/${destName}.`);
      return false;
    }
    console.error(`[sync-skill] ERROR: no ${skillName} source at ${src} and no bundled copy at ${dest}.`);
    process.exit(1);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(join(dest, refSubdir), { recursive: true });
  cpSync(join(src, "SKILL.md"), join(dest, "SKILL.md"));

  const refDir = join(src, refSubdir);
  let refCount = 0;
  for (const f of readdirSync(refDir)) {
    if (f.endsWith(".md")) {
      cpSync(join(refDir, f), join(dest, refSubdir, f));
      refCount++;
    }
  }

  const scriptsSrc = join(src, "scripts");
  let scriptCount = 0;
  if (existsSync(scriptsSrc)) {
    cpSync(scriptsSrc, join(dest, "scripts"), { recursive: true });
    scriptCount = readdirSync(scriptsSrc).filter((f) => f.endsWith(".mjs") || f.endsWith(".json")).length;
  }

  console.log(`[sync-skill] synced ${skillName}: SKILL.md + ${refCount} reference files + scripts → ${dest} (${scriptCount} script entries)`);
  return true;
}

syncSkillModule("designer-skill", "skill", "reference");
syncSkillModule("ux-designer", "ux-designer", "references");