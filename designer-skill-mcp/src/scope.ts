import { lstatSync, readdirSync, realpathSync, statSync, existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, extname } from "node:path";

export class DesignError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DesignError";
  }
}

export function projectRoot(cwd: string): string {
  if (!cwd.trim()) throw new DesignError("INPUT_INVALID", "Project root must not be blank.");
  const root = realpathSync(resolve(cwd));
  if (!statSync(root).isDirectory()) throw new DesignError("INPUT_INVALID", "Project root must be a directory.");
  return root;
}

export function assertWithin(root: string, path: string): void {
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new DesignError("SCOPE_VIOLATION", "Requested path escapes the project root.");
  }
}

export interface ScanCoverage {
  candidateFiles: number;
  scannedFiles: number;
  ignoredFiles: number;
  unsupportedFiles: number;
  excludedDirectories: number;
  bytesScanned: number;
}

export interface ScanSelection {
  root: string;
  target: string;
  files: string[];
  coverage: ScanCoverage;
}

/** Strict bounded traversal. Never swallow a failed read or follow a symlink. */
export function selectScanFiles(
  cwd: string,
  target: string,
  extensions: ReadonlySet<string>,
  skipDirectories: ReadonlySet<string>,
  ignored: (path: string) => boolean,
): ScanSelection {
  if (!target.trim()) throw new DesignError("INPUT_INVALID", "Scan target must not be blank.");
  const root = projectRoot(cwd);
  const requested = resolve(root, target);
  assertWithin(root, requested);
  assertWithin(root, realpathSync(requested));
  const coverage: ScanCoverage = {
    candidateFiles: 0, scannedFiles: 0, ignoredFiles: 0,
    unsupportedFiles: 0, excludedDirectories: 0, bytesScanned: 0,
  };
  const files: string[] = [];
  let visited = 0;
  let selectedBytes = 0;
  function visit(path: string, depth: number): void {
    if (++visited > 20_000 || depth > 48) {
      throw new DesignError("SCAN_LIMIT", "Scan exceeds 20,000 entries or 48 directory levels. Narrow the target.");
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new DesignError("SCOPE_VIOLATION", "Symlink scan entries are unsupported; select an authorized real path.");
    }
    assertWithin(root, realpathSync(path));
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && skipDirectories.has(entry.name)) {
          coverage.excludedDirectories++;
        } else {
          visit(resolve(path, entry.name), depth + 1);
        }
      }
      return;
    }
    if (!stat.isFile()) throw new DesignError("INPUT_INVALID", "Only regular files and directories can be scanned.");
    if (!extensions.has(extname(path).toLowerCase())) {
      coverage.unsupportedFiles++;
      return;
    }
    coverage.candidateFiles++;
    if (ignored(path)) {
      coverage.ignoredFiles++;
      return;
    }
    selectedBytes += stat.size;
    if (files.length >= 2_000 || stat.size > 2 * 1024 * 1024 || selectedBytes > 32 * 1024 * 1024) {
      throw new DesignError("SCAN_LIMIT", "Scan exceeds 2,000 files, 2 MiB per file, or 32 MiB total. Narrow the target.");
    }
    files.push(path);
  }
  visit(requested, 0);
  return { root, target: requested, files, coverage };
}

/** The legacy engine ignores malformed JSON. A verification call must not. */
export function validateConfigFiles(root: string): void {
  for (const name of ["config.json", "config.local.json"]) {
    const path = resolve(root, ".designer-skill", name);
    if (!existsSync(path)) continue;
    assertWithin(root, realpathSync(path));
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new DesignError("CONFIG_INVALID", "Config must be a regular file no larger than 1 MiB.");
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new DesignError("CONFIG_INVALID", "Detector configuration is not readable valid JSON."); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DesignError("CONFIG_INVALID", "Config must be a JSON object.");
    for (const key of ["hook", "detector"]) {
      const section = (raw as Record<string, unknown>)[key];
      if (section === undefined) continue;
      if (!section || typeof section !== "object" || Array.isArray(section)) throw new DesignError("CONFIG_INVALID", `${key} must be an object.`);
      const values = section as Record<string, unknown>;
      for (const field of ["ignoreRules", "ignoreFiles"]) {
        const list = values[field];
        if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== "string" || !v.trim()))) {
          throw new DesignError("CONFIG_INVALID", `${field} must be an array of nonempty strings.`);
        }
      }
      if (values.ignoreValues !== undefined && !Array.isArray(values.ignoreValues)) throw new DesignError("CONFIG_INVALID", "ignoreValues must be an array.");
      if (values.designSystem !== undefined) {
        const design = values.designSystem;
        if (!design || typeof design !== "object" || Array.isArray(design) ||
          ((design as Record<string, unknown>).enabled !== undefined && typeof (design as Record<string, unknown>).enabled !== "boolean")) {
          throw new DesignError("CONFIG_INVALID", "designSystem.enabled must be a boolean.");
        }
      }
    }
  }
}
