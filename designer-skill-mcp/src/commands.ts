// One registry feeds command discovery, aliases, dispatch and reference routing.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isReferenceName, type ReferenceName } from "./skill.js";
import { DesignError } from "./scope.js";

export interface CommandMeta {
  description: string;
  argumentHint: string;
  aliases: string[];
  cues: string[];
  reads: ReferenceName[];
}

export function validateCommandMetadata(value: unknown): Record<string, CommandMeta> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
    throw new DesignError("REGISTRY_INVALID", "Command registry must be a nonempty object.");
  }
  const metadata = value as Record<string, CommandMeta>;
  const names = new Set(Object.keys(metadata));
  const fail = () => { throw new DesignError("REGISTRY_INVALID", "Invalid command metadata, duplicate alias, or unknown reference."); };
  for (const [verb, item] of Object.entries(metadata)) {
    if (!/^[a-z][a-z-]*$/.test(verb) || !item || typeof item !== "object" ||
      typeof item.description !== "string" || !item.description.trim() || typeof item.argumentHint !== "string") fail();
    for (const field of ["aliases", "cues", "reads"] as const) {
      const entries = item[field];
      if (!Array.isArray(entries) || entries.some((s) => typeof s !== "string" || !s.trim()) || new Set(entries).size !== entries.length) fail();
    }
    if (!item.cues.length || !item.reads.length || item.reads.some((r) => !isReferenceName(r))) fail();
    for (const alias of item.aliases) {
      if (!/^[a-z][a-z-]*$/.test(alias) || names.has(alias)) fail();
      names.add(alias);
    }
  }
  return metadata;
}

let cache: Record<string, CommandMeta> | undefined;
export function getCommandMetadata(): Record<string, CommandMeta> {
  if (cache) return cache;
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [join(pkgRoot, "assets", "skill", "scripts", "command-metadata.json"),
    resolve(pkgRoot, "..", "skills", "designer-skill", "scripts", "command-metadata.json")];
  const path = candidates.find(existsSync);
  if (!path) throw new DesignError("REGISTRY_INVALID", "Command registry missing. Run npm run sync-skill.");
  cache = validateCommandMetadata(JSON.parse(readFileSync(path, "utf8")));
  return cache;
}

export function resolveCommandVerb(verb: string): { canonical: string; alias?: string } {
  const key = verb.trim().toLowerCase();
  const meta = getCommandMetadata();
  if (Object.hasOwn(meta, key)) return { canonical: key };
  for (const [canonical, entry] of Object.entries(meta)) {
    if (entry.aliases.includes(key)) return { canonical, alias: key };
  }
  throw new DesignError("UNKNOWN_COMMAND", `Unknown command "${verb}". Use list_commands or dispatch_intent.`);
}

export function listCommands(): { verb: string; description: string; argumentHint: string }[] {
  return Object.entries(getCommandMetadata()).map(([verb, { description, argumentHint }]) => ({ verb, description, argumentHint }));
}
export function getCommandReads(verb: string): ReferenceName[] {
  return [...getCommandMetadata()[resolveCommandVerb(verb).canonical].reads];
}
export function formatCommandHelp(verb: string): string {
  const { canonical, alias } = resolveCommandVerb(verb);
  const meta = getCommandMetadata()[canonical];
  return [`# designer-skill command: ${canonical}`, alias ? `${alias} is an alias for ${canonical}.` : "",
    meta.description, meta.argumentHint, `Read before acting: ${meta.reads.map((r) => `reference/${r}.md`).join(", ")}`,
    "Preserve user scope. Static review_and_gate results do not certify rendered UI readiness."].filter(Boolean).join("\n\n");
}
