// Static detector adapter. Coverage is evidence; an empty finding list is not.
import { readFileSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertWithin, DesignError, projectRoot, validateConfigFiles, selectScanFiles, type ScanCoverage } from "./scope.js";

export interface DetectionFinding {
  file: string;
  line?: number;
  antipattern: string;
  snippet: string;
  description: string;
  importedBy?: string[];
}

export interface DetectionReport {
  target: string;
  coverage: ScanCoverage;
  findings: DetectionFinding[];
  files: Array<{ path: string; sha256: string }>;
  ignoredRules: string[];
  ignoredValues: number;
}

function resolveEngineDir(): string {
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "engine");
  if (existsSync(join(bundled, "detect-antipatterns.mjs"))) return bundled;
  throw new DesignError("ENGINE_MISSING", "Detector engine not found in assets/engine. Run npm run build.");
}

async function loadEngine() {
  const dir = resolveEngineDir();
  const [html, text, design, config, fs] = await Promise.all([
    import(pathToFileURL(join(dir, "engines/static-html/detect-html.mjs")).href),
    import(pathToFileURL(join(dir, "engines/regex/detect-text.mjs")).href),
    import(pathToFileURL(join(dir, "design-system.mjs")).href),
    import(pathToFileURL(join(dir, "lib/designer-skill-config.mjs")).href),
    import(pathToFileURL(join(dir, "node/file-system.mjs")).href),
  ]);
  return {
    detectHtml: html.detectHtml as (file: string, options: object) => Promise<DetectionFinding[]>,
    detectText: text.detectText as (text: string, file: string, options: object) => DetectionFinding[],
    loadDesignSystemForCwd: design.loadDesignSystemForCwd as (cwd: string) => unknown,
    readDetectionConfig: config.readDetectionConfig as (cwd: string) => {
      ignoreRules: string[]; ignoreFiles: string[]; ignoreValues: string[]; designSystem?: { enabled?: boolean };
    },
    filterDetectionFindings: config.filterDetectionFindings as (findings: DetectionFinding[], config: unknown) => DetectionFinding[],
    shouldIgnoreDetectionFile: config.shouldIgnoreDetectionFile as (file: string, cwd: string, config: unknown) => boolean,
    HTML_EXTENSIONS: fs.HTML_EXTENSIONS as Set<string>,
    SCANNABLE_EXTENSIONS: fs.SCANNABLE_EXTENSIONS as Set<string>,
    SKIP_DIRS: fs.SKIP_DIRS as Set<string>,
    buildImportGraph: fs.buildImportGraph as (files: string[]) => Map<string, Set<string>>,
  };
}

export async function scanAntipatterns(
  target: string,
  options: { cwd?: string; useConfig?: boolean } = {},
): Promise<DetectionReport> {
  const cwd = projectRoot(options.cwd ?? process.cwd());
  if (options.useConfig !== false) validateConfigFiles(cwd);
  const engine = await loadEngine();
  const config = options.useConfig === false
    ? { ignoreRules: [], ignoreFiles: [], ignoreValues: [], designSystem: { enabled: true } }
    : engine.readDetectionConfig(cwd);
  const selected = selectScanFiles(cwd, target, engine.SCANNABLE_EXTENSIONS, engine.SKIP_DIRS,
    (file) => engine.shouldIgnoreDetectionFile(file, cwd, config));
  const designSystem = options.useConfig !== false && config.designSystem?.enabled !== false
    ? engine.loadDesignSystemForCwd(selected.root) : null;
  const scanOptions = designSystem ? { designSystem } : {};
  const findings: DetectionFinding[] = [];
  const files: DetectionReport["files"] = [];
  const graph = engine.buildImportGraph(selected.files);
  const importers = new Map<string, string[]>();
  for (const [importer, imports] of graph) {
    for (const imported of imports) {
      importers.set(imported, [...(importers.get(imported) ?? []), relative(selected.root, importer)]);
    }
  }
  for (const file of selected.files) {
    const before = lstatSync(file);
    assertWithin(selected.root, realpathSync(file));
    if (!before.isFile() || before.size > 2 * 1024 * 1024) {
      throw new DesignError("CONCURRENT_CHANGE", "Selected input changed before scanning.");
    }
    const content = readFileSync(file);
    const digest = createHash("sha256").update(content).digest("hex");
    const detected = engine.HTML_EXTENSIONS.has(extname(file).toLowerCase())
      ? await engine.detectHtml(file, scanOptions)
      : engine.detectText(content.toString("utf8"), file, scanOptions);
    const after = lstatSync(file);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      digest !== createHash("sha256").update(readFileSync(file)).digest("hex")) {
      throw new DesignError("CONCURRENT_CHANGE", "Input changed during scanning. Rerun against a stable revision.");
    }
    findings.push(...detected.map((finding) => ({ ...finding, importedBy: importers.get(file) })));
    if (findings.length > 20_000) throw new DesignError("SCAN_LIMIT", "Too many findings. Narrow the target.");
    selected.coverage.scannedFiles++;
    selected.coverage.bytesScanned += content.byteLength;
    files.push({ path: relative(selected.root, file), sha256: digest });
  }
  return {
    target: relative(selected.root, selected.target) || ".",
    coverage: selected.coverage,
    findings: engine.filterDetectionFindings(findings, config), files,
    ignoredRules: [...config.ignoreRules], ignoredValues: config.ignoreValues.length,
  };
}

/** Compatibility adapter for callers that only consume findings. Prefer scanAntipatterns. */
export async function detectAntipatterns(target: string, options: { cwd?: string; useConfig?: boolean } = {}): Promise<DetectionFinding[]> {
  return (await scanAntipatterns(target, options)).findings;
}

export function formatDetectionResults(findings: DetectionFinding[]): string {
  if (!findings.length) return "No static findings. This does not establish rendered UI readiness.";
  return findings.map((f) => `[${f.antipattern}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.description}`).join("\n");
}
