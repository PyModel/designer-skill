// Behavioral tests for the ship gate: the interface is scan + gate, exercised
// with fixture files. This is the coverage the gate never had.
import { describe, it, expect } from "vitest";
import { reviewAndGate, GATE_CONTRACT, gateRequirementText } from "../src/gate.js";
import { detectAntipatterns } from "../src/detect.js";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("GATE_CONTRACT", () => {
  it("exposes the scoring contract once", () => {
    expect(GATE_CONTRACT.passScore).toBe(85);
    expect(GATE_CONTRACT.slopPenalty).toBe(8);
    expect(GATE_CONTRACT.warningPenalty).toBe(3);
    expect(gateRequirementText()).toBe(`score ≥${GATE_CONTRACT.passScore}, zero blocking slop`);
  });
});

describe("reviewAndGate on fixtures", () => {
  it("clean markup passes with a perfect score", async () => {
    const result = await reviewAndGate(join(fixturesDir, "clean.html"), { cwd: fixturesDir });
    expect(result.status).toBe("PASS");
    expect(result.score).toBe(100);
    expect(result.blockingCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("slop markup fails with blocking findings and a consistent score", async () => {
    const result = await reviewAndGate(join(fixturesDir, "slop.html"), { cwd: fixturesDir });
    expect(result.status).toBe("FAIL");
    expect(result.blockingCount).toBeGreaterThanOrEqual(1);
    expect(result.score).toBe(
      Math.max(0, 100 - result.blockingCount * GATE_CONTRACT.slopPenalty - result.warningCount * GATE_CONTRACT.warningPenalty),
    );
    expect(result.summary).toContain("review_and_gate: FAIL");
    expect(result.fixes.some((f) => f.startsWith("[BLOCKING]"))).toBe(true);
  });

  it("detectAntipatterns surfaces slop ids deterministically", async () => {
    const findings = await detectAntipatterns(join(fixturesDir, "slop.html"), { cwd: fixturesDir });
    const ids = findings.map((f) => f.antipattern);
    expect(ids).toContain("side-tab");
    expect(ids.length).toBeGreaterThan(0);
    // Same input, same output — no LLM, no nondeterminism.
    const again = await detectAntipatterns(join(fixturesDir, "slop.html"), { cwd: fixturesDir });
    expect(again.map((f) => `${f.antipattern}:${f.line}`).sort()).toEqual(
      findings.map((f) => `${f.antipattern}:${f.line}`).sort(),
    );
  });

  it("clean markup detects nothing", async () => {
    const findings = await detectAntipatterns(join(fixturesDir, "clean.html"), { cwd: fixturesDir });
    expect(findings).toEqual([]);
  });
});
