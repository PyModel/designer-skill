// Command metadata and verb → reference routing for designer-skill MCP.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReferenceId } from "./skill.js";

export interface CommandMeta {
  description: string;
  argumentHint: string;
}

/** Legacy verb names → canonical command. */
export const COMMAND_ALIASES: Record<string, string> = {
  init: "setup",
  craft: "build",
  shape: "plan",
  live: "preview",
  document: "spec",
  audit: "check",
  critique: "review",
  score: "review",
  typeset: "type",
  colorize: "color",
  animate: "motion",
  adapt: "responsive",
  distill: "simplify",
  clarify: "copy",
  harden: "ship",
  optimize: "speed",
  extract: "tokens",
  redesign: "refresh",
  variants: "options",
  polish: "finish",
  bolder: "amplify",
  quieter: "calm",
  overdrive: "push",
  navigate: "nav",
  feel: "tone",
};

/** Maps a design verb to the reference file(s) an agent should read. */
export const COMMAND_READS: Record<string, ReferenceId[]> = {
  setup: ["project-init"],
  plan: ["design-principles", "aesthetic-systems", "differentiation-playbook"],
  build: ["craft-flow", "design-principles", "aesthetic-systems", "differentiation-playbook", "engineering-and-performance", "avoid-ai-slop"],
  preview: ["live-mode"],
  spec: ["refactor-and-redesign"],
  check: ["engineering-and-performance", "avoid-ai-slop", "refactor-and-redesign", "ux/03-accessibility"],
  review: ["design-principles", "avoid-ai-slop", "visual-critique"],
  finish: ["design-principles", "engineering-and-performance"],
  amplify: ["aesthetic-systems", "differentiation-playbook", "avoid-ai-slop"],
  calm: ["design-principles", "aesthetic-systems"],
  push: ["motion-and-interaction", "engineering-and-performance"],
  motion: ["motion-and-interaction"],
  delight: ["motion-and-interaction", "avoid-ai-slop"],
  layout: ["design-principles"],
  type: ["design-principles"],
  color: ["design-principles", "aesthetic-systems"],
  ship: ["engineering-and-performance", "ux/23-internationalization"],
  speed: ["engineering-and-performance", "ux/22-performance-ux"],
  simplify: ["design-principles"],
  tokens: ["engineering-and-performance", "design-systems"],
  brand: ["aesthetic-systems", "differentiation-playbook", "avoid-ai-slop"],
  responsive: ["engineering-and-performance", "refactor-and-redesign", "ux/08-mobile-ux"],
  refresh: ["refactor-and-redesign", "avoid-ai-slop"],
  copy: ["command-playbook", "avoid-ai-slop", "ux/09-ux-writing"],
  onboard: ["command-playbook", "engineering-and-performance", "ux/16-onboarding"],
  options: ["refactor-and-redesign", "differentiation-playbook", "avoid-ai-slop"],
  form: ["interaction-design", "engineering-and-performance", "ux/07-forms-and-inputs"],
  nav: ["interaction-design", "design-principles", "ux/05-information-architecture"],
  states: ["interaction-design", "engineering-and-performance"],
  tone: ["interaction-design", "motion-and-interaction"],
  system: ["design-systems", "engineering-and-performance"],
};

function resolveScriptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = resolve(here, "..");
  const bundled = join(pkgRoot, "assets", "skill", "scripts");
  if (existsSync(join(bundled, "command-metadata.json"))) return bundled;
  const dev = resolve(pkgRoot, "..", "skills", "designer-skill", "scripts");
  if (existsSync(join(dev, "command-metadata.json"))) return dev;
  throw new Error("command-metadata.json not found. Run npm run sync-skill.");
}

let metadataCache: Record<string, CommandMeta> | null = null;

export function getCommandMetadata(): Record<string, CommandMeta> {
  if (metadataCache) return metadataCache;
  const dir = resolveScriptsDir();
  metadataCache = JSON.parse(readFileSync(join(dir, "command-metadata.json"), "utf8")) as Record<
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

export function getCommandReads(verb: string): ReferenceId[] {
  const { canonical } = resolveCommandVerb(verb);
  const reads = COMMAND_READS[canonical];
  if (!reads) return ["command-playbook", "design-principles"];
  return reads;
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
