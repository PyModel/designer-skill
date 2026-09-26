import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate, reviewAndGate, validateRegistry } from "../src/gate.js";
import { scanAntipatterns, REQUIRED_STATIC_RULES, type DetectionReport, type ScannedFile } from "../src/detect.js";

const roots: string[] = [];
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "designer-gate-")); roots.push(path); return path;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function writeConfig(cwd: string, name: string, detector: unknown): void {
  mkdirSync(join(cwd, ".designer-skill"), { recursive: true });
  writeFileSync(join(cwd, ".designer-skill", name), JSON.stringify({ detector }));
}

const CLEAN_PAGE = '<!doctype html><html><head><title>t</title></head><body><main><p>Readable text</p></main></body></html>\n';

describe("bundled detector integration", () => {
  it("does not pass empty directories", async () => {
    const result = await reviewAndGate(".", { cwd: root() });
    expect(result.code).toBe("NO_SCAN_COVERAGE"); expect(result.status).toBe("FAIL");
  });

  it("reports scanned files and hashes without certifying UI readiness", async () => {
    const cwd = root(); writeFileSync(join(cwd, "fixture.css"), ".fixture { display: block; }\n");
    const result = await reviewAndGate("fixture.css", { cwd });
    expect(result.schemaVersion).toBe(3);
    expect(result.coverage.scannedFiles).toBe(1);
    expect(result.files[0]).toMatchObject({ path: "fixture.css", role: "selected" });
    expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.status).toBe("NOT_VERIFIED");
    expect(result.checks.find((c) => c.id === "rendered")).toMatchObject({ status: "NOT_RUN", rules: ["text-overflow"] });
  });

  it("does not claim a static PASS for rules a CSS-only scan cannot evaluate", async () => {
    const cwd = root(); writeFileSync(join(cwd, "fixture.css"), ".fixture { display: block; }\n");
    const result = await reviewAndGate("fixture.css", { cwd });
    expect(result.staticStatus).toBe("INCOMPLETE");
    expect(result.code).toBe("REQUIRED_RULES_UNSUPPORTED");
  });

  it("passes the static check on a clean full page only as NOT_VERIFIED", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    const result = await reviewAndGate("index.html", { cwd });
    expect(result.ruleCoverage.map((c) => [c.rule, c.status])).toEqual(REQUIRED_STATIC_RULES.map((r) => [r, "RAN"]));
    expect(result).toMatchObject({ staticStatus: "PASS", status: "NOT_VERIFIED", code: "ADDITIONAL_VERIFICATION_REQUIRED" });
  });

  it("fails on a required-rule finding with a positive line number", async () => {
    const cwd = root();
    writeFileSync(join(cwd, "index.html"), '<!doctype html><html><body>\n<p style="color:#777;background:#888">Low contrast</p>\n</body></html>\n');
    const result = await reviewAndGate("index.html", { cwd });
    expect(result).toMatchObject({ staticStatus: "FAIL", code: "STATIC_FINDINGS" });
    const finding = result.findings.find((f) => f.antipattern === "low-contrast");
    expect(finding).toMatchObject({ file: "index.html", line: 2 });
  });

  it("marks cascade rules UNRESOLVED when a stylesheet cannot be read", async () => {
    const cwd = root();
    writeFileSync(join(cwd, "index.html"), CLEAN_PAGE.replace("<title>t</title>", '<title>t</title><link rel="stylesheet" href="https://cdn.example/app.css">'));
    const result = await reviewAndGate("index.html", { cwd });
    expect(result).toMatchObject({ staticStatus: "INCOMPLETE", code: "REQUIRED_RULES_UNRESOLVED" });
    expect(result.ruleCoverage.find((c) => c.rule === "low-contrast")?.status).toBe("UNRESOLVED");
  });

  it("cannot pass ignored-only scans", async () => {
    const cwd = root();
    writeFileSync(join(cwd, "fixture.css"), ".fixture { display: block; }");
    writeConfig(cwd, "config.json", { ignoreFiles: ["fixture.css"] });
    const result = await reviewAndGate("fixture.css", { cwd });
    expect(result.coverage.ignoredFiles).toBe(1); expect(result.code).toBe("NO_SCAN_COVERAGE");
  });

  it("rejects malformed config instead of using silent defaults", async () => {
    const cwd = root(); mkdirSync(join(cwd, ".designer-skill"));
    writeFileSync(join(cwd, ".designer-skill/config.json"), "{not json");
    await expect(scanAntipatterns(".", { cwd })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("validates config reached through a symlinked project root", async () => {
    const real = root(), linked = join(root(), "linked"); symlinkSync(real, linked);
    writeFileSync(join(real, "a.css"), "a {}");
    writeConfig(real, "config.json", {});
    await expect(scanAntipatterns(".", { cwd: linked })).resolves.toMatchObject({ target: "." });
    writeFileSync(join(real, ".designer-skill/config.json"), "{not json");
    await expect(scanAntipatterns(".", { cwd: linked })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("rejects external targets and symlinked targets", async () => {
    const cwd = root(), outside = root(); writeFileSync(join(outside, "private.css"), "body {}");
    await expect(scanAntipatterns(join(outside, "private.css"), { cwd })).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
    await expect(scanAntipatterns("../x.css", { cwd })).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
    symlinkSync(join(outside, "private.css"), join(cwd, "escape.css"));
    await expect(scanAntipatterns("escape.css", { cwd })).rejects.toMatchObject({ code: "SCOPE_VIOLATION" });
  });

  it("skips and counts symlinks inside a directory scan without reading them", async () => {
    const cwd = root(), outside = root(); writeFileSync(join(outside, "private.css"), "body {}");
    writeFileSync(join(cwd, "own.css"), "a {}");
    symlinkSync(join(outside, "private.css"), join(cwd, "escape.css"));
    const report = await scanAntipatterns(".", { cwd });
    expect(report.coverage.skippedSymlinks).toBe(1);
    expect(report.files.map((f) => f.path)).toEqual(["own.css"]);
  });

  it("prunes dependency and virtualenv directories", async () => {
    const cwd = root();
    for (const dir of ["node_modules/pkg", ".venv/lib", "src"]) mkdirSync(join(cwd, dir), { recursive: true });
    writeFileSync(join(cwd, "node_modules/pkg/a.css"), "a {}");
    writeFileSync(join(cwd, ".venv/lib/b.js"), "x");
    writeFileSync(join(cwd, "src/c.css"), "c {}");
    const report = await scanAntipatterns(".", { cwd });
    expect(report.files.map((f) => f.path)).toEqual(["src/c.css"]);
  });

  it("prunes a deep dependency directory in a git work tree instead of hitting the depth limit", async () => {
    const cwd = root();
    execFileSync("git", ["init", "-q"], { cwd });
    const deep = join(cwd, "node_modules", ...Array.from({ length: 60 }, (_, i) => `d${i}`));
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "x.css"), "a {}");
    writeFileSync(join(cwd, "own.css"), "a {}");
    const report = await scanAntipatterns(".", { cwd });
    expect(report.coverage.enumeration).toBe("git");
    expect(report.files.map((f) => f.path)).toEqual(["own.css"]);
  });

  it("fails closed on malformed registry metadata", () => {
    expect(() => validateRegistry(undefined)).toThrow(); expect(() => validateRegistry([])).toThrow();
    expect(() => validateRegistry([{ id: "x", category: "slop" }])).toThrow(/Required rule/);
  });
});

describe("detector policy", () => {
  it.each([
    ["an unknown rule id", { ignoreRules: ["no-such-rule"] }],
    ["a case-variant rule id", { ignoreRules: ["Low-Contrast"] }],
    ["a padded rule id", { ignoreRules: [" low-contrast"] }],
    ["a non-array ignoreFiles", { ignoreFiles: "a.css" }],
    ["an absolute webRoot", { webRoot: "/etc" }],
    ["an escaping webRoot", { webRoot: "../.." }],
    ["a missing webRoot", { webRoot: "public" }],
    ["a file webRoot", { webRoot: "a.css" }],
    ["a non-boolean designSystem.enabled", { designSystem: { enabled: "no" } }],
  ])("rejects %s", async (_label, detector) => {
    const cwd = root(); writeFileSync(join(cwd, "a.css"), "a {}");
    writeConfig(cwd, "config.json", detector);
    await expect(reviewAndGate(".", { cwd })).rejects.toMatchObject({ code: expect.stringMatching(/CONFIG_INVALID|SCOPE_VIOLATION/) });
  });

  it("rejects a per-developer waiver of a required rule", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    writeConfig(cwd, "config.local.json", { ignoreRules: ["low-contrast"] });
    await expect(reviewAndGate(".", { cwd })).rejects.toMatchObject({ code: "CONFIG_INVALID", details: { rule: "low-contrast" } });
  });

  it.each([
    ["ignoreFiles", { ignoreFiles: ["bad.html"] }],
    ["ignoreValues", { ignoreValues: [{ rule: "low-contrast", value: "#777" }] }],
  ])("rejects per-developer %s that could hide a failing required rule", async (_field, detector) => {
    const cwd = root();
    writeFileSync(join(cwd, "bad.html"), '<!doctype html><html><body><p style="color:#777;background:#888">x</p></body></html>');
    writeFileSync(join(cwd, "clean.html"), CLEAN_PAGE);
    await expect(reviewAndGate(".", { cwd })).resolves.toMatchObject({ staticStatus: "FAIL" });
    writeConfig(cwd, "config.local.json", detector);
    await expect(reviewAndGate(".", { cwd })).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });

  it("allows per-developer ignoreValues for an advisory rule", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    writeConfig(cwd, "config.local.json", { ignoreValues: [{ rule: "overused-font", value: "inter" }] });
    await expect(reviewAndGate(".", { cwd })).resolves.toMatchObject({ waivedRules: [] });
  });

  it("applies the same required-rule policy to detect_antipatterns as to the gate", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    writeConfig(cwd, "config.local.json", { ignoreRules: ["low-contrast"] });
    await expect(scanAntipatterns(".", { cwd })).rejects.toMatchObject({ code: "CONFIG_INVALID", details: { rule: "low-contrast" } });
    writeConfig(cwd, "config.local.json", {});
    writeConfig(cwd, "config.json", { ignoreRules: ["low-contrast"] });
    await expect(scanAntipatterns(".", { cwd })).resolves.toMatchObject({ waivedRules: ["low-contrast"] });
  });

  it("allows a per-developer waiver of an advisory rule", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    writeConfig(cwd, "config.local.json", { ignoreRules: ["side-tab"] });
    await expect(reviewAndGate(".", { cwd })).resolves.toMatchObject({ ignoredRules: ["side-tab"], waivedRules: [] });
  });

  it("reports committed waivers of required rules and suppresses their findings", async () => {
    const cwd = root();
    writeFileSync(join(cwd, "index.html"), '<!doctype html><html><body><p style="color:#777;background:#888">x</p></body></html>');
    writeConfig(cwd, "config.json", { ignoreRules: ["low-contrast"] });
    const result = await reviewAndGate(".", { cwd });
    expect(result.waivedRules).toEqual(["low-contrast"]);
    expect(result.findings.some((f) => f.antipattern === "low-contrast")).toBe(false);
    expect(result.code).toBe("REQUIRED_RULES_WAIVED");
    expect(result.staticStatus).toBe("PASS");
  });

  it("gives no coverage when every required rule is waived", async () => {
    const cwd = root(); writeFileSync(join(cwd, "index.html"), CLEAN_PAGE);
    writeConfig(cwd, "config.json", { ignoreRules: [...REQUIRED_STATIC_RULES] });
    await expect(reviewAndGate(".", { cwd })).resolves.toMatchObject({ code: "NO_SCAN_COVERAGE", status: "FAIL" });
  });

  it("rejects unknown project blocking rules", async () => {
    await expect(reviewAndGate(".", { cwd: root(), blockingRules: ["nope"] })).rejects.toMatchObject({ code: "REGISTRY_INVALID" });
  });
});

describe("evaluateGate rule matrix", () => {
  const registry = [...REQUIRED_STATIC_RULES, "text-overflow", "side-tab"].map((id) => ({ id, category: "quality" }));
  const file: ScannedFile = { path: "a.html", engine: "static-html", fullPage: true, gaps: [] };
  function report(over: Partial<DetectionReport> = {}): DetectionReport {
    return {
      target: ".", findings: [], files: [], scannedFiles: [file], designSystem: { status: "absent" },
      ignoredRules: [], waivedRules: [], ignoredValues: 0,
      coverage: {
        enumeration: "filesystem", candidateFiles: 1, scannedFiles: 1, ignoredFiles: 0, unsupportedFiles: 0, excludedDirectories: 0,
        skippedSymlinks: 0, skippedSpecialFiles: 0, unreadableEntries: 0, skippedPaths: [], bytesScanned: 10,
      },
      ...over,
    };
  }
  const ran = () => ({ status: "RAN" as const });

  it.each([
    ["all rules ran", ran, {}, "PASS", "ADDITIONAL_VERIFICATION_REQUIRED"],
    ["a rule unresolved", (r: string) => r === "low-contrast" ? { status: "UNRESOLVED" as const, reason: "x" } : ran(), {}, "INCOMPLETE", "REQUIRED_RULES_UNRESOLVED"],
    ["a rule unsupported", (r: string) => r === "broken-image" ? { status: "UNSUPPORTED" as const } : ran(), {}, "INCOMPLETE", "REQUIRED_RULES_UNSUPPORTED"],
    ["a blocking finding", ran, { findings: [{ file: "a.html", line: 1, antipattern: "broken-image", snippet: "s", description: "d" }] }, "FAIL", "STATIC_FINDINGS"],
    ["no bytes scanned", ran, { coverage: { ...report().coverage, bytesScanned: 0 } }, "FAIL", "NO_SCAN_COVERAGE"],
  ] as const)("%s", (_label, coverageOf, over, staticStatus, code) => {
    const result = evaluateGate(report(over as Partial<DetectionReport>), registry, coverageOf);
    expect(result).toMatchObject({ staticStatus, code, status: staticStatus === "FAIL" ? "FAIL" : "NOT_VERIFIED" });
  });

  it("unresolved outranks unsupported, and findings outrank both", () => {
    const mixed = (r: string) => r === "low-contrast" ? { status: "UNRESOLVED" as const } : { status: "UNSUPPORTED" as const };
    expect(evaluateGate(report(), registry, mixed).code).toBe("REQUIRED_RULES_UNRESOLVED");
    const withFinding = report({ findings: [{ file: "a.html", antipattern: "low-contrast", snippet: "", description: "" }] });
    expect(evaluateGate(withFinding, registry, mixed).code).toBe("STATIC_FINDINGS");
  });

  it("treats project blocking rules as required and advisory findings as warnings", () => {
    const findings = [{ file: "a.html", antipattern: "side-tab", snippet: "", description: "" }];
    expect(evaluateGate(report({ findings }), registry, ran)).toMatchObject({ code: "ADDITIONAL_VERIFICATION_REQUIRED", warningCount: 1 });
    expect(evaluateGate(report({ findings }), registry, ran, ["side-tab"])).toMatchObject({ code: "STATIC_FINDINGS", blockingCount: 1 });
  });

  it("deduplicates identical findings and rejects unregistered ones", () => {
    const f = { file: "a.html", line: 3, antipattern: "side-tab", snippet: "s", description: "d" };
    expect(evaluateGate(report({ findings: [f, { ...f }] }), registry, ran).findingCount).toBe(1);
    expect(() => evaluateGate(report({ findings: [{ ...f, antipattern: "ghost" }] }), registry, ran)).toThrow(/unregistered/);
  });
});
