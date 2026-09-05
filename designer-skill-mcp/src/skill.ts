// Read only the requested document. Reference discovery must not load the library.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const REFERENCE_NAMES = [
  "design-principles", "aesthetic-systems", "motion-and-interaction", "engineering-and-performance",
  "avoid-ai-slop", "differentiation-playbook", "refactor-and-redesign", "command-playbook",
  "interaction-design", "visual-critique", "design-systems", "project-init", "craft-flow", "live-mode", "css-techniques",
] as const;
export type ReferenceName = (typeof REFERENCE_NAMES)[number];
export const REFERENCE_DESCRIPTIONS: Record<ReferenceName, string> = {
  "design-principles": "Visual fundamentals: hierarchy, typography, spacing and contrast.",
  "aesthetic-systems": "Optional visual-language examples; preserve approved identity.",
  "motion-and-interaction": "Purposeful motion and reduced-motion alternatives.",
  "engineering-and-performance": "Framework-aware implementation, accessibility and measurement.",
  "avoid-ai-slop": "Advisory style critique, truthful content and output completeness.",
  "differentiation-playbook": "Optional creative-direction exercises for appropriate tasks.",
  "refactor-and-redesign": "Improve existing interfaces while preserving behavior.",
  "command-playbook": "Command discovery and scope-aware dispatch.",
  "interaction-design": "Forms, navigation, states and recovery.",
  "visual-critique": "Hierarchy, clarity, affordance and identity review.",
  "design-systems": "Tokens, component contracts, themes and compatibility.",
  "project-init": "Optional project discovery and context setup.",
  "craft-flow": "Scope-adaptive implementation and verification workflow.",
  "live-mode": "Authorized browser preview and variant iteration.",
  "css-techniques": "Supported CSS implementation patterns.",
};
function resolveSkillDir(): string {
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dirs = [join(pkgRoot, "assets", "skill"), resolve(pkgRoot, "..", "skills", "designer-skill")];
  const dir = dirs.find((path) => existsSync(join(path, "SKILL.md")));
  if (!dir) throw new Error("Skill content missing. Run npm run sync-skill.");
  return dir;
}
const cache = new Map<string, string>();
function readDocument(path: string): string {
  const dir = resolveSkillDir();
  const full = join(dir, path);
  let content = cache.get(full);
  if (content === undefined) {
    content = readFileSync(full, "utf8");
    cache.set(full, content);
  }
  return content;
}
export function getSkillRouter(): string { return readDocument("SKILL.md"); }
export function isReferenceName(value: string): value is ReferenceName {
  return (REFERENCE_NAMES as readonly string[]).includes(value);
}
export function getReferenceDoc(name: ReferenceName): string {
  if (!isReferenceName(name)) throw new Error("Unknown reference.");
  return readDocument(`reference/${name}.md`);
}
