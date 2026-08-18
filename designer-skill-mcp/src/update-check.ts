import updateNotifier, { type UpdateInfo } from "update-notifier";
import { pkg } from "./pkg.js";

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

const UPGRADE_COMMAND = "npx -y @pymodel/designer-skill-mcp@latest";

function createNotifier() {
  return updateNotifier({
    pkg,
    updateCheckInterval: WEEK_MS,
    shouldNotifyInNpmScript: false,
  });
}

export function formatUpdateStatus(update: UpdateInfo | undefined): string {
  if (!update || update.latest === update.current) {
    const current = update?.current ?? pkg.version;
    return `${current} (latest)`;
  }
  return `${update.current} → ${update.latest} available (${update.type})\nRun: ${UPGRADE_COMMAND}`;
}

export async function fetchUpdateInfo(): Promise<UpdateInfo> {
  const notifier = createNotifier();
  return notifier.fetchInfo();
}

export async function printCheckUpdate(): Promise<void> {
  const info = await fetchUpdateInfo();
  console.log(formatUpdateStatus(info));
}

/** Non-blocking stderr notice; respects NO_UPDATE_NOTIFIER and CI. */
export function notifyAvailableUpdate(): void {
  const notifier = createNotifier();
  if (!notifier.update) return;

  notifier.notify({
    defer: false,
    isGlobal: false,
    message:
      "designer-skill-mcp {currentVersion} → {latestVersion} available.\n" +
      `Run: ${UPGRADE_COMMAND}`,
  });
}
