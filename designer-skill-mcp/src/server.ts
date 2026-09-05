import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isAbsolute } from "node:path";
import { getSkillRouter, getReferenceDoc, isReferenceName, REFERENCE_NAMES, REFERENCE_DESCRIPTIONS } from "./skill.js";
import { dispatchIntent } from "./dispatch.js";
import { listCommands, formatCommandHelp, getCommandReads } from "./commands.js";
import { loadProjectContext, formatProjectContext } from "./context.js";
import { scanAntipatterns, formatDetectionResults } from "./detect.js";
import { getPaletteSeed } from "./palette.js";
import { getPreflightBrief } from "./brief.js";
import { commitDesignDirection, formatDesignDirectionResult } from "./direction.js";
import { reviewAndGate, formatGateResult } from "./gate.js";
import { DesignError } from "./scope.js";
import { pkg } from "./pkg.js";

export const SERVER_NAME = "designer-skill-mcp";
export const SERVER_VERSION = pkg.version;
export const SERVER_INSTRUCTIONS = [
  "For UI tasks, call get_preflight_brief then load_project_context with the actual project root.",
  "Preserve identity and user scope. Audit/plan requests do not authorize implementation edits.",
  "Use dispatch_intent and load relevant references only. commit_design_direction validates new direction inputs, not taste or external writes.",
  "review_and_gate reports static coverage, not overall readiness. Never invent verification or treat NOT_VERIFIED as PASS.",
].join("\n");

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const cwdSchema = z.string().trim().min(1).max(4096).refine(isAbsolute, "cwd must be an absolute authorized project directory");
const targetSchema = z.string().trim().min(1).max(4096);
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
function failure(error: unknown) {
  return { isError: true, ...text(JSON.stringify({
    code: error instanceof DesignError ? error.code : "OPERATION_FAILED",
    message: error instanceof Error ? error.message : "Operation failed.",
  })) };
}
const findingSchema = z.object({
  file: z.string(), line: z.number().int().positive().optional(), antipattern: z.string(), snippet: z.string(),
  description: z.string(), importedBy: z.array(z.string()).optional(),
});
const coverageSchema = z.object({
  candidateFiles: z.number().int().nonnegative(), scannedFiles: z.number().int().nonnegative(),
  ignoredFiles: z.number().int().nonnegative(), unsupportedFiles: z.number().int().nonnegative(),
  excludedDirectories: z.number().int().nonnegative(), bytesScanned: z.number().int().nonnegative(),
});
const fileEvidenceSchema = z.array(z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }));
const scanOutput = {
  target: z.string(), coverage: coverageSchema, findings: z.array(findingSchema), files: fileEvidenceSchema,
  ignoredRules: z.array(z.string()), ignoredValues: z.number().int().nonnegative(),
};
const gateOutput = {
  schemaVersion: z.literal(2), status: z.enum(["FAIL", "NOT_VERIFIED"]), staticStatus: z.enum(["PASS", "FAIL"]),
  uiReadiness: z.enum(["FAIL", "NOT_VERIFIED"]), scope: z.literal("static"),
  code: z.enum(["STATIC_FINDINGS", "NO_SCAN_COVERAGE", "ADDITIONAL_VERIFICATION_REQUIRED"]),
  findingCount: z.number().int().nonnegative(), blockingCount: z.number().int().nonnegative(), warningCount: z.number().int().nonnegative(),
  findings: z.array(findingSchema), coverage: coverageSchema, files: fileEvidenceSchema,
  ignoredRules: z.array(z.string()), ignoredValues: z.number().int().nonnegative(),
  checks: z.array(z.object({ id: z.string(), status: z.enum(["PASS", "FAIL", "NOT_RUN"]), producer: z.string().nullable() })),
  fixes: z.array(z.string()), summary: z.string(),
};

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  server.registerResource("designer-skill", "designer://skill", { mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: getSkillRouter() }] }));
  server.registerResource("designer-reference", new ResourceTemplate("designer://reference/{name}", {
    list: async () => ({ resources: REFERENCE_NAMES.map((name) => ({
      uri: `designer://reference/${name}`, name, description: REFERENCE_DESCRIPTIONS[name], mimeType: "text/markdown",
    })) }),
  }), { mimeType: "text/markdown" }, async (uri, variables) => {
    const name = String(variables.name);
    if (!isReferenceName(name)) throw new DesignError("UNKNOWN_REFERENCE", "Unknown designer reference.");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: getReferenceDoc(name) }] };
  });
  server.registerTool("get_preflight_brief", { description: "Start a scope-aware UI task. Load project context next.", annotations },
    async () => text(getPreflightBrief()));
  server.registerTool("get_design_system", { description: "Read the full skill contract and reference routing map.", annotations },
    async () => text(getSkillRouter()));
  server.registerTool("get_reference", {
    description: "Load one task-relevant reference. Style examples are advisory, not universal requirements.",
    annotations, inputSchema: { name: z.enum(REFERENCE_NAMES) },
  }, async ({ name }) => text(getReferenceDoc(name)));
  server.registerTool("anti_slop_checklist", { description: "Read advisory style and truthful-content review guidance.", annotations },
    async () => text(getReferenceDoc("avoid-ai-slop")));
  server.registerTool("list_commands", { description: "Discover canonical commands. Reviews do not authorize edits.", annotations,
    outputSchema: { commands: z.array(z.object({ verb: z.string(), description: z.string(), argumentHint: z.string() })) },
  }, async () => {
    const commands = listCommands();
    return { ...text(commands.map((c) => `${c.verb}: ${c.description}`).join("\n")), structuredContent: { commands } };
  });
  server.registerTool("get_command", {
    description: "Get validated command help and reference names. Load reference contents separately with get_reference.",
    annotations, inputSchema: { verb: z.string().trim().min(1).max(80) },
    outputSchema: { help: z.string(), references: z.array(z.enum(REFERENCE_NAMES)) },
  }, async ({ verb }) => {
    try {
      const help = formatCommandHelp(verb);
      return { ...text(help), structuredContent: { help, references: getCommandReads(verb) } };
    } catch (error) { return failure(error); }
  });
  server.registerTool("dispatch_intent", {
    description: "Route explicit or natural-language UI requests through the canonical registry; load at most four initial references.",
    annotations, inputSchema: { request: z.string().trim().min(1).max(8_000) },
    outputSchema: {
      matched: z.array(z.object({ verb: z.string(), files: z.array(z.enum(REFERENCE_NAMES)), note: z.string(), score: z.number() })),
      recommendedReads: z.array(z.enum(REFERENCE_NAMES)), deferredReads: z.array(z.enum(REFERENCE_NAMES)),
      reason: z.enum(["explicit", "matched", "no-match", "out-of-scope"]), text: z.string(),
    },
  }, async ({ request }) => {
    try { const result = dispatchIntent(request); return { ...text(result.text), structuredContent: { ...result } }; }
    catch (error) { return failure(error); }
  });
  server.registerTool("load_project_context", {
    description: "Read PRODUCT.md and DESIGN.md independently before deciding a direction. Missing documents do not force setup.",
    annotations, inputSchema: { cwd: cwdSchema },
  }, async ({ cwd }) => {
    try { return text(formatProjectContext(loadProjectContext(cwd))); } catch (error) { return failure(error); }
  });
  server.registerTool("commit_design_direction", {
    description: "Validate a context-grounded direction record. Use preserve for bounded fixes; audits need no direction ceremony. Does not persist approval or enforce writes.",
    annotations, inputSchema: {
      mode: z.enum(["preserve", "change"]).default("change"), register: z.enum(["brand", "product"]),
      designRead: z.string().trim().min(20).max(2_000), contextSources: z.array(z.string().trim().min(1).max(2_000)).min(1).max(32),
      aesthetic: z.string().trim().min(1).max(200).optional(), typographyDirection: z.string().trim().min(1).max(2_000).optional(),
      layoutFamilies: z.array(z.string().trim().min(1).max(200)).max(32).optional(),
      designVariance: z.number().int().min(1).max(10).optional(), motionIntensity: z.number().int().min(1).max(10).optional(),
      visualDensity: z.number().int().min(1).max(10).optional(), physicalScene: z.string().max(2_000).optional(),
      antiSlopRisks: z.array(z.string().max(500)).max(32).optional(), inverseTestPass: z.boolean().optional(),
      inverseTestDescription: z.string().max(2_000).optional(), namedReferences: z.array(z.string().max(500)).max(16).optional(),
    },
    outputSchema: { status: z.enum(["PASS", "FAIL"]), scope: z.literal("input-validation"), message: z.string(),
      directionId: z.string().optional(), direction: z.record(z.string(), z.unknown()).optional(), fixes: z.array(z.string()).optional() },
  }, async (input) => {
    const result = commitDesignDirection(input);
    return { ...text(formatDesignDirectionResult(result)), structuredContent: { ...result } };
  });
  server.registerTool("get_palette_seed", { description: "Optional palette seed for authorized new identity work only.", annotations,
    inputSchema: { id: z.string().max(200).optional(), from: z.string().max(2_000).optional() },
  }, async ({ id, from }) => text(getPaletteSeed({ id, from })));
  server.registerTool("detect_antipatterns", {
    description: "Bounded static scan with coverage, file hashes and explicit ignored inputs. Not a rendered audit.", annotations,
    inputSchema: { target: targetSchema, cwd: cwdSchema }, outputSchema: scanOutput,
  }, async ({ target, cwd }) => {
    try { const result = await scanAntipatterns(target, { cwd });
      return { ...text(formatDetectionResults(result.findings)), structuredContent: { ...result } };
    } catch (error) { return failure(error); }
  });
  server.registerTool("review_and_gate", {
    description: "Static verification only. Empty scans fail; successful static checks still report overall NOT_VERIFIED. Run other required checks separately.",
    annotations, inputSchema: {
      target: targetSchema, cwd: cwdSchema, blockingRules: z.array(z.string().trim().min(1).max(100)).max(64).optional(),
      includeChecklistExcerpt: z.boolean().optional().describe("Deprecated compatibility input; no implicit reference loading."),
    }, outputSchema: gateOutput,
  }, async ({ target, cwd, blockingRules, includeChecklistExcerpt }) => {
    try { const result = await reviewAndGate(target, { cwd, blockingRules });
      return { ...text(formatGateResult(result, includeChecklistExcerpt)), structuredContent: { ...result } };
    } catch (error) { return failure(error); }
  });
  server.registerPrompt("design", {
    description: "Start a context-first UI task with a compact brief, not an eagerly loaded reference library.",
    argsSchema: { task: z.string().min(1).max(8_000), aesthetic: z.string().max(200).optional() },
  }, ({ task, aesthetic }) => ({ messages: [{ role: "user", content: { type: "text", text:
    `${getPreflightBrief()}\n\n${dispatchIntent(task).text}\n\nTask: ${task}${aesthetic ? `\nRequested aesthetic: ${aesthetic}` : ""}`,
  } }] }));
  return server;
}
