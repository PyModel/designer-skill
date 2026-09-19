// The design-verb registry (dispatch.ts) is the single owner of verb → reads.
// These tests hold every derived surface to it.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { VERB_REGISTRY, COMMAND_ALIASES, readsFor } from "../src/dispatch.js";
import { isReferenceName } from "../src/skill.js";
import { getCommandMetadata } from "../src/commands.js";
import { GATE_CONTRACT } from "../src/gate.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(pkgRoot, "..");

describe("design-verb registry", () => {
  it("every registry read is a valid reference id", () => {
    const verbs = Object.keys(VERB_REGISTRY);
    expect(verbs.length).toBeGreaterThanOrEqual(40);
    for (const [verb, v] of Object.entries(VERB_REGISTRY)) {
      for (const f of v.files) {
        expect(isReferenceName(f), `${verb} reads unknown reference "${f}"`).toBe(true);
      }
    }
  });

  it("aliases resolve to registry verbs", () => {
    for (const [alias, canonical] of Object.entries(COMMAND_ALIASES)) {
      expect(VERB_REGISTRY[canonical], `alias "${alias}" points at missing verb "${canonical}"`).toBeDefined();
    }
  });

  it("every command-metadata verb exists in the registry", () => {
    for (const verb of Object.keys(getCommandMetadata())) {
      const canonical = COMMAND_ALIASES[verb] ?? verb;
      expect(VERB_REGISTRY[canonical], `command-metadata verb "${verb}" missing from the registry`).toBeDefined();
    }
  });

  it("readsFor serves registry files, canonical or legacy", () => {
    expect(readsFor("check")).toEqual(VERB_REGISTRY.check!.files);
    expect(readsFor("audit")).toEqual(VERB_REGISTRY.check!.files);
    expect(readsFor("css")).toContain("css-techniques");
  });
});

describe("derived documentation", () => {
  const playbook = readFileSync(
    join(repoRoot, "skills", "designer-skill", "reference", "command-playbook.md"),
    "utf8",
  );

  it("playbook Read column matches the registry exactly", () => {
    let inTable = false;
    const checked: string[] = [];
    for (const line of playbook.split("\n")) {
      if (line.startsWith("## ")) inTable = line.startsWith("## Dispatch table");
      if (!inTable || !line.startsWith("|")) continue;
      const cells = line.split("|").map((c) => c.trim());
      const verb = cells[1];
      if (!verb || cells.length < 6 || !VERB_REGISTRY[verb]) continue;
      const expected = VERB_REGISTRY[verb]!.files.map((f) => `${f}.md`).join(", ");
      expect(cells[4], `playbook Read column for "${verb}" drifted from the registry`).toBe(expected);
      checked.push(verb);
    }
    expect(checked.length, "expected the dispatch table to cover several registry verbs").toBeGreaterThan(5);
  });

  it("SKILL.md states the same gate threshold as GATE_CONTRACT", () => {
    const skill = readFileSync(join(repoRoot, "skills", "designer-skill", "SKILL.md"), "utf8");
    expect(skill).toContain(`≥${GATE_CONTRACT.passScore}`);
  });
});
