// Read only the requested document. Reference discovery must not load the library.
// The ux-designer module's references are namespaced "ux/" so the two registries
// stay disjoint. Both resolve through the shared bundled-asset seam in assets.ts.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bundledRoot } from "./assets.js";
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

// ux-designer reference files, namespaced under "ux/". Files live in the
// ux-designer skill's own references/ directory.
export const UX_REFERENCE_NAMES = [
  "ux/01-core-principles",
  "ux/02-laws-of-ux",
  "ux/03-accessibility",
  "ux/04-visual-design",
  "ux/05-information-architecture",
  "ux/06-interaction-design",
  "ux/07-forms-and-inputs",
  "ux/08-mobile-ux",
  "ux/09-ux-writing",
  "ux/10-user-research",
  "ux/11-design-systems",
  "ux/12a-presence-awareness",
  "ux/12b-conflict-resolution-sync",
  "ux/13a-canvas-navigation",
  "ux/13b-canvas-objects-performance",
  "ux/14-ai-ux-patterns",
  "ux/15-ethical-design",
  "ux/16-onboarding",
  "ux/17-notifications",
  "ux/18-data-visualization",
  "ux/19-search-ux",
  "ux/20-emotional-design",
  "ux/21-data-tables",
  "ux/22-performance-ux",
  "ux/23-internationalization",
  "ux/24-voice-and-multimodal",
] as const;
export type UxReferenceName = (typeof UX_REFERENCE_NAMES)[number];
export const UX_REFERENCE_DESCRIPTIONS: Record<UxReferenceName, string> = {
  "ux/01-core-principles": "Core UX heuristics: user-centered design, calm and clarity, hierarchy of needs.",
  "ux/02-laws-of-ux": "Laws of UX: Fitts, Hick, Miller, Jakob's Law, aesthetic-usability effect.",
  "ux/03-accessibility": "WCAG 2.2 AA: keyboard, focus, contrast, screen readers.",
  "ux/04-visual-design": "Visual design patterns: dominance, typography, spacing scales.",
  "ux/05-information-architecture": "IA: navigation models, wayfinding, sitemaps, content structure.",
  "ux/06-interaction-design": "Interaction patterns: touch targets, feedback, states, gestures.",
  "ux/07-forms-and-inputs": "Form design: inline validation, error messages, field grouping.",
  "ux/08-mobile-ux": "Mobile UX: thumb zones, bottom navigation, touch ergonomics.",
  "ux/09-ux-writing": "UX writing: action labels, error copy, tone of voice.",
  "ux/10-user-research": "User research methods: interviews, usability tests, surveys.",
  "ux/11-design-systems": "Design system creation: foundations, components, governance.",
  "ux/12a-presence-awareness": "Collaborative presence: live cursors, avatars, typing indicators.",
  "ux/12b-conflict-resolution-sync": "Real-time sync UX: conflict resolution, offline state, undo/redo.",
  "ux/13a-canvas-navigation": "Canvas apps: zoom, pan, minimap, keyboard navigation, culling.",
  "ux/13b-canvas-objects-performance": "Canvas objects and performance: layers, selection, snapping.",
  "ux/14-ai-ux-patterns": "AI interface design: chat, copilots, generative UI, attribution.",
  "ux/15-ethical-design": "Ethical design: dark-pattern avoidance, consent symmetry, trust.",
  "ux/16-onboarding": "Onboarding: first-run, empty states, aha moment, skippable tours.",
  "ux/17-notifications": "Notifications and attention: severity, timing, channels.",
  "ux/18-data-visualization": "Data visualization: chart choice, dashboards, colorblind-safe palettes.",
  "ux/19-search-ux": "Search UX: autocomplete, ranking, filters, empty results.",
  "ux/20-emotional-design": "Emotional design: delight, trust, personality, recovery warmth.",
  "ux/21-data-tables": "Data tables: columns, sorting, pagination, bulk actions.",
  "ux/22-performance-ux": "Perceived performance: loading states, skeletons, optimistic updates.",
  "ux/23-internationalization": "i18n and RTL: text expansion, logical properties, pluralization.",
  "ux/24-voice-and-multimodal": "Voice and multimodal input: fallbacks, feedback, cross-device flows.",
};

export const ALL_REFERENCE_NAMES = [...REFERENCE_NAMES, ...UX_REFERENCE_NAMES] as const;
export type ReferenceId = ReferenceName | UxReferenceName;

const cache = new Map<string, string>();
function readDocument(path: string): string {
  let content = cache.get(path);
  if (content === undefined) {
    content = readFileSync(path, "utf8");
    cache.set(path, content);
  }
  return content;
}
export function getSkillRouter(): string { return readDocument(join(bundledRoot("skill"), "SKILL.md")); }
export function isReferenceName(value: string): value is ReferenceId {
  return (ALL_REFERENCE_NAMES as readonly string[]).includes(value);
}
export function getReferenceDoc(name: ReferenceId): string {
  if (!isReferenceName(name)) throw new Error(`Unknown reference "${name}".`);
  // ux/* files live in the ux-designer module's own references/ directory.
  const base = name.startsWith("ux/")
    ? join(bundledRoot("ux-designer"), "references", `${name.slice(3)}.md`)
    : join(bundledRoot("skill"), "reference", `${name}.md`);
  if (!existsSync(base)) throw new Error(`Missing reference file: ${base}`);
  return readDocument(base);
}
