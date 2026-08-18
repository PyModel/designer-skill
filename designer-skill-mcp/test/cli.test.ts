import { describe, it, expect } from "vitest";
import { HELP_TEXT, parseCli } from "../src/cli.js";
import { formatUpdateStatus } from "../src/update-check.js";

describe("parseCli", () => {
  it("parses --version", () => {
    expect(parseCli(["node", "index.js", "--version"])).toEqual({ kind: "version" });
  });

  it("parses -v", () => {
    expect(parseCli(["node", "index.js", "-v"])).toEqual({ kind: "version" });
  });

  it("parses --check-update", () => {
    expect(parseCli(["node", "index.js", "--check-update"])).toEqual({ kind: "check-update" });
  });

  it("parses --help", () => {
    expect(parseCli(["node", "index.js", "--help"])).toEqual({ kind: "help" });
  });

  it("defaults to stdio run mode", () => {
    expect(parseCli(["node", "index.js"])).toEqual({
      kind: "run",
      http: false,
      port: 3017,
      host: "127.0.0.1",
      notifyUpdates: true,
    });
  });

  it("parses http transport flags", () => {
    expect(parseCli(["node", "index.js", "--http", "--port", "4000", "--host", "0.0.0.0"])).toEqual({
      kind: "run",
      http: true,
      port: 4000,
      host: "0.0.0.0",
      notifyUpdates: true,
    });
  });

  it("disables update notifier with --no-update-notifier", () => {
    const command = parseCli(["node", "index.js", "--no-update-notifier"]);
    expect(command).toMatchObject({ kind: "run", notifyUpdates: false });
  });
});

describe("formatUpdateStatus", () => {
  it("reports latest when versions match", () => {
    expect(formatUpdateStatus({ name: "@pymodel/designer-skill-mcp", current: "0.9.0", latest: "0.9.0", type: "latest" })).toBe(
      "0.9.0 (latest)",
    );
  });

  it("reports upgrade path when a newer version exists", () => {
    expect(
      formatUpdateStatus({ name: "@pymodel/designer-skill-mcp", current: "0.8.0", latest: "0.9.0", type: "minor" }),
    ).toBe("0.8.0 → 0.9.0 available (minor)\nRun: npx -y @pymodel/designer-skill-mcp@latest");
  });
});

describe("HELP_TEXT", () => {
  it("documents version and update flags", () => {
    expect(HELP_TEXT).toContain("--version");
    expect(HELP_TEXT).toContain("--check-update");
    expect(HELP_TEXT).toContain("NO_UPDATE_NOTIFIER");
  });
});
