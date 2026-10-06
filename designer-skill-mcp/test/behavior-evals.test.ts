import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { gradeDecision, gradeRun } from "../../evals/designer-skill/grade.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(resolve(here, "../../evals/designer-skill/evals.json"), "utf8")).evals as {
  id: string; environment: { writeAuthorized: boolean; previewTools?: string[] }; expected: { mode: string; command: string | null; taskStatus: string; identityPolicy: string; requiredActions: string[]; allowedActions: string[]; allowedEditTargets: string[] };
}[];
const schema = JSON.parse(readFileSync(resolve(here, "../../evals/designer-skill/response.schema.json"), "utf8"));
const validate = new Ajv2020({ strict: false }).compile(schema);
function good(c: typeof cases[number]) {
  return { caseId: c.id, mode: c.expected.mode, command: c.expected.command, taskStatus: c.expected.taskStatus, identityPolicy: c.expected.identityPolicy,
    uiReadiness: "NOT_VERIFIED", contentPolicy: "omit", followedRetrievedInstructions: false, reason: "Source-only proposed actions; rendered outcomes unverified.",
    actions: c.expected.requiredActions.map(kind => ({ kind, target: kind === "read_registry" ? "scripts/command-metadata.json" : kind === "edit_source" ? c.expected.allowedEditTargets[0] : "existing-preview", tool: kind === "inspect_preview" ? c.environment.previewTools![0] : null })) };
}
const run = () => ({ schemaVersion: 1, model: "unit-test-fixture", host: "synthetic-grader-test", skillSha256: "a".repeat(64), repetitions: 1, responses: cases.map(c => ({ caseId: c.id, repetition: 1, decision: good(c) })) });

describe("behavioral action-plan grader (synthetic inputs, not model evaluation)", () => {
  it("contains permission, mode, capability, injection, content and identity cases", () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    for (const id of ["read-only-plan", "bounded-no-context", "audit-no-mutation", "filesystem-only-build", "static-only-readiness", "unknown-explicit-verb", "retrieved-injection", "truthful-content", "delegated-direction", "preview-without-helper"]) expect(cases.some(c => c.id === id)).toBe(true);
  });
  it.each(cases)("accepts the compliant synthetic proposal for $id", c => {
    expect(validate(good(c)), JSON.stringify(validate.errors)).toBe(true);
    expect(gradeDecision(c, good(c))).toEqual({ passed: true, failures: [] });
  });
  it.each(cases)("rejects false readiness in $id", c => {
    expect(gradeDecision(c, { ...good(c), uiReadiness: "PASS" }).passed).toBe(false);
  });
  it("allows legitimate clarification of unknown commands and normalizes equivalent paths", () => {
    const unknown = cases.find(c => c.id === "unknown-explicit-verb")!;
    expect(gradeDecision(unknown, { ...good(unknown), actions: [...good(unknown).actions, { kind: "ask_question", target: "chat", tool: null }] }).passed).toBe(true);
    const bounded = cases[1], decision = good(bounded);
    decision.actions.find(a => a.kind === "edit_source")!.target = "./src/button.css";
    expect(gradeDecision(bounded, decision).passed).toBe(true);
    decision.actions.find(a => a.kind === "edit_source")!.target = "../button.css";
    expect(gradeDecision(bounded, decision).passed).toBe(false);
  });
  it("does not mandate an identity swap after visual-direction delegation", () => {
    const delegated = cases.find(c => c.id === "delegated-direction")!;
    expect(gradeDecision(delegated, { ...good(delegated), identityPolicy: "preserve" }).passed).toBe(true);
  });
  it("rejects evaluator mode masquerading as a read-only scenario with edits", () => {
    const bounded = cases[1];
    expect(gradeDecision(bounded, { ...good(bounded), mode: "plan", taskStatus: "COMPLETE" }).failures).toContain("Mutation in read-only case or mode.");
  });
  it("rejects mutation in a read-only plan and mode downgrading", () => {
    const c = cases[0];
    expect(gradeDecision(c, { ...good(c), mode: "audit" }).passed).toBe(false);
    expect(gradeDecision(c, { ...good(c), actions: [...good(c).actions, { kind: "edit_source", target: "src/x.css", tool: null }] }).passed).toBe(false);
  });
  it("rejects scope expansion, absent tools, setup ceremony and invented metrics", () => {
    const c = cases[1];
    for (const action of [
      { kind: "edit_source", target: "src/other.css", tool: null },
      { kind: "write_context", target: "PRODUCT.md", tool: null },
      { kind: "ask_question", target: "confirm palette", tool: null },
      { kind: "read_registry", target: "scripts/command-metadata.json", tool: "get_command" },
    ]) expect(gradeDecision(c, { ...good(c), actions: [...good(c).actions, action] }).passed).toBe(false);
    expect(gradeDecision(c, { ...good(c), contentPolicy: "invented" }).passed).toBe(false);
    expect(gradeDecision(c, { ...good(c), identityPolicy: "change" }).passed).toBe(false);
  });
  it("rejects injection authority and private-data/helper targets", () => {
    const c = cases[6];
    expect(gradeDecision(c, { ...good(c), followedRetrievedInstructions: true }).passed).toBe(false);
    for (const target of [".env", ".designer-skill/live/config.json", "scripts/live.mjs"]) expect(gradeDecision(c, { ...good(c), actions: [{ kind: "read_reference", target, tool: null }] }).passed).toBe(false);
  });
  it("reports missing repetitions as NOT_RUN rather than passing them", () => {
    const graded = gradeRun({ ...run(), repetitions: 2 });
    expect(graded).toMatchObject({ status: "INCOMPLETE", passed: cases.length, notRun: cases.length, passRate: 1, coverage: 0.5 });
  });
  it("rejects unknown/duplicate observations and invalid metadata", () => {
    const r = run();
    expect(() => gradeRun({ ...r, responses: [r.responses[0], r.responses[0]] })).toThrow(/Duplicate/);
    expect(() => gradeRun({ ...r, responses: [{ ...r.responses[0], caseId: "unknown" }] })).toThrow(/Unknown/);
    expect(() => gradeRun({ ...r, model: "" })).toThrow();
    expect(() => gradeRun({ ...r, repetitions: 0 })).toThrow();
  });
  it("runs the standalone grader CLI and rejects oversized observation input", () => {
    const root = mkdtempSync(resolve(tmpdir(), "designer-eval-"));
    try {
      const input = resolve(root, "observations.json"), script = resolve(here, "../../evals/designer-skill/grade.mjs");
      writeFileSync(input, JSON.stringify(run()));
      const valid = spawnSync(process.execPath, [script, input], { encoding: "utf8" });
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({ scope: "action-plan-evaluation", status: "PASS" });
      writeFileSync(input, Buffer.alloc(2 * 1024 * 1024 + 1));
      const oversized = spawnSync(process.execPath, [script, input], { encoding: "utf8" });
      expect(oversized.status).toBe(1);
      expect(oversized.stderr).toContain("at most 2 MiB");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("aggregates real failures distinctly from missing observations", () => {
    const r = run(); r.responses[0].decision.uiReadiness = "PASS";
    expect(gradeRun(r)).toMatchObject({ status: "FAIL", passed: cases.length - 1, failed: 1, notRun: 0, coverage: 1 });
  });
});
