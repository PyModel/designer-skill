// Programmatic anti-pattern detection — wraps the bundled detector engine.
import { readFileSync, statSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bundledRoot } from "./assets.js";

export interface DetectionFinding {
  file: string;
  line?: number;
  antipattern: string;
  snippet: string;
  description: string;
  importedBy?: string[];
}

type Engine = Awaited<ReturnType<typeof loadEngineOnce>>;

function resolveEngineDir(): string {
  return bundledRoot("engine");
}

async function loadEngineOnce() {
  const engineDir = resolveEngineDir();
  const [
    { detectHtml },
    { detectText },
    { loadDesignSystemForCwd },
    configMod,
    fsMod,
  ] = await Promise.all([
    import(pathToFileURL(join(engineDir, "engines/static-html/detect-html.mjs")).href),
    import(pathToFileURL(join(engineDir, "engines/regex/detect-text.mjs")).href),
    import(pathToFileURL(join(engineDir, "design-system.mjs")).href),
    import(pathToFileURL(join(engineDir, "lib/designer-skill-config.mjs")).href),
    import(pathToFileURL(join(engineDir, "node/file-system.mjs")).href),
  ]);
  return {
    detectHtml,
    detectText,
    loadDesignSystemForCwd,
    readDetectionConfig: configMod.readDetectionConfig as (cwd: string) => {
      ignoreRules: string[];
      ignoreFiles: string[];
      ignoreValues: string[];
      designSystem?: { enabled?: boolean };
    },
    filterDetectionFindings: configMod.filterDetectionFindings as (
      findings: DetectionFinding[],
      config: ReturnType<typeof configMod.readDetectionConfig>,
    ) => DetectionFinding[],
    shouldIgnoreDetectionFile: configMod.shouldIgnoreDetectionFile as (
      file: string,
      cwd: string,
      config: ReturnType<typeof configMod.readDetectionConfig>,
    ) => boolean,
    HTML_EXTENSIONS: fsMod.HTML_EXTENSIONS as Set<string>,
    walkDir: fsMod.walkDir as (dir: string) => string[],
    buildImportGraph: fsMod.buildImportGraph as (files: string[]) => Map<string, Set<string>>,
  };
}

let enginePromise: Promise<Engine> | null = null;

/** Load the vendored engine once per process; later calls reuse it. */
function loadEngine(): Promise<Engine> {
  return (enginePromise ??= loadEngineOnce());
}

export async function detectAntipatterns(
  target: string,
  options: { cwd?: string; useConfig?: boolean } = {},
): Promise<DetectionFinding[]> {
  const cwd = options.cwd ?? process.cwd();
  const useConfig = options.useConfig !== false;
  const engine = await loadEngine();
  const detectionConfig = useConfig
    ? engine.readDetectionConfig(cwd)
    : { ignoreRules: [], ignoreFiles: [], ignoreValues: [], designSystem: { enabled: true } };
  const designSystem =
    useConfig && detectionConfig.designSystem?.enabled !== false
      ? engine.loadDesignSystemForCwd(cwd)
      : null;
  const scanOptions = designSystem ? { designSystem } : {};

  const resolved = resolve(cwd, target);
  let allFindings: DetectionFinding[] = [];

  if (!existsSync(resolved)) {
    throw new Error(`Target not found: ${target}`);
  }

  const stat = statSync(resolved);
  if (stat.isFile()) {
    if (engine.shouldIgnoreDetectionFile(resolved, cwd, detectionConfig)) return [];
    const ext = extname(resolved).toLowerCase();
    allFindings = engine.HTML_EXTENSIONS.has(ext)
      ? await engine.detectHtml(resolved, scanOptions)
      : engine.detectText(readFileSync(resolved, "utf8"), resolved, scanOptions);
  } else if (stat.isDirectory()) {
    const files = engine
      .walkDir(resolved)
      .filter((file) => !engine.shouldIgnoreDetectionFile(file, cwd, detectionConfig));
    const graph = engine.buildImportGraph(files);
    const importedByMap = new Map<string, Set<string>>();
    for (const [importer, imports] of graph) {
      for (const imported of imports) {
        if (!importedByMap.has(imported)) importedByMap.set(imported, new Set());
        importedByMap.get(imported)!.add(importer);
      }
    }
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      let fileFindings: DetectionFinding[];
      if (engine.HTML_EXTENSIONS.has(ext)) {
        fileFindings = await engine.detectHtml(file, scanOptions);
      } else {
        fileFindings = engine.detectText(readFileSync(file, "utf8"), file, scanOptions);
      }
      const importers = importedByMap.get(file);
      if (importers && importers.size > 0) {
        const importerNames = [...importers].map((f) => f.split("/").pop()!);
        for (const f of fileFindings) f.importedBy = importerNames;
      }
      allFindings.push(...fileFindings);
    }
  }

  return engine.filterDetectionFindings(allFindings, detectionConfig);
}

export function formatDetectionResults(findings: DetectionFinding[]): string {
  if (findings.length === 0) return "No anti-patterns detected.";
  const grouped: Record<string, DetectionFinding[]> = {};
  for (const f of findings) {
    if (!grouped[f.file]) grouped[f.file] = [];
    grouped[f.file].push(f);
  }
  const lines: string[] = [`${findings.length} anti-pattern${findings.length === 1 ? "" : "s"} found:\n`];
  for (const [file, items] of Object.entries(grouped)) {
    const importNote = items[0]?.importedBy?.length
      ? ` (imported by ${items[0].importedBy.join(", ")})`
      : "";
    lines.push(`**${file}**${importNote}`);
    for (const item of items) {
      lines.push(`  - [${item.antipattern}] ${item.line ? `line ${item.line}: ` : ""}${item.snippet}`);
      lines.push(`    → ${item.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
