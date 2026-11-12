// Rendered check, run as a child process: the project's own Playwright and
// axe-core are loaded here, never in the MCP server process, and this process
// is started without the server's credentials in its environment.
// Protocol: one { url, root, viewports } message in, one { result } or { error } out.
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localUrl } from './local-url.mjs';

const NAVIGATION_TIMEOUT_MS = 30_000;
const REPORTED_ITEMS = 10;
const firstLine = (error) => (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 200);

/** The project's Playwright and axe-core. This package ships neither. */
async function resolveTooling(root) {
  const require = createRequire(join(root, 'package.json'));
  const find = (name) => { try { return require.resolve(name); } catch { return null; } };
  let chromium = null;
  for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    const path = find(name);
    if (!path) continue;
    const mod = await import(pathToFileURL(path).href);
    chromium = mod.chromium ?? mod.default?.chromium ?? null;
    if (chromium) break;
  }
  return { chromium, axePath: find('axe-core/axe.min.js') };
}

// Runs in the page.
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

/**
 * Keep the top-level page on this machine. Each main-frame navigation is fetched
 * here without following redirects, so a redirect to another host is refused
 * before any request reaches that host.
 */
async function confineNavigation(page, root, blocked) {
  const refuse = (route, url) => { blocked.push(url.slice(0, 200)); return route.abort('blockedbyclient'); };
  await page.route('**/*', async (route, request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.continue();
    if (!localUrl(request.url(), root).ok) return refuse(route, request.url());
    if (request.url().startsWith('file:')) return route.continue(); // no redirects on file URLs
    let response;
    try { response = await route.fetch({ maxRedirects: 0 }); } catch { return route.abort('connectionfailed'); }
    const location = response.status() >= 300 && response.status() < 400 ? response.headers().location : undefined;
    if (location) {
      const target = new URL(location, request.url()).href;
      if (!localUrl(target, root).ok) return refuse(route, target);
    }
    return route.fulfill({ response });
  });
}

async function inspectViewport(browser, url, root, viewport, axePath, outDir) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  try {
    const page = await context.newPage();
    const check = (id, failures, detail) => ({
      id, viewport: viewport.name, status: failures.length ? 'FAIL' : 'PASS',
      ...(detail ? { detail } : {}), ...(failures.length ? { items: failures.slice(0, REPORTED_ITEMS) } : {}),
    });
    const errors = [];
    const blocked = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)); });
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
    await confineNavigation(page, root, blocked);
    const outOfScope = () => (blocked.length ? [check('page-load', [`navigation outside the local scope was refused: ${blocked[0]}`])] : null);
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      // A page that does not load is a finding about the page, not a tool failure.
      return { checks: outOfScope() ?? [check('page-load', [firstLine(error)])] };
    }
    const checks = [check('page-load', response && !response.ok() ? [`HTTP ${response.status()}`] : [])];
    const probe = await page.evaluate(PAGE_PROBE);
    checks.push(check('console-errors', errors), check('broken-image', probe.brokenImages), check('text-overflow', probe.clipped),
      check('horizontal-overflow', probe.pageOverflow > 1 ? [`page is ${probe.pageOverflow}px wider than the ${viewport.width}px viewport`] : []));
    const violations = axePath ? await page.addScriptTag({ path: axePath }).then(() => page.evaluate(AXE_RUN)).catch(() => null) : null;
    if (violations) {
      const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      checks.push(check('accessibility', blocking.map((v) => `${v.id} (${v.impact}, ${v.nodes} node(s))`),
        `axe-core: ${violations.length} violation rule(s), ${blocking.length} serious or critical`));
    } else {
      checks.push({ id: 'accessibility', viewport: viewport.name, status: 'NOT_RUN',
        detail: axePath ? 'axe-core could not run in the page (a Content-Security-Policy may block injected scripts).' : 'axe-core is not installed in the project (npm i -D axe-core).' });
    }
    // A script may have tried to leave since the load; nothing from such a page is reported.
    const left = outOfScope();
    if (left) return { checks: left };
    const image = await page.screenshot({ fullPage: true });
    const path = join(outDir, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
    writeFileSync(path, image);
    return { checks, screenshot: { viewport: viewport.name, path, sha256: createHash('sha256').update(image).digest('hex') } };
  } finally {
    await context.close();
  }
}

async function run({ url, root, viewports }) {
  const base = { schemaVersion: 1, scope: 'rendered', url };
  const notRun = (reason) => ({ ...base, status: 'NOT_RUN', reason, checks: [], screenshots: [], summary: `Rendered check: NOT_RUN. ${reason}` });
  const { chromium, axePath } = await resolveTooling(root);
  if (!chromium) return notRun('Playwright is not installed in the project (npm i -D playwright, then npx playwright install chromium). Use a browser MCP instead and report its evidence.');
  let browser;
  try {
    // If the bundled browser is missing, try the installed Chrome; report why the bundled one failed.
    browser = await chromium.launch().catch((bundled) => chromium.launch({ channel: 'chrome' }).catch(() => { throw bundled; }));
  } catch (error) {
    return notRun(`No browser could be launched (${firstLine(error)}). Run npx playwright install chromium.`);
  }
  try {
    const outDir = mkdtempSync(join(tmpdir(), 'designer-skill-rendered-'));
    const checks = [];
    const screenshots = [];
    for (const viewport of viewports) {
      const result = await inspectViewport(browser, url, root, viewport, axePath, outDir);
      checks.push(...result.checks);
      if (result.screenshot) screenshots.push(result.screenshot);
    }
    const failed = checks.filter((c) => c.status === 'FAIL');
    const notRunChecks = checks.filter((c) => c.status === 'NOT_RUN');
    const status = failed.length ? 'FAIL' : notRunChecks.length ? 'INCOMPLETE' : 'PASS';
    const summary = [
      `Rendered check: ${status} for ${url} at ${viewports.map((v) => v.name).join(', ')}.`,
      ...failed.map((c) => `FAIL ${c.id} (${c.viewport}): ${(c.items ?? []).join('; ')}`),
      ...[...new Set(notRunChecks.map((c) => `NOT_RUN ${c.id}: ${c.detail}`))],
      'Covers one URL in one state. Interaction states, keyboard flow and performance are not checked; look at the screenshots yourself.',
    ].join('\n');
    return { ...base, status, checks, screenshots, summary };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// `on`, not `once`: a listener keeps the channel, and so this process, alive until the result is sent.
process.on('message', (job) => {
  run(job).then((result) => ({ result }), (error) => ({ error: firstLine(error) }))
    .then((message) => process.send(message, () => process.exit(0)));
});
