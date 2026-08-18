// Compact preflight brief (~400–600 tokens) injected before any UI work.

export function getPreflightBrief(): string {
  return `# designer-skill preflight brief

**Binding workflow:** Brief by default → commit direction before code → deep refs on demand → deterministic gate before done.

## 1. Session loop (every UI task)

1. \`get_preflight_brief\` — you are here
2. \`commit_design_direction\` — declare design read, calibration dials, register, aesthetic, scene, layouts; must PASS before code
3. \`load_project_context\` — PRODUCT.md / DESIGN.md when present
4. \`dispatch_intent\` — task verb + which references to load (2–4 max, not all fifteen)
5. Implement
6. \`review_and_gate\` — before final response; do not claim done on FAIL

## 2. Register (pick one)

- **brand** — marketing, landing, campaign, portfolio. Bar: **distinctiveness**. Could a viewer say "AI made that"?
- **product** — app, dashboard, settings, tools. Bar: **earned familiarity**. Would a Linear/Figma/Notion user trust this?

Infer: brand = \`/\`, \`/pricing\`, hero sections; product = \`/app/*\`, forms, data tables.

## 3. Design read + calibration (commit before styling)

Write one sentence naming the surface, audience, and visual language. Then set three whole-number dials from 1–10:

- **designVariance:** 1 = strict symmetry/convention; 10 = expressive/off-grid
- **motionIntensity:** 1 = static; 10 = cinematic/physics-led
- **visualDensity:** 1 = gallery-like/airy; 10 = compact/data-dense

Infer from the brief and existing UI. Accessibility, reduced motion, and established brand rules override dial values.

## 4. Aesthetic system (commit ONE per surface)

Minimalist · Brutalist · Soft · High-end-Stitch · Brand-identity · Product (overlay on product surfaces).

Never mix two systems' signatures on one surface. System rules in \`aesthetic-systems.md\` override the neutral baseline.

## 5. Inverse test (before palette or layout)

Describe the build the way a **competitor** would. If that sentence fits the category's usual landing page, **restart**.

Also run second-order check: category + "not the obvious look" still predicts your choice → restart.

## 6. Physical scene (one sentence)

Who uses this, where, under what light, in what mood. Must force light vs dark and tone — not a default.

## 7. Top slop bans (hard refuse)

**Color:** purple/violet AI gradient (hue 260–310), cyan-on-dark headings (160–200), cream/sand body bg, beige+brass palette, pure #000/#fff, gradient text on headers.

**Layout:** three equal feature cards, icon-tile-stack above headings, ghost-card (1px border + ≥16px shadow), ≥24px card radius, side-stripe accent borders, centered hero over mesh/blob.

**Type:** Inter/Roboto/Open Sans by reflex, italic-serif display hero, full-sentence display H1, reflex display serifs (Fraunces, Playfair, etc.) on non-editorial briefs.

**Components:** eyebrow chips (max 1 per 3 sections), numbered section markers (01/02), fake div-screenshots, emoji icons, em-dash (—) anywhere visible.

## 8. Layout rules

- **Brand:** ≥2 different layout families per page; ≥4 on an 8-section page; max 2 consecutive zig-zags.
- **Product:** one clear pattern per view; innovate in states and semantics, not page theater.
- See \`differentiation-playbook.md\` for the layout menu and "one weird thing" rule.

## 9. Typography rules

- 2–3 font families max; scale ratio ≥1.25 between steps.
- Pair on contrast axis (serif+sans, geometric+humanist) — not two similar sans.
- Body ≥16px; measure 65–75ch for prose.
- Brand: run font-selection procedure in \`aesthetic-systems.md\` — reject reflex list, browse catalogs.

## 10. Ship gate

Before declaring done: \`review_and_gate\` on changed files. Score ≥85, zero blocking slop findings. Manual pass: category-reflex, completeness (no \`// rest of code\`), a11y (focus rings, 4.5:1 text, 44px touch targets, reduced-motion).

## 11. Deep references (on demand only)

| Need | File |
|---|---|
| Distinctive / creative | \`differentiation-playbook\` |
| Ban-list + checklist | \`avoid-ai-slop\` |
| Visual baseline | \`design-principles\` |
| Aesthetic execution | \`aesthetic-systems\` |
| Build pipeline | \`craft-flow\` |

**Next step:** call \`commit_design_direction\` with your declared direction, then \`dispatch_intent\` for this task.`;
}
