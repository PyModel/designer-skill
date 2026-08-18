// Builds the designer-skill MCP server: resources, guidance tools, and a
// `design` prompt. Transport-agnostic. No API key required.
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSkillRouter,
  getReferenceDoc,
  isReferenceName,
  REFERENCE_NAMES,
  REFERENCE_DESCRIPTIONS,
  type ReferenceName,
} from "./skill.js";
import { dispatchIntent } from "./dispatch.js";
import { listCommands, formatCommandHelp, getCommandReads } from "./commands.js";
import { loadProjectContext, formatProjectContext } from "./context.js";
import { detectAntipatterns, formatDetectionResults } from "./detect.js";
import { getPaletteSeed } from "./palette.js";
import { pkg } from "./pkg.js";
import { getPreflightBrief } from "./brief.js";
import { commitDesignDirection, formatDesignDirectionResult } from "./direction.js";
import { reviewAndGate, formatGateResult } from "./gate.js";

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
        resources: REFERENCE_NAMES.map((name) => ({
          uri: `designer://reference/${name}`,
          name,
          description: REFERENCE_DESCRIPTIONS[name],
          mimeType: "text/markdown",
        })),
      }),
    }),
    {
      title: "designer-skill reference",
      description: "One of the fifteen designer-skill reference files.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const name = String(variables.name);
      if (!isReferenceName(name)) {
        throw new Error(`Unknown reference "${name}". Valid: ${REFERENCE_NAMES.join(", ")}.`);
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
    async () => ({ content: [{ type: "text", text: getPreflightBrief() }] }),
  );

  server.registerTool(
    "commit_design_direction",
    {
      title: "Commit design direction before code",
      description:
        "Required checkpoint before writing UI code. Submit a one-line design read, three calibration dials, register, aesthetic system, physical scene, layout families, typography direction, anti-slop risks, and inverse-test result. Returns PASS (proceed) or FAIL (fix and resubmit).",
      inputSchema: {
        register: z.enum(["brand", "product"]).describe("brand = distinctiveness bar; product = earned familiarity bar."),
        designRead: z
          .string()
          .min(40)
          .describe("One sentence naming the surface, audience, and intended visual language."),
        designVariance: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("1 = strict symmetry and convention; 10 = expressive, off-grid composition."),
        motionIntensity: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("1 = static; 10 = cinematic or physics-led. Accessibility still overrides the dial."),
        visualDensity: z
          .number()
          .int()
          .min(1)
          .max(10)
          .describe("1 = gallery-like and airy; 10 = compact, information-dense cockpit."),
        aesthetic: z
          .string()
          .min(1)
          .describe("One of: minimalist, brutalist, soft, high-end-stitch, brand-identity, product."),
        physicalScene: z
          .string()
          .min(1)
          .describe("One sentence: who, where, light, mood — must force light/dark and tone."),
        layoutFamilies: z
          .array(z.string().min(1))
          .min(1)
          .describe("Layout patterns for this surface (≥2 for brand, ≥1 for product)."),
        typographyDirection: z
          .string()
          .min(1)
          .describe("Font pairing + scale approach, e.g. grotesk display + humanist body, 1.333 ratio."),
        antiSlopRisks: z
          .array(z.string().min(1))
          .min(2)
          .describe("≥2 specific AI-slop tells you are actively avoiding on this surface."),
        inverseTestPass: z.boolean().describe("true only when the inverse test passes — category-modal descriptions must be reworked."),
        inverseTestDescription: z
          .string()
          .min(1)
          .describe("Why this direction is NOT category-modal (specific user + visual lane, not industry template copy)."),
        namedReferences: z
          .array(z.string().min(1))
          .optional()
          .describe("Optional: 2–3 real sites/products with one extracted move each."),
      },
    },
    async (input) => ({
      content: [{ type: "text", text: formatDesignDirectionResult(commitDesignDirection(input)) }],
    }),
  );

  server.registerTool(
    "get_design_system",
    {
      title: "Get the designer-skill router",
      description:
        "Returns the full SKILL.md router. For UI tasks, prefer get_preflight_brief first (compact). Use this for deep routing map and reference index.",
    },
    async () => ({ content: [{ type: "text", text: getSkillRouter() }] }),
  );

  server.registerTool(
    "get_reference",
    {
      title: "Get a designer-skill reference file",
      description: `Returns the full text of one designer-skill reference file. Valid names: ${REFERENCE_NAMES.join(", ")}.`,
      inputSchema: { name: z.enum(REFERENCE_NAMES) },
    },
    async ({ name }) => ({ content: [{ type: "text", text: getReferenceDoc(name as ReferenceName) }] }),
  );

  server.registerTool(
    "dispatch_intent",
    {
      title: "Map a UI request to design moves + files to read",
      description:
        "Maps a natural-language UI request (e.g. 'make it pop', 'the spacing feels off', 'make it production-ready') to the design verb(s) and reference files to read before implementing.",
      inputSchema: { request: z.string().min(1).describe("What the user wants done to the UI.") },
    },
    async ({ request }) => ({ content: [{ type: "text", text: dispatchIntent(request).text }] }),
  );

  server.registerTool(
    "anti_slop_checklist",
    {
      title: "Anti-slop ship gate",
      description:
        "Returns the designer-skill anti-AI-slop reference: the tell ban-list, category-reflex checks, the output-completeness contract, and the final checklist. Run before declaring any UI work done.",
    },
    async () => ({ content: [{ type: "text", text: getReferenceDoc("avoid-ai-slop") }] }),
  );

  server.registerTool(
    "list_commands",
    {
      title: "List all designer-skill design commands",
      description:
        "Returns all design verbs (setup, build, preview, check, finish, amplify, …) with descriptions and argument hints. Use to discover the command vocabulary before calling get_command.",
    },
    async () => {
      const cmds = listCommands();
      const lines = cmds.map((c) => `- **${c.verb}** — ${c.description}${c.argumentHint ? ` \`${c.argumentHint}\`` : ""}`);
      return { content: [{ type: "text", text: `# designer-skill commands\n\n${lines.join("\n")}` }] };
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
      const reads = getCommandReads(verb);
      const refTexts = reads.map((name) => `## reference/${name}.md\n\n${getReferenceDoc(name)}`);
      return { content: [{ type: "text", text: [help, ...refTexts].join("\n\n---\n\n") }] };
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
    async ({ cwd }) => {
      const ctx = loadProjectContext(cwd ?? process.cwd());
      return { content: [{ type: "text", text: formatProjectContext(ctx) }] };
    },
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
    async ({ id, from }) => ({ content: [{ type: "text", text: getPaletteSeed({ id, from }) }] }),
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
      const json = JSON.stringify(findings, null, 2);
      const summary = formatDetectionResults(findings);
      return { content: [{ type: "text", text: `${summary}\n\n\`\`\`json\n${json}\n\`\`\`` }] };
    },
  );

  server.registerTool(
    "review_and_gate",
    {
      title: "Review and ship gate (call before declaring UI work done)",
      description:
        "Composite gate: runs detect_antipatterns, computes slop score (pass ≥85, 0 blocking slop), returns fix list + manual checklist. Do not claim completion on FAIL.",
      inputSchema: {
        target: z.string().min(1).describe("File or directory to scan (relative to cwd or absolute)."),
        cwd: z.string().optional().describe("Project root. Defaults to process.cwd()."),
        includeChecklistExcerpt: z
          .boolean()
          .optional()
          .describe("Include a short avoid-ai-slop excerpt in the response."),
      },
    },
    async ({ target, cwd, includeChecklistExcerpt }) => {
      const result = await reviewAndGate(target, { cwd: cwd ?? process.cwd() });
      return {
        content: [{ type: "text", text: formatGateResult(result, includeChecklistExcerpt === true) }],
      };
    },
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
      const reads = new Set<ReferenceName>(dispatchIntent(task).recommendedReads);
      reads.add("design-principles");
      reads.add("avoid-ai-slop");
      reads.add("differentiation-playbook");
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
