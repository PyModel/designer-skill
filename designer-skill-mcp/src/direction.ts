// Validate a direction record, not aesthetic taste or writes through other tools.
import { createHash } from "node:crypto";
import { z } from "zod";

// The single definition of a direction record's constraints; the MCP tool
// uses this shape as its inputSchema and commitDesignDirection re-validates it.
export const directionInputShape = {
  mode: z.enum(["preserve", "change"]).default("change"),
  register: z.enum(["brand", "product"]),
  designRead: z.string().trim().min(20).max(2_000),
  contextSources: z.array(z.string().trim().min(1).max(2_000)).min(1).max(32),
  aesthetic: z.string().trim().min(1).max(200).optional(),
  typographyDirection: z.string().trim().min(1).max(2_000).optional(),
  layoutFamilies: z.array(z.string().trim().min(1).max(200)).max(32).optional(),
  designVariance: z.number().int().min(1).max(10).optional(),
  motionIntensity: z.number().int().min(1).max(10).optional(),
  visualDensity: z.number().int().min(1).max(10).optional(),
  physicalScene: z.string().max(2_000).optional(),
  antiSlopRisks: z.array(z.string().max(500)).max(32).optional(),
  inverseTestPass: z.boolean().optional(),
  inverseTestDescription: z.string().max(2_000).optional(),
  namedReferences: z.array(z.string().max(500)).max(16).optional(),
};
const directionInputSchema = z.object(directionInputShape);
export type DesignDirectionInput = z.input<typeof directionInputSchema>;
type DesignDirection = z.output<typeof directionInputSchema>;

export interface DesignDirectionResult {
  status: "PASS" | "FAIL";
  scope: "input-validation";
  message: string;
  directionId?: string;
  direction?: DesignDirection;
  fixes?: string[];
}

const FIELD_HINTS: Record<string, string> = {
  mode: "mode must be preserve or change.",
  register: "register must be brand or product.",
  designRead: "designRead must contain 20-2,000 characters describing this task.",
  contextSources: "contextSources must identify 1-32 inspected project sources.",
  designVariance: "designVariance must be a whole number from 1 to 10.",
  motionIntensity: "motionIntensity must be a whole number from 1 to 10.",
  visualDensity: "visualDensity must be a whole number from 1 to 10.",
};

export function commitDesignDirection(input: DesignDirectionInput): DesignDirectionResult {
  const parsed = directionInputSchema.safeParse(input);
  const fixes: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "input");
      const hint = FIELD_HINTS[field] ?? `${field}: ${issue.message}`;
      if (!fixes.includes(hint)) fixes.push(hint);
    }
    return { status: "FAIL", scope: "input-validation", message: "Direction input is incomplete or invalid.", fixes };
  }
  const direction = parsed.data;
  const layouts = direction.layoutFamilies ?? [];
  if (direction.mode === "change") {
    if (!direction.aesthetic) fixes.push("aesthetic must state the chosen visual language; custom systems are allowed.");
    if (!direction.typographyDirection) fixes.push("typographyDirection must state the approved type approach.");
    if (!layouts.length || new Set(layouts).size !== layouts.length) fixes.push("layoutFamilies must contain distinct applicable patterns.");
  }
  if (fixes.length) return { status: "FAIL", scope: "input-validation", message: "Direction input is incomplete or invalid.", fixes };
  const record = { ...direction, layoutFamilies: layouts };
  return {
    status: "PASS", scope: "input-validation",
    message: "Direction input accepted. This does not prove visual quality, persist approval, or enforce external file writes. Inverse test statements are advisory.",
    directionId: createHash("sha256").update(JSON.stringify(record)).digest("hex"), direction: record,
  };
}

export function formatDesignDirectionResult(result: DesignDirectionResult): string {
  if (result.status === "FAIL") return `## commit_design_direction: FAIL\n\n${result.message}\n\n${result.fixes!.map((f) => `- ${f}`).join("\n")}`;
  return `## commit_design_direction: PASS\n\n${result.message}\n\ndirectionId: ${result.directionId}`;
}
