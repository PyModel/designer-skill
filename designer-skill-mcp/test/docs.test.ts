// Documentation claims that drifted before: tool tables, counts and the Cursor
// rule's tool contract are checked against the live server.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { ALL_REFERENCE_NAMES } from "../src/skill.js";
import { registryIds } from "../src/detect.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");

async function liveTools() {
  const server = createServer();
  const client = new Client({ name: "docs", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const { tools } = await client.listTools();
  await client.close(); await server.close();
  return tools;
}

function tableTools(markdown: string): string[] {
  const block = markdown.match(/<!-- tools:start -->([\s\S]*?)<!-- tools:end -->/);
  expect(block, "tools table markers").not.toBeNull();
  return [...block![1].matchAll(/(?:^\| `|^<tr><td[^>]*><code>)([a-z_]+)(?:`|<\/code>)/gm)].map((m) => m[1]).sort();
}

describe("documentation matches the server", () => {
  it("lists every MCP tool, and only those, in both READMEs", async () => {
    const names = (await liveTools()).map((t) => t.name).sort();
    expect(tableTools(read("README.md"))).toEqual(names);
    expect(tableTools(read("designer-skill-mcp/README.md"))).toEqual(names);
  });

  it("states the real tool, reference and rule counts", async () => {
    const readme = read("README.md");
    const tools = (await liveTools()).length;
    const counts = [...readme.matchAll(/MCP_tools-(\d+)|MCP-(\d+)_tools/g)].map((m) => Number(m[1] ?? m[2]));
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) expect(n).toBe(tools);
    expect(Number(readme.match(/references-(\d+)-/)![1])).toBe(ALL_REFERENCE_NAMES.length);
    const rules = (await registryIds()).size;
    expect(Number(readme.match(/detector-(\d+)_rules/)![1])).toBe(rules);
    for (const m of readme.matchAll(/(\d+)-rule deterministic detector|Deterministic static scan \((\d+) rules\)/g)) {
      expect(Number(m[1] ?? m[2])).toBe(rules);
    }
  });

  it("keeps the Cursor rule on the live tool contract", async () => {
    const rule = read("rules/designer-skill-ui.mdc");
    const tools = await liveTools();
    const names = new Set(tools.map((t) => t.name));
    for (const [, name] of rule.matchAll(/`([a-z]+_[a-z_]+)`/g)) expect(names, name).toContain(name);
    const direction = tools.find((t) => t.name === "commit_design_direction")!;
    for (const field of direction.inputSchema.required ?? []) expect(rule, `required field ${field}`).toContain(`\`${field}\``);
  });
});
