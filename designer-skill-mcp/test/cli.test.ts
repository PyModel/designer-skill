import { afterEach, describe, it, expect, onTestFinished, vi } from "vitest";
import { HELP_TEXT, parseCli } from "../src/cli.js";
import { formatUpdateStatus, isNewer, notifyAvailableUpdate } from "../src/update-check.js";

const run = (...args: string[]) => parseCli(["node", "index.js", ...args]);

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("parseCli", () => {
  it("parses info flags", () => {
    expect(run("--version")).toEqual({ kind: "version" });
    expect(run("-v")).toEqual({ kind: "version" });
    expect(run("--check-update")).toEqual({ kind: "check-update" });
    expect(run("--help")).toEqual({ kind: "help" });
    expect(run("-h")).toEqual({ kind: "help" });
  });

  it("defaults to stdio run mode", () => {
    vi.stubEnv("PORT", undefined);
    vi.stubEnv("DESIGNER_SKILL_ROOTS", undefined);
    expect(run()).toEqual({
      kind: "run", http: false, port: 3017, host: "127.0.0.1", roots: [], allowedHosts: [], notifyUpdates: true,
    });
  });

  it("parses http transport flags in both spellings", () => {
    vi.stubEnv("DESIGNER_SKILL_ROOTS", undefined);
    const expected = {
      kind: "run", http: true, port: 4000, host: "0.0.0.0", roots: ["/srv/app"], allowedHosts: ["design.example"], notifyUpdates: true,
    };
    expect(run("--http", "--port", "4000", "--host", "0.0.0.0", "--root", "/srv/app", "--allowed-host", "design.example")).toEqual(expected);
    expect(run("--http", "--port=4000", "--host=0.0.0.0", "--root=/srv/app", "--allowed-host=design.example")).toEqual(expected);
  });

  it("rejects --allowed-host values the SDK's hostname match can never accept", () => {
    for (const host of ["design.example:3017", "Design.Example", "http://design.example", "a b"]) {
      expect(run("--allowed-host", host), host).toMatchObject({ kind: "error" });
    }
    expect(run("--allowed-host", "[::1]", "--allowed-host", "10.0.0.5")).toMatchObject({ allowedHosts: ["[::1]", "10.0.0.5"] });
  });

  it("collects repeated and environment roots", () => {
    vi.stubEnv("DESIGNER_SKILL_ROOTS", " /c , ,/d");
    expect(run("--root", "/a", "--root", "/b")).toMatchObject({ roots: ["/a", "/b", "/c", "/d"] });
  });

  it("rejects invalid ports instead of binding somewhere else", () => {
    for (const port of ["abc", "-1", "65536", "80.5", ""]) {
      expect(run("--port", port)).toMatchObject({ kind: "error" });
    }
    vi.stubEnv("PORT", "nope");
    expect(run()).toMatchObject({ kind: "error" });
  });

  it("rejects unknown flags and positionals", () => {
    expect(run("--htpp")).toMatchObject({ kind: "error" });
    expect(run("serve")).toMatchObject({ kind: "error" });
  });

  it("disables update notifier with --no-update-notifier", () => {
    expect(run("--no-update-notifier")).toMatchObject({ kind: "run", notifyUpdates: false });
  });
});

describe("update check", () => {
  it("compares semver numerically", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("garbage", "1.0.0")).toBe(false);
  });

  it("reports latest when versions match", () => {
    expect(formatUpdateStatus({ current: "0.9.0", latest: "0.9.0" })).toBe("0.9.0 (latest)");
  });

  it("reports upgrade path when a newer version exists", () => {
    expect(formatUpdateStatus({ current: "0.8.0", latest: "0.9.0" }))
      .toBe("0.8.0 → 0.9.0 available\nRun: npx -y @pymodel/designer-skill-mcp@latest");
  });

  it("never reports an older registry version as an upgrade", () => {
    expect(formatUpdateStatus({ current: "0.9.0", latest: "0.8.0" })).toBe("0.9.0 (latest)");
  });

  it("says why an interactive update check failed instead of staying silent", async () => {
    vi.stubEnv("CI", undefined); vi.stubEnv("NO_UPDATE_NOTIFIER", undefined);
    const tty = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    onTestFinished(() => {
      if (tty) Object.defineProperty(process.stderr, "isTTY", tty);
      else Reflect.deleteProperty(process.stderr, "isTTY");
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND registry.npmjs.org")));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await notifyAvailableUpdate();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("update check failed (getaddrinfo ENOTFOUND registry.npmjs.org)"));
  });
});

describe("HELP_TEXT", () => {
  it("documents flags and environment", () => {
    for (const text of ["--version", "--check-update", "--root", "--allowed-host", "NO_UPDATE_NOTIFIER",
      "DESIGNER_SKILL_HTTP_TOKEN", "DESIGNER_SKILL_ROOTS", "DESIGNER_SKILL_SCAN_TIMEOUT_MS"]) {
      expect(HELP_TEXT).toContain(text);
    }
  });
});
