// A static check cannot certify an interface it never rendered.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanAntipatterns, formatDetectionResults, type DetectionReport, type DetectionFinding } from "./detect.js";
import { DesignError } from "./scope.js";

interface Rule { id: string; category: "slop" | "quality"; severity?: string }
const REQUIRED_REVIEW_RULES = new Set(["broken-image", "low-contrast", "text-overflow", "clipped-overflow-container"]);

export function validateRegistry(value: unknown): Rule[] {
  if (!Array.isArray(value) || !value.length) throw new DesignError("REGISTRY_INVALID", "Detector registry is empty or invalid.");
  const ids = new Set<string>();
  for (const rule of value) {
    if (!rule || typeof rule.id !== "string" || !rule.id.trim() || ids.has(rule.id) ||
      !["slop", "quality"].includes(rule.category)) {
      throw new DesignError("REGISTRY_INVALID", "Registry requires unique nonempty ids and known categories.");
    }
    ids.add(rule.id);
  }
  return value as Rule[];
}

export interface GateResult {
  schemaVersion: 2;
  status: "FAIL" | "NOT_VERIFIED";
  staticStatus: "PASS" | "FAIL";
  uiReadiness: "FAIL" | "NOT_VERIFIED";
  scope: "static";
  code: "STATIC_FINDINGS" | "NO_SCAN_COVERAGE" | "ADDITIONAL_VERIFICATION_REQUIRED";
  findingCount: number;
  blockingCount: number;
  warningCount: number;
  findings: DetectionFinding[];
  coverage: DetectionReport["coverage"];
  files: DetectionReport["files"];
  ignoredRules: string[];
  ignoredValues: number;
  checks: Array<{ id: string; status: "PASS" | "FAIL" | "NOT_RUN"; producer: string | null }>;
  fixes: string[];
  summary: string;
}

export function evaluateGate(report: DetectionReport, registry: unknown, blockingRules: string[] = []): GateResult {
  const rules = validateRegistry(registry);
  const ids = new Set(rules.map((r) => r.id));
  if (blockingRules.some((id) => !ids.has(id))) throw new DesignError("REGISTRY_INVALID", "Unknown project blocking rule.");
  if (report.findings.some((f) => !ids.has(f.antipattern))) throw new DesignError("REGISTRY_INVALID", "Detector emitted an unregistered rule.");
  const blocking = new Set([...REQUIRED_REVIEW_RULES, ...blockingRules]);
  const seen = new Set<string>();
  const findings = report.findings.filter((f) => {
    const key = JSON.stringify([f.file, f.line, f.antipattern, f.snippet]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const blockingCount = findings.filter((f) => blocking.has(f.antipattern)).length;
  const covered = report.coverage.scannedFiles > 0 && report.coverage.bytesScanned > 0 &&
    rules.some((rule) => !report.ignoredRules.includes(rule.id));
  const staticStatus = covered && !blockingCount ? "PASS" : "FAIL";
  const status = staticStatus === "FAIL" ? "FAIL" : "NOT_VERIFIED";
  const code = !covered ? "NO_SCAN_COVERAGE" : blockingCount ? "STATIC_FINDINGS" : "ADDITIONAL_VERIFICATION_REQUIRED";
  const fixes = findings.map((f) => `[${blocking.has(f.antipattern) ? "REVIEW REQUIRED" : "advisory"}] ${f.file}: ${f.description}`);
  if (!covered) fixes.unshift("No applicable files were scanned. Correct the target or document non-applicability.");
  const checks: GateResult["checks"] = [
    { id: "static", status: staticStatus, producer: "designer-skill-detector" },
    ...["functional", "rendered", "accessibility", "performance"].map((id) => ({ id, status: "NOT_RUN" as const, producer: null })),
  ];
  return {
    schemaVersion: 2, status, staticStatus, uiReadiness: status, scope: "static", code,
    findingCount: findings.length, blockingCount, warningCount: findings.length - blockingCount,
    findings, coverage: report.coverage, files: report.files,
    ignoredRules: report.ignoredRules, ignoredValues: report.ignoredValues, checks, fixes,
    summary: `Static check: ${staticStatus}. UI readiness: ${status}.\n` +
      `Scanned ${report.coverage.scannedFiles} of ${report.coverage.candidateFiles} candidate files; ignored ${report.coverage.ignoredFiles}.\n` +
      `${blockingCount} findings require review; ${findings.length - blockingCount} advisory findings.\n` +
      "Style preferences are not universal defects. Required rendered and behavioral checks must be reported separately.\n" +
      formatDetectionResults(findings),
  };
}

export async function reviewAndGate(target: string, options: { cwd?: string; blockingRules?: string[] } = {}): Promise<GateResult> {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "engine", "registry", "antipatterns.mjs");
  if (!existsSync(path)) throw new DesignError("REGISTRY_INVALID", "Detector registry is missing; reinstall the package.");
  const registry = validateRegistry((await import(pathToFileURL(path).href)).ANTIPATTERNS);
  const report = await scanAntipatterns(target, options);
  return evaluateGate(report, registry, options.blockingRules);
}

export function formatGateResult(result: GateResult, _includeChecklist = false): string {
  return `## review_and_gate: ${result.status}\n\n${result.summary}\n\n` +
    "Manual verification remains NOT_RUN until separately evidenced.\n\n```json\n" + JSON.stringify(result, null, 2) + "\n```";
}
