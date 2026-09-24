import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server.js";

export async function runStdio({ roots }: { roots: string[] }): Promise<void> {
  const server = createServer({ allowedRoots: roots, useClientRoots: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the protocol channel — log to stderr only.
  console.error("designer-skill-mcp: stdio transport ready");
}
