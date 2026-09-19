import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("command registry (single source: command-metadata.json)", () => {
  it("every registry read names a real reference (designer-skill or ux namespace)", async () => {
    const { getCommandMetadata } = await import("../src/commands.js");
    const { ALL_REFERENCE_NAMES } = await import("../src/skill.js");
    const valid = new Set<string>(ALL_REFERENCE_NAMES);
    for (const [verb, meta] of Object.entries(getCommandMetadata())) {
      expect(meta.reads.length, verb).toBeGreaterThan(0);
      for (const name of meta.reads) expect(valid.has(name), `${verb} reads ${name}`).toBe(true);
    }
  });

  it("aliases resolve and list_commands equals the registry verbs", async () => {
    const { getCommandMetadata, resolveCommandVerb, listCommands } = await import("../src/commands.js");
    const meta = getCommandMetadata();
    expect(listCommands().map((c) => c.verb).sort()).toEqual(Object.keys(meta).sort());
    for (const [verb, { aliases }] of Object.entries(meta)) {
      for (const alias of aliases) expect(resolveCommandVerb(alias).canonical).toBe(verb);
    }
  });

  it("bundled assets/skill registry matches the canonical skills/ source", () => {
    const canonical = readFileSync(join(repoRoot, "skills", "designer-skill", "scripts", "command-metadata.json"), "utf8");
    const bundled = join(repoRoot, "designer-skill-mcp", "assets", "skill", "scripts", "command-metadata.json");
    if (!existsSync(bundled)) return; // not built yet; pack.test.ts covers the packed artifact
    expect(readFileSync(bundled, "utf8")).toBe(canonical);
  });

  it("SKILL.md and the playbook route command discovery through the registry", () => {
    const skill = readFileSync(join(repoRoot, "skills", "designer-skill", "SKILL.md"), "utf8");
    expect(skill).toContain("dispatch_intent");
    const playbook = readFileSync(join(repoRoot, "skills", "designer-skill", "reference", "command-playbook.md"), "utf8");
    expect(playbook).toContain("command-metadata.json");
  });
});
