import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import { dispatchIntent } from "../src/dispatch.js";
import { REFERENCE_NAMES } from "../src/skill.js";
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function connect() {
  const server = createServer(); const client = new Client({ name: "test-client", version: "0.0.0" });
  cleanup.push(() => server.close(), () => client.close());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "designer-server-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
function textOf(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) return "";
  return result.content.map((b) => b.type === "text" ? b.text : "").join("\n");
}

describe("intent routing regressions", () => {
  const examples: Array<[string, string]> = [
    ["the hero is bland, make it pop", "amplify"], ["make this production-ready with real data and error states", "ship"],
    ["the spacing feels off on this card", "layout"], ["redesign this page without breaking it", "refresh"],
    ["rewrite this error message, the wording is off", "copy"], ["design the first run and empty states for activation", "onboard"],
    ["capture the design system and write DESIGN.md", "spec"], ["show me 3 versions of this hero", "options"],
    ["help me with form design and validation", "form"], ["which navigation pattern should I use", "nav"],
    ["model all ui states as a state machine", "states"], ["the interface feels flat and lifeless", "tone"],
    ["set up the design system and token architecture", "system"], ["do a visual critique and score the design", "review"],
    ["setup project and write PRODUCT.md", "setup"], ["craft this landing page end to end", "build"],
    ["iterate in live mode on the hero", "preview"], ["fix the css with flexbox", "css"],
  ];
  it.each(examples)("routes %s to %s", (request, verb) => {
    expect(dispatchIntent(request).matched.map((m) => m.verb)).toContain(verb);
  });
  it("keeps unknown natural-language requests non-authorizing", () => {
    expect(dispatchIntent("xyzzy").reason).toBe("no-match");
    expect(dispatchIntent("xyzzy").recommendedReads).toContain("command-playbook");
  });
});

describe("MCP contract", () => {
  it("advertises the twelve supported tools and gate output schema", async () => {
    const tools = (await (await connect()).listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "anti_slop_checklist", "commit_design_direction", "detect_antipatterns", "dispatch_intent", "get_command", "get_design_system",
      "get_palette_seed", "get_preflight_brief", "get_reference", "list_commands", "load_project_context", "review_and_gate",
    ].sort());
    expect(tools.find((t) => t.name === "review_and_gate")?.outputSchema).toBeDefined();
  });
  it("keeps instructions compact and context first", async () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(700);
    const result = textOf(await (await connect()).callTool({ name: "get_preflight_brief" }));
    expect(result.indexOf("load_project_context")).toBeLessThan(result.indexOf("commit_design_direction"));
  });
  it("returns structured dispatch and valid CSS command guidance", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "dispatch_intent", arguments: { request: "css" } });
    expect(result.structuredContent).toMatchObject({ reason: "explicit", matched: [{ verb: "css" }] });
    const help = await client.callTool({ name: "get_command", arguments: { verb: "css" } });
    expect(help.isError).not.toBe(true); expect(help.structuredContent).toMatchObject({ references: ["css-techniques", "design-principles"] });
  });
  it("supports aliases but rejects unknown explicit commands", async () => {
    const client = await connect();
    expect(textOf(await client.callTool({ name: "get_command", arguments: { verb: "init" } }))).toContain("alias");
    expect((await client.callTool({ name: "get_command", arguments: { verb: "unknown" } })).isError).toBe(true);
  });
  it("does not eagerly include reference contents in command help", async () => {
    const result = textOf(await (await connect()).callTool({ name: "get_command", arguments: { verb: "build" } }));
    expect(result.length).toBeLessThan(1500); expect(result).toContain("craft-flow");
  });
  it("preserves DESIGN.md when PRODUCT.md is absent", async () => {
    const cwd = workspace(); writeFileSync(join(cwd, "DESIGN.md"), "Approved identity evidence");
    const result = textOf(await (await connect()).callTool({ name: "load_project_context", arguments: { cwd } }));
    expect(result).toContain("Approved identity evidence"); expect(result).toContain("NO_PRODUCT_MD");
  });
  it("rejects a missing or relative MCP project root", async () => {
    const client = await connect();
    for (const args of [{}, { cwd: "." }]) expect((await client.callTool({ name: "load_project_context", arguments: args })).isError).toBe(true);
  });
  it("reports empty scan failure as structured evidence", async () => {
    const result = await (await connect()).callTool({ name: "review_and_gate", arguments: { cwd: workspace(), target: "." } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ schemaVersion: 2, code: "NO_SCAN_COVERAGE", staticStatus: "FAIL", status: "FAIL" });
  });
  it("validates preservation without requiring an invented aesthetic", async () => {
    const result = await (await connect()).callTool({ name: "commit_design_direction", arguments: {
      mode: "preserve", register: "product", designRead: "Repair existing account form spacing without changing identity.", contextSources: ["src/form.css"],
    } });
    expect(result.structuredContent).toMatchObject({ status: "PASS", scope: "input-validation" });
  });
  it("lists and reads the skill and reference resources", async () => {
    const client = await connect(); const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("designer://skill");
    for (const name of REFERENCE_NAMES) expect(uris).toContain(`designer://reference/${name}`);
    const result = await client.readResource({ uri: "designer://reference/avoid-ai-slop" });
    expect(result.contents[0].text).toContain("Avoiding AI Slop");
    expect((await client.callTool({ name: "get_reference", arguments: { name: "unknown" } })).isError).toBe(true);
  });
  it("exposes a compact design prompt instead of the entire reference library", async () => {
    const prompt = await (await connect()).getPrompt({ name: "design", arguments: { task: "build a pricing page" } });
    const content = prompt.messages[0].content;
    expect(content.type).toBe("text");
    if (content.type === "text") { expect(content.text).toContain("Task: build a pricing page"); expect(content.text.length).toBeLessThan(5000); }
  });
  it("retains palette and router discovery", async () => {
    const client = await connect();
    expect(textOf(await client.callTool({ name: "get_palette_seed", arguments: { from: "test-brand" } })).toLowerCase()).toContain("oklch");
    expect(textOf(await client.callTool({ name: "get_design_system" }))).toContain("Overview & Execution Contract");
  });
});
