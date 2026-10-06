import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { validateRunReport } from "../../skills/designer-skill/scripts/validate-report.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "designer-report-")); roots.push(root);
  const body = "Viewed final UI; keyboard and narrow viewport exercised.";
  writeFileSync(join(root, "inspection.txt"), body);
  const evidence = { artifact: "inspection.txt", sha256: createHash("sha256").update(body).digest("hex"), producer: "host-preview", revision: "final", origin: "observed" };
  const plan = { schemaVersion: 1, runId: "r", mode: "implement", inputRevision: "initial", outputRevision: "final", inputHash: "a".repeat(64), checks: [{ id: "ui", kind: "rendered", allowNotApplicable: false }] };
  const report = { schemaVersion: 2, runId: "r", mode: "implement", inputRevision: "initial", outputRevision: "final", inputHash: "a".repeat(64), taskStatus: "COMPLETE", uiReadiness: "PASS", checks: [{ id: "ui", kind: "rendered", required: true, status: "PASS", reason: "Inspected", evidence: [evidence] }], findings: [], changes: ["button.css"], limitations: [] };
  return { root, plan, report };
}

describe("host-bound semantic report validation", () => {
  it("verifies real evidence and returns report-validation, not UI-readiness scope", () => {
    const { root, plan, report } = fixture();
    expect(validateRunReport(report, plan, root)).toEqual({ status: "PASS", scope: "report-validation", issues: [] });
  });
  it.each(["runId", "mode", "inputRevision", "outputRevision", "inputHash"] as const)("rejects changed host identity %s", field => {
    const { root, plan, report } = fixture();
    expect(validateRunReport({ ...report, [field]: "different" }, plan, root).status).toBe("FAIL");
  });
  it.each(["static", "functional", "accessibility"])("rejects UI PASS backed by %s alone", kind => {
    const { root, plan, report } = fixture();
    report.checks[0].kind = kind; plan.checks[0].kind = kind;
    expect(validateRunReport(report, plan, root).issues).toContain("UI PASS requires planned rendered PASS and observed final-revision evidence.");
  });
  it("rejects stale evidence", () => {
    const { root, plan, report } = fixture(); report.checks[0].evidence[0].revision = "old";
    expect(validateRunReport(report, plan, root).issues).toContain("ui: stale evidence revision.");
  });
  it("requires final resolution evidence for resolved blocking findings but permits historical defect evidence", () => {
    const { root, plan, report } = fixture();
    const historic = { ...report.checks[0].evidence[0], revision: "initial" };
    const finding = { id: "f1", severity: "major", blocking: true, resolved: true, summary: "Fixed focus trap", evidence: [historic] };
    expect(validateRunReport({ ...report, findings: [finding] }, plan, root).status).toBe("FAIL");
    expect(validateRunReport({ ...report, findings: [{ ...finding, evidence: [historic, report.checks[0].evidence[0]] }] }, plan, root).status).toBe("PASS");
    expect(validateRunReport({ ...report, findings: [{ ...finding, blocking: false }] }, plan, root).status).toBe("PASS");
  });
  it("rejects implementation changes in both read-only modes", () => {
    const { root, plan, report } = fixture();
    for (const mode of ["audit", "plan"]) expect(validateRunReport({ ...report, mode }, { ...plan, mode }, root).status).toBe("FAIL");
  });
  it("rejects oversized evidence arrays before reading them", () => {
    const { root, plan, report } = fixture();
    report.checks[0].evidence = Array.from({ length: 17 }, () => report.checks[0].evidence[0]);
    expect(validateRunReport(report, plan, root).status).toBe("FAIL");
  });
  it("rejects hash mismatch", () => {
    const { root, plan, report } = fixture(); writeFileSync(join(root, "inspection.txt"), "changed");
    expect(validateRunReport(report, plan, root).issues).toContain("ui: artifact hash mismatch.");
  });
  it.each(["missing.txt", "../escape.txt", "/etc/passwd"])("rejects missing/outside artifact %s", artifact => {
    const { root, plan, report } = fixture(); report.checks[0].evidence[0].artifact = artifact;
    expect(validateRunReport(report, plan, root).status).toBe("FAIL");
  });
  it("rejects escaping symlinks", () => {
    const { root, plan, report } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "designer-outside-")); roots.push(outside);
    writeFileSync(join(outside, "outside.txt"), "outside"); symlinkSync(join(outside, "outside.txt"), join(root, "link.txt"));
    report.checks[0].evidence[0].artifact = "link.txt";
    expect(validateRunReport(report, plan, root).issues).toContain("ui: Artifact escapes the authorized root.");
  });
  it("rejects oversized artifacts", () => {
    const { root, plan, report } = fixture(); writeFileSync(join(root, "inspection.txt"), Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(validateRunReport(report, plan, root).status).toBe("FAIL");
  });
  it("rejects removed, downgraded, duplicate or unauthorized waived checks", () => {
    const { root, plan, report } = fixture();
    for (const checks of [[], [{ ...report.checks[0], required: false }], [report.checks[0], report.checks[0]], [{ ...report.checks[0], status: "NOT_APPLICABLE" }]]) {
      expect(validateRunReport({ ...report, checks }, plan, root).status).toBe("FAIL");
    }
    expect(validateRunReport(report, { ...plan, checks: [plan.checks[0], plan.checks[0]] }, root).status).toBe("FAIL");
  });
  it("rejects execution without inspection and legacy reports", () => {
    const { root, plan, report } = fixture(); report.checks[0].evidence[0].origin = "executed";
    expect(validateRunReport(report, plan, root).status).toBe("FAIL");
    expect(validateRunReport({ ...report, schemaVersion: 1 }, plan, root).status).toBe("FAIL");
  });
  it("accepts honest completed read-only plans and audits without rendered readiness", () => {
    const { root, plan, report } = fixture();
    for (const mode of ["plan", "audit"]) {
      const checks = [{ ...report.checks[0], kind: "static", status: "FAIL" }];
      const expected = { ...plan, mode, checks: [{ ...plan.checks[0], kind: "static" }] };
      expect(validateRunReport({ ...report, mode, changes: [], checks, uiReadiness: "NOT_VERIFIED" }, expected, root).status).toBe("PASS");
    }
  });
  it("accepts missing rendered capability only as honest partial work", () => {
    const { root, plan, report } = fixture();
    const checks = [{ ...report.checks[0], status: "NOT_RUN", evidence: [] }];
    expect(validateRunReport({ ...report, checks, taskStatus: "PARTIAL", uiReadiness: "NOT_VERIFIED" }, plan, root).status).toBe("PASS");
    expect(validateRunReport({ ...report, checks }, plan, root).status).toBe("FAIL");
  });
  it.each([null, {}, { schemaVersion: 2, checks: "wrong" }])("fails malformed inputs without throwing", bad => {
    const { root, plan } = fixture(); expect(validateRunReport(bad, plan, root).status).toBe("FAIL");
  });
  it("runs from a filesystem skill without package dependencies and fails nonzero on bad evidence", () => {
    const { root, plan, report } = fixture();
    writeFileSync(join(root, "plan.json"), JSON.stringify(plan)); writeFileSync(join(root, "report.json"), JSON.stringify(report));
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/designer-skill/scripts/validate-report.mjs");
    const args = [script, join(root, "report.json"), join(root, "plan.json"), root];
    expect(JSON.parse(execFileSync(process.execPath, args, { encoding: "utf8" })).status).toBe("PASS");
    rmSync(join(root, "inspection.txt"));
    expect(spawnSync(process.execPath, args, { encoding: "utf8" }).status).toBe(1);
  });
});
