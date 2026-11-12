// Niblet bridge tests against a local stand-in for the hosted Niblet MCP
// (https://niblet-api.pymodel.com/mcp): pass-through, and every way the
// catalogue can be off, unreachable or failing without becoming a tool error.
// The adapter spoke REST before 0.23; those tests were replaced with the module.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { z } from "zod";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { McpServer } from "@modelcontextprotocol/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { callNiblet, nibletConfigured, nibletPolicy, resetNibletCircuit } from "../src/niblet.js";

const KEY = ["niblet", "at", "test"].join("_");
const PNG = Buffer.from("fake-image").toString("base64");
let listener: Server;
let origin = "";
/** Tool calls the stand-in served, and every HTTP request it saw. */
const served: Array<{ tool: string; args: unknown }> = [];
let httpRequests = 0;
/** Status codes to answer before behaving, consumed one per request. */
let failWith: number[] = [];
/** How the stand-in answers tools/call after a normal initialize. */
let misbehave: "hang" | "bad-json" | null = null;

function fakeNiblet(): McpServer {
  const server = new McpServer({ name: "fake-niblet", version: "0" });
  server.registerTool("find_ui_references", { inputSchema: z.object({ query: z.string(), limit: z.number().optional() }) }, async (args) => {
    served.push({ tool: "find_ui_references", args });
    return { content: [{ type: "text", text: "1. Acme Settings — settings (web) id=scr-001" }, { type: "image", data: PNG, mimeType: "image/png" }] };
  });
  server.registerTool("get_design_reference", { inputSchema: z.object({ screenId: z.string().optional() }) }, async (args) => {
    served.push({ tool: "get_design_reference", args });
    return { isError: true, content: [{ type: "text", text: "only web screens have one" }] };
  });
  server.registerTool("find_ui_materials", { inputSchema: z.object({ query: z.string(), kind: z.string() }) }, async (args) => {
    served.push({ tool: "find_ui_materials", args });
    return { content: [{ type: "text", text: "x".repeat(25_000) }] };
  });
  return server;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    httpRequests++;
    const status = failWith.shift();
    if (status) { res.status(status).json({ error: "stub failure" }); return; }
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.status(401).json({ error: "bad key" }); return; }
    if (req.body?.method === "tools/call" && misbehave === "hang") return; // never answers
    if (req.body?.method === "tools/call" && misbehave === "bad-json") { res.status(200).type("application/json").send("{not json"); return; }
    const server = fakeNiblet();
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all("/mcp", (_req, res) => { res.status(405).end(); });
  listener = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => { listener.close(() => resolve()); }));

const saved = { ...nibletPolicy };
const env = ["NIBLET_TOKEN", "NIBLET_API_ORIGIN", "NIBLET_DISABLED"] as const;
const savedEnv = Object.fromEntries(env.map((name) => [name, process.env[name]]));
beforeEach(() => {
  process.env.NIBLET_TOKEN = KEY;
  process.env.NIBLET_API_ORIGIN = origin;
  delete process.env.NIBLET_DISABLED;
  Object.assign(nibletPolicy, { timeoutMs: 2_000, backoffMs: [1, 1], cooldownMs: 60_000 });
  resetNibletCircuit();
  served.length = 0; httpRequests = 0; failWith = []; misbehave = null;
});
afterEach(() => {
  Object.assign(nibletPolicy, saved);
  for (const name of env) { if (savedEnv[name] === undefined) delete process.env[name]; else process.env[name] = savedEnv[name]; }
});

const textOf = (answer: Awaited<ReturnType<typeof callNiblet>>) =>
  answer.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

describe("niblet bridge — catalogue off", () => {
  it("answers setup guidance and sends nothing without a key", async () => {
    delete process.env.NIBLET_TOKEN;
    const answer = await callNiblet("find_ui_references", { query: "pricing page" });
    expect(answer.status).toBe("not-configured");
    expect(textOf(answer)).toContain("NIBLET_TOKEN");
    expect(textOf(answer)).toContain("the catalogue is optional");
    expect(nibletConfigured()).toBe(false);
    expect(httpRequests).toBe(0);
  });
  it("never sends a NIBLET_TOKEN that is not a Niblet key", async () => {
    process.env.NIBLET_TOKEN = "sk-some-other-vendor";
    const answer = await callNiblet("find_ui_references", { query: "pricing page" });
    expect(answer.status).toBe("invalid-key");
    expect(textOf(answer)).not.toContain("sk-some-other-vendor");
    expect(httpRequests).toBe(0);
  });
  it("is skipped entirely when NIBLET_DISABLED is set, even with a valid key", async () => {
    process.env.NIBLET_DISABLED = "1";
    expect((await callNiblet("find_ui_materials", { query: "icons", kind: "icon" })).status).toBe("disabled");
    expect(httpRequests).toBe(0);
  });
  it("refuses a non-https or non-bare origin before sending", async () => {
    process.env.NIBLET_API_ORIGIN = "http://example.com";
    expect(textOf(await callNiblet("find_ui_references", { query: "q" }))).toContain("must use https");
    process.env.NIBLET_API_ORIGIN = `${origin}/v1`;
    expect(textOf(await callNiblet("find_ui_references", { query: "q" }))).toContain("bare origin");
    expect(httpRequests).toBe(0);
  });
  it("refuses kind pack before any request", async () => {
    const answer = await callNiblet("find_ui_materials", { query: "kit", kind: "pack" });
    expect(textOf(answer)).toContain("no packs");
    expect(httpRequests).toBe(0);
  });
});

describe("niblet bridge — hosted MCP pass-through", () => {
  it("passes arguments through and returns text and images marked untrusted", async () => {
    const answer = await callNiblet("find_ui_references", { query: "settings page", limit: 2, platform: undefined });
    expect(answer.status).toBe("ok");
    expect(served).toEqual([{ tool: "find_ui_references", args: { query: "settings page", limit: 2 } }]);
    expect(answer.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("untrusted evidence") });
    expect(textOf(answer)).toContain("id=scr-001");
    expect(answer.content.some((block) => block.type === "image")).toBe(true);
  });
  it("turns a catalogue tool error into guidance, not a failure", async () => {
    const answer = await callNiblet("get_design_reference", { screenId: "ios-1" });
    expect(answer.status).toBe("ok");
    expect(textOf(answer)).toContain("only web screens have one");
    expect(textOf(answer)).toContain("untrusted evidence"); // catalogue error text is third-party data too
    expect(textOf(answer)).toContain("the catalogue is optional");
  });
  it("bounds oversized catalogue text", async () => {
    const text = textOf(await callNiblet("find_ui_materials", { query: "icons", kind: "icon" }));
    expect(text).toContain("Truncated at 20000 characters");
    expect(text.length).toBeLessThan(21_000);
  });
});

describe("niblet bridge — failure handling", () => {
  it("retries a transient failure and succeeds", async () => {
    failWith = [503];
    const answer = await callNiblet("find_ui_references", { query: "settings page" });
    expect(answer.status).toBe("ok");
    expect(served).toHaveLength(1);
  });
  it("does not retry a rejected key and names the fix", async () => {
    process.env.NIBLET_TOKEN = `${KEY}_revoked`;
    const answer = await callNiblet("find_ui_references", { query: "settings page" });
    expect(answer.status).toBe("invalid-key");
    expect(textOf(answer)).toContain("rejected the NIBLET_TOKEN key");
    expect(httpRequests).toBe(1);
  });
  it("gives up after the configured tries, then skips the catalogue during the cool-down", async () => {
    failWith = Array(10).fill(503);
    const first = await callNiblet("find_ui_references", { query: "settings page" });
    expect(first.status).toBe("unavailable");
    expect(textOf(first)).toContain("does not establish an empty catalogue");
    expect(httpRequests).toBe(nibletPolicy.attempts);
    const second = await callNiblet("find_ui_references", { query: "settings page" });
    expect(second.status).toBe("skipped");
    expect(httpRequests).toBe(nibletPolicy.attempts); // nothing more was sent
    resetNibletCircuit();
    failWith = [];
    expect((await callNiblet("find_ui_references", { query: "settings page" })).status).toBe("ok");
  });
  it("reports an unreachable host as unavailable instead of throwing", async () => {
    process.env.NIBLET_API_ORIGIN = "http://127.0.0.1:1";
    const answer = await callNiblet("find_ui_references", { query: "settings page" });
    expect(answer.status).toBe("unavailable");
    expect(served).toHaveLength(0);
  });
  it("retries a catalogue that never answers, then skips it", async () => {
    misbehave = "hang";
    Object.assign(nibletPolicy, { timeoutMs: 150 });
    const first = await callNiblet("find_ui_references", { query: "settings page" });
    expect(first.status).toBe("unavailable");
    expect(textOf(first)).toContain(`after ${nibletPolicy.attempts} tries`);
    expect((await callNiblet("find_ui_references", { query: "settings page" })).status).toBe("skipped");
  });
  it("does not retry a malformed response or open the cool-down for it", async () => {
    misbehave = "bad-json";
    const before = httpRequests;
    const answer = await callNiblet("find_ui_references", { query: "settings page" });
    expect(answer.status).toBe("unavailable");
    expect(textOf(answer)).toContain("malformed response");
    const perCall = httpRequests - before;
    misbehave = null;
    expect((await callNiblet("find_ui_references", { query: "settings page" })).status).toBe("ok");
    expect(perCall).toBeLessThan(nibletPolicy.attempts * 2); // one initialize + one call, not three rounds
  });
  it("does not send a rejected key again", async () => {
    process.env.NIBLET_TOKEN = `${KEY}_revoked`;
    await callNiblet("find_ui_references", { query: "settings page" });
    const sent = httpRequests;
    const again = await callNiblet("find_ui_references", { query: "settings page" });
    expect(again.status).toBe("invalid-key");
    expect(httpRequests).toBe(sent);
  });
  it("does not retry a failure the server chose (HTTP 400)", async () => {
    failWith = [400];
    expect((await callNiblet("find_ui_references", { query: "settings page" })).status).toBe("unavailable");
    expect(httpRequests).toBe(1);
    expect((await callNiblet("find_ui_references", { query: "settings page" })).status).toBe("ok"); // no cool-down for it
  });
});
