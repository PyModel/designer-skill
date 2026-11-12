// Rendered verification: load a local page in a real browser and observe it.
// The browser work runs in a child process (assets/engine/node/rendered-worker.mjs)
// that loads the PROJECT's Playwright and axe-core; this package ships neither.
// The child gets no credentials from this server's environment and one overall
// deadline. Without Playwright the result is NOT_RUN with the reason, never a pass.
import { fork } from "node:child_process";
import { pathToFileURL } from "node:url";
import { bundledFile } from "./assets.js";
import { DesignError } from "./scope.js";

export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN";
export interface RenderedCheck { id: string; viewport: string; status: CheckStatus; detail?: string; items?: string[] }
export interface RenderedResult {
  schemaVersion: 1;
  scope: "rendered";
  status: "PASS" | "FAIL" | "INCOMPLETE" | "NOT_RUN";
  url: string;
  reason?: string;
  checks: RenderedCheck[];
  screenshots: Array<{ viewport: string; path: string; sha256: string }>;
  summary: string;
}

export interface Viewport { name: string; width: number; height: number }
export const DEFAULT_VIEWPORTS: Viewport[] = [{ name: "desktop", width: 1280, height: 800 }, { name: "mobile", width: 390, height: 844 }];
/** Whole check, every viewport included. Tests shorten it; nothing else should. */
export const renderedPolicy = { deadlineMs: 120_000 };

type LocalUrl = (raw: string, root: string) => { ok: true; url: URL } | { ok: false; code: "INPUT_INVALID" | "SCOPE_VIOLATION"; message: string };
const engineFile = (name: string) => bundledFile("engine", `node/${name}`);

/** Only pages on this machine: a loopback http(s) server, or a file inside the project root. */
export async function assertLocalUrl(raw: string, root: string): Promise<URL> {
  const { localUrl } = await import(pathToFileURL(engineFile("local-url.mjs")).href) as { localUrl: LocalUrl };
  const checked = localUrl(raw, root);
  if (!checked.ok) throw new DesignError(checked.code, checked.message);
  return checked.url;
}

/** Names that carry credentials are not passed to the process that runs project code. */
const SECRET_ENV = /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|^NIBLET_|^DESIGNER_SKILL_/i;
const workerEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !SECRET_ENV.test(name)));

export async function verifyRendered(rawUrl: string, options: { root: string; viewports?: Viewport[]; signal?: AbortSignal }): Promise<RenderedResult> {
  const url = (await assertLocalUrl(rawUrl, options.root)).href;
  const viewports = options.viewports ?? DEFAULT_VIEWPORTS;
  if (options.signal?.aborted) throw new DesignError("CANCELLED", "Rendered check cancelled by the client.");
  return new Promise<RenderedResult>((resolve, reject) => {
    const child = fork(engineFile("rendered-worker.mjs"), [], { env: workerEnv(), stdio: ["ignore", "ignore", "ignore", "ipc"] });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL"); // also ends the browser it started
      settle();
    };
    const onAbort = () => finish(() => reject(new DesignError("CANCELLED", "Rendered check cancelled by the client.")));
    const deadline = setTimeout(() => finish(() => {
      const reason = `The check did not finish within ${renderedPolicy.deadlineMs / 1000} seconds and was stopped.`;
      resolve({ schemaVersion: 1, scope: "rendered", status: "NOT_RUN", url, reason, checks: [], screenshots: [], summary: `Rendered check: NOT_RUN. ${reason}` });
    }), renderedPolicy.deadlineMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.once("message", (message: { result?: RenderedResult; error?: string }) => finish(() =>
      (message.result ? resolve(message.result) : reject(new DesignError("OPERATION_FAILED", `Rendered check failed: ${message.error}`)))));
    child.once("error", (error) => finish(() => reject(new DesignError("OPERATION_FAILED", `Rendered check could not start: ${error.message}`))));
    child.once("exit", (code) => finish(() => reject(new DesignError("OPERATION_FAILED", `Rendered check process exited early (code ${code}).`))));
    child.send({ url, root: options.root, viewports });
  });
}
