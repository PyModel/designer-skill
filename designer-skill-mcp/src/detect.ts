// Static detector adapter. Coverage is evidence; an empty finding list is not.
// File selection and policy live here; every file read and every detector runs
// in a worker thread under a deadline and heap limit (assets/engine/node).
import { Worker } from "node:worker_threads";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { DesignError, SCAN_LIMITS, loadDetectorPolicy, projectRoot, selectScanFiles, type ScanCoverage } from "./scope.js";
import { resolveDesignSources } from "./context.js";
import { bundledRoot } from "./assets.js";

export interface DetectionFinding {
  file: string;
  line?: number;
  antipattern: string;
  name: string;
  severity: string;
  snippet: string;
  description: string;
  importedBy?: string[];
}

export interface ScanGap {
  kind: string;
  rule?: string;
  detail?: string;
  line?: number;
}

export interface ScannedFile {
  path: string;
  engine: "static-html" | "regex";
  fullPage: boolean;
  gaps: ScanGap[];
}

export type DesignSystemStatus = "absent" | "no-tokens" | "loaded" | "invalid" | "disabled";

export interface DetectionReport {
  target: string;
  coverage: ScanCoverage;
  findings: DetectionFinding[];
  files: Array<{ path: string; sha256: string; role: "selected" | "linked-stylesheet" | "design-system" }>;
  scannedFiles: ScannedFile[];
  designSystem: { status: DesignSystemStatus; reason?: string };
  ignoredRules: string[];
  waivedRules: string[];
  ignoredValues: number;
}

/** Required static rules: blocking by default, required to have RUN for a static PASS, and waivable only in the committed config. */
export const REQUIRED_STATIC_RULES = ["broken-image", "low-contrast", "clipped-overflow-container"] as const;

export interface ScanOptions {
  cwd?: string;
  /** Rules that only the committed config may waive. Defaults to the required static rules. */
  protectedRules?: ReadonlySet<string>;
}

interface EngineModules {
  registry: { ANTIPATTERNS: Array<{ id: string }> };
  config: {
    assertValidGlob: (glob: string) => void;
    normalizeIgnoreValueEntries: (entries: unknown[]) => unknown[];
    shouldIgnoreDetectionFile: (relPath: string, config: unknown) => boolean;
    shouldPruneDetectionDirectory: (relDir: string, config: unknown) => boolean;
  };
  fileSystem: { SCANNABLE_EXTENSIONS: Set<string>; SKIP_DIRS: Set<string> };
  workerUrl: URL;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const WORKER_HEAP_MB = 1024;

let enginePromise: Promise<EngineModules> | undefined;
function loadEngine(): Promise<EngineModules> {
  enginePromise ??= (async () => {
    let dir: string;
    try {
      dir = bundledRoot("engine");
    } catch {
      throw new DesignError("ENGINE_MISSING", "Detector engine not found in assets/engine. Reinstall the package.");
    }
    const load = (file: string) => import(pathToFileURL(join(dir, file)).href);
    const [registry, config, fileSystem] = await Promise.all([
      load("registry/antipatterns.mjs"), load("lib/designer-skill-config.mjs"), load("node/file-system.mjs"),
    ]);
    return { registry, config, fileSystem, workerUrl: pathToFileURL(join(dir, "node/scan-worker.mjs")) } as EngineModules;
  })().catch((error) => {
    enginePromise = undefined; // a transient failure must not poison the process
    throw error;
  });
  return enginePromise;
}

export async function registryIds(): Promise<Set<string>> {
  return new Set((await loadEngine()).registry.ANTIPATTERNS.map((rule) => rule.id));
}

function scanTimeoutMs(): number {
  const raw = Number(process.env.DESIGNER_SKILL_SCAN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

interface WorkerResult {
  findings: DetectionFinding[];
  fileMeta: ScannedFile[];
  files: DetectionReport["files"];
  bytesScanned: number;
  unsupportedBinary: number;
  designSystem: DetectionReport["designSystem"];
}

function runWorker(workerUrl: URL, job: unknown): Promise<WorkerResult> {
  const timeoutMs = scanTimeoutMs();
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(workerUrl, { workerData: { job }, resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } });
    let currentFile = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new DesignError("SCAN_LIMIT",
      `Scan exceeded ${timeoutMs} ms${currentFile ? ` while analyzing ${currentFile}` : ""}. Narrow the target or ignore that file.`,
      { bound: "time", limit: timeoutMs, path: currentFile || "." }))), timeoutMs);
    worker.on("message", (message: { type: string; file?: string; result?: WorkerResult; error?: { code: string; message: string; details?: Record<string, unknown> } }) => {
      if (message.type === "progress") currentFile = message.file ?? "";
      else if (message.type === "result") finish(() => resolvePromise(message.result!));
      else if (message.type === "error") finish(() => reject(new DesignError(message.error!.code, message.error!.message, message.error!.details)));
    });
    worker.on("error", (error: Error & { code?: string }) => finish(() => reject(error.code === "ERR_WORKER_OUT_OF_MEMORY"
      ? new DesignError("SCAN_LIMIT", `Scan exceeded the ${WORKER_HEAP_MB} MiB analysis heap${currentFile ? ` while analyzing ${currentFile}` : ""}.`,
        { bound: "memory", limit: WORKER_HEAP_MB, path: currentFile || "." })
      : new DesignError("OPERATION_FAILED", `Detector failed: ${error.message}`))));
    worker.on("exit", (code) => finish(() => reject(new DesignError("OPERATION_FAILED", `Detector exited unexpectedly (code ${code}).`))));
  });
}

export async function scanAntipatterns(target: string, options: ScanOptions = {}): Promise<DetectionReport> {
  const root = projectRoot(options.cwd ?? process.cwd());
  const engine = await loadEngine();
  const ruleIds = new Set(engine.registry.ANTIPATTERNS.map((rule) => rule.id));
  const policy = loadDetectorPolicy(root, {
    ruleIds,
    protectedRules: options.protectedRules ?? new Set(REQUIRED_STATIC_RULES),
    validateGlob: engine.config.assertValidGlob,
    normalizeIgnoreValues: engine.config.normalizeIgnoreValueEntries,
  });
  const selected = selectScanFiles(root, target, {
    extensions: engine.fileSystem.SCANNABLE_EXTENSIONS,
    skipDirectories: engine.fileSystem.SKIP_DIRS,
    isIgnoredFile: (rel) => engine.config.shouldIgnoreDetectionFile(rel, policy),
    isPrunedDirectory: (rel) => engine.config.shouldPruneDetectionDirectory(rel, policy),
  });
  const design = policy.designSystemEnabled ? resolveDesignSources(root) : null;
  const result = selected.files.length
    ? await runWorker(engine.workerUrl, {
      root,
      webRoot: policy.webRoot,
      files: selected.files,
      policy: {
        ignoreRules: policy.ignoreRules,
        ignoreValues: policy.ignoreValues,
        designSystemEnabled: policy.designSystemEnabled,
      },
      design,
      limits: { maxFileBytes: SCAN_LIMITS.fileBytes, maxTotalBytes: SCAN_LIMITS.totalBytes, maxFindings: SCAN_LIMITS.findings },
    })
    : { findings: [], fileMeta: [], files: [], bytesScanned: 0, unsupportedBinary: 0, designSystem: { status: "absent" as const } };
  selected.coverage.scannedFiles = result.fileMeta.length;
  selected.coverage.bytesScanned = result.bytesScanned;
  selected.coverage.unsupportedFiles += result.unsupportedBinary;
  return {
    target: relative(root, selected.target).split(sep).join("/") || ".",
    coverage: selected.coverage,
    findings: result.findings,
    files: result.files,
    scannedFiles: result.fileMeta,
    designSystem: result.designSystem,
    ignoredRules: policy.ignoreRules,
    waivedRules: policy.waivedRules,
    ignoredValues: policy.ignoreValues.length,
  };
}

export function formatDetectionResults(findings: DetectionFinding[], limit = Infinity): string {
  if (!findings.length) return "No static findings. This does not establish rendered UI readiness.";
  const lines = findings.slice(0, limit).map((f) => `[${f.antipattern}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.snippet}`);
  if (findings.length > limit) lines.push(`… ${findings.length - limit} more in structuredContent.findings`);
  return lines.join("\n");
}
