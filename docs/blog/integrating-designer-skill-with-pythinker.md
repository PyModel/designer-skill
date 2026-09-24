# Ship Better UI from Pythinker: A Beginner's Guide to the designer-skill MCP

> **Audience:** Pythinker users at any skill level who want their coding agent to build UI that doesn't look like every other AI-generated site.
> **Build time:** about 10 minutes.
> **What you'll have at the end:** the designer-skill MCP server connected to Pythinker, and a clear picture of what it checks and what it doesn't.

---

## Table of contents

1. [Why this guide exists](#why-this-guide-exists)
2. [What designer-skill is](#what-designer-skill-is)
3. [MCP in one minute](#mcp-in-one-minute)
4. [Prerequisites](#prerequisites)
5. [Install with one command](#install-with-one-command)
6. [Or edit mcp.json by hand](#or-edit-mcpjson-by-hand)
7. [Verify the connection](#verify-the-connection)
8. [The recommended flow](#the-recommended-flow)
9. [Walkthrough: a pricing page](#walkthrough-a-pricing-page)
10. [What the ship gate does and doesn't check](#what-the-ship-gate-does-and-doesnt-check)
11. [All 14 tools](#all-14-tools)
12. [Troubleshooting](#troubleshooting)
13. [FAQ](#faq)

---

## Why this guide exists

Ask a coding agent for a landing page and you often get the same thing: three identical feature cards, a purple-to-blue gradient hero, and copy full of words like *seamless* and *empower*. The designer-skill repo calls this **AI slop**: the average output, recognizable as machine-made at a glance.

**designer-skill** gives your agent a design vocabulary to do better, and a static check to catch a few concrete defects before it says "done". This guide covers connecting it to Pythinker, the order to call the tools in, and how to read the results.

> **TL;DR.** Run `pythinker mcp add --transport stdio designer-skill -- npx -y @pymodel/designer-skill-mcp`, restart Pythinker, then ask for UI work in plain language. The agent calls `get_preflight_brief` first and `review_and_gate` on the changed files last.

---

## What designer-skill is

It is **not** a design tool like Figma. It doesn't draw layouts or render components.

It is a set of **markdown references** plus a small **static detector**, served over MCP:

- **A router** (`SKILL.md`) that sets the working rules: stay in the scope the user asked for, preserve the product's existing identity unless told otherwise, and never invent test results.
- **41 references**: 15 designer references (typography, color, motion, engineering, anti-slop, redesign, design systems and more) and 26 `ux/*` references (forms, accessibility, navigation, i18n and others).
- **A 44-rule detector** that scans your files for concrete problems such as low text contrast or broken images.

It is framework-agnostic. React, Vue, Svelte, plain HTML and Tailwind all work, because the references describe principles, not syntax.

One thing to know up front: the style guidance is **advisory**. The skill states there is no universal ban on any font, color, layout or punctuation mark. Your product's own identity and your instructions come first.

---

## MCP in one minute

**MCP** (Model Context Protocol) lets a coding agent talk to external tool servers. An MCP server can offer:

| Thing | What it is |
|---|---|
| **Tools** | Functions the agent can call with arguments |
| **Resources** | Read-only content the agent can fetch |
| **Prompts** | Prompt templates you can start a task from |

designer-skill offers **14 tools**, two resources (`designer://skill` and `designer://reference/{+name}`) and one prompt (`design`, with a `task` and an optional `aesthetic`).

You don't call any of this yourself. You describe the UI work, and Pythinker calls the tools.

---

## Prerequisites

1. **Pythinker CLI v0.38.0 or later.** Check with `pythinker --version`. Install from [PyModel/pythinker-code](https://pymodel.github.io/pythinker-code/) or with `brew install pymodel/tap/pythinker`.
2. **Node.js 22 or later.** The server runs through `npx`, and the package requires Node `>=22`. Check with `node --version`.
3. **An internet connection** the first time, so `npx` can fetch the package from npm. After that it comes from the npm cache.

**No API key.** The core tools read bundled files and scan your local project. Two optional tools (`find_ui_references`, `get_design_reference`) search the niblet.com screen catalogue and need a `NIBLET_TOKEN`; without it they return setup instructions instead of results.

---

## Install with one command

```bash
pythinker mcp add --transport stdio designer-skill -- npx -y @pymodel/designer-skill-mcp
```

| Part | Meaning |
|---|---|
| `pythinker mcp add` | Add an MCP server entry |
| `--transport stdio` | Pythinker starts the server as a child process and talks to it over stdin/stdout |
| `designer-skill` | The name Pythinker uses for this server. Its tools appear as `mcp_designer-skill_*` |
| `--` | Everything after this is the command Pythinker runs |
| `npx -y @pymodel/designer-skill-mcp` | Download and run the package; `-y` skips the install prompt |

The entry is written to `~/.pythinker/mcp.json`. Confirm it with `pythinker mcp list`, then restart Pythinker (or run `/mcp reconnect` inside the TUI).

---

## Or edit mcp.json by hand

Useful if you keep your config in dotfiles. Open `~/.pythinker/mcp.json` (run `pythinker mcp list` if you're unsure of the path) and add:

```json
{
  "mcpServers": {
    "designer-skill": {
      "command": "npx",
      "args": ["-y", "@pymodel/designer-skill-mcp"]
    }
  }
}
```

No `env` block is needed. Save, then restart Pythinker or run `/mcp reconnect`.

- `designer-skill` is the friendly name; pick anything.
- `command` and `args` are what Pythinker runs.
- `env` (optional) adds environment variables, e.g. `NIBLET_TOKEN` if you use the optional catalogue tools.
- `toolTimeout` (optional) is the per-call timeout in seconds.
- `enabledTools` (optional) limits which tools are registered; `["*"]` registers all of them.

**Pin a version:** replace the package with `@pymodel/designer-skill-mcp@0.18.1` so the server doesn't change under you.

**Run from a local checkout:** clone [PyModel/designer-skill](https://github.com/PyModel/designer-skill), run `npm ci && npm run build` inside `designer-skill-mcp/`, then set `"command": "node"` and `"args": ["/abs/path/to/designer-skill-mcp/dist/index.js"]`.

---

## Verify the connection

1. **Is it configured?** `pythinker mcp list` should show `designer-skill` with its command.
2. **Does it start?** `pythinker mcp test designer-skill` starts the server and lists its tools. You should see all 14, including `get_preflight_brief`, `dispatch_intent` and `review_and_gate`.
3. **Is it loaded in your session?** Inside the TUI, `/mcp` lists connected servers and `/tools` should show names starting with `mcp_designer-skill_`.

If any step fails, see [Troubleshooting](#troubleshooting).

---

## The recommended flow

Five steps, in this order:

1. **`get_preflight_brief`** first. It returns a short checklist: establish scope, load project context, route the request, make the smallest authorized change, gate it, and report honestly. Right after it, the brief tells the agent to call `load_project_context` with the absolute project root so it reads your `PRODUCT.md` and `DESIGN.md` if you have them.
2. **`dispatch_intent`** with the request. It maps plain language ("make it pop", "it looks AI-made") to design verbs and recommends **at most four** references to read.
3. **`get_reference`** for each recommended reference, and only those.
4. **Build** the change.
5. **`review_and_gate`** on the changed files, with an **absolute** `cwd`. If it reports `FAIL`, fix and run it again.

Some phrases and where `dispatch_intent` sends them (from the current registry):

| You say | Verbs | Recommended reads |
|---|---|---|
| "make it pop" | `amplify` | `aesthetic-systems`, `differentiation-playbook` |
| "it looks AI-made" | `review` | `visual-critique`, `design-principles`, `avoid-ai-slop`, `ux/01-core-principles` |
| "harden this form for long input and missing data" | `form`, `ship` | `interaction-design`, `engineering-and-performance`, `ux/07-forms-and-inputs`, `css-techniques` |

When nothing matches, it falls back to `command-playbook` and `design-principles` and tells the agent to inspect the request before acting.

You can also name a verb directly ("run the `check` verb on the homepage"). The canonical verbs are: `setup`, `plan`, `build`, `preview`, `spec`, `check`, `review`, `finish`, `layout`, `type`, `color`, `motion`, `responsive`, `simplify`, `copy`, `onboard`, `ship`, `speed`, `tokens`, `brand`, `refresh`, `options`, `amplify`, `calm`, `push`, `delight`, `form`, `nav`, `states`, `tone`, `system`, `css`. The agent can list them with `list_commands` and get help for one with `get_command`.

---

## Walkthrough: a pricing page

### The prompt

```
Use designer-skill to build a pricing page for an analytics SaaS called
"Loopgate": three tiers, a monthly/annual toggle, a comparison table and
an FAQ. Voice: data-forward, no buzzwords. Write it to site/pricing.html.
```

### What the agent does

1. Calls `get_preflight_brief`, then `load_project_context` with your project root.
2. Calls `dispatch_intent`. For "build a pricing page" the registry returns the `build` verb and recommends `craft-flow`, `engineering-and-performance`, `design-principles` and `differentiation-playbook`.
3. Calls `get_reference` for those four.
4. Writes `site/pricing.html`.
5. Calls `review_and_gate` with `target: "site/pricing.html"` and `cwd` set to the absolute project root.

### Reading the gate result

Here is real output from `review_and_gate` on a one-file page whose muted caption was `#bbb` on white:

```
## review_and_gate: FAIL

Static check: FAIL (STATIC_FINDINGS). UI readiness: FAIL.
Scanned 1 of 1 candidate files (filesystem listing); ignored 0; skipped 0 symlink/special/unreadable entries.
1 blocking and 0 advisory findings.
Required rules: broken-image RAN on 1 file(s); low-contrast RAN on 1 file(s); clipped-overflow-container RAN on 1 file(s).
Rendered checks NOT_RUN: text-overflow; functional, accessibility and performance checks must be reported separately.

[low-contrast] pricing.html:3: 1.9:1 (need 4.5:1) — text #bbbbbb on #ffffff
```

After changing the color to `#555` and running it again:

```
## review_and_gate: NOT_VERIFIED

Static check: PASS (ADDITIONAL_VERIFICATION_REQUIRED). UI readiness: NOT_VERIFIED.
```

Note the second result. The static check **passed**, but the overall status is `NOT_VERIFIED`, not PASS. That's by design, and the next section explains why.

If the design feels too safe, push back in plain language: "It's a bit safe. Make it bolder." That routes to `amplify`, the agent reads the new references, edits, and gates again.

---

## What the ship gate does and doesn't check

`review_and_gate` is the ship gate. It is **static only**: it reads your source files and never opens a browser.

**What it checks.** Three rules are required by default: `broken-image`, `low-contrast` and `clipped-overflow-container`. The gate does not promise they run on every file; it reports their coverage, since a rule can only run on file types it supports. You can make more of the 44 detector rules blocking with the `blockingRules` argument. For each required rule it reports one status:

| Rule status | Meaning |
|---|---|
| `RAN` | The rule was evaluated on every scanned file |
| `UNSUPPORTED` | The file type can't express it statically (e.g. contrast in a CSS-only or TSX file) |
| `UNRESOLVED` | It applies but couldn't be evaluated (e.g. a remote stylesheet or a `var()` with no value) |
| `WAIVED` | Turned off in the committed `.designer-skill/config.json` |

**How to read the result** (gate `schemaVersion: 3`):

- `staticStatus` is `PASS`, `FAIL` or `INCOMPLETE`. `INCOMPLETE` means a required rule couldn't run. Treat it as unfinished, not as a pass.
- The overall `status` is only ever `FAIL` or `NOT_VERIFIED`. It never returns PASS.
- An empty scan, or one where every required rule is waived, fails with `NO_SCAN_COVERAGE`.
- The `checks` list always reports `rendered` (with `text-overflow`), `functional`, `accessibility` and `performance` as `NOT_RUN`.

**What it doesn't do.** It never certifies that your UI is ready. Rendering, keyboard and focus behavior, responsive layout and real accessibility testing belong to your own test harness or a manual check. Full contract: [`docs/HARDENING.md`](../HARDENING.md).

**What about `anti_slop_checklist`?** It returns the `avoid-ai-slop` reference: advisory style and truthful-content guidance. It's useful for a review, but it doesn't check anything and it isn't the gate.

---

## All 14 tools

| Tool | Purpose |
|---|---|
| `get_preflight_brief` | Scope and verification contract (call first) |
| `load_project_context` | Read PRODUCT.md / DESIGN.md from the project (absolute `cwd`) |
| `get_design_system` | SKILL.md router and reference map |
| `get_reference` | One of 41 references by name (designer or `ux/*`) |
| `anti_slop_checklist` | Advisory style and truthful-content review guidance |
| `list_commands` | All design verbs with descriptions |
| `get_command` | Help and reference names for one verb |
| `dispatch_intent` | Map a request → verb(s) + at most four references to read |
| `commit_design_direction` | Validate a context-grounded direction record |
| `get_palette_seed` | OKLCH brand seed for authorized new palette work |
| `detect_antipatterns` | Deterministic static scan (44 rules): coverage, file hashes, gaps |
| `review_and_gate` | Static gate per required rule; never claims rendered readiness |
| `find_ui_references` | Optional niblet real-screen search (`NIBLET_TOKEN`) |
| `get_design_reference` | Optional niblet structured reference (`NIBLET_TOKEN`) |

This table matches the one in the [README](../../README.md#tools).

---

## Troubleshooting

**Pythinker doesn't see the server.** Restart the TUI or run `/mcp reconnect`. Check the config path with `pythinker mcp list`, and validate the JSON with `jq . ~/.pythinker/mcp.json`. A stray comma is the usual culprit.

**`pythinker mcp test designer-skill` fails.** Run `npx -y @pymodel/designer-skill-mcp` directly to see the real error. Common causes: npm registry blocked by a proxy or firewall, Node older than 22, or an npm cache directory that isn't writable.

**`review_and_gate` rejects `cwd`.** `cwd` must be an absolute path; a relative one fails input validation. It must also sit inside the project roots the server is allowed to read, or the call returns `SCOPE_VIOLATION`. Pass the absolute project root.

**The gate says `NO_SCAN_COVERAGE`.** Nothing was scanned. Check that `target` points at the files you changed and that they aren't ignored by `.gitignore` or the project's config.

**The gate says `INCOMPLETE`.** A required rule couldn't run, often because the file is TSX or CSS-only, or a stylesheet couldn't be resolved. The summary line names the rule and an example file. Report it; don't count it as a pass.

**The output still looks AI-made.** The skill guides the model; it doesn't guarantee taste. Name an aesthetic ("minimalist editorial") instead of "modern and clean", ask the agent to justify a direction before building, or split the work: layout first, then type, then color, then motion.

**Turn it off.** `pythinker mcp remove designer-skill`. Re-add it with the install command above.

---

## FAQ

**Does it work with local models?**
Yes. The core tools read bundled files and your local project, with no external API calls. Only the two optional niblet tools go online.

**Does it change my files?**
No. Every tool is read-only. Your agent makes the edits; designer-skill advises and checks.

**Can I use it for non-UI work?**
There's no point. The skill says not to activate for backend, database, CLI or other non-visual tasks.

**Does a static PASS mean my page is ready to ship?**
No. It means the required static rules ran and found nothing. Overall status stays `NOT_VERIFIED` until you run rendered, functional, accessibility and performance checks yourself.

**Is the package trustworthy?**
It's published as [`@pymodel/designer-skill-mcp`](https://www.npmjs.com/package/@pymodel/designer-skill-mcp) under the MIT license, with source at [github.com/PyModel/designer-skill](https://github.com/PyModel/designer-skill).

---

**Resources**

- designer-skill repo: <https://github.com/PyModel/designer-skill>
- npm package: <https://www.npmjs.com/package/@pymodel/designer-skill-mcp>
- Verification contract: [`docs/HARDENING.md`](../HARDENING.md)
- Pythinker docs: <https://pymodel.github.io/pythinker-code/>
- MCP spec: <https://modelcontextprotocol.io>

**License:** MIT (designer-skill and this guide).
