// Tarball smoke test: the real published surface, exercised through the
// server's interface. Packs the package (same command npm publish uses),
// extracts the tarball, and connects a client to the extracted server.
// This is the test that catches "forgot the files whitelist" before publish.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SHIPPED_DIR_ROOTS } from "../scripts/shipped-roots.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = existsSync(join(pkgRoot, "dist", "index.js"));

describe.skipIf(!built)("npm pack smoke test (requires npm run build first)", () => {
  const workDir = mkdtempSync(join(tmpdir(), "dsmcp-pack-"));
  let extracted = "";

  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function tarballPath(): string {
    const tgzs = readdirSync(workDir).filter((f) => f.endsWith(".tgz"));
    expect(tgzs.length).toBeGreaterThan(0);
    return join(workDir, tgzs[0]!);
  }

  it("packs the package", () => {
    execFileSync("npm", ["pack", "--pack-destination", workDir], { cwd: pkgRoot, stdio: "pipe" });
    expect(existsSync(tarballPath())).toBe(true);
  }, 120_000);

  it("tarball contains every shipped root", () => {
    const listing = execFileSync("tar", ["-tzf", tarballPath()], { encoding: "utf8" });
    for (const root of SHIPPED_DIR_ROOTS) {
      // Tarball paths are prefixed with "package/".
      expect(listing, `tarball is missing files under ${root}`).toContain(`package/${root}/`);
    }
  });

  it("extracted server serves designer-skill and ux-designer references", async () => {
    extracted = join(workDir, "extracted");
    mkdirSync(extracted);
    execFileSync("tar", ["-xzf", tarballPath(), "-C", extracted], { stdio: "pipe" });
    // The tarball ships no node_modules; link the workspace's so the server can
    // resolve the SDK. The paths under test are the bundled assets, which the
    // server resolves relative to its own location inside the extracted tree.
    symlinkSync(join(pkgRoot, "node_modules"), join(extracted, "package", "node_modules"), "junction");

    const { createServer } = (await import(
      pathToFileURL(join(extracted, "package", "dist", "server.js")).href
    )) as typeof import("../src/server.js");
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "pack-smoke", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const name of ["avoid-ai-slop", "ux/03-accessibility"]) {
      const res = await client.callTool({ name: "get_reference", arguments: { name } });
      const text = (res.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n");
      expect(text.length, `get_reference(${name}) should return the bundled file`).toBeGreaterThan(200);
    }
  }, 120_000);
});
