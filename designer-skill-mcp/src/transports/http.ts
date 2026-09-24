// Streamable HTTP transport, stateless: a fresh server + transport per request
// (no session store). Binds 127.0.0.1 by default with an Origin guard against
// DNS-rebinding; use --host 0.0.0.0 to expose (put your own auth in front).
//
// Rate limiting (below) is off by default on the loopback bind — a single
// local client (e.g. a coding agent doing initialize/tools-list/one POST per
// tool call) shares one bucket and would otherwise trip 429s during normal
// use — and on by default for any non-loopback bind. Override with
// RATE_LIMIT_ENABLED=true|false in either direction. The limiter keys on
// req.ip with Express's `trust proxy` left at its default (off): behind a
// reverse proxy every request resolves to the proxy's own address and
// collapses into a single bucket. That is not auto-detected or fixed here —
// operators fronting this process with a proxy should rely on the proxy's
// own rate limiting/auth, per the guidance above.
import express, { type Express, type NextFunction, type Request, type Response } from "express";
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

// In-memory rate limiter to bound per-client request volume and guard
// against request/resource exhaustion from a flood of requests (CWE-770).
// Bounded by both a TTL sweep (expired entries are periodically evicted)
// and a hard cap on tracked keys (oldest entry evicted FIFO once at
// capacity), so memory stays bounded even under an IP-rotation flood.
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX = 120;
export const MAX_TRACKED_CLIENTS = 10_000;

export interface RateLimitOptions {
  enabled: boolean;
  windowMs: number;
  max: number;
  maxTrackedClients: number;
}

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  size: () => number;
  close: () => void;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function resolveRateLimitOptions(host: string, env: NodeJS.ProcessEnv = process.env): RateLimitOptions {
  // RATE_LIMIT_ENABLED, when set, always wins over the bind-based default in
  // either direction. Only the exact value "true" (trimmed, case-insensitive)
  // enables it; any other value present (e.g. "1", "yes") disables it.
  const override = env.RATE_LIMIT_ENABLED;
  const enabled = override === undefined ? !isLoopback(host) : override.trim().toLowerCase() === "true";
  return {
    enabled,
    windowMs: numberFromEnv(env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    max: numberFromEnv(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
    maxTrackedClients: MAX_TRACKED_CLIENTS,
  };
}

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  if (!options.enabled) {
    return {
      middleware: (_req, _res, next) => next(),
      size: () => 0,
      close: () => {},
    };
  }

  const entries = new Map<string, { count: number; resetAt: number }>();

  const sweepHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }, options.windowMs);
  sweepHandle.unref?.();

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const entry = entries.get(key);

    if (!entry || now >= entry.resetAt) {
      if (!entries.has(key) && entries.size >= options.maxTrackedClients) {
        const oldestKey = entries.keys().next().value;
        if (oldestKey !== undefined) entries.delete(oldestKey);
      }
      entries.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      jsonRpcError(res, 429, -32000, "Too many requests.");
      return;
    }
    next();
  }

  return {
    middleware,
    size: () => entries.size,
    close: () => clearInterval(sweepHandle),
  };
}

export interface HttpApp {
  app: Express;
  close: () => void;
}

export function buildApp({ host }: Pick<HttpOptions, "host">, env: NodeJS.ProcessEnv = process.env): HttpApp {
  const limiter = createRateLimiter(resolveRateLimitOptions(host, env));
  const app = express();

  app.use(limiter.middleware);
  app.use(express.json({ limit: "8mb" }));

  app.post("/mcp", async (req: Request, res: Response) => {
    if (!originAllowed(req, host)) {
      jsonRpcError(res, 403, -32000, "Forbidden origin (DNS-rebinding protection).");
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

  return { app, close: limiter.close };
}

export async function runHttp({ port, host }: HttpOptions): Promise<void> {
  const { app } = buildApp({ host });
  await new Promise<void>((resolve) => app.listen(port, host, () => resolve()));
  console.error(`designer-skill-mcp: HTTP transport on http://${host}:${port}/mcp`);
}
