// Loads the bundled designer-skill and ux-designer markdown (SKILL.md + reference
// files) and caches it. Content resolution goes through the shared bundled-asset
// seam in assets.ts (packaged assets/ first, sibling skills/ in dev).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bundledRoot } from "./assets.js";

export const REFERENCE_NAMES = [
  "design-principles",
  "aesthetic-systems",
  "motion-and-interaction",
  "engineering-and-performance",
  "avoid-ai-slop",
  "differentiation-playbook",
  "refactor-and-redesign",
  "command-playbook",
  "interaction-design",
  "visual-critique",
  "design-systems",
  "project-init",
  "craft-flow",
  "live-mode",
  "css-techniques",
] as const;

export type ReferenceName = (typeof REFERENCE_NAMES)[number];

export const REFERENCE_DESCRIPTIONS: Record<ReferenceName, string> = {
  "design-principles":
    "Aesthetic-neutral visual baseline: typography, spacing & rhythm, color & contrast, layout & grid, hierarchy, depth.",
  "aesthetic-systems":
    "Five opinionated design languages (Minimalist, Brutalist, Soft, High-end, Brand-identity) and when to use which.",
  "motion-and-interaction":
    "What to animate, how fast, which curve; springs, micro-interactions, gestures, scroll, perceived performance, reduced-motion.",
  "engineering-and-performance":
    "Component architecture, design tokens, hardware acceleration, responsive/fluid, accessibility, Core Web Vitals, framework-honest output.",
  "avoid-ai-slop":
    "The AI-tell ban-list, category-reflex checks, and the output-completeness contract. The always-run ship gate.",
  "differentiation-playbook":
    "Positive creativity guide: inverse test, layout menu, one weird thing, named references, physical scene. How to be distinctive.",
  "refactor-and-redesign":
    "Improving existing UI without breaking it: audit, diagnose generic patterns, the redesign loop, image/reference-to-code.",
  "command-playbook":
    "Intent-to-verb dispatch table mapping a request to the right design move and reference files.",
  "interaction-design":
    "Cognitive laws (Fitts, Hick, Miller, Doherty), state machines, form design, navigation patterns, error UX, feedback, loading, gestures, emotional timing.",
  "visual-critique":
    "Seven-dimension critique instrument: visual hierarchy, composition, color, typography, affordance, information density, brand consistency.",
  "design-systems":
    "Token architecture (global→semantic→component), motion system, component specs, naming conventions, theming, pattern library, color/type/spacing scales.",
  "project-init":
    "One-time project setup: discovery interview, PRODUCT.md, optional DESIGN.md, live-mode pre-config, and next-command routing.",
  "craft-flow":
    "Full shape-then-build pipeline with user gates, framework detection, visual iteration loop, and production-grade output.",
  "live-mode":
    "Interactive browser variant mode: element selection, hot-swapped HTML+CSS variants via HMR, poll/steer/accept contract.",
  "css-techniques":
    "Modern CSS implementation cookbook: resets, box-sizing, centering, aspect-ratio, :is()/:not(), logical properties, container queries, :has(), @layer, clamp(), Baseline-bucketed features. The how-to for applying CSS fixes.",
};

// ux-designer reference files, namespaced under "ux/" to keep the two modules'
// registries disjoint. Files live in the ux-designer skill's own references/ dir.
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
  "ux/01-core-principles": "Core UX heuristics: user-centered design, calm & clarity, hierarchy of needs.",
  "ux/02-laws-of-ux": "Laws of UX quick reference: Fitts, Hick, Miller, Jakob's Law, aesthetic-usability effect.",
  "ux/03-accessibility": "WCAG 2.2 AA compliance: keyboard, focus, contrast, screen readers, EN 301 549 / EAA.",
  "ux/04-visual-design": "Visual design patterns: dominance, typography, contrast, spacing scales, consistency.",
  "ux/05-information-architecture": "IA: navigation models, 7±2 rule, wayfinding, sitemaps, content structure.",
  "ux/06-interaction-design": "Interaction patterns: touch targets, feedback, states, gestures, 100ms response.",
  "ux/07-forms-and-inputs": "Form design: inline validation, error messages, field grouping, multi-step flows.",
  "ux/08-mobile-ux": "Mobile UX: thumb zones, bottom navigation, viewport constraints, touch ergonomics.",
  "ux/09-ux-writing": "UX writing and microcopy: action labels, error copy, tone of voice, string guidelines.",
  "ux/10-user-research": "User research methods: interviews, usability tests, surveys, success metrics.",
  "ux/11-design-systems": "Design system creation: foundations, components, tokens, governance, documentation.",
  "ux/12a-presence-awareness": "Collaborative presence: live cursors, avatars, typing indicators, awareness without noise.",
  "ux/12b-conflict-resolution-sync": "Real-time sync UX: conflict resolution, offline state, undo/redo, sharing, permissions.",
  "ux/13a-canvas-navigation": "Canvas apps: cursor-centered zoom, pan, minimap, keyboard navigation, viewport culling.",
  "ux/13b-canvas-objects-performance": "Canvas objects & performance: layers, selection, smart guides, snapping, 60fps pan/zoom.",
  "ux/14-ai-ux-patterns": "AI interface design: chat, copilots, agents, generative UI, labeling, attribution, undo.",
  "ux/15-ethical-design": "Ethical design: dark-pattern avoidance, consent symmetry, confirmshaming, trust.",
  "ux/16-onboarding": "Onboarding and activation: first-run, empty states, aha moment, skippable tours.",
  "ux/17-notifications": "Notifications & attention: severity mapping, permission timing, toasts, channels.",
  "ux/18-data-visualization": "Data visualization: chart choice, dashboards, colorblind-safe palettes, Tufte principles.",
  "ux/19-search-ux": "Search UX: autocomplete, result ranking, filters, empty results, >70% success bar.",
  "ux/20-emotional-design": "Emotional design: delight, trust-building, personality, error recovery warmth.",
  "ux/21-data-tables": "Data tables: columns, sortable lists, pagination, bulk actions, infinite scroll context.",
  "ux/22-performance-ux": "Perceived performance: loading states, skeletons, optimistic updates, CWV.",
  "ux/23-internationalization": "i18n & RTL: text expansion, logical properties, Intl formatting, pluralization, endonyms.",
  "ux/24-voice-and-multimodal": "Voice & multimodal input: fallbacks, recognition feedback, cross-device flows.",
};

export const ALL_REFERENCE_NAMES = [...REFERENCE_NAMES, ...UX_REFERENCE_NAMES] as const;

export type ReferenceId = ReferenceName | UxReferenceName;

function resolveSkillDirs(): { skillDir: string; uxDir: string } {
  return { skillDir: bundledRoot("skill"), uxDir: bundledRoot("ux-designer") };
}

interface SkillCache {
  router: string;
  refs: Map<ReferenceId, string>;
}

let cache: SkillCache | null = null;

function load(): SkillCache {
  if (cache) return cache;
  const { skillDir, uxDir } = resolveSkillDirs();
  const router = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const refs = new Map<ReferenceId, string>();
  for (const name of REFERENCE_NAMES) {
    const p = join(skillDir, "reference", `${name}.md`);
    if (!existsSync(p)) throw new Error(`Missing designer-skill reference file: ${p}`);
    refs.set(name, readFileSync(p, "utf8"));
  }
  for (const name of UX_REFERENCE_NAMES) {
    const file = name.slice("ux/".length);
    const p = join(uxDir, "references", `${file}.md`);
    if (!existsSync(p)) throw new Error(`Missing ux-designer reference file: ${p}`);
    refs.set(name, readFileSync(p, "utf8"));
  }
  cache = { router, refs };
  return cache;
}

export function getSkillRouter(): string {
  return load().router;
}

export function getReferenceDoc(name: ReferenceId): string {
  const doc = load().refs.get(name);
  if (doc === undefined) throw new Error(`Unknown reference "${name}".`);
  return doc;
}

export function isReferenceName(value: string): value is ReferenceId {
  return (ALL_REFERENCE_NAMES as readonly string[]).includes(value);
}