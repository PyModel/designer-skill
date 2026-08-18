import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_INSTRUCTIONS } from "../src/server.js";
import { dispatchIntent } from "../src/dispatch.js";
import { REFERENCE_NAMES } from "../src/skill.js";

async function connectClient(): Promise<Client> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

describe("dispatchIntent", () => {
  it("routes 'make it pop' to amplify", () => {
    expect(dispatchIntent("the hero is bland, make it pop").matched.map((m) => m.verb)).toContain("amplify");
  });
  it("routes 'production-ready' to ship", () => {
    expect(
      dispatchIntent("make this production-ready with real data and error states").matched.map((m) => m.verb),
    ).toContain("ship");
  });
  it("routes 'spacing feels off' to layout", () => {
    expect(dispatchIntent("the spacing feels off on this card").matched.map((m) => m.verb)).toContain("layout");
  });
  it("routes 'redesign without breaking' to refresh", () => {
    expect(dispatchIntent("redesign this page without breaking it").matched.map((m) => m.verb)).toContain("refresh");
  });
  it("routes 'rewrite this error message' to copy", () => {
    expect(dispatchIntent("rewrite this error message, the wording is off").matched.map((m) => m.verb)).toContain("copy");
  });
  it("routes 'first run / empty states' to onboard", () => {
    expect(dispatchIntent("design the first run and empty states for activation").matched.map((m) => m.verb)).toContain("onboard");
  });
  it("routes 'capture the design system in DESIGN.md' to spec", () => {
    expect(dispatchIntent("capture the design system and write DESIGN.md").matched.map((m) => m.verb)).toContain("spec");
  });
  it("routes 'show me 3 versions' to options", () => {
    expect(dispatchIntent("show me 3 versions of this hero").matched.map((m) => m.verb)).toContain("options");
  });
  it("routes 'form design' to form", () => {
    expect(dispatchIntent("help me with form design and validation").matched.map((m) => m.verb)).toContain("form");
  });
  it("routes 'navigation' to nav", () => {
    expect(dispatchIntent("which navigation pattern should I use").matched.map((m) => m.verb)).toContain("nav");
  });
  it("routes 'state machine' to states", () => {
    expect(dispatchIntent("model all ui states as a state machine").matched.map((m) => m.verb)).toContain("states");
  });
  it("routes 'feels flat' to tone", () => {
    expect(dispatchIntent("the interface feels flat and lifeless").matched.map((m) => m.verb)).toContain("tone");
  });
  it("routes 'design system' to system", () => {
    expect(dispatchIntent("set up the design system and token architecture").matched.map((m) => m.verb)).toContain("system");
  });
  it("routes 'visual critique' to review", () => {
    expect(dispatchIntent("do a visual critique and score the design").matched.map((m) => m.verb)).toContain("review");
  });
  it("routes 'setup project' to setup", () => {
    expect(dispatchIntent("setup project and write PRODUCT.md").matched.map((m) => m.verb)).toContain("setup");
  });
  it("routes 'craft end to end' to build", () => {
    expect(dispatchIntent("craft this landing page end to end").matched.map((m) => m.verb)).toContain("build");
  });
  it("routes 'live mode' to preview", () => {
    expect(dispatchIntent("iterate in live mode on the hero").matched.map((m) => m.verb)).toContain("preview");
  });
  it("resolves legacy aliases via get_command", async () => {
    const client = await connectClient();
    const text = textOf(await client.callTool({ name: "get_command", arguments: { verb: "init" } }));
    expect(text).toContain("setup");
    expect(text).toContain("alias");
  });
  it("always recommends the anti-slop ship gate", () => {
    expect(dispatchIntent("literally anything").recommendedReads).toContain("avoid-ai-slop");
    expect(dispatchIntent("make it pop").recommendedReads).toContain("avoid-ai-slop");
  });
  it("falls back to the command playbook when nothing matches", () => {
    const r = dispatchIntent("xyzzy");
    expect(r.matched).toHaveLength(0);
    expect(r.recommendedReads).toContain("command-playbook");
  });
  it("routes CSS fixes to the css-techniques reference", () => {
    expect(dispatchIntent("fix the css").recommendedReads).toContain("css-techniques");
    expect(dispatchIntent("center this with flexbox").recommendedReads).toContain("css-techniques");
  });
});

describe("designer-skill MCP server", () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });

  it("advertises the workflow tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "anti_slop_checklist",
        "commit_design_direction",
        "detect_antipatterns",
        "dispatch_intent",
        "get_command",
        "get_design_system",
        "get_palette_seed",
        "get_preflight_brief",
        "get_reference",
        "list_commands",
        "load_project_context",
        "review_and_gate",
      ].sort(),
    );
  });

  it("get_preflight_brief returns the compact workflow", async () => {
    const text = textOf(await client.callTool({ name: "get_preflight_brief" }));
    expect(text).toContain("get_preflight_brief");
    expect(text).toContain("commit_design_direction");
    expect(text).toContain("review_and_gate");
    expect(text).toContain("Inverse test");
  });

  it("commit_design_direction validates direction", async () => {
    const text = textOf(
      await client.callTool({
        name: "commit_design_direction",
        arguments: {
          register: "brand",
          designRead: "Bakery ordering page for hurried local customers, with warm editorial utility",
          designVariance: 7,
          motionIntensity: 4,
          visualDensity: 5,
          aesthetic: "minimalist",
          physicalScene: "Shop owner on a bright tablet at the counter during morning rush",
          layoutFamilies: ["asymmetric bento", "horizontal scroll rail"],
          typographyDirection: "Editorial serif display + grotesk body, 1.5 ratio",
          antiSlopRisks: ["no Inter", "no eyebrow chips"],
          inverseTestPass: true,
          inverseTestDescription:
            "Counter-service ordering for a single-location bakery — hand-drawn price chalkboard energy, not another food delivery app hero",
        },
      }),
    );
    expect(text).toContain("PASS");
  });

  it("commit_design_direction rejects category-modal copy", async () => {
    const text = textOf(
      await client.callTool({
        name: "commit_design_direction",
        arguments: {
          register: "brand",
          designRead: "Team analytics page for operations leads, with a generic soft software language",
          designVariance: 6,
          motionIntensity: 4,
          visualDensity: 5,
          aesthetic: "soft",
          physicalScene: "Team lead presenting quarterly results in a bright conference room",
          layoutFamilies: ["asymmetric bento", "split asymmetric"],
          typographyDirection: "Grotesk display + humanist body, 1.333 ratio",
          antiSlopRisks: ["no cream bg", "no three equal cards"],
          inverseTestPass: true,
          inverseTestDescription: "AI-powered platform that streamlines workflows for modern teams seamlessly",
        },
      }),
    );
    expect(text).toContain("FAIL");
  });

  it("get_reference returns differentiation playbook", async () => {
    const text = textOf(await client.callTool({ name: "get_reference", arguments: { name: "differentiation-playbook" } }));
    expect(text).toContain("inverse test");
    expect(text).toContain("One weird thing");
  });

  it("get_design_system returns the router with the precedence rule", async () => {
    const text = textOf(await client.callTool({ name: "get_design_system" }));
    expect(text).toContain("designer-skill");
    expect(text.toLowerCase()).toContain("precedence");
    expect(text).toContain("reference/avoid-ai-slop.md");
  });

  it("get_reference returns concrete values for a named file", async () => {
    const text = textOf(await client.callTool({ name: "get_reference", arguments: { name: "motion-and-interaction" } }));
    expect(text).toContain("cubic-bezier");
  });

  it("get_reference rejects an unknown name", async () => {
    const res = await client.callTool({ name: "get_reference", arguments: { name: "not-a-real-file" } });
    expect(res.isError).toBe(true);
  });

  it("dispatch_intent returns routed guidance text", async () => {
    const text = textOf(await client.callTool({ name: "dispatch_intent", arguments: { request: "make it pop" } }));
    expect(text).toContain("amplify");
    expect(text).toContain("review_and_gate");
  });

  it("anti_slop_checklist returns the slop reference", async () => {
    const text = textOf(await client.callTool({ name: "anti_slop_checklist" }));
    expect(text).toContain("Avoiding AI Slop");
  });

  it("exposes the skill router resource and all fifteen reference resources", async () => {
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toContain("designer://skill");
    for (const name of REFERENCE_NAMES) {
      expect(uris).toContain(`designer://reference/${name}`);
    }
  });

  it("list_commands returns setup, build, and preview", async () => {
    const text = textOf(await client.callTool({ name: "list_commands" }));
    expect(text).toContain("setup");
    expect(text).toContain("build");
    expect(text).toContain("preview");
  });

  it("get_command returns setup guidance and project-init reference", async () => {
    const text = textOf(await client.callTool({ name: "get_command", arguments: { verb: "setup" } }));
    expect(text).toContain("project-init");
    expect(text).toContain("PRODUCT.md");
  });

  it("load_project_context reports missing PRODUCT.md", async () => {
    const text = textOf(await client.callTool({ name: "load_project_context", arguments: {} }));
    expect(text).toContain("NO_PRODUCT_MD");
  });

  it("get_palette_seed returns OKLCH seed data", async () => {
    const text = textOf(await client.callTool({ name: "get_palette_seed", arguments: { from: "test-brand" } }));
    expect(text.toLowerCase()).toContain("oklch");
  });

  it("get_reference returns project-init flow", async () => {
    const text = textOf(await client.callTool({ name: "get_reference", arguments: { name: "project-init" } }));
    expect(text).toContain("PRODUCT.md");
  });

  it("reads a reference resource by URI", async () => {
    const res = await client.readResource({ uri: "designer://reference/avoid-ai-slop" });
    expect(res.contents[0]?.text).toContain("Avoiding AI Slop");
  });

  it("exposes the design prompt and bundles skill context", async () => {
    const names = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(names).toContain("design");
    const prompt = await client.getPrompt({ name: "design", arguments: { task: "build a pricing page" } });
    const msg = prompt.messages[0];
    const text = typeof msg.content === "object" && "text" in msg.content ? (msg.content.text as string) : "";
    expect(text).toContain("designer-skill");
    expect(text).toContain("Task: build a pricing page");
  });
});

describe("server instructions", () => {
  it("is a thin pointer that routes to the brief-first workflow", () => {
    expect(SERVER_INSTRUCTIONS).toContain("get_preflight_brief");
    expect(SERVER_INSTRUCTIONS).toContain("commit_design_direction");
    expect(SERVER_INSTRUCTIONS).toContain("review_and_gate");
    // Thin pointer, not a copy of the ~3.6k-char brief.
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(700);
  });
});
