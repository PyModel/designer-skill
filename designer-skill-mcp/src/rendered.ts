// Rendered verification: load a local page in a real browser and observe it.
// The browser driver (Playwright) and axe-core are the PROJECT's own installs,
// resolved from the project root; this package ships neither. Without them the
// result is NOT_RUN with the reason, never a pass.
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DesignError, isWithin } from "./scope.js";

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
const NAVIGATION_TIMEOUT_MS = 30_000;
const REPORTED_ITEMS = 10;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Only pages on this machine: a loopback http(s) server, or a file inside the project root. */
export function assertLocalUrl(raw: string, root: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new DesignError("INPUT_INVALID", "url must be an absolute http(s) or file URL."); }
  if (url.protocol === "file:") {
    let real: string;
    try { real = realpathSync(fileURLToPath(url)); } catch { throw new DesignError("INPUT_INVALID", "file URL does not exist."); }
    if (!isWithin(realpathSync(root), real)) throw new DesignError("SCOPE_VIOLATION", "file URL is outside the project root.");
    const local = pathToFileURL(real);
    local.search = url.search; local.hash = url.hash; // a hash-routed page is a different state
    return local;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !LOOPBACK.has(url.hostname)) {
    throw new DesignError("SCOPE_VIOLATION", "url must be a loopback http(s) address (a local dev server) or a file URL inside the project root.");
  }
  return url;
}

// The slice of Playwright this module uses.
interface Page {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<{ ok(): boolean; status(): number } | null>;
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  evaluate<T>(fn: string): Promise<T>;
  addScriptTag(options: { path: string }): Promise<unknown>;
  url(): string;
  screenshot(options: { fullPage: boolean }): Promise<Buffer>;
}
interface Browser {
  newContext(options: { viewport: { width: number; height: number } }): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}
interface Driver { chromium: { launch(options?: { channel?: string }): Promise<Browser> } }

export interface RenderedTooling { driver: Driver | null; axePath: string | null }

/** Resolve the project's Playwright and axe-core, then this package's own (dev installs). */
export async function resolveTooling(root: string): Promise<RenderedTooling> {
  const requires = [createRequire(join(root, "package.json")), createRequire(import.meta.url)];
  const find = (name: string) => {
    for (const require of requires) { try { return require.resolve(name); } catch { /* next resolver */ } }
    return null;
  };
  let driver: Driver | null = null;
  for (const name of ["playwright", "playwright-core", "@playwright/test"]) {
    const path = find(name);
    if (!path) continue;
    const mod = await import(pathToFileURL(path).href) as Partial<Driver> & { default?: Partial<Driver> };
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) { driver = { chromium }; break; }
  }
  return { driver, axePath: find("axe-core/axe.min.js") };
}

// Runs in the page. Kept as source text so it is not transformed by the TS target.
const PAGE_PROBE = `(() => {
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const brokenImages = [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.currentSrc || img.getAttribute('src') || describe(img));
  const clipped = [];
  for (const el of document.querySelectorAll('body *')) {
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const style = getComputedStyle(el);
    const clipsX = (style.overflowX === 'hidden' || style.overflowX === 'clip') && style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clipsY = (style.overflowY === 'hidden' || style.overflowY === 'clip') && !style.webkitLineClamp?.match(/\\d/) && el.scrollHeight > el.clientHeight + 1;
    if (clipsX || clipsY) clipped.push(describe(el) + ': ' + el.textContent.trim().slice(0, 40));
  }
  return { brokenImages, clipped, pageOverflow: document.documentElement.scrollWidth - window.innerWidth };
})()`;
const AXE_RUN = `axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))`;

interface Probe { brokenImages: string[]; clipped: string[]; pageOverflow: number }
interface AxeViolation { id: string; impact: string | null; nodes: number }

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 200);

async function inspectViewport(browser: Browser, url: string, root: string, viewport: Viewport, axePath: string | null, outDir: string):
  Promise<{ checks: RenderedCheck[]; screenshot?: RenderedResult["screenshots"][number] }> {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 200)); });
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 200)));
    const check = (id: string, failures: string[], detail?: string): RenderedCheck => ({
      id, viewport: viewport.name, status: failures.length ? "FAIL" : "PASS",
      ...(detail ? { detail } : {}), ...(failures.length ? { items: failures.slice(0, REPORTED_ITEMS) } : {}),
    });
    // The scope check must hold for where the page ends up, not only the URL passed in:
    // after a redirect or script navigation to a non-local page nothing is inspected or captured.
    const leftScope = (): RenderedCheck[] | null => {
      try { assertLocalUrl(page.url(), root); return null; } catch {
        return [check("page-load", [`the page navigated outside the local scope (${page.url().slice(0, 200)}); nothing was inspected`])];
      }
    };
    let response: Awaited<ReturnType<Page["goto"]>>;
    try {
      response = await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // A page that does not load is a finding about the page, not a tool failure.
      return { checks: [check("page-load", [firstLine(error)])] };
    }
    const outside = leftScope();
    if (outside) return { checks: outside };
    const checks: RenderedCheck[] = [check("page-load", response && !response.ok() ? [`HTTP ${response.status()}`] : [])];
    const probe = await page.evaluate<Probe>(PAGE_PROBE);
    checks.push(check("console-errors", errors), check("broken-image", probe.brokenImages), check("text-overflow", probe.clipped),
      check("horizontal-overflow", probe.pageOverflow > 1 ? [`page is ${probe.pageOverflow}px wider than the ${viewport.width}px viewport`] : []));
    const violations = axePath ? await page.addScriptTag({ path: axePath }).then(() => page.evaluate<AxeViolation[]>(AXE_RUN)).catch(() => null) : null;
    if (violations) {
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      checks.push(check("accessibility", blocking.map((v) => `${v.id} (${v.impact}, ${v.nodes} node(s))`),
        `axe-core: ${violations.length} violation rule(s), ${blocking.length} serious or critical`));
    } else {
      checks.push({ id: "accessibility", viewport: viewport.name, status: "NOT_RUN",
        detail: axePath ? "axe-core could not run in the page (a Content-Security-Policy may block injected scripts)." : "axe-core is not installed in the project (npm i -D axe-core)." });
    }
    const movedOn = leftScope(); // a script may have navigated since the load
    if (movedOn) return { checks: movedOn };
    const image = await page.screenshot({ fullPage: true });
    const path = join(outDir, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
    writeFileSync(path, image);
    return { checks, screenshot: { viewport: viewport.name, path, sha256: createHash("sha256").update(image).digest("hex") } };
  } finally {
    await context.close();
  }
}

export async function verifyRendered(rawUrl: string, options: { root: string; viewports?: Viewport[]; signal?: AbortSignal; tooling?: RenderedTooling }): Promise<RenderedResult> {
  const url = assertLocalUrl(rawUrl, options.root).href;
  const base = { schemaVersion: 1 as const, scope: "rendered" as const, url };
  const notRun = (reason: string): RenderedResult => ({ ...base, status: "NOT_RUN", reason, checks: [], screenshots: [], summary: `Rendered check: NOT_RUN. ${reason}` });
  const tooling = options.tooling ?? await resolveTooling(options.root);
  if (!tooling.driver) return notRun("Playwright is not installed in the project (npm i -D playwright, then npx playwright install chromium). Use a browser MCP instead and report its evidence.");
  let browser: Browser;
  try {
    browser = await tooling.driver.chromium.launch().catch((bundled: unknown) =>
      tooling.driver!.chromium.launch({ channel: "chrome" }).catch(() => { throw bundled; })); // report why the bundled browser failed
  } catch (error) {
    return notRun(`No browser could be launched (${firstLine(error)}). Run npx playwright install chromium.`);
  }
  const abort = () => void browser.close();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const outDir = mkdtempSync(join(tmpdir(), "designer-skill-rendered-"));
    const checks: RenderedCheck[] = [];
    const screenshots: RenderedResult["screenshots"] = [];
    for (const viewport of options.viewports ?? DEFAULT_VIEWPORTS) {
      if (options.signal?.aborted) throw new DesignError("CANCELLED", "Rendered check cancelled by the client.");
      const result = await inspectViewport(browser, url, options.root, viewport, tooling.axePath, outDir);
      checks.push(...result.checks);
      if (result.screenshot) screenshots.push(result.screenshot);
    }
    const failed = checks.filter((c) => c.status === "FAIL");
    const notRunChecks = checks.filter((c) => c.status === "NOT_RUN");
    const status = failed.length ? "FAIL" : notRunChecks.length ? "INCOMPLETE" : "PASS";
    const summary = [
      `Rendered check: ${status} for ${url} at ${(options.viewports ?? DEFAULT_VIEWPORTS).map((v) => v.name).join(", ")}.`,
      ...failed.map((c) => `FAIL ${c.id} (${c.viewport}): ${(c.items ?? []).join("; ")}`),
      ...[...new Set(notRunChecks.map((c) => `NOT_RUN ${c.id}: ${c.detail}`))],
      "Covers one URL in one state. Interaction states, keyboard flow and performance are not checked; look at the screenshots yourself.",
    ].join("\n");
    return { ...base, status, checks, screenshots, summary };
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await browser.close().catch(() => undefined);
  }
}
