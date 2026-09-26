// Every tool reports a thrown error in the failure() JSON shape, including
// tools whose handlers have no error handling of their own.
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

vi.mock("../src/niblet.js", () => ({
  findUiReferences: () => { throw new TypeError("catalogue exploded"); },
  getDesignReference: () => { throw new TypeError("catalogue exploded"); },
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
});
