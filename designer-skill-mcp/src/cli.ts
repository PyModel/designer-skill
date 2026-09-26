import { parseArgs } from "node:util";

export type CliCommand =
  | { kind: "run"; http: boolean; port: number; host: string; roots: string[]; allowedHosts: string[]; notifyUpdates: boolean }
  | { kind: "version" }
  | { kind: "check-update" }
  | { kind: "help" }
  | { kind: "error"; message: string };

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 0 && port <= 65_535 ? port : null;
}

export function parseCli(argv: string[]): CliCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(2),
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        "check-update": { type: "boolean" },
        http: { type: "boolean" },
        port: { type: "string" },
        host: { type: "string" },
        root: { type: "string", multiple: true },
        "allowed-host": { type: "string", multiple: true },
        "no-update-notifier": { type: "boolean" },
      },
    });
  } catch (error) {
    return { kind: "error", message: (error as Error).message };
  }
  const { values } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };
  if (values["check-update"]) return { kind: "check-update" };
  const rawPort = values.port ?? process.env.PORT ?? "3017";
  const port = parsePort(rawPort);
  if (port === null) return { kind: "error", message: `Invalid port "${rawPort}": expected an integer from 0 to 65535.` };
  const allowedHosts = values["allowed-host"] ?? [];
  const badHost = allowedHosts.find((h) => hostnameOf(h) !== h);
  if (badHost !== undefined) {
    // The SDK compares the Host header's parsed hostname exactly: a port or upper case never matches.
    return { kind: "error", message: `Invalid --allowed-host "${badHost}": expected a lowercase hostname without a port.` };
  }
  const envRoots = (process.env.DESIGNER_SKILL_ROOTS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  return {
    kind: "run",
    http: !!values.http,
    port,
    host: values.host ?? "127.0.0.1",
    roots: [...(values.root ?? []), ...envRoots],
    allowedHosts,
    notifyUpdates: !values["no-update-notifier"],
  };
}

function hostnameOf(value: string): string | null {
  try { return new URL(`http://${value}`).hostname; } catch { return null; }
}

export const HELP_TEXT = `designer-skill-mcp — plug-and-play MCP for UI design superpowers

Usage:
  designer-skill-mcp                 Start stdio MCP server (default)
  designer-skill-mcp --http          Start Streamable HTTP transport
  designer-skill-mcp --http --port 3017 --host 127.0.0.1

Flags:
  --root <dir>           Authorize a project root (repeatable; also DESIGNER_SKILL_ROOTS=a,b).
                         Without it, stdio clients' MCP roots are honored when declared.
  --port <n>, --port=<n> HTTP port (default 3017, or PORT)
  --host <addr>          HTTP bind address (default 127.0.0.1). HTTP mode requires at least
                         one --root; a non-loopback address also requires DESIGNER_SKILL_HTTP_TOKEN.
  --allowed-host <name>  Extra hostname (no port) accepted in the Host header (repeatable);
                         a loopback bind always accepts its own loopback names
  --version, -v          Print version and exit
  --check-update         Check npm for a newer release and exit
  --no-update-notifier   Skip update checks (also NO_UPDATE_NOTIFIER=1)
  --help, -h             Show this help

Environment:
  DESIGNER_SKILL_HTTP_TOKEN        Bearer token required on every HTTP request when set
  DESIGNER_SKILL_SCAN_TIMEOUT_MS   Per-scan deadline in ms (default 60000)
`;
