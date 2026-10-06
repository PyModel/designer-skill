// Regression tests for the router's reachability contract: every registry
// reference resolves from the designer-skill directory alone (filesystem
// skill-only installs are self-contained), the vendored ux/ copies never drift
// from the ux-designer authoring home, and the external craft map covers every
// directory actually present in the inspected third-party snapshot.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getReferenceDoc, ALL_REFERENCE_NAMES } from "../src/skill.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "..");
const skillDir = join(repoRoot, "skills", "designer-skill");
const read = (path: string) => readFileSync(path, "utf8");

describe("reference reachability (self-contained skill directory)", () => {
  it("every registry reference is a file inside skills/designer-skill alone", () => {
    for (const name of ALL_REFERENCE_NAMES) {
      const path = join(skillDir, "reference", `${name}.md`);
      expect(read(path).length, name).toBeGreaterThan(80);
    }
  });

  it("getReferenceDoc serves every name from the dev-tree skill root", () => {
    for (const name of ALL_REFERENCE_NAMES) {
      expect(getReferenceDoc(name).length, name).toBeGreaterThan(80);
    }
  });

  it("vendored ux/ copies stay byte-identical to skills/ux-designer/references", () => {
    const authoringHome = join(repoRoot, "skills", "ux-designer", "references");
    const vendored = join(skillDir, "reference", "ux");
    const authors = readdirSync(authoringHome).filter((f) => f.endsWith(".md")).sort();
    const copies = readdirSync(vendored).filter((f) => f.endsWith(".md")).sort();
    expect(copies, "vendored reference/ux must mirror the ux-designer authoring home one-to-one").toEqual(authors);
    for (const file of authors) {
      expect(read(join(vendored, file)), `${file} drifted; run node scripts/sync-ux.mjs`).toBe(read(join(authoringHome, file)));
    }
  });
});

describe("disclosed craft provenance (historical, not a snapshot dependency)", () => {
  const skillMd = read(join(skillDir, "SKILL.md"));
  const provenance = read(join(skillDir, "reference", "craft-provenance.md"));

  it("keeps all 13 historical capabilities in an on-demand packaged reference", () => {
    expect([...provenance.matchAll(/^\| `[^`]+` \|/gm)]).toHaveLength(13);
    expect(skillMd).toContain("`craft-provenance`");
    expect(skillMd).not.toContain("### External craft map");
    expect(provenance).toContain("removed from this workspace");
  });

  it("never claims the absent ask-sonner skill as bundled", () => {
    expect(provenance).toMatch(/ask-sonner[^\n]*absent/i);
    expect(provenance).not.toMatch(/\[.*ask-sonner.*\]\(.*\)/);
  });

  it("routes the snapshot-derived guidance references through the registry", () => {
    for (const name of ["niblet-catalogue", "motion-vocabulary", "fluid-input-principles", "native-web", "worst-case-data", "variant-prototyping", "dependency-selection"]) {
      expect(skillMd, name).toContain(`\`${name}\``);
    }
  });

  it("documents the four-tool Niblet workflow in the catalogue reference", () => {
    const catalogue = read(join(skillDir, "reference", "niblet-catalogue.md"));
    for (const tool of ["find_ui_references", "find_ui_materials", "get_design_reference", "get_ui_component"]) {
      expect(catalogue).toContain(`\`${tool}\``);
    }
    expect(catalogue).toContain("selectedIds");
    expect(catalogue).toContain("remote-only");
    expect(catalogue).toContain("niblet.pymodel.com/account");
  });

  it("states the snapshot is all-rights-reserved and not copied", () => {
    expect(provenance).toMatch(/all rights reserved/i);
  });
});
