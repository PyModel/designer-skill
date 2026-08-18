// Validates a design-direction commit before the agent writes UI code.

export type Register = "brand" | "product";

export const AESTHETIC_SYSTEMS = [
  "minimalist",
  "brutalist",
  "soft",
  "high-end-stitch",
  "brand-identity",
  "product",
] as const;

export type AestheticSystem = (typeof AESTHETIC_SYSTEMS)[number];

export interface DesignDirectionInput {
  register: Register;
  designRead: string;
  designVariance: number;
  motionIntensity: number;
  visualDensity: number;
  aesthetic: string;
  physicalScene: string;
  layoutFamilies: string[];
  typographyDirection?: string;
  antiSlopRisks: string[];
  inverseTestPass: boolean;
  inverseTestDescription?: string;
  namedReferences?: string[];
}

export interface DesignDirectionResult {
  status: "PASS" | "FAIL";
  message: string;
  direction?: DesignDirectionInput;
  fixes?: string[];
}

const GENERIC_INVERSE_PATTERNS = [
  /\bai[- ]powered\b/i,
  /\bstreamlin(e|ing)\b/i,
  /\bseamless(ly)?\b/i,
  /\bcutting[- ]edge\b/i,
  /\bnext[- ]generation\b/i,
  /\bworld[- ]class\b/i,
  /\benterprise[- ]grade\b/i,
  /\bmodern (saas|platform|solution|tool)\b/i,
  /\bthree (feature )?cards?\b/i,
  /\bhero (with )?gradient\b/i,
  /\bminimal and elegant\b/i,
  /\bclean and (modern|professional)\b/i,
  /\bfintech\b.*\b(navy|gold|secure)\b/i,
  /\bstartup landing\b/i,
  /\bsaas (landing|page|hero)\b/i,
  /\bempower(s|ing)? (teams|users|businesses)\b/i,
  /\btransform(s|ing)? (the way|how)\b/i,
  /\bleverage(s|ing)?\b/i,
  /\bunlock(s|ing)? (the power|potential)\b/i,
];

const VAGUE_SCENE_PATTERNS = [
  /^modern\b/i,
  /^clean\b/i,
  /^professional\b/i,
  /^users who want\b/i,
  /^people who need\b/i,
  /^anyone looking for\b/i,
];

function normalizeAesthetic(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/high-end-?stitch|stitch|premium/g, "high-end-stitch")
    .replace(/minimalist|editorial/g, "minimalist")
    .replace(/brand-identity|brand identity/g, "brand-identity");
}

function isValidAesthetic(value: string): value is AestheticSystem {
  return (AESTHETIC_SYSTEMS as readonly string[]).includes(value);
}

function matchGenericPattern(text: string, pattern: RegExp): boolean {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    const window = text.slice(Math.max(0, idx - 24), idx);
    if (/\bnot (another|a|the)\s*$/i.test(window)) continue;
    return true;
  }
  return false;
}

function failsInverseTest(description: string): string | null {
  const text = description.trim();
  if (text.length < 40) {
    return "inverseTestDescription is too short — name the specific user, context, and visual lane (≥40 chars).";
  }
  for (const pattern of GENERIC_INVERSE_PATTERNS) {
    if (matchGenericPattern(text, pattern)) {
      return `inverse test description reads category-modal (${pattern.source}). Be specific to this product, not the industry template.`;
    }
  }
  return null;
}

function validateDial(name: string, value: number, fixes: string[]): void {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    fixes.push(`${name} must be a whole number from 1 to 10.`);
  }
}

export function commitDesignDirection(input: DesignDirectionInput): DesignDirectionResult {
  const fixes: string[] = [];

  if (input.register !== "brand" && input.register !== "product") {
    fixes.push('register must be "brand" or "product".');
  }

  const designRead = input.designRead?.trim() ?? "";
  if (designRead.length < 40) {
    fixes.push("designRead must state the surface, audience, and visual language in one concrete sentence (≥40 chars).");
  }

  validateDial("designVariance", input.designVariance, fixes);
  validateDial("motionIntensity", input.motionIntensity, fixes);
  validateDial("visualDensity", input.visualDensity, fixes);

  const aesthetic = normalizeAesthetic(input.aesthetic);
  if (!isValidAesthetic(aesthetic)) {
    fixes.push(`aesthetic must be one of: ${AESTHETIC_SYSTEMS.join(", ")}.`);
  }

  const scene = input.physicalScene?.trim() ?? "";
  if (scene.length < 30) {
    fixes.push("physicalScene must be one concrete sentence (≥30 chars): who, where, light, mood.");
  } else {
    for (const pattern of VAGUE_SCENE_PATTERNS) {
      if (pattern.test(scene)) {
        fixes.push("physicalScene is too vague — add place, light, and mood, not adjectives alone.");
        break;
      }
    }
  }

  const layouts = (input.layoutFamilies ?? []).map((s) => s.trim()).filter(Boolean);
  const minLayouts = input.register === "brand" ? 2 : 1;
  if (layouts.length < minLayouts) {
    fixes.push(
      input.register === "brand"
        ? "layoutFamilies needs ≥2 distinct families for brand surfaces (see differentiation-playbook)."
        : "layoutFamilies needs ≥1 pattern for product surfaces.",
    );
  }

  if (!input.typographyDirection?.trim()) {
    fixes.push("typographyDirection required — name pairing and scale approach (e.g. grotesk display + humanist body, 1.333 ratio).");
  }

  const risks = (input.antiSlopRisks ?? []).map((s) => s.trim()).filter(Boolean);
  if (risks.length < 2) {
    fixes.push("antiSlopRisks needs ≥2 specific tells you are actively avoiding for this surface.");
  }

  if (!input.inverseTestPass) {
    fixes.push("inverseTestPass must be true — rework direction until the inverse test passes, then resubmit.");
  }

  const inverseDesc = input.inverseTestDescription?.trim() ?? "";
  if (!inverseDesc) {
    fixes.push("inverseTestDescription required — one sentence explaining why your direction is NOT category-modal.");
  } else {
    const inverseFail = failsInverseTest(inverseDesc);
    if (inverseFail) fixes.push(inverseFail);
  }

  if (input.register === "brand" && aesthetic === "product") {
    fixes.push('brand register should not use aesthetic "product" — pick a build system (minimalist, brutalist, soft, high-end-stitch, brand-identity).');
  }

  if (fixes.length > 0) {
    return {
      status: "FAIL",
      message: "Design direction not committed. Fix the issues below and call commit_design_direction again.",
      fixes,
    };
  }

  const refCount = input.namedReferences?.filter((r) => r.trim()).length ?? 0;
  const refsTip =
    refCount >= 2
      ? ""
      : "\n\nTip: add 2–3 namedReferences with one extracted move each (differentiation-playbook).";

  return {
    status: "PASS",
    message:
      `Design direction committed. Proceed to dispatch_intent and load only task-relevant references.${refsTip}`,
    direction: { ...input, designRead, aesthetic, layoutFamilies: layouts, antiSlopRisks: risks },
  };
}

export function formatDesignDirectionResult(result: DesignDirectionResult): string {
  const lines = [`## commit_design_direction: ${result.status}`, "", result.message];
  if (result.fixes?.length) {
    lines.push("", "### Fixes required");
    for (const fix of result.fixes) lines.push(`- ${fix}`);
  }
  if (result.direction) {
    lines.push("", "### Committed direction", "```json", JSON.stringify(result.direction, null, 2), "```");
  }
  return lines.join("\n");
}
