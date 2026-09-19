// Command metadata (descriptions + argument hints) for designer-skill MCP.
// Verb → reads routing is NOT defined here — dispatch.ts owns the registry
// (VERB_REGISTRY); this module derives from it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledFile } from "./assets.js";
import { COMMAND_ALIASES, readsFor } from "./dispatch.js";

export interface CommandMeta {
  description: string;
  argumentHint: string;
}

export { COMMAND_ALIASES };

let metadataCache: Record<string, CommandMeta> | null = null;

export function getCommandMetadata(): Record<string, CommandMeta> {
  if (metadataCache) return metadataCache;
  const metadataPath = bundledFile("skill", join("scripts", "command-metadata.json"));
  metadataCache = JSON.parse(readFileSync(metadataPath, "utf8")) as Record<
    string,
    CommandMeta
  >;
  return metadataCache;
}

export function resolveCommandVerb(verb: string): { canonical: string; alias?: string } {
  const key = verb.toLowerCase();
  const canonical = COMMAND_ALIASES[key] ?? key;
  return { canonical, alias: canonical !== key ? key : undefined };
}

export function listCommands(): { verb: string; description: string; argumentHint: string }[] {
  const meta = getCommandMetadata();
  return Object.entries(meta).map(([verb, m]) => ({
    verb,
    description: m.description,
    argumentHint: m.argumentHint,
  }));
}

export function getCommandReads(verb: string): string[] {
  const { canonical } = resolveCommandVerb(verb);
  return readsFor(canonical);
}

export function formatCommandHelp(verb: string): string {
  const { canonical, alias } = resolveCommandVerb(verb);
  const meta = getCommandMetadata()[canonical];
  if (!meta) {
    return `Unknown command "${verb}". Call list_commands for all verbs, or dispatch_intent with a natural-language request.`;
  }
  const reads = getCommandReads(canonical);
  const lines = [
    `# designer-skill command: ${canonical}`,
    "",
    alias ? `> \`${alias}\` is an alias for \`${canonical}\`.` : "",
    meta.description,
    meta.argumentHint ? `\nArgument hint: \`${meta.argumentHint}\`` : "",
    "",
    `Read before acting: ${reads.join(", ")}`,
    "",
    "Always run the anti-slop ship gate (`anti_slop_checklist` or `reference/avoid-ai-slop.md`) before declaring UI work done.",
  ];
  return lines.filter(Boolean).join("\n");
}
