// Detector regressions from the 0.22 audit, run against the engine directly.
// Each case was a false alarm or a miss in one of the three required rules,
// or a way one file could fail a whole scan.
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAntipatterns } from "../src/detect.js";
// @ts-expect-error untyped engine module
import { detectHtml } from "../assets/engine/engines/static-html/detect-html.mjs";
// @ts-expect-error untyped engine module
import { detectText } from "../assets/engine/engines/regex/detect-text.mjs";
// @ts-expect-error untyped engine module
import { staticRuleCoverage } from "../assets/engine/registry/antipatterns.mjs";
// @ts-expect-error untyped engine module
import { matchesGlob } from "../assets/engine/lib/designer-skill-config.mjs";
// @ts-expect-error untyped engine module
import { loadDesignSystem } from "../assets/engine/design-system.mjs";

interface Finding { antipattern: string; line?: number; snippet: string }
const doc = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
async function html(content: string, rule: string, options: Record<string, unknown> = {}): Promise<Finding[]> {
  const result = await detectHtml("t.html", { content, readStylesheet: () => ({ ok: false, reason: "stub" }), ...options });
  return (result.findings as Finding[]).filter((f) => f.antipattern === rule);
}
const text = (content: string, file: string, rule: string, options: Record<string, unknown> = {}): Finding[] =>
  (detectText(content, file, options).findings as Finding[]).filter((f) => f.antipattern === rule);

describe("low-contrast", () => {
  it.each(["span", "li", "td", "label", "a"])("checks text inside <%s>", async (tag) => {
    const wrap = tag === "li" ? ["<ul>", "</ul>"] : tag === "td" ? ["<table><tr>", "</tr></table>"] : ["<div>", "</div>"];
    expect(await html(doc(`${wrap[0]}<${tag} style="color:#ccc">faint text</${tag}>${wrap[1]}`), "low-contrast")).toHaveLength(1);
  });
  it("composites translucent text over its background", async () => {
    expect(await html(doc(`<p style="color:rgba(0,0,0,0.15);background:#fff">faint</p>`), "low-contrast")).toHaveLength(1);
    expect(await html(doc(`<p style="color:rgba(0,0,0,0.9);background:#fff">fine</p>`), "low-contrast")).toHaveLength(0);
  });
  it("reads attributes whatever their case", async () => {
    expect(await html(doc(`<p STYLE="color:#ccc;background:#fff">faint</p>`), "low-contrast")).toHaveLength(1);
    expect(await html(doc(`<img SRC="a.png" alt="">`), "broken-image")).toHaveLength(0);
  });
  it("applies the large-text threshold to headings and the bold keyword", async () => {
    expect(await html(doc(`<h1 style="color:#949494;background:#fff">Large heading at 3:1</h1>`), "low-contrast")).toHaveLength(0);
    expect(await html(doc(`<p style="font-size:20px;font-weight:bold;color:#8a8a8a;background:#fff">bold</p>`), "low-contrast")).toHaveLength(0);
    expect(await html(doc(`<p style="font-size:20px;color:#8a8a8a;background:#fff">regular</p>`), "low-contrast")).toHaveLength(1);
  });
  it("converts absolute units instead of multiplying them by the font size", async () => {
    expect(await html(doc(`<p style="font-size:10pt;color:#8a8a8a;background:#fff">small</p>`), "low-contrast")).toHaveLength(1);
    expect(await html(doc(`<p style="font-size:18pt;color:#8a8a8a;background:#fff">large</p>`), "low-contrast")).toHaveLength(0);
  });
  it("does not guess a size it cannot evaluate: only a failure of both thresholds is reported", async () => {
    expect(await html(doc(`<p style="font-size:clamp(2rem,5vw,4rem);color:#8a8a8a;background:#fff">fluid</p>`), "low-contrast")).toHaveLength(0);
    expect(await html(doc(`<p style="font-size:5vw;color:#ccc;background:#fff">fluid and faint</p>`), "low-contrast")).toHaveLength(1);
  });
  it("keeps a background color written after an image in the shorthand", async () => {
    const page = `<!doctype html><html><head></head><body style="background:url(n.png) #111;color:#eee"><p>light on dark</p></body></html>`;
    expect(await html(page, "low-contrast")).toHaveLength(0);
  });
});

describe("broken-image", () => {
  it("accepts srcset and <picture> sources in HTML", async () => {
    expect(await html(doc(`<img srcset="a.png 1x, b.png 2x" alt="">`), "broken-image")).toHaveLength(0);
    expect(await html(doc(`<picture><source srcset="a.webp"><img alt=""></picture>`), "broken-image")).toHaveLength(0);
    expect(await html(doc(`<img alt="">`), "broken-image")).toHaveLength(1);
    expect(await html(doc(`<img src="" alt="">`), "broken-image")).toHaveLength(1);
  });
  it("accepts srcSet, data-src beside a real src, and '>' inside an attribute in source files", () => {
    expect(text(`<img srcSet="a.png 1x" alt="" />`, "a.tsx", "broken-image")).toHaveLength(0);
    expect(text(`<img src="a.png" data-src="" alt="">`, "a.vue", "broken-image")).toHaveLength(0);
    expect(text(`<img alt="1 > 0" src="a.png">`, "a.vue", "broken-image")).toHaveLength(0);
    expect(text(`<img alt="x">`, "a.vue", "broken-image")).toHaveLength(1);
    expect(text(`<img src="" alt="x">`, "a.vue", "broken-image")).toHaveLength(1);
  });
});

describe("clipped-overflow-container", () => {
  const clip = (child: string, parent = "position:relative;overflow:hidden") => doc(`<div class="card" style="${parent}"><div class="tip" style="${child}">tip</div></div>`);
  it("flags a positioned child escaping the box that contains it", async () => {
    expect(await html(clip("position:absolute;top:-8px"), "clipped-overflow-container")).toHaveLength(1);
    expect(await html(clip("position:absolute;top:110%"), "clipped-overflow-container")).toHaveLength(1);
    expect(await html(clip("position:absolute;top:0;transform:translateY(-120%)"), "clipped-overflow-container")).toHaveLength(1);
    expect(await html(clip("position:absolute;top:0;transform:scale(100%)"), "clipped-overflow-container")).toHaveLength(0); // scaling moves nothing
    expect(await html(clip("position:absolute;top:-8px", "position:relative;overflow:hidden auto"), "clipped-overflow-container")).toHaveLength(1);
  });
  it("ignores children the box does not clip", async () => {
    expect(await html(clip("position:fixed;top:-8px"), "clipped-overflow-container")).toHaveLength(0);
    expect(await html(clip("position:absolute;top:-8px", "overflow:hidden"), "clipped-overflow-container")).toHaveLength(0);
    expect(await html(clip("position:absolute;top:8px"), "clipped-overflow-container")).toHaveLength(0);
  });
});

describe("scan robustness", () => {
  it("scans a long declaration-free stylesheet in linear time", () => {
    const css = "animation:x ".repeat(20_000); // every "animation:" restarts a scan to the end of the run
    const started = performance.now();
    detectText(css, "big.css", {});
    expect(performance.now() - started).toBeLessThan(1_000); // ~3 s before the fix
  });
  it("reports the real line of a finding inside a component <style> block", () => {
    const vue = `<template>\n  <div/>\n</template>\n<style>\n.a { transition: width 1s; }\n</style>\n`;
    expect(text(vue, "a.vue", "layout-transition")[0].line).toBe(5);
  });
  it("keeps different findings that sit on neighboring lines", () => {
    const css = `.a { transition: width 1s; }\n.b { transition: height 1s; }\n.c { transition: margin 1s; }\n`;
    expect(text(css, "a.css", "layout-transition")).toHaveLength(3);
  });
  it("reports a provider-gated rule as unsupported while its provider is off", () => {
    const file = { path: "t.html", engine: "static-html", fullPage: true, gaps: [] };
    expect(staticRuleCoverage("gpt-thin-border-wide-shadow", file, "absent").status).toBe("UNSUPPORTED");
    expect(staticRuleCoverage("broken-image", file, "absent").status).toBe("RAN");
  });
});

describe("scan policy", () => {
  it("ignores test and mock sources by default and counts them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "designer-engine-"));
    try {
      writeFileSync(join(dir, "card.test.ts"), 'expect(html).toBe(`<img src="">`);');
      writeFileSync(join(dir, "card.html"), "<!doctype html><html><head></head><body><p>ok</p></body></html>");
      const report = await scanAntipatterns(".", { cwd: dir });
      expect(report.findings).toEqual([]);
      expect(report.coverage).toMatchObject({ candidateFiles: 2, scannedFiles: 1, ignoredFiles: 1 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("does not let a root-relative stylesheet href climb out of the web root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "designer-engine-"));
    try {
      mkdirSync(join(dir, "site")); mkdirSync(join(dir, "private")); mkdirSync(join(dir, ".designer-skill"));
      writeFileSync(join(dir, ".designer-skill/config.json"), JSON.stringify({ detector: { webRoot: "site" } }));
      writeFileSync(join(dir, "private/secret.css"), ".a { transition: width 1s; }");
      writeFileSync(join(dir, "site/index.html"), '<!doctype html><html><head><link rel="stylesheet" href="/../private/secret.css"></head><body><p class="a">x</p></body></html>');
      const report = await scanAntipatterns("site", { cwd: dir });
      expect(report.files.map((f) => f.path)).not.toContain("private/secret.css");
      expect(JSON.stringify(report.scannedFiles[0].gaps)).toContain("outside the web root");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("policy matching", () => {
  it("matches nested braces and directory globs", () => {
    expect(matchesGlob("b.css", "{a,{b,c}}.css")).toBe(true);
    expect(matchesGlob("legacy/deep/x.css", "legacy/")).toBe(true);
    expect(matchesGlob("other/x.css", "legacy/")).toBe(false);
  });
  it("loads nested DESIGN.md color groups and accepts function radii", async () => {
    const markdown = `---\ncolors:\n  ink: "#111111"\n  brand:\n    500: "#2563eb"\nrounded:\n  md: 8px\n---\n# Design\n`;
    const loaded = loadDesignSystem({ markdown });
    expect(loaded.status).toBe("loaded");
    const css = `.a { color: #2563eb; border-radius: calc(4px + 4px); }\n.b { border-radius: clamp(4px, 1vw, 8px); }`;
    const findings = detectText(css, "a.css", { designSystem: loaded.designSystem }).findings as Finding[];
    expect(findings.filter((f) => f.antipattern === "design-system-color")).toHaveLength(0);
    expect(findings.filter((f) => f.antipattern === "design-system-radius")).toHaveLength(0);
  });
});
