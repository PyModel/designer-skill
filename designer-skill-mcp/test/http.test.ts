import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  createRateLimiter,
  DEFAULT_RATE_LIMIT_MAX,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  resolveRateLimitOptions,
  type RateLimiter,
} from "../src/transports/http.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeReqRes(ip: string) {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let jsonBody: unknown = null;
  const req = { ip } as unknown as Parameters<RateLimiter["middleware"]>[0];
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
  } as unknown as Parameters<RateLimiter["middleware"]>[1];
  return {
    req,
    res,
    headers,
    get statusCode() {
      return statusCode;
    },
    get jsonBody() {
      return jsonBody;
    },
  };
}

describe("resolveRateLimitOptions", () => {
  it("defaults to disabled on loopback hosts with no env override", () => {
    expect(resolveRateLimitOptions("127.0.0.1", {}).enabled).toBe(false);
    expect(resolveRateLimitOptions("localhost", {}).enabled).toBe(false);
    expect(resolveRateLimitOptions("::1", {}).enabled).toBe(false);
  });

  it("defaults to enabled on a non-loopback host with no env override", () => {
    expect(resolveRateLimitOptions("0.0.0.0", {}).enabled).toBe(true);
  });

  it("RATE_LIMIT_ENABLED=true forces on for a loopback host", () => {
    expect(resolveRateLimitOptions("127.0.0.1", { RATE_LIMIT_ENABLED: "true" }).enabled).toBe(true);
  });

  it("RATE_LIMIT_ENABLED set to a non-true value forces off for a non-loopback host", () => {
    expect(resolveRateLimitOptions("0.0.0.0", { RATE_LIMIT_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveRateLimitOptions("0.0.0.0", { RATE_LIMIT_ENABLED: "1" }).enabled).toBe(false);
  });

  it("reads window/max from env, falling back to defaults when absent or non-numeric", () => {
    expect(resolveRateLimitOptions("0.0.0.0", {}).windowMs).toBe(DEFAULT_RATE_LIMIT_WINDOW_MS);
    expect(resolveRateLimitOptions("0.0.0.0", {}).max).toBe(DEFAULT_RATE_LIMIT_MAX);
    expect(resolveRateLimitOptions("0.0.0.0", { RATE_LIMIT_WINDOW_MS: "5000", RATE_LIMIT_MAX: "3" })).toMatchObject({
      windowMs: 5000,
      max: 3,
    });
    expect(resolveRateLimitOptions("0.0.0.0", { RATE_LIMIT_WINDOW_MS: "abc" }).windowMs).toBe(
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    );
  });
});

describe("createRateLimiter", () => {
  let limiter: RateLimiter | null = null;

  afterEach(() => {
    limiter?.close();
    limiter = null;
  });

  it("allows requests under the limit", () => {
    limiter = createRateLimiter({ enabled: true, windowMs: 60_000, max: 3, maxTrackedClients: 100 });
    for (let i = 0; i < 3; i++) {
      const { req, res, statusCode } = fakeReqRes("1.1.1.1");
      let nextCalled = false;
      limiter.middleware(req, res, () => (nextCalled = true));
      expect(nextCalled).toBe(true);
      expect(statusCode).toBe(0);
    }
  });

  it("returns 429 with Retry-After after exceeding the limit", () => {
    limiter = createRateLimiter({ enabled: true, windowMs: 60_000, max: 1, maxTrackedClients: 100 });
    const first = fakeReqRes("2.2.2.2");
    limiter.middleware(first.req, first.res, () => {});

    const second = fakeReqRes("2.2.2.2");
    let nextCalled = false;
    limiter.middleware(second.req, second.res, () => (nextCalled = true));

    expect(nextCalled).toBe(false);
    expect(second.statusCode).toBe(429);
    expect(second.jsonBody).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("resets the window after windowMs elapses", async () => {
    limiter = createRateLimiter({ enabled: true, windowMs: 20, max: 1, maxTrackedClients: 100 });
    const key = "3.3.3.3";
    limiter.middleware(fakeReqRes(key).req, fakeReqRes(key).res, () => {});
    const throttled = fakeReqRes(key);
    limiter.middleware(throttled.req, throttled.res, () => {});
    expect(throttled.statusCode).toBe(429);

    await sleep(30);

    const afterReset = fakeReqRes(key);
    let nextCalled = false;
    limiter.middleware(afterReset.req, afterReset.res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    expect(afterReset.statusCode).toBe(0);
  });

  it("caps tracked clients and evicts the oldest FIFO", () => {
    limiter = createRateLimiter({ enabled: true, windowMs: 60_000, max: 100, maxTrackedClients: 5 });
    for (let i = 0; i < 1000; i++) {
      const { req, res } = fakeReqRes(`10.0.0.${i}`);
      limiter.middleware(req, res, () => {});
      expect(limiter.size()).toBeLessThanOrEqual(5);
    }
    expect(limiter.size()).toBe(5);

    // The earliest key was evicted, so it starts a fresh window (not throttled).
    const early = fakeReqRes("10.0.0.0");
    let nextCalled = false;
    limiter.middleware(early.req, early.res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);

    // The most recent key is still tracked (its count increments).
    const recent = fakeReqRes("10.0.0.999");
    let recentNextCalled = false;
    limiter.middleware(recent.req, recent.res, () => (recentNextCalled = true));
    expect(recentNextCalled).toBe(true);
  });

  it("sweeps expired entries over time", async () => {
    limiter = createRateLimiter({ enabled: true, windowMs: 20, max: 100, maxTrackedClients: 100 });
    for (let i = 0; i < 10; i++) {
      const { req, res } = fakeReqRes(`20.0.0.${i}`);
      limiter.middleware(req, res, () => {});
    }
    expect(limiter.size()).toBe(10);

    await sleep(40);

    expect(limiter.size()).toBe(0);
  });

  it("is a total no-op when disabled", () => {
    limiter = createRateLimiter({ enabled: false, windowMs: 60_000, max: 1, maxTrackedClients: 1 });
    for (let i = 0; i < 50; i++) {
      const { req, res } = fakeReqRes("30.0.0.1");
      let nextCalled = false;
      limiter.middleware(req, res, () => (nextCalled = true));
      expect(nextCalled).toBe(true);
    }
    expect(limiter.size()).toBe(0);
    expect(() => limiter?.close()).not.toThrow();
  });
});

describe("buildApp (integration)", () => {
  let stop: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (stop) await stop();
    stop = null;
  });

  async function startTestApp(host: string, env: NodeJS.ProcessEnv): Promise<string> {
    const { app, close } = buildApp({ host }, env);
    const server = app.listen(0, host);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    stop = async () => {
      close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };
    return `http://${host}:${port}`;
  }

  it("never rate-limits the default loopback bind, even past a tight max", async () => {
    const origin = await startTestApp("127.0.0.1", { RATE_LIMIT_MAX: "2" });
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).not.toBe(429);
    }
  });

  it("rate-limits on loopback when RATE_LIMIT_ENABLED=true", async () => {
    const origin = await startTestApp("127.0.0.1", {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_MAX: "2",
      RATE_LIMIT_WINDOW_MS: "60000",
    });
    let lastStatus = 0;
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${origin}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("429 response has Retry-After header and JSON-RPC error body", async () => {
    const origin = await startTestApp("127.0.0.1", {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_MAX: "1",
      RATE_LIMIT_WINDOW_MS: "60000",
    });
    await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
  });

  it("resets the window over the wire", async () => {
    const origin = await startTestApp("127.0.0.1", {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_MAX: "1",
      RATE_LIMIT_WINDOW_MS: "50",
    });
    const post = () =>
      fetch(`${origin}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });

    expect((await post()).status).not.toBe(429);
    expect((await post()).status).toBe(429);

    await sleep(60);

    expect((await post()).status).not.toBe(429);
  });

  it("runs the rate limiter before JSON body parsing", async () => {
    const origin = await startTestApp("127.0.0.1", {
      RATE_LIMIT_ENABLED: "true",
      RATE_LIMIT_MAX: "1",
      RATE_LIMIT_WINDOW_MS: "60000",
    });
    // First request consumes the quota.
    await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    // Second request has a malformed body; if express.json() ran before the
    // limiter, this would surface as a body-parse error rather than our
    // rate limiter's JSON-RPC 429 shape.
    const res = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 }, id: null });
  });
});
