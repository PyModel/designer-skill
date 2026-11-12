// Regressions from the 0.22 audit: each case failed (or did not exist) before 0.23.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dispatchIntent, HOST_COMMANDS, TOPIC_READS } from "../src/dispatch.js";
import { getCommandMetadata } from "../src/commands.js";
import { ALL_REFERENCE_NAMES } from "../src/skill.js";
import { loadProjectContext } from "../src/context.js";
import { reviewAndGate } from "../src/gate.js";
import { scanAntipatterns } from "../src/detect.js";
import { apcaLc, checkContrast } from "../src/contrast.js";
import { convertDesignTokens } from "../src/tokens.js";
import { assertLocalUrl, renderedPolicy, verifyRendered } from "../src/rendered.js";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getPaletteSeed } from "../src/palette.js";
import { commitDesignDirection } from "../src/direction.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); delete process.env.DESIGNER_SKILL_CONTEXT_DIR; });
function workspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "designer-audit-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
const verbs = (request: string) => dispatchIntent(request).matched.map((m) => m.verb);

describe("dispatch_intent", () => {
  it("treats a UI request that mentions a backend word as UI work", () => {
    const result = dispatchIntent("redesign the database admin table so rows are easier to read");
    expect(result.reason).toBe("matched");
    expect(result.recommendedReads).toContain("ux/21-data-tables");
    expect(dispatchIntent("tune the postgres query planner").reason).toBe("out-of-scope");
  });
  it("routes contrast, dark mode and state requests", () => {
    expect(verbs("fix the dark mode contrast")).toContain("color");
    expect(verbs("add a loading skeleton and an empty state to the list")).toContain("states");
  });
  it("names every matched verb instead of silently dropping those past the top three", () => {
    const result = dispatchIntent("audit accessibility and fix the dark mode contrast, add an empty state, make it responsive and tidy the form validation copy");
    const all = [...result.matched.map((m) => m.verb), ...result.alsoMatched];
    for (const verb of ["check", "color", "responsive", "form", "copy"]) expect(all, verb).toContain(verb);
    expect(result.matched).toHaveLength(3);
    expect(result.text).toContain("Also matched");
  });
  it("honors a negation a few words before the cue", () => {
    expect(verbs("make the hero pop but don't add any animation")).not.toContain("motion");
    expect(verbs("make the hero pop without motion")).not.toContain("motion");
    expect(verbs("no layout changes, but add animation to the hero")).toContain("motion");
  });
  it("answers the plugin's own slash commands instead of rejecting them as unknown verbs", () => {
    const commands = readdirSync(join(import.meta.dirname, "../../commands")).map((file) => file.replace(/\.md$/, ""));
    expect([...HOST_COMMANDS].sort()).toEqual(commands.sort()); // commands/*.md is the source of truth
    for (const command of commands) expect(dispatchIntent(`/${command}`).text).toContain("the host runs itself");
    expect(() => dispatchIntent("/levitate the pricing page")).toThrow(/Unknown command/); // unknown verbs stay blocked
  });
  it("keeps UI requests that mention a backend, and requests that describe a lack", () => {
    for (const request of ["improve chart colors in our postgres monitoring app", "add dark mode to the sql editor", "redis admin panel dropdown is misaligned",
      "the cli output colors are hard to read", "make the database explorer tooltip animation smoother"]) expect(dispatchIntent(request).reason, request).not.toBe("out-of-scope");
    for (const request of ["the app has no dark mode", "there is no dark mode, add one", "the checkout has no loading state",
      "the page is not responsive on mobile", "I don't like the dashboard charts"]) expect(dispatchIntent(request).reason, request).toBe("matched");
    for (const request of ["restyle the card, don't add any animation", "tidy the hero without animation", "do not animate"]) expect(verbs(request), request).not.toContain("motion");
  });
  it("routes every bundled reference from some command or topic", () => {
    const routed = new Set([...Object.values(getCommandMetadata()).flatMap((m) => m.reads), ...TOPIC_READS.flatMap((t) => t.reads), "command-playbook"]);
    expect(ALL_REFERENCE_NAMES.filter((name) => !routed.has(name))).toEqual([]);
  });
  it("routes a native-platform request to the native reference and says the checks are web-only", () => {
    const result = dispatchIntent("build an iOS SwiftUI settings screen");
    expect(result.recommendedReads[0]).toBe("native-platforms");
    expect(result.text).toContain("cover web source only");
  });
});

describe("tool results", () => {
  it("does not report a required rule as RAN when no file was scanned", async () => {
    const result = await reviewAndGate(".", { cwd: workspace({ "notes.txt": "nothing scannable" }) });
    expect(result.code).toBe("NO_SCAN_COVERAGE");
    expect(result.ruleCoverage.map((c) => c.status)).toEqual(["NOT_RUN", "NOT_RUN", "NOT_RUN"]);
    expect(result.summary).not.toContain("RAN on 0");
  });
  it("lists the known seed ids when an id is unknown", async () => {
    await expect(getPaletteSeed({ id: "nope" })).rejects.toMatchObject({ code: "UNKNOWN_SEED", details: { ids: expect.arrayContaining(["seed-199"]) } });
  });
  it("tells a bounded fix to use preserve mode", () => {
    const result = commitDesignDirection({ register: "product", designRead: "Fix a misaligned button in the settings form footer.", contextSources: ["src/app.css"] });
    expect(result.fixes?.join(" ")).toContain('mode "preserve"');
  });
  it("prefers the explicitly configured context directory over the defaults", () => {
    const cwd = workspace({ "PRODUCT.md": "root copy", "brand/PRODUCT.md": "configured copy" });
    process.env.DESIGNER_SKILL_CONTEXT_DIR = "brand";
    expect(loadProjectContext(cwd).product).toBe("configured copy");
  });
  it("reports design tooling found at the project root", () => {
    const cwd = workspace({ "components.json": "{}", "tokens.json": "{}", ".storybook/main.ts": "" });
    expect(loadProjectContext(cwd).integrations.map((i) => i.id)).toEqual(["shadcn", "storybook", "design-tokens"]);
  });
  it("stops a scan when the client cancels", async () => {
    const cwd = workspace({ "index.html": "<p>hello</p>" });
    await expect(scanAntipatterns(".", { cwd, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("check_contrast", () => {
  it("matches reference WCAG and APCA values", async () => {
    const [blackOnWhite, grey] = await checkContrast([{ foreground: "#000", background: "#fff" }, { foreground: "#777", background: "white" }]);
    expect(blackOnWhite).toMatchObject({ ratio: 21, passesAA: true, passesAAA: true });
    expect(blackOnWhite.apcaLc).toBeCloseTo(106, 0);
    expect(apcaLc({ r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(-107.9, 0);
    expect(grey).toMatchObject({ ratio: 4.48, passesAA: false, requiredRatio: 4.5 });
  });
  it("uses the large-text threshold and composites translucent text", async () => {
    const [large, faint] = await checkContrast([
      { foreground: "#777", background: "#fff", fontSizePx: 24 },
      { foreground: "rgba(0,0,0,0.15)", background: "#fff" },
    ]);
    expect(large).toMatchObject({ largeText: true, requiredRatio: 3, passesAA: true });
    expect(faint.ratio).toBeLessThan(1.5); // 21:1 if alpha were ignored
  });
  it("reports a color it cannot evaluate instead of guessing", async () => {
    const [result] = await checkContrast([{ foreground: "var(--ink)", background: "#fff" }]);
    expect(result.error).toContain("not a concrete CSS color");
    expect(result.ratio).toBeUndefined();
  });
});

describe("convert_design_tokens", () => {
  const tokens = {
    color: { $type: "color", brand: { 500: { $value: "#2563eb" } }, primary: { $value: "{color.brand.500}" }, p3: { $value: { colorSpace: "display-p3", components: [1, 0, 0], alpha: 0.5 } } },
    radius: { $type: "dimension", md: { $value: { value: 8, unit: "px" } } },
    font: { body: { $type: "fontFamily", $value: ["Source Sans 3", "sans-serif"] } },
    shadow: { card: { $type: "shadow", $value: { offsetX: "0px" } } },
    loop: { a: { $value: "{loop.b}" }, b: { $value: "{loop.a}" } },
  };
  it("emits CSS custom properties with aliases resolved and group types inherited", () => {
    const { css, skipped } = convertDesignTokens(tokens, "css");
    expect(css).toContain("--color-brand-500: #2563eb;");
    expect(css).toContain("--color-primary: #2563eb;");
    expect(css).toContain("--color-p3: color(display-p3 1 0 0 / 0.5);");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).toContain('--font-body: "Source Sans 3", sans-serif;');
    expect(skipped.sort()).toEqual(["loop.a", "loop.b", "shadow.card"]);
  });
  it("maps token types to Tailwind v4 theme namespaces without doubling them", () => {
    const { css } = convertDesignTokens(tokens, "tailwind");
    expect(css.startsWith("@theme {")).toBe(true);
    expect(css).toContain("--color-brand-500:");
    expect(css).toContain("--radius-md: 8px;");
    expect(css).not.toContain("--color-color-");
  });
  it("rejects a document with no tokens", () => {
    expect(() => convertDesignTokens({ colors: { primary: "#fff" } }, "css")).toThrow(/No tokens/);
  });
});

describe("convert_design_tokens review fixes", () => {
  it("keeps alpha when a color also carries hex, and reports a name collision", () => {
    const result = convertDesignTokens({
      overlay: { $type: "color", $value: { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5, hex: "#000000" } },
      color: { x: { $type: "color", $value: "#111111" } }, "color-x": { $type: "color", $value: "#222222" },
    }, "css");
    expect(result.css).toContain("--overlay: color(srgb 0 0 0 / 0.5);");
    expect(result.css).toContain("--color-x: #111111;");
    expect(result.css).not.toContain("#222222");
    expect(result.skipped).toEqual(["color-x (name --color-x already used)"]);
    expect(result.tokenCount).toBe(2);
  });
});

describe("verify_rendered", () => {
  const page = `<!doctype html><html lang="en"><head><title>t</title><style>
    .clip{width:60px;white-space:nowrap;overflow:hidden} .faint{color:#ccc;background:#fff}</style></head>
    <body><main><h1>Title</h1><p class="clip">This sentence is far wider than sixty pixels</p>
    <p class="faint">low contrast</p><img src="missing.png" alt="x"></main></body></html>`;
  const repoModules = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules");
  /** A project that has Playwright and axe-core installed (this repository's dev installs). */
  const projectWithBrowser = (files: Record<string, string> = {}) => {
    const cwd = workspace({ "index.html": page, ...files });
    symlinkSync(repoModules, join(cwd, "node_modules"));
    return cwd;
  };
  /** A project whose "playwright" is a stand-in that runs the given launch body in the worker process. */
  const projectWithFakeDriver = (launchBody: string) => workspace({
    "index.html": page,
    "node_modules/playwright/package.json": '{"name":"playwright","main":"index.js"}',
    "node_modules/playwright/index.js": `exports.chromium = { launch: async () => { ${launchBody} } };`,
  });
  const fileUrl = (cwd: string) => pathToFileURL(join(cwd, "index.html")).href;
  const desktop = [{ name: "desktop", width: 800, height: 600 }];
  const real = (result: Awaited<ReturnType<typeof verifyRendered>>) => {
    if (result.status === "NOT_RUN") throw new Error(`no browser on this machine: ${result.reason}`);
    return result;
  };
  const listen = (handler: Parameters<typeof createHttpServer>[1], host: string) => new Promise<{ port: number; close: () => void }>((done) => {
    const server = createHttpServer(handler);
    server.listen(0, host, () => done({ port: (server.address() as AddressInfo).port, close: () => server.close() }));
  });
  afterEach(() => { renderedPolicy.deadlineMs = 120_000; delete process.env.NIBLET_TOKEN; });

  it("only loads pages on this machine", async () => {
    const cwd = workspace({ "index.html": page });
    await expect(assertLocalUrl("https://example.com/", cwd)).rejects.toThrow(/loopback/);
    await expect(assertLocalUrl(pathToFileURL("/etc/hosts").href, cwd)).rejects.toThrow(/outside the project root/);
    expect((await assertLocalUrl("http://localhost:5173/app", cwd)).hostname).toBe("localhost");
    const url = await assertLocalUrl(`${fileUrl(cwd)}?theme=dark#/settings`, cwd);
    expect([url.search, url.hash]).toEqual(["?theme=dark", "#/settings"]);
  });
  it("reports NOT_RUN, never a pass, when the project has no browser driver", async () => {
    const cwd = workspace({ "index.html": page });
    const result = await verifyRendered(fileUrl(cwd), { root: cwd });
    expect(result).toMatchObject({ status: "NOT_RUN", checks: [] });
    expect(result.reason).toContain("Playwright is not installed");
  });
  it("runs project code without this server's credentials", async () => {
    process.env.NIBLET_TOKEN = ["niblet", "at", "test"].join("_");
    const cwd = projectWithFakeDriver('throw new Error("token=" + (process.env.NIBLET_TOKEN ? "present" : "absent") + " path=" + (process.env.PATH ? "kept" : "lost"));');
    const result = await verifyRendered(fileUrl(cwd), { root: cwd });
    expect(result.reason).toContain("token=absent path=kept");
  });
  it("stops a check that never finishes", async () => {
    renderedPolicy.deadlineMs = 400;
    const cwd = projectWithFakeDriver("return new Promise(() => {});");
    const result = await verifyRendered(fileUrl(cwd), { root: cwd });
    expect(result).toMatchObject({ status: "NOT_RUN", reason: expect.stringContaining("did not finish") });
  });
  it("is cancelled by the caller's signal", async () => {
    const cwd = projectWithFakeDriver("return new Promise(() => {});");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(verifyRendered(fileUrl(cwd), { root: cwd, signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" });
  });
  it("finds clipped text, a broken image and an axe contrast failure in a real browser", async () => {
    const cwd = projectWithBrowser();
    const result = real(await verifyRendered(fileUrl(cwd), { root: cwd, viewports: [{ name: "desktop", width: 1280, height: 800 }] }));
    const status = Object.fromEntries(result.checks.map((c) => [c.id, c]));
    expect(result.status).toBe("FAIL");
    expect(status["text-overflow"]).toMatchObject({ status: "FAIL", items: [expect.stringContaining("p.clip")] });
    expect(status["broken-image"].status).toBe("FAIL");
    expect(status["accessibility"].items?.join(" ")).toContain("color-contrast");
    expect(status["horizontal-overflow"].status).toBe("PASS");
    expect(result.screenshots[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);
  it("reports a server that is down as a page-load FAIL, not a tool error", async () => {
    const cwd = projectWithBrowser();
    const down = real(await verifyRendered("http://127.0.0.1:1/", { root: cwd, viewports: desktop }));
    expect(down).toMatchObject({ status: "FAIL", screenshots: [], checks: [{ id: "page-load", status: "FAIL" }] });
  }, 60_000);
  it("follows a redirect that stays local and refuses one that leaves, before the other host is contacted", async () => {
    const cwd = projectWithBrowser();
    let outsideHits = 0;
    // 0.0.0.0 reaches this machine but is not a loopback name: it stands in for a remote host.
    const outside = await listen((_req, res) => { outsideHits++; res.writeHead(200, { "content-type": "text/html" }).end(page); }, "0.0.0.0");
    const local = await listen((req, res) => {
      if (req.url === "/landed") { res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html lang=en><title>ok</title><main><h1>Landed</h1></main>"); return; }
      res.writeHead(302, { Location: req.url === "/stay" ? "/landed" : `http://0.0.0.0:${outside.port}/` }).end();
    }, "127.0.0.1");
    try {
      const stays = real(await verifyRendered(`http://127.0.0.1:${local.port}/stay`, { root: cwd, viewports: desktop }));
      expect(stays.checks.find((c) => c.id === "page-load")?.status).toBe("PASS");
      expect(stays.screenshots).toHaveLength(1);
      const leaves = await verifyRendered(`http://127.0.0.1:${local.port}/leave`, { root: cwd, viewports: desktop });
      expect(leaves).toMatchObject({ status: "FAIL", screenshots: [] });
      expect(leaves.checks).toHaveLength(1);
      expect(leaves.checks[0].items?.[0]).toContain(`outside the local scope was refused: http://0.0.0.0:${outside.port}/`);
      expect(outsideHits).toBe(0);
    } finally { local.close(); outside.close(); }
  }, 60_000);
});
