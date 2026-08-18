export type CliCommand =
  | { kind: "run"; http: boolean; port: number; host: string; notifyUpdates: boolean }
  | { kind: "version" }
  | { kind: "check-update" }
  | { kind: "help" };

function flagValue(args: string[], flag: string, fallback: string): string {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

export function parseCli(argv: string[]): CliCommand {
  const args = argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (args.includes("--version") || args.includes("-v")) return { kind: "version" };
  if (args.includes("--check-update")) return { kind: "check-update" };

  return {
    kind: "run",
    http: args.includes("--http"),
    port: Number(flagValue(args, "--port", process.env.PORT ?? "3017")),
    host: flagValue(args, "--host", "127.0.0.1"),
    notifyUpdates: !args.includes("--no-update-notifier"),
  };
}

export const HELP_TEXT = `designer-skill-mcp — plug-and-play MCP for UI design superpowers

Usage:
  designer-skill-mcp                 Start stdio MCP server (default)
  designer-skill-mcp --http          Start Streamable HTTP transport
  designer-skill-mcp --http --port 3017 --host 127.0.0.1

Flags:
  --version, -v          Print version and exit
  --check-update         Check npm for a newer release and exit
  --no-update-notifier   Skip background update notifications
  --help, -h             Show this help

Upgrade:
  npx -y @pymodel/designer-skill-mcp@latest

Opt out of update checks globally:
  NO_UPDATE_NOTIFIER=1
`;
