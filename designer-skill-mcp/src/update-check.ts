// Update checks query the npm registry directly: no background process, no
// config store in $HOME, and nothing written to stdout (the stdio protocol channel).
import { pkg } from "./pkg.js";

const UPGRADE_COMMAND = "npx -y @pymodel/designer-skill-mcp@latest";
const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name.replace("/", "%2f")}/latest`;
const TIMEOUT_MS = 3_000;

export interface UpdateInfo { current: string; latest: string }

function parseVersion(version: string): number[] | null {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function formatUpdateStatus(info: UpdateInfo): string {
  if (!isNewer(info.latest, info.current)) return `${info.current} (latest)`;
  return `${info.current} → ${info.latest} available\nRun: ${UPGRADE_COMMAND}`;
}

export async function fetchUpdateInfo(): Promise<UpdateInfo> {
  const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const body = await response.json() as { version?: unknown };
  if (typeof body.version !== "string") throw new Error("npm registry response has no version");
  return { current: pkg.version, latest: body.version };
}

export async function printCheckUpdate(): Promise<void> {
  console.log(formatUpdateStatus(await fetchUpdateInfo()));
}

/** One stderr notice for interactive (terminal) HTTP runs: an available update, or why the check failed. */
export function notifyAvailableUpdate(): Promise<void> {
  if (!process.stderr.isTTY || "NO_UPDATE_NOTIFIER" in process.env || process.env.CI) return Promise.resolve();
  return fetchUpdateInfo().then((info) => {
    if (isNewer(info.latest, info.current)) console.error(`designer-skill-mcp ${info.current} → ${info.latest} available. Run: ${UPGRADE_COMMAND}`);
  }, (error: unknown) => {
    console.error(`designer-skill-mcp: update check failed (${error instanceof Error ? error.message : String(error)}). Set NO_UPDATE_NOTIFIER=1 to skip it.`);
  });
}
