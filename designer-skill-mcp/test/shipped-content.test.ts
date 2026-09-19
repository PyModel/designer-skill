// Ensures npm-shipped paths (what MCP / npx users receive) contain no forbidden branding.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { SHIPPED_ROOTS, SHIPPED_DIR_ROOTS } from "../scripts/shipped-roots.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Only paths listed in package.json "files" — the published package surface. */
const SHIPPED_PATHS = SHIPPED_ROOTS.map((p) => join(pkgRoot, p));

const FORBIDDEN = new RegExp(String.fromCharCode(105, 109, 112, 101, 99, 99, 97, 98, 108, 101), "i");

function walk(entry: string, files: string[] = []): string[] {
  if (!existsSync(entry)) return files;
  const st = statSync(entry);
  if (st.isFile()) {
    if (/\.(md|mjs|js|ts|json)$/.test(entry)) files.push(entry);
    return files;
  }
  if (!st.isDirectory()) return files;
  for (const name of readdirSync(entry)) {
    if (name === "node_modules") continue;
    walk(join(entry, name), files);
  }
  return files;
}

describe("shipped package content", () => {
  it("package.json files covers every dir root in the shipped-roots manifest", () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { files: string[] };
    const missing = SHIPPED_DIR_ROOTS.filter((root) => !pkg.files.includes(root));
    expect(missing, `package.json "files" is missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("contains no forbidden third-party skill branding in npm publish paths", () => {
    const violations: string[] = [];
    for (const root of SHIPPED_PATHS) {
      for (const file of walk(root)) {
        if (FORBIDDEN.test(readFileSync(file, "utf8"))) violations.push(file);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
