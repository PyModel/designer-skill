// Streamable HTTP transport, stateless: a fresh server + transport per request
// (no session store). Binds 127.0.0.1 by default with an Origin guard against
// DNS-rebinding; use --host 0.0.0.0 to expose (put your own auth in front).
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../server.js";

export interface HttpOptions {
  port: number;
  host: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

// DNS-rebinding guard: when bound to loopback, reject cross-origin browser
// requests (a non-local Origin header). Non-browser clients send no Origin.
function originAllowed(req: Request, host: string): boolean {
  if (!isLoopback(host)) return true; // public bind: operator owns auth/proxy
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return isLoopback(new URL(origin).hostname);
  } catch {
    return false;
  }
}

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

// Simple in-memory rate limiter to bound per-client request volume and guard
// against resource exhaustion from a flood of requests (CWE-770).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(key);
  if (!entry || now >= entry.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function runHttp({ port, host }: HttpOptions): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "8mb" }));

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!originAllowed(req, host)) {
      jsonRpcError(res, 403, -32000, "Forbidden origin (DNS-rebinding protection).");
      return;
    }
    if (rateLimited(req.ip ?? "unknown")) {
      jsonRpcError(res, 429, -32000, "Too many requests.");
      return;
    }
    try {
      const server = createServer();
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

  await new Promise<void>((resolve) => app.listen(port, host, () => resolve()));
  console.error(`designer-skill-mcp: HTTP transport on http://${host}:${port}/mcp`);
}
