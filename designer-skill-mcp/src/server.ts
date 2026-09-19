// Builds the designer-skill MCP server: resources, guidance tools, and a
// `design` prompt. Transport-agnostic. No API key required.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSkillRouter,
  getReferenceDoc,
  isReferenceName,
  REFERENCE_DESCRIPTIONS,
  UX_REFERENCE_DESCRIPTIONS,
  ALL_REFERENCE_NAMES,
  type ReferenceId,
} from "./skill.js";
import { dispatchIntent, ALWAYS_READS } from "./dispatch.js";
import { listCommands, formatCommandHelp, getCommandReads } from "./commands.js";
import { loadProjectContext, formatProjectContext } from "./context.js";
import { detectAntipatterns, formatDetectionResults } from "./detect.js";
import { getPaletteSeed } from "./palette.js";
import { pkg } from "./pkg.js";
import { getPreflightBrief } from "./brief.js";
import { commitDesignDirection, formatDesignDirectionResult, directionInputSchema } from "./direction.js";
import { reviewAndGate, formatGateResult, gateRequirementText } from "./gate.js";
import { findUiReferences, getDesignReference } from "./niblet.js";

export const SERVER_NAME = "designer-skill-mcp";
export const SERVER_VERSION = pkg.version;

export const SERVER_INSTRUCTIONS = [
  "designer-skill gives this agent UI design superpowers. For ANY web/app UI work",
  "(build, redesign, polish, audit, components, design systems):",
  "1. Call get_preflight_brief FIRST: it returns the binding workflow.",
  "2. Call commit_design_direction and get PASS before writing UI code.",
  "3. Use dispatch_intent to route the request to verbs + reference files; load only those via get_reference.",
  "4. Call review_and_gate before claiming the work is done: do not claim done on FAIL.",
  "Read reference files on demand; do not design from memory. Not for backend, CLI, or non-UI code.",
].join("\n");

/** Every tool returns one text block; this is the whole envelope. */
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  // ---- Resources -----------------------------------------------------------
  server.registerResource(
    "designer-skill",
    "designer://skill",
    {
      title: "designer-skill (router)",
      description: "SKILL.md — the entry point: session preflight, precedence rule, routing map, ship gate.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: getSkillRouter() }],
    }),
  );

  server.registerResource(
    "designer-reference",
    new ResourceTemplate("designer://reference/{name}", {
      list: async () => ({
        resources: ALL_REFERENCE_NAMES.map((name) => ({
          uri: `designer://reference/${name}`,
          name,
          description:
            name in REFERENCE_DESCRIPTIONS
              ? REFERENCE_DESCRIPTIONS[name as keyof typeof REFERENCE_DESCRIPTIONS]
              : UX_REFERENCE_DESCRIPTIONS[name as keyof typeof UX_REFERENCE_DESCRIPTIONS],
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "designer-skill reference / ux-designer reference",
      description: "One of the reference files across the designer-skill and ux-designer modules.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const name = String(variables.name);
      if (!isReferenceName(name)) {
        throw new Error(`Unknown reference "${name}". Valid: ${ALL_REFERENCE_NAMES.join(", ")}.`);
      }
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: getReferenceDoc(name) }],
      };
    },
  );

  // ---- Tools ---------------------------------------------------------------
  server.registerTool(
    "get_preflight_brief",
    {
      title: "Preflight brief (call first on every UI task)",
      description:
        "Returns the compact binding workflow (register, aesthetic commitment, inverse test, slop bans, layout/type rules, ship gate): call FIRST before any UI code, then commit_design_direction, then dispatch_intent.",
    },
    async () => text(getPreflightBrief()),
  );

  server.registerTool(
    "commit_design_direction",
    {
      title: "Commit design direction before code",
      description:
        "Required checkpoint before writing UI code. Submit a one-line design read, three calibration dials, register, aesthetic system, physical scene, layout families, typography direction, anti-slop risks, and inverse-test result. Returns PASS (proceed) or FAIL (fix and resubmit).",
      inputSchema: directionInputSchema,
    },
    async (input) => text(formatDesignDirectionResult(commitDesignDirection(input))),
  );

  server.registerTool(
    "get_design_system",
    {
      title: "Get the designer-skill router",
      description:
        "Returns the full SKILL.md router. For UI tasks, prefer get_preflight_brief first (compact). Use this for deep routing map and reference index.",
    },
    async () => text(getSkillRouter()),
  );

  server.registerTool(
    "get_reference",
    {
      title: "Get a designer-skill or ux-designer reference file",
      description: `Returns the full text of one reference file (designer-skill or ux-designer, ux files are namespaced ux/…). Valid names: ${ALL_REFERENCE_NAMES.join(", ")}.`,
      inputSchema: { name: z.enum(ALL_REFERENCE_NAMES) },
    },
    async ({ name }) => text(getReferenceDoc(name as ReferenceId)),
  );

  server.registerTool(
    "dispatch_intent",
    {
      title: "Map a UI request to design moves + files to read",
      description:
        "Maps a natural-language UI request (e.g. 'make it pop', 'the spacing feels off', 'make it production-ready') to the design verb(s) and reference files to read before implementing.",
      inputSchema: { request: z.string().min(1).describe("What the user wants done to the UI.") },
    },
    async ({ request }) => text(dispatchIntent(request).text),
  );

  server.registerTool(
    "anti_slop_checklist",
    {
      title: "Anti-slop ship gate",
      description:
        "Returns the designer-skill anti-AI-slop reference: the tell ban-list, category-reflex checks, the output-completeness contract, and the final checklist. Run before declaring any UI work done.",
    },
    async () => text(getReferenceDoc("avoid-ai-slop")),
  );

  server.registerTool(
    "list_commands",
    {
      title: "List all designer-skill design commands",
      description:
        "Returns all design verbs (setup, build, preview, check, finish, amplify, …) with descriptions and argument hints. Use to discover the command vocabulary before calling get_command.",
    },
    async () => {
      const lines = listCommands().map(
        (c) => `- **${c.verb}** — ${c.description}${c.argumentHint ? ` \`${c.argumentHint}\`` : ""}`,
      );
      return text(`# designer-skill commands\n\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "get_command",
    {
      title: "Get guidance for a specific design command",
      description:
        "Returns the description, argument hint, and reference files to read for a design verb (e.g. setup, build, check, finish). Legacy names (init, craft, audit, …) resolve via aliases. Call list_commands first if unsure which verb applies.",
      inputSchema: { verb: z.string().min(1).describe("Design command verb, e.g. setup, build, check, finish.") },
    },
    async ({ verb }) => {
      const help = formatCommandHelp(verb);
      const refTexts = getCommandReads(verb).map((name) => `## reference/${name}.md\n\n${getReferenceDoc(name as ReferenceId)}`);
      return text([help, ...refTexts].join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "load_project_context",
    {
      title: "Load PRODUCT.md and DESIGN.md from the project",
      description:
        "Reads PRODUCT.md (and DESIGN.md when present) from the project root or .agents/context/ or docs/. Returns NO_PRODUCT_MD when missing — then run get_command({ verb: \"setup\" }) before any UI work.",
      inputSchema: {
        cwd: z.string().optional().describe("Project root directory. Defaults to the MCP server's working directory."),
      },
    },
    async ({ cwd }) => text(formatProjectContext(loadProjectContext(cwd ?? process.cwd()))),
  );

  server.registerTool(
    "get_palette_seed",
    {
      title: "Get an OKLCH brand-seed color for greenfield projects",
      description:
        "Returns one curated OKLCH seed color + mood + composition strategy for composing a full palette on greenfield work. Skip when committed brand colors already exist in the project.",
      inputSchema: {
        id: z.string().optional().describe("Specific seed id, e.g. seed-021."),
        from: z.string().optional().describe("Deterministic seed key (hashed to a seed)."),
      },
    },
    async ({ id, from }) => text(await getPaletteSeed({ id, from })),
  );

  server.registerTool(
    "detect_antipatterns",
    {
      title: "Scan files for UI anti-patterns (deterministic)",
      description:
        "Runs 44 deterministic detector rules against a file or directory. No LLM, no API key. Respects .designer-skill/config.json ignore rules. Use during check/review before declaring work done.",
      inputSchema: {
        target: z.string().min(1).describe("File or directory path to scan (relative to cwd or absolute)."),
        cwd: z.string().optional().describe("Project root for config resolution. Defaults to process.cwd()."),
      },
    },
    async ({ target, cwd }) => {
      const findings = await detectAntipatterns(target, { cwd: cwd ?? process.cwd() });
      return text(`${formatDetectionResults(findings)}\n\n\`\`\`json\n${JSON.stringify(findings, null, 2)}\n\`\`\``);
    },
  );

  server.registerTool(
    "review_and_gate",
    {
      title: "Review and ship gate (call before declaring UI work done)",
      description: `Composite gate: runs detect_antipatterns, computes slop score (pass ${gateRequirementText()}), returns fix list + manual checklist. Do not claim completion on FAIL.`,
      inputSchema: {
        target: z.string().min(1).describe("File or directory to scan (relative to cwd or absolute)."),
        cwd: z.string().optional().describe("Project root. Defaults to process.cwd()."),
        includeChecklistExcerpt: z
          .boolean()
          .optional()
          .describe("Include a short avoid-ai-slop excerpt in the response."),
      },
    },
    async ({ target, cwd, includeChecklistExcerpt }) =>
      text(formatGateResult(await reviewAndGate(target, { cwd: cwd ?? process.cwd() }), includeChecklistExcerpt === true)),
  );

  server.registerTool(
    "find_ui_references",
    {
      title: "Find real-screen UI references (niblet.com catalogue)",
      description:
        "Searches the Niblet catalogue (niblet.com) for one to three real full-screen references matching a concrete UI question — extract moves, don't copy layouts. Optional: needs NIBLET_TOKEN in this server's environment; without it, returns setup guidance and the bundled references remain authoritative.",
      inputSchema: {
        query: z.string().min(1).max(240).describe("Concrete UI question, e.g. 'subscription settings with clear renewal status'."),
        platform: z.enum(["web", "ios"]).optional().describe("Restrict results to one platform."),
        limit: z.number().int().min(1).max(3).optional().describe("References to return (1–3, default 2)."),
      },
    },
    async ({ query, platform, limit }) =>
      text((await findUiReferences(query, { platform, limit })).text),
  );

  server.registerTool(
    "get_design_reference",
    {
      title: "Read a recorded design reference (niblet.com catalogue)",
      description:
        "Reads the recorded colors, typography, and components behind a web screen returned by find_ui_references, or a design pack by slug. Optional: needs NIBLET_TOKEN; without it, returns setup guidance.",
      inputSchema: {
        screenId: z.string().min(1).max(160).optional().describe("Screen id from find_ui_references."),
        packSlug: z.string().min(1).max(160).optional().describe("Design pack slug."),
        sections: z
          .array(z.enum(["overview", "colors", "typography", "components", "provenance"]))
          .min(1)
          .optional()
          .describe("Sections to return; omit for the full document."),
      },
    },
    async ({ screenId, packSlug, sections }) =>
      text((await getDesignReference({ screenId, packSlug, sections })).text),
  );

  // ---- Prompt --------------------------------------------------------------
  server.registerPrompt(
    "design",
    {
      title: "Design with the designer-skill",
      description:
        "Loads the designer-skill (router + the references relevant to your task) as context and asks you to design, refactor, or enhance the given UI.",
      argsSchema: {
        task: z.string().describe("What to design, refactor, or improve."),
        aesthetic: z.string().optional().describe("Optional aesthetic direction."),
      },
    },
    ({ task, aesthetic }) => {
      const reads = new Set<ReferenceId>(dispatchIntent(task).recommendedReads);
      const promptExtras: ReferenceId[] = ["design-principles", "differentiation-playbook"];
      for (const r of [...ALWAYS_READS, ...promptExtras]) reads.add(r);
      const context = [
        getPreflightBrief(),
        getSkillRouter(),
        ...[...reads].map((r) => getReferenceDoc(r)),
      ].join("\n\n---\n\n");
      const ask = aesthetic ? `${task}\n\nAesthetic direction: ${aesthetic}` : task;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                "Use the designer-skill workflow: get_preflight_brief → commit_design_direction → implement → review_and_gate. " +
                "Commit to one aesthetic system, preserve functionality on refactors, and do not finish on a failed gate.\n\n" +
                `${context}\n\n---\n\nTask: ${ask}`,
            },
          },
        ],
      };
    },
  );

  return server;
}
