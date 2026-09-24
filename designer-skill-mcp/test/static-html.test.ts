// The static-html engine imports its parsers lazily and falls back to regex
// detection when they are missing, so an undeclared parser dependency fails
// silently: HTML scans lose every DOM/cascade rule without any error.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanAntipatterns } from "../src/detect.js";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function engineBareImports(dir: string, found = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) engineBareImports(path, found);
    else if (/\.m?js$/.test(entry.name)) {
      // Comment lines are prose, not imports.
      const code = readFileSync(path, "utf8").split("\n").filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line)).join("\n");
      for (const [, spec] of code.matchAll(/(?:from\s+|import\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
        if (!spec.startsWith("node:")) found.add(spec);
      }
    }
  }
  return found;
}

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("static-html engine dependencies", () => {
  it("declares every package the bundled engine imports", () => {
    const { dependencies } = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
    const missing = [...engineBareImports(join(pkgRoot, "assets/engine"))]
      .filter((spec) => !(spec in dependencies));
    expect(missing).toEqual([]);
  });

  it("runs DOM cascade rules on HTML instead of the regex fallback", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "designer-static-html-")); roots.push(cwd);
    writeFileSync(join(cwd, "page.html"), '<!doctype html><html><body><p style="color:#777;background:#888">Low contrast</p></body></html>\n');
    const report = await scanAntipatterns("page.html", { cwd });
    expect(report.findings.map((f) => f.antipattern)).toContain("low-contrast");
  });
});
