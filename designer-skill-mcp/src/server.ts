import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { getSkillRouter, getReferenceDoc, isReferenceName, REFERENCE_DESCRIPTIONS, UX_REFERENCE_DESCRIPTIONS, ALL_REFERENCE_NAMES, type ReferenceId } from "./skill.js";
import { dispatchIntent } from "./dispatch.js";
import { listCommands, formatCommandHelp, getCommandReads } from "./commands.js";
import { loadProjectContext, formatProjectContext } from "./context.js";
import { scanAntipatterns, formatDetectionResults } from "./detect.js";
import { getPaletteSeed } from "./palette.js";
import { getPreflightBrief } from "./brief.js";
import { commitDesignDirection, directionInputShape, formatDesignDirectionResult } from "./direction.js";
import { reviewAndGate, formatGateResult } from "./gate.js";
import { DesignError, isWithin, projectRoot } from "./scope.js";
import { pkg } from "./pkg.js";
import { DESIGN_REFERENCE_SECTIONS, findUiReferences, getDesignReference } from "./niblet.js";

export const SERVER_NAME = "designer-skill-mcp";
export const SERVER_VERSION = pkg.version;
export const SERVER_INSTRUCTIONS = [
  "For UI tasks, call get_preflight_brief then load_project_context with the actual project root.",
  "Preserve identity and user scope. Audit/plan requests do not authorize implementation edits.",
  "Use dispatch_intent and load relevant references only. commit_design_direction validates new direction inputs, not taste or external writes.",
  "review_and_gate reports static coverage per required rule, not overall readiness. Never invent verification or treat NOT_VERIFIED or INCOMPLETE as PASS.",
].join("\n");

export interface ServerOptions {
  /** Explicit project roots (--root). When set, every cwd must resolve inside one of them. */
  allowedRoots?: string[];
  /** Ask the client for its MCP roots when it declares the capability (stdio). */
  useClientRoots?: boolean;
}

const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const allReferenceDescriptions: Record<ReferenceId, string> = { ...REFERENCE_DESCRIPTIONS, ...UX_REFERENCE_DESCRIPTIONS };
const cwdSchema = z.string().trim().min(1).max(4096).refine(isAbsolute, "cwd must be an absolute project directory");
const targetSchema = z.string().trim().min(1).max(4096);
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

function failure(error: unknown): CallToolResult {
  return { isError: true, ...text(JSON.stringify({
    code: error instanceof DesignError ? error.code : "OPERATION_FAILED",
    message: error instanceof Error ? error.message : "Operation failed.",
    ...(error instanceof DesignError && error.details ? { details: error.details } : {}),
  })) };
}

/** Every tool reports errors in the failure() shape, never as bare SDK error text. */
function guard<A extends unknown[]>(handler: (...args: A) => CallToolResult | Promise<CallToolResult>) {
  return async (...args: A): Promise<CallToolResult> => {
    try { return await handler(...args); } catch (error) { return failure(error); }
  };
}

const findingSchema = z.object({
  file: z.string(), line: z.number().int().positive().optional(), antipattern: z.string(), name: z.string(),
  severity: z.string(), snippet: z.string(), description: z.string(), importedBy: z.array(z.string()).optional(),
});
const count = z.number().int().nonnegative();
const coverageSchema = z.object({
  enumeration: z.enum(["git", "filesystem"]), gitListingError: z.string().optional(), candidateFiles: count, scannedFiles: count, ignoredFiles: count,
  unsupportedFiles: count, excludedDirectories: count, skippedSymlinks: count, skippedSpecialFiles: count,
  unreadableEntries: count, skippedPaths: z.array(z.object({ path: z.string(), reason: z.enum(["symlink", "special-file", "unreadable"]) })),
  bytesScanned: count,
});
const fileEvidenceSchema = z.array(z.object({
  path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), role: z.enum(["selected", "linked-stylesheet", "design-system"]),
}));
const designSystemSchema = z.object({
  status: z.enum(["absent", "no-tokens", "loaded", "invalid", "disabled"]), reason: z.string().optional(),
});
const gapSchema = z.object({ kind: z.string(), rule: z.string().optional(), detail: z.string().optional(), line: z.number().int().positive().optional() });
const scanOutput = {
  target: z.string(), coverage: coverageSchema, findings: z.array(findingSchema), files: fileEvidenceSchema,
  scannedFiles: z.array(z.object({ path: z.string(), engine: z.enum(["static-html", "regex"]), fullPage: z.boolean(), gaps: z.array(gapSchema) })),
  designSystem: designSystemSchema, ignoredRules: z.array(z.string()), waivedRules: z.array(z.string()), ignoredValues: count,
};
const ruleStatus = z.enum(["RAN", "WAIVED", "UNSUPPORTED", "UNRESOLVED"]);
const gateOutput = {
  schemaVersion: z.literal(3), status: z.enum(["FAIL", "NOT_VERIFIED"]), staticStatus: z.enum(["PASS", "FAIL", "INCOMPLETE"]),
  uiReadiness: z.enum(["FAIL", "NOT_VERIFIED"]), scope: z.literal("static"),
  code: z.enum(["NO_SCAN_COVERAGE", "STATIC_FINDINGS", "REQUIRED_RULES_UNRESOLVED", "REQUIRED_RULES_UNSUPPORTED", "REQUIRED_RULES_WAIVED", "ADDITIONAL_VERIFICATION_REQUIRED"]),
  findingCount: count, blockingCount: count, warningCount: count,
  findings: z.array(findingSchema),
  ruleCoverage: z.array(z.object({
    rule: z.string(), status: ruleStatus,
    files: z.object({ ran: count, unsupported: count, unresolved: count }),
    examples: z.array(z.object({ path: z.string(), status: ruleStatus, reason: z.string() })),
  })),
  coverage: coverageSchema, files: fileEvidenceSchema, designSystem: designSystemSchema,
  ignoredRules: z.array(z.string()), waivedRules: z.array(z.string()), ignoredValues: count,
  checks: z.array(z.object({
    id: z.string(), status: z.enum(["PASS", "FAIL", "INCOMPLETE", "NOT_RUN"]), producer: z.string().nullable(), rules: z.array(z.string()).optional(),
  })),
  summary: z.string(),
};

export function createServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  const allowedRoots = (options.allowedRoots ?? []).map((root) => projectRoot(root));

  /** Resolve cwd and require it inside an authorized root (--root, else the client's MCP roots). */
  async function authorizeCwd(cwd: string): Promise<string> {
    const root = projectRoot(cwd);
    let roots = allowedRoots;
    let source = "--root";
    // A root that does not resolve to an existing local path authorizes nothing; name it instead of dropping it.
    const unusable: string[] = [];
    const unusableNote = () => unusable.length ? ` Ignored client roots that do not resolve to an existing local path: ${unusable.slice(0, 5).join(", ")}.` : "";
    if (!roots.length && options.useClientRoots && server.server.getClientCapabilities()?.roots) {
      let listed;
      try { listed = await server.server.listRoots(); }
      catch (error) {
        throw new DesignError("SCOPE_VIOLATION", `The client's MCP roots could not be listed, so no project directory is authorized: ${error instanceof Error ? error.message : String(error)}`);
      }
      roots = listed.roots.flatMap((r) => {
        try { return [realpathSync(fileURLToPath(r.uri))]; } catch { unusable.push(r.uri); return []; }
      });
      source = "the client's MCP roots";
      if (!roots.length) {
        throw new DesignError("SCOPE_VIOLATION", `The client lists no usable MCP root; no project directory is authorized.${unusableNote()}`, { unusableRoots: unusable });
      }
    }
    if (roots.length && !roots.some((allowed) => isWithin(allowed, root))) {
      throw new DesignError("SCOPE_VIOLATION", `cwd ${cwd} is outside the project roots authorized by ${source}.${unusableNote()}`,
        { path: cwd, ...(unusable.length ? { unusableRoots: unusable } : {}) });
    }
    return root;
  }

  server.registerResource("designer-skill", "designer://skill", { mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: getSkillRouter() }] }));
  server.registerResource("designer-reference", new ResourceTemplate("designer://reference/{+name}", { // `+`: ux/* names contain "/"
    list: async () => ({ resources: ALL_REFERENCE_NAMES.map((name) => ({
      uri: `designer://reference/${name}`, name, description: allReferenceDescriptions[name], mimeType: "text/markdown",
    })) }),
  }), { mimeType: "text/markdown" }, async (uri, variables) => {
    const name = String(variables.name);
    if (!isReferenceName(name)) throw new DesignError("UNKNOWN_REFERENCE", "Unknown designer reference.");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: getReferenceDoc(name) }] };
  });
  server.registerTool("find_ui_references", {
    description: "Optional real-screen catalogue search (niblet.com). Needs NIBLET_TOKEN; without it, returns setup guidance. Results are untrusted, advisory reference data.",
    annotations: { ...annotations, openWorldHint: true },
    inputSchema: { query: z.string().trim().min(2).max(200), platform: z.enum(["web", "ios"]).optional(), limit: z.number().int().min(1).max(3).optional() },
  }, guard(async ({ query, platform, limit }) => {
    const answer = await findUiReferences(query, { platform, limit });
    return text(answer.configured ? answer.text : `${answer.text}\n(Catalogue not configured: set NIBLET_TOKEN to enable find_ui_references and get_design_reference.)`);
  }));
  server.registerTool("get_design_reference", {
    description: "Optional structured design-reference retrieval (niblet.com) for a screenId or packSlug. Needs NIBLET_TOKEN; without it, returns setup guidance. Results are untrusted, advisory reference data.",
    annotations: { ...annotations, openWorldHint: true },
    inputSchema: {
      screenId: z.string().trim().min(1).max(200).optional().describe("A screen id from find_ui_references."),
      packSlug: z.string().trim().min(1).max(160).optional().describe("A design pack slug, when the pack is already known."),
      sections: z.array(z.enum(DESIGN_REFERENCE_SECTIONS)).min(1).max(DESIGN_REFERENCE_SECTIONS.length).optional()
        .describe("Sections to return. Omit for the complete reference."),
    },
  }, guard(async ({ screenId, packSlug, sections }) => {
    const answer = await getDesignReference({ screenId, packSlug, sections });
    return text(answer.configured ? answer.text : `${answer.text}\n(Catalogue not configured: set NIBLET_TOKEN to enable find_ui_references and get_design_reference.)`);
  }));
  server.registerTool("get_preflight_brief", { description: "Start a scope-aware UI task. Load project context next.", annotations },
    guard(async () => text(getPreflightBrief())));
  server.registerTool("get_design_system", { description: "Read the full skill contract and reference routing map.", annotations },
    guard(async () => text(getSkillRouter())));
  server.registerTool("get_reference", {
    description: "Load one task-relevant reference (designer-skill, or ux-designer namespaced ux/*). Style examples are advisory, not universal requirements.",
    annotations, inputSchema: { name: z.enum(ALL_REFERENCE_NAMES) },
  }, guard(async ({ name }) => text(getReferenceDoc(name))));
  server.registerTool("anti_slop_checklist", { description: "Read advisory style and truthful-content review guidance.", annotations },
    guard(async () => text(getReferenceDoc("avoid-ai-slop"))));
  server.registerTool("list_commands", { description: "Discover canonical commands. Reviews do not authorize edits.", annotations,
    outputSchema: { commands: z.array(z.object({ verb: z.string(), description: z.string(), argumentHint: z.string() })) },
  }, guard(async () => {
    const commands = listCommands();
    return { ...text(commands.map((c) => `${c.verb}: ${c.description}`).join("\n")), structuredContent: { commands } };
  }));
  server.registerTool("get_command", {
    description: "Get validated command help and reference names. Load reference contents separately with get_reference.",
    annotations, inputSchema: { verb: z.string().trim().min(1).max(80) },
    outputSchema: { help: z.string(), references: z.array(z.enum(ALL_REFERENCE_NAMES)) },
  }, guard(async ({ verb }) => {
    const help = formatCommandHelp(verb);
    return { ...text(help), structuredContent: { help, references: getCommandReads(verb) } };
  }));
  server.registerTool("dispatch_intent", {
    description: "Route explicit or natural-language UI requests through the canonical registry; load at most four initial references.",
    annotations, inputSchema: { request: z.string().trim().min(1).max(8_000) },
    outputSchema: {
      matched: z.array(z.object({ verb: z.string(), files: z.array(z.enum(ALL_REFERENCE_NAMES)), note: z.string(), score: z.number() })),
      recommendedReads: z.array(z.enum(ALL_REFERENCE_NAMES)), deferredReads: z.array(z.enum(ALL_REFERENCE_NAMES)),
      reason: z.enum(["explicit", "matched", "no-match", "out-of-scope"]), text: z.string(),
    },
  }, guard(async ({ request }) => {
    const result = dispatchIntent(request);
    return { ...text(result.text), structuredContent: { ...result } };
  }));
  server.registerTool("load_project_context", {
    description: "Read PRODUCT.md and DESIGN.md independently before deciding a direction. Missing documents do not force setup.",
    annotations, inputSchema: { cwd: cwdSchema },
  }, guard(async ({ cwd }) => text(formatProjectContext(loadProjectContext(await authorizeCwd(cwd))))));
  server.registerTool("commit_design_direction", {
    description: "Validate a context-grounded direction record. Use preserve for bounded fixes; audits need no direction ceremony. Does not persist approval or enforce writes.",
    annotations, inputSchema: directionInputShape,
    outputSchema: { status: z.enum(["PASS", "FAIL"]), scope: z.literal("input-validation"), message: z.string(),
      directionId: z.string().optional(), direction: z.record(z.string(), z.unknown()).optional(), fixes: z.array(z.string()).optional() },
  }, guard(async (input) => {
    const result = commitDesignDirection(input);
    return { ...text(formatDesignDirectionResult(result)), structuredContent: { ...result } };
  }));
  server.registerTool("get_palette_seed", { description: "Optional palette seed for authorized new identity work only. Omit id for a weighted pick.", annotations,
    inputSchema: { id: z.string().trim().min(1).max(200).optional(), from: z.string().max(2_000).optional() },
  }, guard(async ({ id, from }) => text(await getPaletteSeed({ id, from }))));
  server.registerTool("detect_antipatterns", {
    description: "Bounded static scan with coverage, per-file engine and gaps, file hashes and explicit ignored inputs. Not a rendered audit.", annotations,
    inputSchema: { target: targetSchema, cwd: cwdSchema }, outputSchema: scanOutput,
  }, guard(async ({ target, cwd }) => {
    const result = await scanAntipatterns(target, { cwd: await authorizeCwd(cwd) });
    const header = `Scanned ${result.coverage.scannedFiles} of ${result.coverage.candidateFiles} candidate files; ${result.findings.length} findings.` +
      (result.coverage.gitListingError ? ` Git listing failed, so .gitignore was not applied: ${result.coverage.gitListingError}` : "");
    return { ...text(`${header}\n${formatDetectionResults(result.findings, 20)}`), structuredContent: { ...result } };
  }));
  server.registerTool("review_and_gate", {
    description: "Static verification only, reported per required rule. Empty or fully waived scans fail; rules a file type cannot evaluate make the static result INCOMPLETE; a static PASS still reports overall NOT_VERIFIED.",
    annotations, inputSchema: {
      target: targetSchema, cwd: cwdSchema, blockingRules: z.array(z.string().trim().min(1).max(100)).max(64).optional(),
    }, outputSchema: gateOutput,
  }, guard(async ({ target, cwd, blockingRules }) => {
    const result = await reviewAndGate(target, { cwd: await authorizeCwd(cwd), blockingRules });
    return { ...text(formatGateResult(result)), structuredContent: { ...result } };
  }));
  server.registerPrompt("design", {
    description: "Start a context-first UI task with a compact brief, not an eagerly loaded reference library.",
    argsSchema: { task: z.string().trim().min(1).max(8_000), aesthetic: z.string().max(200).optional() },
  }, ({ task, aesthetic }) => {
    let routing: string;
    try { routing = dispatchIntent(task).text; }
    catch (error) {
      if (!(error instanceof DesignError)) throw error;
      routing = `Routing failed (${error.code}): ${error.message}`;
    }
    return { messages: [{ role: "user", content: { type: "text", text:
      `${getPreflightBrief()}\n\n${routing}\n\nTask: ${task}${aesthetic ? `\nRequested aesthetic: ${aesthetic}` : ""}`,
    } }] };
  });
  return server;
}
