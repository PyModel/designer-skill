// Deterministic intent -> verb -> reference-file routing. Mirrors the
// command-playbook dispatch table. No LLM; pure keyword scoring.
// Designer-skill verbs may cross-link ux-designer references (ux/…).
import type { ReferenceId } from "./skill.js";

interface Verb {
  verb: string;
  cues: string[];
  files: ReferenceId[];
  note: string;
}

const VERBS: Verb[] = [
  {
    verb: "setup",
    cues: ["setup", "set up project", "setup project", "bootstrap", "first time", "no product.md", "write product.md", "project setup", "init"],
    files: ["project-init"],
    note: "One-time project setup: discovery interview, write PRODUCT.md, offer DESIGN.md, configure preview mode.",
  },
  {
    verb: "build",
    cues: ["build", "craft", "make a", "create", "scaffold", "implement", "from scratch", "new page", "new component", "landing page", "build me", "end to end", "full build flow"],
    files: ["craft-flow", "design-principles", "aesthetic-systems", "differentiation-playbook", "engineering-and-performance", "avoid-ai-slop"],
    note: "Build a feature end-to-end: plan, visual gates, production code, in-browser iteration.",
  },
  {
    verb: "preview",
    cues: ["preview mode", "live mode", "live variant", "browser variants", "pick elements", "hot swap", "iterate in browser", "visual experiment"],
    files: ["live-mode"],
    note: "Browser variant mode: select elements, generate alternatives hot-swapped via HMR.",
  },
  {
    verb: "plan",
    cues: ["plan", "shape", "spec", "think through", "before code", "brief", "approach", "wireframe"],
    files: ["design-principles", "aesthetic-systems", "differentiation-playbook"],
    note: "Plan UX/UI before code: color strategy, physical scene, named references — no implementation.",
  },
  {
    verb: "check",
    cues: ["check", "audit", "review the", "review my", "check the", "a11y", "accessibility", "performance review", "responsive check", "lighthouse", "wcag", "eaa", "screen reader"],
    files: ["engineering-and-performance", "avoid-ai-slop", "refactor-and-redesign", "css-techniques", "ux/03-accessibility"],
    note: "Technical audit (a11y, perf, responsive, CSS anti-patterns). Report findings; fix nothing yet.",
  },
  {
    verb: "review",
    cues: ["review", "critique", "is this good", "design review", "feels ai", "looks ai", "feel ai", "feedback on", "does this feel", "thoughts on the design", "score the design", "visual critique", "rate the design"],
    files: ["design-principles", "avoid-ai-slop", "visual-critique"],
    note: "Design review: hierarchy, IA, cognitive load, scoring; lead with the AI-slop verdict.",
  },
  {
    verb: "finish",
    cues: ["finish", "polish", "final pass", "tighten", "before shipping", "ship ready", "refine", "clean up the ui"],
    files: ["design-principles", "engineering-and-performance", "css-techniques"],
    note: "Final polish: spacing scale, interaction states, optical alignment, idiomatic CSS.",
  },
  {
    verb: "amplify",
    cues: ["amplify", "bolder", "too safe", "bland", "make it pop", "boring", "more striking", "stand out", "needs energy"],
    files: ["aesthetic-systems", "differentiation-playbook", "avoid-ai-slop"],
    note: "Increase visual impact: stronger hierarchy, committed color, break the grid.",
  },
  {
    verb: "calm",
    cues: ["calm", "quieter", "too loud", "too busy", "aggressive", "overstimulating", "tone down", "calmer", "too much"],
    files: ["design-principles", "aesthetic-systems"],
    note: "Reduce intensity: desaturate, flatten, calm motion — keep the point of view.",
  },
  {
    verb: "push",
    cues: ["push", "overdrive", "extraordinary", "wow", "push past", "cinematic", "award", "go crazy", "showstopper"],
    files: ["motion-and-interaction", "engineering-and-performance"],
    note: "Maximum ambition: View Transitions, scroll-driven effects, WebGL. Confirm direction first.",
  },
  {
    verb: "motion",
    cues: ["motion", "animate", "animation", "transition", "feels static", "smooth this", "hover effect", "scroll effect", "micro-interaction"],
    files: ["motion-and-interaction"],
    note: "Add purposeful motion: duration tiers, ease-out curves, reduced-motion alternative.",
  },
  {
    verb: "delight",
    cues: ["delight", "personality", "memorable", "charm", "easter egg", "playful", "fun touch"],
    files: ["motion-and-interaction", "avoid-ai-slop"],
    note: "Earned delight moments (success, empty, error recovery); never generic filler.",
  },
  {
    verb: "layout",
    cues: ["layout", "spacing", "feels off", "alignment", "hierarchy", "grid", "whitespace", "cramped", "looks off"],
    files: ["design-principles", "css-techniques"],
    note: "Fix spacing, rhythm, hierarchy: 4pt scale, flex/grid, subgrid, container queries, squint test.",
  },
  {
    verb: "type",
    cues: ["type", "typography", "typeset", "font", "typeface", "type scale", "headings", "text hierarchy", "fonts"],
    files: ["design-principles"],
    note: "Improve typography: scale, weights, measure, tracking.",
  },
  {
    verb: "color",
    cues: ["color", "colour", "colorize", "palette", "flat", "grayscale", "greyscale", "monochrome", "add color", "color scheme"],
    files: ["design-principles", "aesthetic-systems"],
    note: "Color strategy, OKLCH ramp, 60-30-10 weighting, tinted neutrals.",
  },
  {
    verb: "ship",
    cues: ["ship", "harden", "production-ready", "production ready", "edge case", "real data", "empty state", "error state", "i18n", "loading state", "rtl", "localization", "translation"],
    files: ["engineering-and-performance", "css-techniques", "ux/23-internationalization"],
    note: "Production-ready: long/empty/RTL text, API errors, no fixed text widths, logical properties.",
  },
  {
    verb: "speed",
    cues: ["speed", "optimize", "optimise", "slow", "janky", "jank", "lag", "fps", "bundle size", "performance issue", "core web vitals"],
    files: ["engineering-and-performance", "css-techniques", "ux/22-performance-ux"],
    note: "Fix UI performance: measure first, fix the real bottleneck.",
  },
  {
    verb: "simplify",
    cues: ["simplify", "distill", "too complex", "cluttered", "strip", "minimal", "reduce complexity", "declutter"],
    files: ["design-principles"],
    note: "Strip to essence: one goal, progressive disclosure, fewer colors.",
  },
  {
    verb: "tokens",
    cues: ["tokens", "extract", "reusable", "design system", "componentize", "dedupe", "shared component"],
    files: ["engineering-and-performance", "design-systems"],
    note: "Pull repeated patterns into tokens + components; avoid premature abstraction.",
  },
  {
    verb: "brand",
    cues: ["brand", "identity", "distinctive", "not generic", "logo", "brand voice", "make it unique"],
    files: ["aesthetic-systems", "differentiation-playbook", "avoid-ai-slop"],
    note: "Distinctive identity: aesthetic + reference, font procedure, palette strategy.",
  },
  {
    verb: "responsive",
    cues: ["responsive", "adapt", "mobile", "tablet", "different device", "breakpoint", "small screen", "touch"],
    files: ["engineering-and-performance", "refactor-and-redesign", "css-techniques", "ux/08-mobile-ux"],
    note: "Rethink for target device: reflow, container queries, touch targets, safe areas.",
  },
  {
    verb: "refresh",
    cues: ["refresh", "redesign", "improve existing", "fix this ui", "without breaking", "revamp", "modernize", "modernise", "existing site", "existing app", "upgrade the design"],
    files: ["refactor-and-redesign", "avoid-ai-slop", "css-techniques"],
    note: "Improve existing UI without breaking it: audit, diagnose, redesign loop, modern CSS.",
  },
  {
    verb: "copy",
    cues: ["copy", "clarify", "microcopy", "ux copy", "ux writing", "rewrite this error", "error message", "button label", "labels are confusing", "wording"],
    files: ["command-playbook", "avoid-ai-slop", "ux/09-ux-writing"],
    note: "UX copy: verb+object buttons, structured errors, one term per concept.",
  },
  {
    verb: "onboard",
    cues: ["onboard", "onboarding", "first run", "first-run", "first-time", "product tour", "activation", "getting started", "welcome screen", "empty states"],
    files: ["command-playbook", "engineering-and-performance", "ux/16-onboarding"],
    note: "First-run and empty states: shortest path to first value.",
  },
  {
    verb: "spec",
    cues: ["spec", "design.md", "document the design", "write design", "capture the design system", "refresh design.md", "design system doc", "document tokens"],
    files: ["refactor-and-redesign"],
    note: "Generate or refresh DESIGN.md from tokens + components.",
  },
  {
    verb: "options",
    cues: ["options", "variants", "variations", "show me options", "show me 3", "3 versions", "three versions", "alternatives", "a few directions"],
    files: ["refactor-and-redesign", "differentiation-playbook", "avoid-ai-slop"],
    note: "2–3 variants within identity — vary on different axes, not different brands.",
  },
  {
    verb: "form",
    cues: ["form", "form design", "input fields", "form validation", "multi-step form", "form layout", "checkout form", "sign up form"],
    files: ["interaction-design", "engineering-and-performance", "ux/07-forms-and-inputs"],
    note: "Form UX: single column, top labels, blur validation, inline errors.",
  },
  {
    verb: "nav",
    cues: ["nav", "navigation", "nav menu", "sidebar nav", "tab bar", "breadcrumb", "menu structure", "top nav", "bottom nav"],
    files: ["interaction-design", "design-principles", "ux/05-information-architecture"],
    note: "Navigation pattern matched to IA depth and platform.",
  },
  {
    verb: "states",
    cues: ["state machine", "ui states", "all states", "impossible state", "model behavior", "define all states", "every state"],
    files: ["interaction-design", "engineering-and-performance"],
    note: "Finite states with one visual representation each; no impossible combinations.",
  },
  {
    verb: "tone",
    cues: ["tone", "feel", "feels flat", "feels lifeless", "no personality", "feels cold", "humanize", "feels robotic", "too sterile"],
    files: ["interaction-design", "motion-and-interaction"],
    note: "Humanize through easing, delay, copy voice, and duration.",
  },
  {
    verb: "system",
    cues: ["design system", "token system", "naming convention", "theming", "design tokens", "dark mode system", "component library", "token architecture"],
    files: ["design-systems", "engineering-and-performance"],
    note: "Token architecture, component specs, theming, naming conventions.",
  },
  {
    verb: "css",
    cues: ["css", "stylesheet", "tailwind", "css fix", "fix the css", "css bug", "selector", "specificity", "centering", "center this", "aspect-ratio", "container query", ":has", "logical properties", "flexbox", "css grid", "clamp", "box-sizing", "css reset"],
    files: ["css-techniques", "design-principles"],
    note: "Apply idiomatic modern CSS: resets, centering, selectors, specificity (@layer/:is), logical properties, container queries, clamp(), :has().",
  },
  {
    verb: "research",
    cues: ["user research", "interview users", "usability test", "persona", "survey", "test with users", "understand users", "discovery research"],
    files: ["ux/10-user-research", "project-init"],
    note: "Research before design: interviews, usability tests, personas, success metrics.",
  },
  {
    verb: "laws",
    cues: ["laws of ux", "fitts", "hick", "miller law", "jakob", "aesthetic-usability", "cognitive load", "working memory"],
    files: ["ux/02-laws-of-ux", "interaction-design"],
    note: "Apply the Laws of UX quick reference to the interaction design.",
  },
  {
    verb: "notify",
    cues: ["notification", "toast", "push notification", "banner", "alerts", "attention management", "notification center", "permission prompt"],
    files: ["ux/17-notifications", "interaction-design"],
    note: "Notification system design: severity mapping, permission timing, toast lifecycle.",
  },
  {
    verb: "search",
    cues: ["search", "search bar", "autocomplete", "search results", "filters", "facets", "empty results"],
    files: ["ux/19-search-ux", "interaction-design"],
    note: "Search UX: autocomplete, result ranking, filters, empty-result handling.",
  },
  {
    verb: "table",
    cues: ["table", "data table", "sortable", "pagination", "bulk action", "row selection", "list view"],
    files: ["ux/21-data-tables"],
    note: "Data tables: columns, sorting, pagination, bulk actions, dense/comfortable density.",
  },
  {
    verb: "chart",
    cues: ["chart", "graph", "dashboard", "data viz", "visualization", "visualise", "sparkline", "metrics display"],
    files: ["ux/18-data-visualization", "design-principles"],
    note: "Data visualization: chart choice, colorblind-safe palettes, dashboard hierarchy.",
  },
  {
    verb: "collaborate",
    cues: ["collaboration", "multiplayer", "presence", "live cursor", "avatar", "typing indicator", "real-time editing", "shared", "concurrent", "conflict resolution", "offline mode", "permissions"],
    files: ["ux/12a-presence-awareness", "ux/12b-conflict-resolution-sync"],
    note: "Collaborative UX: presence awareness, sync/conflict UX, offline states, permissions.",
  },
  {
    verb: "canvas",
    cues: ["canvas", "whiteboard", "spatial", "zoom", "pan", "minimap", "smart guides", "snapping", "object manipulation", "viewport culling"],
    files: ["ux/13a-canvas-navigation", "ux/13b-canvas-objects-performance"],
    note: "Canvas/spatial apps: cursor-centered zoom, snapping, minimap, 60fps pan/zoom.",
  },
  {
    verb: "ai",
    cues: ["ai interface", "chat interface", "copilot", "agent ui", "generative ui", "llm ui", "ai chat", "streaming response", "ai suggestions", "ai output"],
    files: ["ux/14-ai-ux-patterns", "interaction-design"],
    note: "AI interface design: labeling, attribution, stop/cancel, undo, human override.",
  },
  {
    verb: "ethics",
    cues: ["dark pattern", "ethical", "confirmshaming", "consent", "deceptive", "manipulative", "dark patterns", "privacy design", "trust"],
    files: ["ux/15-ethical-design", "avoid-ai-slop"],
    note: "Ethical design: symmetric consent, no confirmshaming, no deceptive patterns.",
  },
  {
    verb: "voice",
    cues: ["voice", "voice ui", "speech input", "multimodal", "hands-free", "audio feedback", "voice assistant"],
    files: ["ux/24-voice-and-multimodal", "motion-and-interaction"],
    note: "Voice & multimodal input: fallback modality, recognition feedback, cross-device.",
  },
  {
    verb: "emotion",
    cues: ["emotional", "delight", "personality", "trust", "warm", "human connection", "error recovery"],
    files: ["ux/20-emotional-design", "motion-and-interaction"],
    note: "Emotional design: trust-building, personality, warm error recovery.",
  },
];

export interface DispatchMatch {
  verb: string;
  files: ReferenceId[];
  note: string;
  score: number;
}

export interface DispatchResult {
  matched: DispatchMatch[];
  recommendedReads: ReferenceId[];
  text: string;
}

export function dispatchIntent(request: string): DispatchResult {
  const q = request.toLowerCase();
  const scored: DispatchMatch[] = VERBS.map((v) => ({
    verb: v.verb,
    files: v.files,
    note: v.note,
    score: v.cues.reduce((n, cue) => (q.includes(cue) ? n + 1 : n), 0),
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const reads = new Set<ReferenceId>();
  for (const m of scored) for (const f of m.files) reads.add(f);
  reads.add("avoid-ai-slop");
  if (scored.length === 0) {
    reads.add("differentiation-playbook");
    reads.add("command-playbook");
    reads.add("design-principles");
  }
  const recommendedReads = [...reads];

  const lines: string[] = [];
  if (scored.length === 0) {
    lines.push(
      `No specific verb matched "${request}". Read command-playbook.md to map the intent, then design-principles.md for fundamentals.`,
    );
  } else {
    lines.push(`Matched verb(s) for "${request}":`);
    for (const m of scored) {
      lines.push(`\n- **${m.verb}** — ${m.note}\n  Read: ${m.files.join(", ")}`);
    }
  }
  lines.push(
    `\nThen call review_and_gate before declaring done (score ≥85, zero blocking slop).`,
  );
  lines.push(`\nRecommended reads: ${recommendedReads.join(", ")}.`);

  return { matched: scored, recommendedReads, text: lines.join("\n") };
}
