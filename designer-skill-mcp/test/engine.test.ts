// Engine regressions from the principal review: color parsing, cascade
// fidelity, component-syntax false positives, confinement and linear time.
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error untyped engine module
import { parseCssColor } from "../assets/engine/shared/color.mjs";
// @ts-expect-error untyped engine module
import { detectHtml } from "../assets/engine/engines/static-html/detect-html.mjs";
// @ts-expect-error untyped engine module
import { detectText } from "../assets/engine/engines/regex/detect-text.mjs";
// @ts-expect-error untyped engine module
import { createScanFs } from "../assets/engine/node/scan-fs.mjs";
// @ts-expect-error untyped engine module
import { matchesGlob, assertValidGlob } from "../assets/engine/lib/designer-skill-config.mjs";
// @ts-expect-error untyped engine module
import { buildImportGraph } from "../assets/engine/node/file-system.mjs";
import { scanAntipatterns } from "../src/detect.js";

type Finding = { antipattern: string; line?: number };
type HtmlResult = { findings: Finding[]; gaps: Array<{ kind: string; rule?: string; line?: number }> };

const dirs: string[] = [];
function dir(): string { const d = mkdtempSync(join(tmpdir(), "designer-engine-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const page = (head: string, body: string) => `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;
const html = (content: string, readStylesheet?: (href: string) => unknown): Promise<HtmlResult> =>
  detectHtml("index.html", { content, readStylesheet: readStylesheet ?? (() => ({ ok: false, reason: "none" })) });
const ids = (r: { findings: Finding[] }) => r.findings.map((f) => f.antipattern);
const rgb = (c: string) => { const v = parseCssColor(c); return v && [Math.round(v.r), Math.round(v.g), Math.round(v.b)]; };

describe("CSS Color 4 parsing", () => {
  it.each([
    ["#f00", [255, 0, 0]], ["#ff000080", [255, 0, 0]], ["rgb(255 0 0 / 50%)", [255, 0, 0]], ["rgba(255,0,0,.5)", [255, 0, 0]],
    ["hsl(0 0% 60%)", [153, 153, 153]], ["hsl(120deg, 100%, 25%)", [0, 128, 0]], ["hwb(0 0% 0%)", [255, 0, 0]],
    ["lab(54.29% 80.8 69.89)", [255, 0, 0]], ["lch(54.29% 106.84 40.85)", [255, 0, 0]],
    ["oklab(62.8% 0.2249 0.1258)", [255, 0, 0]], ["oklch(62.8% 0.2577 29.23)", [255, 0, 0]],
    ["color(srgb 1 0 0)", [255, 0, 0]], ["rebeccapurple", [102, 51, 153]], ["RED", [255, 0, 0]],
  ])("parses %s", (input, expected) => { expect(rgb(input)).toEqual(expected); });

  it.each(["currentcolor", "var(--x)", "color-mix(in srgb, red, blue)", "notacolor", "#12", "rgb(1 2)"])(
    "treats %s as unevaluable rather than guessing", (input) => { expect(parseCssColor(input)).toBeNull(); });

  it("keeps alpha", () => { expect(parseCssColor("rgb(0 0 0 / 25%)")?.a).toBeCloseTo(0.25); });
});

describe("static cascade fidelity", () => {
  const lowContrast = '<p class="t">Low contrast text</p>';
  it("flags low contrast from a modern color syntax", async () => {
    expect(ids(await html(page("<style>.t{color:hsl(0 0% 47%);background:hsl(0 0% 53%)}</style>", lowContrast)))).toContain("low-contrast");
  });
  it("does not apply rules from a non-matching @media query", async () => {
    const css = "<style>.t{color:#111;background:#fff}@media print{.t{color:#eee}}@media (max-width:400px){.t{color:#eee}}</style>";
    expect(ids(await html(page(css, lowContrast)))).not.toContain("low-contrast");
  });
  it("orders @layer so unlayered styles win", async () => {
    const css = "<style>@layer base{.t{color:#eee;background:#fff}} .t{color:#111}</style>";
    expect(ids(await html(page(css, lowContrast)))).not.toContain("low-contrast");
  });
  it("resolves var() and reports an unresolvable var as a gap, not a finding", async () => {
    const good = "<style>:root{--fg:#111}.t{color:var(--fg);background:#fff}</style>";
    expect(ids(await html(page(good, lowContrast)))).not.toContain("low-contrast");
    const gap = await html(page("<style>.t{color:color-mix(in srgb,red,blue);background:#fff}</style>", lowContrast));
    expect(ids(gap)).not.toContain("low-contrast");
    expect(gap.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "UNEVALUABLE_COLOR", rule: "low-contrast" })]));
  });
  it("survives a var() expansion bomb", async () => {
    const vars = Array.from({ length: 30 }, (_, i) => `--v${i + 1}:var(--v${i}) var(--v${i});`).join("");
    const started = performance.now();
    await html(page(`<style>:root{--v0:x;${vars}}.t{color:var(--v30)}</style>`, lowContrast));
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it("reports an unreadable stylesheet as UNRESOLVED_STYLESHEET, but ignores font-only hosts", async () => {
    const r = await html(page('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><link rel="stylesheet" href="app.css">', lowContrast));
    expect(r.gaps.filter((g) => g.kind === "UNRESOLVED_STYLESHEET")).toHaveLength(1);
  });
  it("reads linked stylesheets through the provided reader", async () => {
    const r = await html(page('<link rel="stylesheet" href="app.css?v=2">', lowContrast), () => ({ ok: true, css: ".t{color:#777;background:#888}", path: "app.css" }));
    expect(ids(r)).toContain("low-contrast");
  });
  it("rejects pathologically deep DOM with a scan-limit error", async () => {
    await expect(html(page("", "<div>".repeat(2000) + "x"))).rejects.toMatchObject({ code: "SCAN_LIMIT" });
  });
});

describe("broken-image false positives", () => {
  it.each([
    ["Svelte shorthand", "<img {src} alt=\"a\">"], ["JSX spread", "<img {...props} />"], ["Angular binding", "<img [src]=\"url\" alt=\"a\">"],
    ["Angular attr binding", "<img [attr.src]=\"url\">"], ["Vue v-bind object", "<img v-bind=\"attrs\">"], ["Vue :src", "<img :src=\"url\">"],
  ])("does not flag %s", (_label, snippet) => {
    expect(ids(detectText(snippet, "c.vue"))).not.toContain("broken-image");
  });
  it.each(['<img alt="a">', '<img src="" alt="a">', '<img src="#">'])("flags %s", (snippet) => {
    expect(ids(detectText(snippet, "c.html"))).toContain("broken-image");
  });
});

describe("ScanFS confinement", () => {
  function fsFor(root: string) { return createScanFs({ root, webRoot: root, maxFileBytes: 1024, maxTotalBytes: 4096 }); }

  it("resolves query strings, fragments and root-relative hrefs inside the root", () => {
    const root = dir(); mkdirSync(join(root, "css")); writeFileSync(join(root, "css/a.css"), "a{}");
    const scan = fsFor(root);
    expect(scan.readStylesheet("css/a.css?v=3#x", "index.html")).toMatchObject({ ok: true, path: "css/a.css" });
    expect(scan.readStylesheet("/css/a.css", "pages/x.html")).toMatchObject({ ok: true, path: "css/a.css" });
  });
  it("refuses remote, escaping and symlinked-out stylesheets", () => {
    const root = dir(), outside = dir(); writeFileSync(join(outside, "s.css"), "a{}");
    symlinkSync(join(outside, "s.css"), join(root, "link.css"));
    const scan = fsFor(root);
    for (const href of ["https://x.test/a.css", "//x.test/a.css", "data:text/css,a{}", "../s.css", "link.css"]) {
      expect(scan.readStylesheet(href, "index.html").ok).toBe(false);
    }
    expect(scan.evidence()).toEqual([]);
  });
  it("refuses FIFOs and devices without blocking or reading", () => {
    const root = dir(); execFileSync("mkfifo", [join(root, "pipe.css")]);
    symlinkSync("/dev/zero", join(root, "zero.css"));
    const scan = fsFor(root);
    expect(scan.read(join(root, "pipe.css"), "selected")).toMatchObject({ ok: false, code: "NOT_REGULAR_FILE" });
    expect(scan.read(join(root, "zero.css"), "selected")).toMatchObject({ ok: false, code: "SCOPE_VIOLATION" });
  });
  it("enforces per-file and total byte caps", () => {
    const root = dir();
    writeFileSync(join(root, "big.css"), "a".repeat(2048));
    for (let i = 0; i < 5; i++) writeFileSync(join(root, `f${i}.css`), "b".repeat(1000));
    const scan = fsFor(root);
    expect(scan.read(join(root, "big.css"), "selected")).toMatchObject({ ok: false, code: "SIZE_LIMIT" });
    expect(() => { for (let i = 0; i < 5; i++) scan.read(join(root, `f${i}.css`), "selected"); }).toThrow(expect.objectContaining({ code: "SCAN_LIMIT" }));
  });
  it("hashes what it reads", () => {
    const root = dir(); writeFileSync(join(root, "a.css"), "a{}");
    const scan = fsFor(root); scan.read(join(root, "a.css"), "selected");
    expect(scan.evidence()).toEqual([{ path: "a.css", sha256: expect.stringMatching(/^[a-f0-9]{64}$/), role: "selected" }]);
  });
});

describe("glob matching", () => {
  it.each([
    ["src/a.css", "*.css", true], ["src/a.css", "src/*.css", true], ["src/x/a.css", "src/*.css", false],
    ["src/x/a.css", "src/**/*.css", true], ["src/a.css", "src/**/*.css", true], ["a.tsx", "*.{ts,tsx}", true],
    ["a.js", "*.{ts,tsx}", false], ["legacy/v1/x.html", "legacy/**", true],
  ])("%s vs %s → %s", (path, glob, expected) => { expect(matchesGlob(path, glob)).toBe(expected); });

  it("matches a single segment exactly like the equivalent anchored regex", () => {
    const words = (alphabet: string, max: number) => {
      const out = [""];
      for (let i = 0; i < out.length; i++) if (out[i].length < max) for (const c of alphabet) out.push(out[i] + c);
      return out;
    };
    const paths = words("ab", 5).filter(Boolean);
    for (const glob of words("ab*?", 4).filter((g) => g && !g.includes("**"))) {
      const reference = new RegExp(`^${glob.replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
      for (const path of paths) expect(matchesGlob(path, glob), `${glob} vs ${path}`).toBe(reference.test(path));
    }
  });

  it("rejects oversized or brace-bomb globs", () => {
    expect(() => assertValidGlob("a".repeat(600))).toThrow();
    expect(() => assertValidGlob("{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}")).toThrow();
  });
  it("matches adversarial globs in linear-ish time", () => {
    const started = performance.now();
    matchesGlob("a/".repeat(40) + "b", "**/".repeat(20) + "c");
    matchesGlob("a".repeat(200), "*a*a*a*a*a*a*a*a*a*a*b");
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("linear-time analyzers", () => {
  const adversarial = [
    "<img " + "a".repeat(2 * 1024 * 1024),
    "<style>" + "a{color:purple ".repeat(100_000),
    "<!--" + "x".repeat(2 * 1024 * 1024),
    "import " + "(".repeat(1024 * 1024),
  ];
  it.each(adversarial.map((s, i) => [i, s] as const))("regex engine handles adversarial input %i under 2 s", (_i, content) => {
    const started = performance.now();
    detectText(content, "x.tsx");
    expect(performance.now() - started).toBeLessThan(2000);
  });
  it("builds the import graph over 2 MiB of adversarial input under 2 s", () => {
    const started = performance.now();
    buildImportGraph(new Map([["/r/a.ts", "from '" + "x".repeat(2 * 1024 * 1024)]]));
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("worker deadline", () => {
  it("aborts a scan past DESIGNER_SKILL_SCAN_TIMEOUT_MS with a SCAN_LIMIT error", async () => {
    const cwd = dir(); writeFileSync(join(cwd, "a.html"), page("", "<p>x</p>".repeat(50_000)));
    const previous = process.env.DESIGNER_SKILL_SCAN_TIMEOUT_MS;
    process.env.DESIGNER_SKILL_SCAN_TIMEOUT_MS = "1";
    try {
      await expect(scanAntipatterns(".", { cwd })).rejects.toMatchObject({ code: "SCAN_LIMIT", details: { bound: "time" } });
    } finally {
      if (previous === undefined) delete process.env.DESIGNER_SKILL_SCAN_TIMEOUT_MS; else process.env.DESIGNER_SKILL_SCAN_TIMEOUT_MS = previous;
    }
  });
});
