import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync, type Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep, extname } from "node:path";

export class DesignError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "DesignError";
  }
}

export const SCAN_LIMITS = Object.freeze({
  entries: 20_000,
  depth: 48,
  files: 2_000,
  fileBytes: 2 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  findings: 20_000,
});

const REPORTED_SKIPS = 20;

export function projectRoot(cwd: string): string {
  if (!cwd.trim()) throw new DesignError("INPUT_INVALID", "Project root must not be blank.");
  let root: string;
  try {
    root = realpathSync(resolve(cwd));
  } catch {
    throw new DesignError("INPUT_INVALID", `Project root ${cwd} does not exist or is unreadable.`, { path: cwd });
  }
  if (!statSync(root).isDirectory()) throw new DesignError("INPUT_INVALID", `Project root ${cwd} is not a directory.`, { path: cwd });
  return root;
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function assertWithin(root: string, path: string): void {
  if (!isWithin(root, path)) {
    throw new DesignError("SCOPE_VIOLATION", "Requested path escapes the project root.", { path: relative(root, path) });
  }
}

const toPosix = (path: string) => path.split(sep).join("/");

const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/**
 * Read a regular file confined to `root`: realpath inside the root, opened
 * without following a final symlink or blocking on a FIFO, type and size
 * checked on the open descriptor. Returns null when the file does not exist.
 */
export function readConfinedFile(root: string, path: string, maxBytes: number, code: string): string | null {
  let real: string;
  try {
    real = realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DesignError(code, `${toPosix(relative(root, path))} is unreadable.`, { path: toPosix(relative(root, path)) });
  }
  const rel = toPosix(relative(root, real));
  assertWithin(root, real);
  const fd = openSync(real, OPEN_FLAGS);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) {
      throw new DesignError(code, `${rel} must be a regular file no larger than ${maxBytes} bytes.`, { path: rel });
    }
    const buffer = Buffer.alloc(stat.size);
    let length = 0;
    while (length < buffer.length) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
    }
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export interface ScanCoverage {
  enumeration: "git" | "filesystem";
  candidateFiles: number;
  scannedFiles: number;
  ignoredFiles: number;
  unsupportedFiles: number;
  excludedDirectories: number;
  skippedSymlinks: number;
  skippedSpecialFiles: number;
  unreadableEntries: number;
  skippedPaths: Array<{ path: string; reason: "symlink" | "special-file" | "unreadable" }>;
  bytesScanned: number;
}

export interface ScanSelection {
  root: string;
  target: string;
  files: string[];
  coverage: ScanCoverage;
}

export interface ScanFilters {
  extensions: ReadonlySet<string>;
  skipDirectories: ReadonlySet<string>;
  isIgnoredFile: (relPath: string) => boolean;
  isPrunedDirectory: (relDir: string) => boolean;
}

function scanLimit(bound: keyof typeof SCAN_LIMITS, observed: number, path: string): DesignError {
  return new DesignError("SCAN_LIMIT",
    `Scan exceeds the ${bound} limit (${SCAN_LIMITS[bound]}) at ${path || "."}. Narrow the target or ignore that subtree.`,
    { bound, limit: SCAN_LIMITS[bound], observed, path: path || "." });
}

/**
 * Bounded traversal. Symlinks, special files and unreadable entries under the
 * target are skipped, counted and named; only an explicitly targeted one is an
 * error. Ignored and vendored directories are pruned before they are counted.
 */
export function selectScanFiles(cwd: string, target: string, filters: ScanFilters): ScanSelection {
  if (!target.trim()) throw new DesignError("INPUT_INVALID", "Scan target must not be blank.");
  const root = projectRoot(cwd);
  const requested = resolve(root, target);
  assertWithin(root, requested);
  const requestedRel = toPosix(relative(root, requested)) || ".";
  let targetStat;
  try {
    targetStat = lstatSync(requested);
  } catch {
    throw new DesignError("INPUT_INVALID", `Scan target ${requestedRel} does not exist.`, { path: requestedRel });
  }
  if (targetStat.isSymbolicLink()) {
    throw new DesignError("SCOPE_VIOLATION", `Scan target ${requestedRel} is a symlink; select the real path.`, { path: requestedRel });
  }
  assertWithin(root, realpathSync(requested));
  if (!targetStat.isFile() && !targetStat.isDirectory()) {
    throw new DesignError("INPUT_INVALID", `Scan target ${requestedRel} is not a regular file or directory.`, { path: requestedRel });
  }

  const coverage: ScanCoverage = {
    enumeration: "filesystem", candidateFiles: 0, scannedFiles: 0, ignoredFiles: 0, unsupportedFiles: 0,
    excludedDirectories: 0, skippedSymlinks: 0, skippedSpecialFiles: 0, unreadableEntries: 0, skippedPaths: [], bytesScanned: 0,
  };
  const files: string[] = [];
  let selectedBytes = 0;
  const skip = (rel: string, reason: ScanCoverage["skippedPaths"][number]["reason"]) => {
    if (reason === "symlink") coverage.skippedSymlinks++;
    else if (reason === "special-file") coverage.skippedSpecialFiles++;
    else coverage.unreadableEntries++;
    if (coverage.skippedPaths.length < REPORTED_SKIPS) coverage.skippedPaths.push({ path: rel, reason });
  };
  const considerFile = (abs: string, rel: string, size: number) => {
    if (!filters.extensions.has(extname(abs).toLowerCase())) {
      coverage.unsupportedFiles++;
      return;
    }
    coverage.candidateFiles++;
    if (filters.isIgnoredFile(rel)) {
      coverage.ignoredFiles++;
      return;
    }
    if (size > SCAN_LIMITS.fileBytes) throw scanLimit("fileBytes", size, rel);
    selectedBytes += size;
    if (selectedBytes > SCAN_LIMITS.totalBytes) throw scanLimit("totalBytes", selectedBytes, rel);
    if (files.length >= SCAN_LIMITS.files) throw scanLimit("files", files.length + 1, rel);
    files.push(rel);
  };

  if (targetStat.isFile()) {
    considerFile(requested, requestedRel, targetStat.size);
    return { root, target: requested, files, coverage };
  }

  const gitListing = listGitFiles(requested);
  if (gitListing) {
    coverage.enumeration = "git";
    const excluded = new Set<string>();
    let considered = 0;
    for (const listed of gitListing) {
      if (listed.endsWith("/")) { // nested repository: not part of this work tree
        excluded.add(toPosix(relative(root, join(requested, listed))));
        continue;
      }
      const rel = toPosix(relative(root, join(requested, listed)));
      const parts = rel.split("/");
      if (parts.length > SCAN_LIMITS.depth) throw scanLimit("depth", parts.length, rel);
      const skippedDir = parts.slice(0, -1).findIndex((part, i) =>
        filters.skipDirectories.has(part) || filters.isPrunedDirectory(parts.slice(0, i + 1).join("/")));
      if (skippedDir !== -1) {
        excluded.add(parts.slice(0, skippedDir + 1).join("/"));
        continue;
      }
      if (++considered > SCAN_LIMITS.entries) throw scanLimit("entries", considered, rel);
      const abs = join(root, rel);
      let stat;
      try {
        stat = lstatSync(abs);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // tracked but deleted
        skip(rel, "unreadable");
        continue;
      }
      if (stat.isSymbolicLink()) skip(rel, "symlink");
      else if (!stat.isFile()) skip(rel, "special-file");
      else considerFile(abs, rel, stat.size);
    }
    coverage.excludedDirectories = excluded.size;
  } else {
    let visited = 0;
    const stack: Array<{ abs: string; depth: number }> = [{ abs: requested, depth: 0 }];
    while (stack.length) {
      const { abs, depth } = stack.pop()!;
      const relDir = toPosix(relative(root, abs));
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        skip(relDir || ".", "unreadable");
        continue;
      }
      entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
      for (const entry of entries) {
        if (++visited > SCAN_LIMITS.entries) throw scanLimit("entries", visited, relDir);
        const child = join(abs, entry.name);
        const rel = toPosix(relative(root, child));
        if (entry.isSymbolicLink()) { skip(rel, "symlink"); continue; }
        if (entry.isDirectory()) {
          if (filters.skipDirectories.has(entry.name) || filters.isPrunedDirectory(rel)) {
            coverage.excludedDirectories++;
            continue;
          }
          if (depth + 1 > SCAN_LIMITS.depth) throw scanLimit("depth", depth + 1, rel);
          stack.push({ abs: child, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile()) { skip(rel, "special-file"); continue; }
        let stat;
        try {
          stat = lstatSync(child);
        } catch {
          skip(rel, "unreadable");
          continue;
        }
        considerFile(child, rel, stat.size);
      }
    }
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { root, target: requested, files, coverage };
}

/**
 * Files git would consider part of the work tree (tracked + untracked, minus
 * .gitignore'd), or null when `dir` is not inside a usable git work tree.
 * Repo config that can execute commands during listing is disabled.
 */
function listGitFiles(dir: string): string[] | null {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  const result = spawnSync("git", [
    "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ".",
  ], { cwd: dir, env, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 15_000, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  const listed = result.stdout.toString("utf8").split("\0").filter(Boolean);
  return [...new Set(listed)];
}

export interface IgnoreValueEntry { rule: string; value: string; files?: string[] }

export interface DetectorPolicy {
  ignoreRules: string[];
  ignoreFiles: string[];
  ignoreValues: unknown[];
  designSystemEnabled: boolean;
  webRoot: string | null;
  /** Required/blocking rules waived in the committed config.json. */
  waivedRules: string[];
}

export interface PolicyOptions {
  ruleIds: ReadonlySet<string>;
  protectedRules: ReadonlySet<string>;
  validateGlob: (glob: string) => void;
  normalizeIgnoreValues: (entries: unknown[]) => unknown[];
}

const CONFIG_MAX_BYTES = 1024 * 1024;

/**
 * The single owner of detector policy: reads, validates and merges
 * `.designer-skill/config.json` (committed) and `config.local.json`
 * (per-developer). Rule ids must be exact registry ids, and protected
 * (required or blocking) rules can only be waived in the committed file.
 */
export function loadDetectorPolicy(root: string, options: PolicyOptions): DetectorPolicy {
  const policy: DetectorPolicy = {
    ignoreRules: [], ignoreFiles: [], ignoreValues: [], designSystemEnabled: true, webRoot: null, waivedRules: [],
  };
  for (const name of ["config.json", "config.local.json"]) {
    const local = name === "config.local.json";
    const label = `.designer-skill/${name}`;
    const text = readConfinedFile(root, resolve(root, ".designer-skill", name), CONFIG_MAX_BYTES, "CONFIG_INVALID");
    if (text === null) continue;
    let raw: unknown;
    try { raw = JSON.parse(text); }
    catch { throw new DesignError("CONFIG_INVALID", `${label} is not valid JSON.`, { path: label }); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new DesignError("CONFIG_INVALID", `${label} must be a JSON object.`, { path: label });
    // Old builds stored detector filters under hook.*; both sections apply.
    for (const key of ["hook", "detector"]) {
      const section = (raw as Record<string, unknown>)[key];
      if (section === undefined) continue;
      const where = `${label} ${key}`;
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        throw new DesignError("CONFIG_INVALID", `${where} must be an object.`, { path: label });
      }
      const values = section as Record<string, unknown>;
      for (const field of ["ignoreRules", "ignoreFiles"]) {
        const list = values[field];
        if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== "string" || !v))) {
          throw new DesignError("CONFIG_INVALID", `${where}.${field} must be an array of nonempty strings.`, { path: label });
        }
      }
      for (const rule of (values.ignoreRules as string[] | undefined) ?? []) {
        if (!options.ruleIds.has(rule)) {
          throw new DesignError("CONFIG_INVALID",
            `${where}.ignoreRules has unknown rule "${rule}". Use exact registry ids (lowercase, no padding).`, { path: label, rule });
        }
        if (options.protectedRules.has(rule)) {
          if (local) {
            throw new DesignError("CONFIG_INVALID",
              `${label} cannot waive required rule "${rule}": it is per-developer and git-excluded. Waive it in the committed .designer-skill/config.json.`,
              { path: label, rule });
          }
          if (!policy.waivedRules.includes(rule)) policy.waivedRules.push(rule);
        }
        if (!policy.ignoreRules.includes(rule)) policy.ignoreRules.push(rule);
      }
      for (const glob of (values.ignoreFiles as string[] | undefined) ?? []) {
        try { options.validateGlob(glob); }
        catch (error) {
          throw new DesignError("CONFIG_INVALID", `${where}.ignoreFiles glob "${glob}" is invalid: ${(error as Error).message}.`, { path: label });
        }
        if (!policy.ignoreFiles.includes(glob)) policy.ignoreFiles.push(glob);
      }
      if (values.ignoreValues !== undefined) {
        if (!Array.isArray(values.ignoreValues)) throw new DesignError("CONFIG_INVALID", `${where}.ignoreValues must be an array.`, { path: label });
        policy.ignoreValues.push(...options.normalizeIgnoreValues(values.ignoreValues));
      }
      if (values.designSystem !== undefined) {
        const design = values.designSystem as Record<string, unknown> | null;
        if (!design || typeof design !== "object" || Array.isArray(design) ||
          (design.enabled !== undefined && typeof design.enabled !== "boolean")) {
          throw new DesignError("CONFIG_INVALID", `${where}.designSystem.enabled must be a boolean.`, { path: label });
        }
        if (design.enabled !== undefined) policy.designSystemEnabled = design.enabled as boolean;
      }
      if (values.webRoot !== undefined) {
        if (typeof values.webRoot !== "string" || !values.webRoot.trim() || isAbsolute(values.webRoot)) {
          throw new DesignError("CONFIG_INVALID", `${where}.webRoot must be a project-relative directory.`, { path: label });
        }
        let webRoot: string;
        try { webRoot = realpathSync(resolve(root, values.webRoot)); }
        catch { throw new DesignError("CONFIG_INVALID", `${where}.webRoot ${values.webRoot} does not exist.`, { path: label }); }
        assertWithin(root, webRoot);
        if (!statSync(webRoot).isDirectory()) throw new DesignError("CONFIG_INVALID", `${where}.webRoot must be a directory.`, { path: label });
        policy.webRoot = webRoot;
      }
    }
  }
  return policy;
}
