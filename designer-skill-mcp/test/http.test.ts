import { afterEach, describe, expect, it, vi } from "vitest";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertHttpExposure, runHttp } from "../src/transports/http.js";

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function start(options: Partial<Parameters<typeof runHttp>[0]> = {}) {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const server = await runHttp({ port: 0, host: "127.0.0.1", roots: [], allowedHosts: [], ...options });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

const initialize = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
};
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(url, {
  method: "POST", body: JSON.stringify(body),
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
});

describe("HTTP exposure policy", () => {
  it("allows loopback binds without a token", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) expect(() => assertHttpExposure({ host, roots: [] })).not.toThrow();
  });
  it("requires a token and a root for any other bind", () => {
    expect(() => assertHttpExposure({ host: "0.0.0.0", roots: ["/srv"] })).toThrow(/DESIGNER_SKILL_HTTP_TOKEN/);
    expect(() => assertHttpExposure({ host: "0.0.0.0", roots: [], token: "t" })).toThrow(/--root/);
    expect(() => assertHttpExposure({ host: "0.0.0.0", roots: ["/srv"], token: "t" })).not.toThrow();
  });
});

describe("HTTP transport", () => {
  it("serves initialize over POST /mcp and refuses GET", async () => {
    const url = await start();
    const res = await post(url, initialize);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("designer-skill");
    expect((await fetch(url)).status).toBe(405);
  });
  it("rejects a foreign Host header on a loopback bind", async () => {
    const url = new URL(await start());
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: url.port, path: "/mcp", method: "POST",
        headers: { host: "evil.example", "content-type": "application/json", accept: "application/json, text/event-stream" } },
      (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end(JSON.stringify(initialize));
    });
    expect(status).toBe(403);
  });
  it("rejects oversized JSON bodies", async () => {
    const url = await start();
    const res = await post(url, { ...initialize, pad: "x".repeat(200_000) });
    expect(res.status).toBe(413);
  });
  it("requires the bearer token when configured", async () => {
    const url = await start({ token: "s3cret" });
    expect((await post(url, initialize)).status).toBe(401);
    expect((await post(url, initialize, { authorization: "Bearer wrong!" })).status).toBe(401);
    expect((await post(url, initialize, { authorization: "Bearer s3cret" })).status).toBe(200);
  });
  it("rejects a port that is already in use instead of hanging", async () => {
    const url = await start();
    const port = Number(new URL(url).port);
    await expect(runHttp({ port, host: "127.0.0.1", roots: [], allowedHosts: [] })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
  it("confines tools/call cwd to --root", async () => {
    const allowed = mkdtempSync(join(tmpdir(), "designer-http-")), other = mkdtempSync(join(tmpdir(), "designer-http-"));
    dirs.push(allowed, other);
    const url = await start({ roots: [allowed] });
    const call = (cwd: string) => post(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "load_project_context", arguments: { cwd } } });
    await post(url, initialize);
    expect(await (await call(allowed)).text()).not.toContain("SCOPE_VIOLATION");
    expect(await (await call(other)).text()).toContain("SCOPE_VIOLATION");
  });
});
