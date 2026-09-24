// A static check cannot certify an interface it never rendered, nor a rule it
// never evaluated: coverage is reported per required rule, per scanned file.
import { pathToFileURL } from "node:url";
import { scanAntipatterns, formatDetectionResults, type DetectionReport, type DetectionFinding, type ScannedFile } from "./detect.js";
import { DesignError } from "./scope.js";
import { bundledFile } from "./assets.js";

interface Rule { id: string; category: "slop" | "quality"; severity?: string }
type RuleStatus = "RAN" | "WAIVED" | "UNSUPPORTED" | "UNRESOLVED";
type CoverageFn = (ruleId: string, file: ScannedFile, designSystemStatus: string) => { status: Exclude<RuleStatus, "WAIVED">; reason?: string };

/** Required static rules: blocking by default and required to have RUN for a static PASS. */
export const REQUIRED_STATIC_RULES = ["broken-image", "low-contrast", "clipped-overflow-container"] as const;
/** Required rules only a rendered check can evaluate; always reported as NOT_RUN here. */
export const REQUIRED_RENDERED_RULES = ["text-overflow"] as const;
const REPORTED_FINDINGS = 20;
const REPORTED_EXAMPLES = 5;

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
  for (const id of [...REQUIRED_STATIC_RULES, ...REQUIRED_RENDERED_RULES]) {
    if (!ids.has(id)) throw new DesignError("REGISTRY_INVALID", `Required rule "${id}" is missing from the detector registry.`);
  }
  return value as Rule[];
}

export interface RuleCoverage {
  rule: string;
  status: RuleStatus;
  files: { ran: number; unsupported: number; unresolved: number };
  examples: Array<{ path: string; status: RuleStatus; reason: string }>;
}

export type GateCode = "NO_SCAN_COVERAGE" | "STATIC_FINDINGS" | "REQUIRED_RULES_UNRESOLVED" | "REQUIRED_RULES_UNSUPPORTED" |
  "REQUIRED_RULES_WAIVED" | "ADDITIONAL_VERIFICATION_REQUIRED";

export interface GateResult {
  schemaVersion: 3;
  status: "FAIL" | "NOT_VERIFIED";
  staticStatus: "PASS" | "FAIL" | "INCOMPLETE";
  uiReadiness: "FAIL" | "NOT_VERIFIED";
  scope: "static";
  code: GateCode;
  findingCount: number;
  blockingCount: number;
  warningCount: number;
  findings: DetectionFinding[];
  ruleCoverage: RuleCoverage[];
  coverage: DetectionReport["coverage"];
  files: DetectionReport["files"];
  designSystem: DetectionReport["designSystem"];
  ignoredRules: string[];
  waivedRules: string[];
  ignoredValues: number;
  checks: Array<{ id: string; status: "PASS" | "FAIL" | "INCOMPLETE" | "NOT_RUN"; producer: string | null; rules?: string[] }>;
  summary: string;
}

function ruleCoverage(rule: string, report: DetectionReport, coverageOf: CoverageFn): RuleCoverage {
  const out: RuleCoverage = { rule, status: "RAN", files: { ran: 0, unsupported: 0, unresolved: 0 }, examples: [] };
  if (report.waivedRules.includes(rule)) {
    out.status = "WAIVED";
    return out;
  }
  for (const file of report.scannedFiles) {
    const cell = coverageOf(rule, file, report.designSystem.status);
    if (cell.status === "RAN") { out.files.ran++; continue; }
    if (cell.status === "UNSUPPORTED") out.files.unsupported++;
    else out.files.unresolved++;
    if (out.examples.length < REPORTED_EXAMPLES) out.examples.push({ path: file.path, status: cell.status, reason: cell.reason ?? "" });
  }
  out.status = out.files.unresolved ? "UNRESOLVED" : out.files.unsupported ? "UNSUPPORTED" : "RAN";
  return out;
}

function describeRule(c: RuleCoverage): string {
  if (c.status === "WAIVED") return `${c.rule} WAIVED (committed config.json)`;
  if (c.status === "RAN") return `${c.rule} RAN on ${c.files.ran} file(s)`;
  const bad = c.status === "UNRESOLVED" ? c.files.unresolved : c.files.unsupported;
  const example = c.examples[0];
  return `${c.rule} ${c.status} on ${bad} file(s)${example ? ` (e.g. ${example.path}: ${example.reason})` : ""}`;
}

export function evaluateGate(report: DetectionReport, registry: unknown, coverageOf: CoverageFn, blockingRules: string[] = []): GateResult {
  const rules = validateRegistry(registry);
  const ids = new Set(rules.map((r) => r.id));
  const unknown = blockingRules.filter((id) => !ids.has(id));
  if (unknown.length) throw new DesignError("REGISTRY_INVALID", `Unknown project blocking rule(s): ${unknown.join(", ")}.`);
  if (report.findings.some((f) => !ids.has(f.antipattern))) throw new DesignError("REGISTRY_INVALID", "Detector emitted an unregistered rule.");
  const blocking = [...new Set<string>([...REQUIRED_STATIC_RULES, ...blockingRules])];
  const blockingSet = new Set(blocking);
  const seen = new Set<string>();
  const findings = report.findings.filter((f) => {
    const key = JSON.stringify([f.file, f.line, f.antipattern, f.snippet]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const blockingCount = findings.filter((f) => blockingSet.has(f.antipattern)).length;
  const coverage = blocking.map((rule) => ruleCoverage(rule, report, coverageOf));
  const allWaived = coverage.every((c) => c.status === "WAIVED");
  const scanned = report.coverage.scannedFiles > 0 && report.coverage.bytesScanned > 0;

  let staticStatus: GateResult["staticStatus"];
  let code: GateCode;
  if (!scanned || allWaived) { staticStatus = "FAIL"; code = "NO_SCAN_COVERAGE"; }
  else if (blockingCount) { staticStatus = "FAIL"; code = "STATIC_FINDINGS"; }
  else if (coverage.some((c) => c.status === "UNRESOLVED")) { staticStatus = "INCOMPLETE"; code = "REQUIRED_RULES_UNRESOLVED"; }
  else if (coverage.some((c) => c.status === "UNSUPPORTED")) { staticStatus = "INCOMPLETE"; code = "REQUIRED_RULES_UNSUPPORTED"; }
  else if (coverage.some((c) => c.status === "WAIVED")) { staticStatus = "PASS"; code = "REQUIRED_RULES_WAIVED"; }
  else { staticStatus = "PASS"; code = "ADDITIONAL_VERIFICATION_REQUIRED"; }
  const status = staticStatus === "FAIL" ? "FAIL" : "NOT_VERIFIED";

  const skipped = report.coverage.skippedSymlinks + report.coverage.skippedSpecialFiles + report.coverage.unreadableEntries;
  const summary = [
    `Static check: ${staticStatus} (${code}). UI readiness: ${status}.`,
    `Scanned ${report.coverage.scannedFiles} of ${report.coverage.candidateFiles} candidate files (${report.coverage.enumeration} listing); ` +
      `ignored ${report.coverage.ignoredFiles}; skipped ${skipped} symlink/special/unreadable entries.`,
    !scanned ? "No applicable files were scanned. Correct the target or document non-applicability."
      : allWaived ? "Every required rule is waived, so nothing was verified." : "",
    `${blockingCount} blocking and ${findings.length - blockingCount} advisory findings.`,
    `Required rules: ${coverage.map(describeRule).join("; ")}.`,
    report.designSystem.status === "invalid" ? `DESIGN.md: invalid (${report.designSystem.reason}); design-system rules did not run.` : "",
    `Rendered checks NOT_RUN: ${REQUIRED_RENDERED_RULES.join(", ")}; functional, accessibility and performance checks must be reported separately.`,
  ].filter(Boolean).join("\n");

  return {
    schemaVersion: 3, status, staticStatus, uiReadiness: status, scope: "static", code,
    findingCount: findings.length, blockingCount, warningCount: findings.length - blockingCount,
    findings, ruleCoverage: coverage, coverage: report.coverage, files: report.files, designSystem: report.designSystem,
    ignoredRules: report.ignoredRules, waivedRules: report.waivedRules, ignoredValues: report.ignoredValues,
    checks: [
      { id: "static", status: staticStatus, producer: "designer-skill-detector" },
      { id: "rendered", status: "NOT_RUN", producer: null, rules: [...REQUIRED_RENDERED_RULES] },
      ...["functional", "accessibility", "performance"].map((id) => ({ id, status: "NOT_RUN" as const, producer: null })),
    ],
    summary,
  };
}

async function loadRegistry(): Promise<{ ANTIPATTERNS: unknown; staticRuleCoverage: CoverageFn }> {
  let path: string;
  try {
    path = bundledFile("engine", "registry/antipatterns.mjs");
  } catch {
    throw new DesignError("REGISTRY_INVALID", "Detector registry is missing; reinstall the package.");
  }
  return import(pathToFileURL(path).href);
}

export async function reviewAndGate(target: string, options: { cwd?: string; blockingRules?: string[] } = {}): Promise<GateResult> {
  const registry = await loadRegistry();
  const rules = validateRegistry(registry.ANTIPATTERNS);
  const blockingRules = options.blockingRules ?? [];
  const unknown = blockingRules.filter((id) => !rules.some((r) => r.id === id));
  if (unknown.length) throw new DesignError("REGISTRY_INVALID", `Unknown project blocking rule(s): ${unknown.join(", ")}.`);
  const report = await scanAntipatterns(target, {
    cwd: options.cwd,
    protectedRules: new Set([...REQUIRED_STATIC_RULES, ...blockingRules]),
  });
  return evaluateGate(report, rules, registry.staticRuleCoverage, blockingRules);
}

/** Human-readable text block; the complete result is in structuredContent. */
export function formatGateResult(result: GateResult): string {
  const ordered = [...result.findings].sort((a, b) =>
    Number(!REQUIRED_STATIC_RULES.includes(a.antipattern as never)) - Number(!REQUIRED_STATIC_RULES.includes(b.antipattern as never)));
  return `## review_and_gate: ${result.status}\n\n${result.summary}\n\n` +
    (result.findings.length ? `${formatDetectionResults(ordered, REPORTED_FINDINGS)}\n\n` : "") +
    "Complete findings, per-rule coverage and file hashes are in structuredContent.";
}
