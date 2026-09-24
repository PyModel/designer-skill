import { afterEach, describe, it, expect, vi } from "vitest";
import { HELP_TEXT, parseCli } from "../src/cli.js";
import { formatUpdateStatus, isNewer } from "../src/update-check.js";

const run = (...args: string[]) => parseCli(["node", "index.js", ...args]);

afterEach(() => { vi.unstubAllEnvs(); });

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
});

describe("HELP_TEXT", () => {
  it("documents flags and environment", () => {
    for (const text of ["--version", "--check-update", "--root", "--allowed-host", "NO_UPDATE_NOTIFIER",
      "DESIGNER_SKILL_HTTP_TOKEN", "DESIGNER_SKILL_ROOTS", "DESIGNER_SKILL_SCAN_TIMEOUT_MS"]) {
      expect(HELP_TEXT).toContain(text);
    }
  });
});
