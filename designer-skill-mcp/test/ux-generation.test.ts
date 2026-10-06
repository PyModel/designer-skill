import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncUxReferences } from "../../scripts/sync-ux.mjs";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "designer-ux-")); roots.push(root); const source = join(root, "source"), target = join(root, "mirror"); mkdirSync(source); writeFileSync(join(source, "one.md"), "canonical"); return { root, source, target }; }
describe("single-owner generated UX references", () => {
  it("copies exact bytes, updates changed source, removes stale generated docs and is idempotent", () => {
    const { source, target } = fixture();
    expect(syncUxReferences(source, target)).toEqual({ copied: 1, removed: 0, total: 1 });
    expect(syncUxReferences(source, target)).toEqual({ copied: 0, removed: 0, total: 1 });
    writeFileSync(join(source, "one.md"), "updated"); writeFileSync(join(target, "old.md"), "stale");
    expect(syncUxReferences(source, target)).toEqual({ copied: 1, removed: 1, total: 1 });
    expect(readFileSync(join(target, "one.md"), "utf8")).toBe("updated");
  });
  it("validates source before mutating a mirror", () => {
    const { source, target } = fixture(); syncUxReferences(source, target);
    mkdirSync(join(source, "unexpected"));
    expect(() => syncUxReferences(source, target)).toThrow(/regular Markdown/);
    expect(readFileSync(join(target, "one.md"), "utf8")).toBe("canonical");
  });
  it("rejects symlinks, overlapping directories and user-owned non-Markdown entries", () => {
    const { root, source, target } = fixture();
    expect(() => syncUxReferences(source, source)).toThrow(/outside/);
    symlinkSync(source, target); expect(() => syncUxReferences(source, target)).toThrow(/real directory/);
    rmSync(target); mkdirSync(target); writeFileSync(join(target, "notes.txt"), "user-owned");
    expect(() => syncUxReferences(source, target)).toThrow(/user-owned/);
    expect(readFileSync(join(target, "notes.txt"), "utf8")).toBe("user-owned");
    symlinkSync(join(root, "missing.md"), join(source, "link.md")); expect(() => syncUxReferences(source, join(root, "another"))).toThrow();
  });
});
