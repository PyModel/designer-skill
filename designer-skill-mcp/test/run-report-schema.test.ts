// The run-report schema must reject incoherent reports, not just malformed ones.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schema = JSON.parse(readFileSync(join(repo, "skills/designer-skill/schemas/run-report.schema.json"), "utf8"));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

const sha = "a".repeat(64);
const evidence = (origin: "executed" | "observed" | "attested") => ({ artifact: "report.json", sha256: sha, producer: "playwright", revision: "abc", origin });
const check = (status: string, origin: "executed" | "observed" | "attested" = "executed", required = true) =>
  ({ id: "rendered", required, status, reason: "ran", evidence: status === "PASS" || status === "FAIL" ? [evidence(origin)] : [] });
const base = {
  schemaVersion: 1, runId: "r1", mode: "implement", inputRevision: "a", outputRevision: "b", inputHash: sha,
  taskStatus: "COMPLETE", uiReadiness: "PASS", checks: [check("PASS")], findings: [], changes: ["src/a.css"], limitations: [],
};

describe("run-report schema coherence", () => {
  it("accepts a coherent PASS backed by executed evidence", () => {
    expect(validate(base), JSON.stringify(validate.errors)).toBe(true);
  });
  it.each([
    ["PASS backed only by attested evidence", { checks: [check("PASS", "attested")] }],
    ["BLOCKED task claiming UI PASS", { taskStatus: "BLOCKED" }],
    ["PASS with a required check not run", { checks: [check("PASS"), check("NOT_RUN")] }],
    ["PASS with a failing required check", { checks: [check("PASS"), check("FAIL")] }],
    ["PASS with an unresolved blocking finding", { findings: [{ id: "f", severity: "major", blocking: true, resolved: false, summary: "s", evidence: [evidence("executed")] }] }],
    ["an audit that changed files", { mode: "audit", taskStatus: "PARTIAL", uiReadiness: "NOT_VERIFIED", changes: ["src/a.css"] }],
    ["a completed implementation without UI PASS", { uiReadiness: "NOT_VERIFIED" }],
    ["a PASS/FAIL check with no evidence", { checks: [{ ...check("PASS"), evidence: [] }] }],
  ])("rejects %s", (_label, patch) => {
    expect(validate({ ...base, ...patch })).toBe(false);
  });
  it("rejects an attested-only required PASS even when UI readiness is not PASS", () => {
    expect(validate({ ...base, mode: "audit", changes: [], taskStatus: "PARTIAL", uiReadiness: "NOT_VERIFIED", checks: [check("PASS", "attested")] })).toBe(false);
  });
  it("accepts attested evidence on an optional check", () => {
    expect(validate({ ...base, checks: [check("PASS"), { ...check("PASS", "attested", false), id: "manual" }] })).toBe(true);
  });
  it("allows a completed audit that reports FAIL", () => {
    expect(validate({ ...base, mode: "audit", changes: [], uiReadiness: "FAIL", checks: [check("FAIL")] })).toBe(true);
  });
});
