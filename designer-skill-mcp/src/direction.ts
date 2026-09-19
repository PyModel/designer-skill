// Validate a direction record, not aesthetic taste or writes through other tools.
import { createHash } from "node:crypto";
export type Register = "brand" | "product";
export const AESTHETIC_SYSTEMS = ["minimalist", "brutalist", "soft", "high-end-stitch", "brand-identity", "product"] as const;
export type AestheticSystem = (typeof AESTHETIC_SYSTEMS)[number];
export interface DesignDirectionInput {
  mode?: "preserve" | "change";
  register: Register;
  designRead: string;
  contextSources: string[];
  aesthetic?: string;
  typographyDirection?: string;
  layoutFamilies?: string[];
  designVariance?: number;
  motionIntensity?: number;
  visualDensity?: number;
  physicalScene?: string;
  antiSlopRisks?: string[];
  inverseTestPass?: boolean;
  inverseTestDescription?: string;
  namedReferences?: string[];
}
export interface DesignDirectionResult {
  status: "PASS" | "FAIL";
  scope: "input-validation";
  message: string;
  directionId?: string;
  direction?: DesignDirectionInput;
  fixes?: string[];
}
export function commitDesignDirection(input: DesignDirectionInput): DesignDirectionResult {
  const fixes: string[] = [];
  const mode = input.mode ?? "change";
  if (!["preserve", "change"].includes(mode)) fixes.push("mode must be preserve or change.");
  if (!["brand", "product"].includes(input.register)) fixes.push("register must be brand or product.");
  const designRead = input.designRead?.trim() ?? "";
  if (designRead.length < 20 || designRead.length > 2_000) fixes.push("designRead must contain 20-2,000 characters describing this task.");
  if (!Array.isArray(input.contextSources) || !input.contextSources.length || input.contextSources.length > 32 ||
    input.contextSources.some((s) => typeof s !== "string" || !s.trim() || s.length > 2_000)) {
    fixes.push("contextSources must identify 1-32 inspected project sources.");
  }
  for (const name of ["designVariance", "motionIntensity", "visualDensity"] as const) {
    const value = input[name];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 10)) fixes.push(`${name} must be a whole number from 1 to 10.`);
  }
  const layouts = input.layoutFamilies?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (mode === "change") {
    if (!input.aesthetic?.trim()) fixes.push("aesthetic must state the chosen visual language; custom systems are allowed.");
    if (!input.typographyDirection?.trim()) fixes.push("typographyDirection must state the approved type approach.");
    if (!layouts.length || new Set(layouts).size !== layouts.length) fixes.push("layoutFamilies must contain distinct applicable patterns.");
  }
  if (fixes.length) return { status: "FAIL", scope: "input-validation", message: "Direction input is incomplete or invalid.", fixes };
  const direction = { ...input, mode, designRead, contextSources: input.contextSources.map((s) => s.trim()), layoutFamilies: layouts };
  return {
    status: "PASS", scope: "input-validation",
    message: "Direction input accepted. This does not prove visual quality, persist approval, or enforce external file writes. Inverse test statements are advisory.",
    directionId: createHash("sha256").update(JSON.stringify(direction)).digest("hex"), direction,
  };
}
export function formatDesignDirectionResult(result: DesignDirectionResult): string {
  return `## commit_design_direction: ${result.status}\n\n${result.message}\n\n` + JSON.stringify(result, null, 2);
}
