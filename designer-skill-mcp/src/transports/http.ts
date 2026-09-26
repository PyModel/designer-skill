// Streamable HTTP transport, stateless: a fresh server + transport per request
// (no session store). Every bind needs at least one --root; a non-loopback bind
// also needs a bearer token. Middleware order is the security boundary: the
// Host header (DNS-rebinding protection) and the token are checked before any
// JSON body is parsed.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type NextFunction, type Request, type Response } from "express";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";
import { projectRoot } from "../scope.js";

export const LOOPBACK_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "::1"];
/** Host-header hostnames of a loopback bind, in URL.hostname form (IPv6 keeps its brackets). */
const LOOPBACK_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

export interface HttpOptions {
  port: number;
  host: string;
  roots: string[];
  allowedHosts: string[];
  token?: string;
}

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

// Fixed-length digests, so the comparison time reveals neither content nor length.
const digest = (value: string) => createHash("sha256").update(value).digest();

function bearerAuth(token: string) {
  const expected = digest(token);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    if (!timingSafeEqual(digest(header.startsWith("Bearer ") ? header.slice(7) : ""), expected)) {
      jsonRpcError(res, 401, -32001, "Unauthorized.");
      return;
    }
    next();
  };
}

export function assertHttpExposure({ host, roots, token }: Pick<HttpOptions, "host" | "roots" | "token">): void {
  if (!roots.length) {
    throw new Error(`HTTP mode requires at least one --root: every local process and OS user can reach ${host}, so the readable project directories must be explicit.`);
  }
  if (LOOPBACK_HOSTS.includes(host)) return;
  if (!token) throw new Error(`Binding ${host} exposes the server beyond this machine: set DESIGNER_SKILL_HTTP_TOKEN (clients send it as a Bearer token).`);
}

export async function runHttp(options: HttpOptions): Promise<Server> {
  assertHttpExposure(options);
  // Resolve once: a bad --root stops startup instead of failing every request.
  const roots = options.roots.map((root) => projectRoot(root));
  const app = express();
  // --allowed-host adds names; a loopback bind always keeps its own.
  const hostnames = [...(LOOPBACK_HOSTS.includes(options.host) ? LOOPBACK_HOSTNAMES : []), ...options.allowedHosts];
  if (hostnames.length) app.use(hostHeaderValidation(hostnames));
  if (options.token) app.use(bearerAuth(options.token));
  app.use(express.json());

  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = createServer({ allowedRoots: roots });
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
