import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewAndGate, validateRegistry } from "../src/gate.js";
import { scanAntipatterns } from "../src/detect.js";

const roots: string[] = [];
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "designer-gate-")); roots.push(path); return path;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("bundled detector integration", () => {
  it("does not pass empty directories", async () => {
    const result = await reviewAndGate(".", { cwd: root() });
    expect(result.code).toBe("NO_SCAN_COVERAGE"); expect(result.status).toBe("FAIL");
  });
  it("reports scanned files and hashes without certifying UI readiness", async () => {
    const cwd = root(); writeFileSync(join(cwd, "fixture.css"), ".fixture { display: block; }\n");
    const result = await reviewAndGate("fixture.css", { cwd });
    expect(result.coverage.scannedFiles).toBe(1);
    expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.status).not.toBe("PASS"); expect(result.checks.find((c) => c.id === "rendered")?.status).toBe("NOT_RUN");
  });
  it("cannot pass ignored-only scans", async () => {
    const cwd = root(); mkdirSync(join(cwd, ".designer-skill"));
    writeFileSync(join(cwd, "fixture.css"), ".fixture { display: block; }");
    writeFileSync(join(cwd, ".designer-skill/config.json"), JSON.stringify({ detector: { ignoreFiles: ["fixture.css"] } }));
    const result = await reviewAndGate("fixture.css", { cwd });
    expect(result.coverage.ignoredFiles).toBe(1); expect(result.code).toBe("NO_SCAN_COVERAGE");
  });
  it("rejects malformed config instead of using silent defaults", async () => {
    const cwd = root(); mkdirSync(join(cwd, ".designer-skill"));
    writeFileSync(join(cwd, ".designer-skill/config.json"), "{not json");
    await expect(scanAntipatterns(".", { cwd })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
  it("rejects external targets and symlink escapes", async () => {
    const cwd = root(), outside = root(); writeFileSync(join(outside, "private.css"), "body {}");
    await expect(scanAntipatterns(join(outside, "private.css"), { cwd })).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
    symlinkSync(join(outside, "private.css"), join(cwd, "escape.css"));
    await expect(scanAntipatterns(".", { cwd })).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
  });
  it("fails closed on malformed registry metadata", () => {
    expect(() => validateRegistry(undefined)).toThrow(); expect(() => validateRegistry([])).toThrow();
  });
});
