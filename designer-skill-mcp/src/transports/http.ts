// Streamable HTTP transport, stateless: a fresh server + transport per request
// (no session store). Built on the SDK's createMcpExpressApp, which validates
// the Host header against localhost names when bound to a loopback address
// (DNS-rebinding protection) and caps JSON bodies. Any other bind address
// requires a bearer token and at least one --root.
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";

export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "::1"];

export interface HttpOptions {
  port: number;
  host: string;
  roots: string[];
  allowedHosts: string[];
  token?: string;
}

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

function bearerAuth(token: string) {
  const expected = Buffer.from(token);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const supplied = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      jsonRpcError(res, 401, -32001, "Unauthorized.");
      return;
    }
    next();
  };
}

export function assertHttpExposure({ host, roots, token }: Pick<HttpOptions, "host" | "roots" | "token">): void {
  if (LOOPBACK_HOSTS.includes(host)) return;
  if (!token) throw new Error(`Binding ${host} exposes the server beyond this machine: set DESIGNER_SKILL_HTTP_TOKEN (clients send it as a Bearer token).`);
  if (!roots.length) throw new Error(`Binding ${host} requires at least one --root to limit which project directories clients can read.`);
}

export async function runHttp(options: HttpOptions): Promise<Server> {
  assertHttpExposure(options);
  const app = createMcpExpressApp({ host: options.host, ...(options.allowedHosts.length ? { allowedHosts: options.allowedHosts } : {}) });
  if (options.token) app.use(bearerAuth(options.token));

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = createServer({ allowedRoots: options.roots });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("designer-skill-mcp http error:", err);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error.");
    }
  });

  // Stateless server: no server-initiated SSE stream or session teardown.
  const notAllowed = (_req: Request, res: Response) =>
    jsonRpcError(res, 405, -32000, "Method not allowed (stateless server). Use POST /mcp.");
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  const listener = await new Promise<Server>((resolve, reject) => {
    const server = app.listen(options.port, options.host, (error?: Error) => (error ? reject(error) : resolve(server)));
    server.on("error", reject);
  });
  const { port } = listener.address() as AddressInfo;
  const shown = options.host.includes(":") ? `[${options.host}]` : options.host;
  console.error(`designer-skill-mcp: HTTP transport on http://${shown}:${port}/mcp`);
  return listener;
}
