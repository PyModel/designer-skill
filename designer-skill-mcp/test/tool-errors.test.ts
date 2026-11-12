// Every tool reports a thrown error in the failure() JSON shape, including
// tools whose handlers have no error handling of their own.
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

vi.mock("../src/niblet.js", async (original) => ({
  ...await original<typeof import("../src/niblet.js")>(),
  callNiblet: () => { throw new TypeError("catalogue exploded"); },
}));
vi.mock("../src/commands.js", async (original) => ({
  ...await original<typeof import("../src/commands.js")>(),
  listCommands: () => { throw new Error("registry unreadable"); },
}));

describe("tool error shape", () => {
  it("returns failure JSON when a handler throws", async () => {
    const server = createServer();
    const client = new Client({ name: "errors", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    await client.listTools();
    for (const [name, args, message] of [
      ["find_ui_references", { query: "pricing" }, "catalogue exploded"],
      ["get_design_reference", { screenId: "x" }, "catalogue exploded"],
      ["list_commands", {}, "registry unreadable"],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      const [block] = result.content as Array<{ text: string }>;
      expect(JSON.parse(block.text), name).toEqual({ code: "OPERATION_FAILED", message });
    }
    await client.close(); await server.close();
  });

  // Schema violations are raised by the SDK before a handler runs; createServer re-shapes them
  // through a private SDK hook. If an SDK upgrade moves that hook, this test is what notices.
  it("reports schema violations and unknown tools in the same JSON shape", async () => {
    const server = createServer();
    const client = new Client({ name: "errors", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), client.connect(a)]);
    const invalid = await client.callTool({ name: "validate_design_direction", arguments: { register: "product", designRead: "short", contextSources: ["a.css"] } });
    expect(invalid.isError).toBe(true);
    const body = JSON.parse((invalid.content as Array<{ text: string }>)[0].text);
    expect(body.code).toBe("INPUT_INVALID");
    expect(body.message).toContain("designRead");
    const unknown = await client.callTool({ name: "no_such_tool", arguments: {} });
    expect(JSON.parse((unknown.content as Array<{ text: string }>)[0].text).code).toBe("OPERATION_FAILED");
    await client.close(); await server.close();
  });
});
