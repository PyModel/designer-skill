# Ship Better UI from Pythinker: A Beginner's Guide to the designer-skill MCP

> **Audience:** Pythinker users (any skill level) who want their coding agent to produce UI that doesn't look like every other AI-generated site.
> **Read time:** ~20 minutes. **Build time:** ~10 minutes.
> **What you'll have at the end:** A MCP server that hands Pythinker a production-grade design vocabulary, ready to invoke from a chat.

---

## Table of contents

1. [Why this guide exists](#why-this-guide-exists)
2. [What "designer-skill" actually is (and what it isn't)](#what-designer-skill-actually-is-and-what-it-isnt)
3. [A 60-second primer on MCP](#a-60-second-primer-on-mcp)
4. [Prerequisites](#prerequisites)
5. [Method 1 — the one-liner (recommended)](#method-1--the-one-liner-recommended)
6. [Method 2 — edit `mcp.json` by hand](#method-2--edit-mcpjson-by-hand)
7. [Method 3 — install the package locally (for the curious)](#method-3--install-the-package-locally-for-the-curious)
8. [Verify the server is wired up](#verify-the-server-is-wired-up)
9. [Invoke the skill from Pythinker](#invoke-the-skill-from-pythinker)
10. [Walkthrough — ask Pythinker to design a pricing page](#walkthrough--ask-pythinker-to-design-a-pricing-page)
11. [The four tools, explained like you're five](#the-four-tools-explained-like-youre-five)
12. [The reference files — when to open which](#the-reference-files--when-to-open-which)
13. [Troubleshooting](#troubleshooting)
14. [FAQ](#faq)
15. [What's next](#whats-next)

---

## Why this guide exists

If you've used a coding agent to build a landing page, dashboard, or marketing site in the last year, you've probably seen this output:

- Three identical feature cards in a row.
- Inter or Roboto everywhere, with a serif display font italicized above.
- A "purple-to-blue AI gradient" hero.
- Buzzwords like *seamless*, *empower*, *next-generation*.
- An em-dash (—) in every other sentence.

This is what the designer-skill repo calls **AI slop**: the average output that a viewer can spot as "AI-made" in under a second. The average used to be a passing grade. After 2024, it's a death sentence — every SaaS page looks the same because every coding model is reaching for the same training-data defaults.

**designer-skill** is a composite design reference that fixes exactly that problem. It codifies a production-grade design vocabulary into ten reference files (typography, aesthetics, motion, engineering, anti-slop discipline, refactoring, interaction design, visual critique, design systems, and a verb-driven command playbook) and exposes them to any MCP-compatible coding agent — including **Pythinker**.

This guide is the beginner's walkthrough: how to connect designer-skill to your Pythinker CLI, how to invoke it, and how to interpret what comes back.

> **TL;DR.** Run one command (`pythinker mcp add --transport stdio designer-skill -- npx -y designer-skill-mcp`), restart Pythinker, and your agent now has a router to ten expert design references. You can ask it to design, audit, refactor, polish, or harden any UI with the same vocabulary a senior design engineer would use.

---

## What "designer-skill" actually is (and what it isn't)

Let's clear up a common misconception: **designer-skill is not a "design tool"** in the Figma / Sketch / Penpot sense. It doesn't generate images, draw layouts, or render components on a canvas.

It is a **structured markdown reference** — a corpus of opinionated design rules, written in plain prose, that a coding agent reads before it touches your UI code. Think of it as:

> A senior design engineer sitting on the agent's shoulder, whispering "no, don't use Inter here" and "stop with the three equal cards" and "you forgot the empty state."

The reference is split into:

- **One router file** (`SKILL.md`) — short on purpose. It's a table of contents and a preflight checklist.
- **Ten reference files** in `reference/` — each one owns a single concern (type, color, motion, etc.) so the agent reads the right one and nothing else.

When the MCP server is running, the agent can:

1. **Read the router** to know what to do first (preflight, ship gate, routing map).
2. **Read a reference** on demand when it needs concrete values (a type scale, an easing curve, a palette).
3. **Map a vague request to concrete actions** ("make it pop" → read `aesthetic-systems` + `avoid-ai-slop`).

The skill is **framework-agnostic** — it doesn't care if you're writing React, Vue, Svelte, plain HTML, or Tailwind. It cares about *principles*, not syntax.

---

## A 60-second primer on MCP

If you already know MCP, skip ahead to [Prerequisites](#prerequisites). If you don't, this is the 90-second version.

**MCP** stands for **Model Context Protocol**. It's a JSON-RPC-based protocol that lets a coding agent talk to *external* tool servers. Instead of writing a custom integration for every tool, an agent implements the MCP client once, and any tool that speaks MCP plugs in.

Concretely, an MCP server can expose three things to an agent:

| Thing | What it is | Analogy |
|---|---|---|
| **Tools** | Functions the agent can call (with structured arguments) | "Add a row to a spreadsheet" |
| **Resources** | Read-only content the agent can fetch (markdown, files, schemas) | "Read the docs page" |
| **Prompts** | Pre-built prompt templates the user can invoke | "Run the code-review command" |

designer-skill's MCP server exposes all three:

- **4 tools** (`get_design_system`, `get_reference`, `dispatch_intent`, `anti_slop_checklist`)
- **2 resources** (`designer://skill` and `designer://reference/{name}`)
- **1 prompt** (`design`)

When you tell Pythinker to "use the designer-skill to redesign this page," the agent will internally:

1. Call `get_design_system` to load the router.
2. Call `dispatch_intent` with your request — this returns the verb(s) and which reference files to read.
3. Call `get_reference` once or twice to load the right expert content.
4. Use that content to drive its design decisions.

You don't have to call any of this yourself. The agent does it. You just see the result.

---

## Prerequisites

You'll need three things:

1. **Pythinker CLI v0.38.0 or later.** Check with:
   ```bash
   pythinker --version
   ```
   If you don't have it, install it from [PyModel/pythinker-code](https://pymodel.github.io/pythinker-code/) or via Homebrew:
   ```bash
   brew install pymodel/tap/pythinker
   ```

2. **Node.js 18 or later** (only required because `designer-skill-mcp` runs over `npx`). Check with:
   ```bash
   node --version
   ```
   On macOS with Homebrew: `brew install node@20`.

3. **An internet connection** for the first run (it will `npx -y designer-skill-mcp` and fetch the package from npm). After that, the package is cached locally.

No API key required — all four tools serve markdown from the bundled skill files.

---

## Method 1 — the one-liner (recommended)

Pythinker's MCP subsystem is managed by the `pythinker mcp` command group. Adding a new stdio server is one line:

```bash
pythinker mcp add --transport stdio designer-skill -- npx -y designer-skill-mcp
```

Let's break that command down so you understand what it does:

| Part | Meaning |
|---|---|
| `pythinker mcp add` | Subcommand: add an MCP server entry. |
| `--transport stdio` | The server will be launched as a child process; Pythinker talks to it over stdin/stdout. |
| `designer-skill` | The name Pythinker will use to refer to this server. Tools get prefixed with `mcp_designer-skill_*`. |
| `--` | Separator: everything after this is the actual command Pythinker will run. |
| `npx -y designer-skill-mcp` | `npx` downloads and runs the package; `-y` auto-confirms the install prompt. |

After running it, you should see something like:

```
Added MCP server 'designer-skill' to /Users/you/.pythinker/mcp.json
```

Confirm with:

```bash
pythinker mcp list
```

Expected output (your other servers will be listed too):

```
MCP config file: /Users/you/.pythinker/mcp.json
  designer-skill (stdio): npx -y designer-skill-mcp
```

Restart Pythinker (or run `/mcp reconnect` inside the TUI) to load the new server.

> **Why this is the recommended path:** the CLI handles JSON formatting, path resolution, transport detection, and schema validation. You can't typo a closing brace.

---

## Method 2 — edit `mcp.json` by hand

If you prefer to see what's actually on disk (good for debugging and for storing your config in dotfiles), edit `~/.pythinker/mcp.json` directly.

> **Note:** Pythinker v0.38.0+ stores MCP servers in `~/.pythinker/mcp.json`. Confirm with `pythinker mcp list`, which prints the path. Older v2.x builds used a different schema under `~/.pythinker/config.json`.

Open the file:

```bash
$EDITOR ~/.pythinker/mcp.json
```

It should look like this when you're done (yours may already have other servers like `tavily` or `context7`):

```json
{
  "mcpServers": {
    "designer-skill": {
      "command": "npx",
      "args": ["-y", "designer-skill-mcp"]
    }
  }
}
```

No `env` block needed. Save, then restart Pythinker or run `/mcp reconnect` inside the TUI.

**Top-level keys, in plain English:**

- `mcpServers` — Pythinker's required key. The `mcpServers` (camelCase) is an alias; the underlying Python field is `mcp_servers`. Both work, but the CLI emits camelCase by default.
- `designer-skill` — the friendly name. Pick anything; it shows up in tool names as `mcp_<name>_*`.
- `command` — the executable Pythinker will spawn. Here, `npx`.
- `args` — the argument list passed to `command`. Same as you'd type on the command line.
- `env` (optional) — extra environment variables merged into the child process's environment.
- `url` (not used here) — for HTTP transports, you'd set a `url` instead of `command`/`args`.
- `headers` (not used here) — for HTTP transports, custom headers (e.g. `Authorization`).
- `toolTimeout` (optional) — per-call timeout in seconds (default 30).
- `enabledTools` (optional) — whitelist of tool names to register; `["*"]` (the default) registers everything.

---

## Method 3 — install the package locally (for the curious)

The default `npx` approach downloads `designer-skill-mcp` from npm on every cold cache. That's fine for most people, but if you want to:

- Pin a specific version
- Audit the source
- Run it offline
- Tinker with the skill files

…you can install it locally and point Pythinker at the absolute path.

```bash
# In any project, or in a tools dir you keep around:
mkdir -p ~/.local/share/designer-skill-mcp
cd ~/.local/share/designer-skill-mcp
npm init -y
npm install designer-skill-mcp
npm run build   # syncs the designer-skill/ files and compiles TypeScript
```

Then in `~/.pythinker/mcp.json`:

```json
{
  "mcpServers": {
    "designer-skill": {
      "command": "node",
      "args": ["/Users/you/.local/share/designer-skill-mcp/node_modules/designer-skill-mcp/dist/index.js"]
    }
  }
}
```

> **The `npm run build` step is important.** It copies the canonical `designer-skill/` markdown content (the SKILL.md router and the ten reference files) into `assets/skill/` so the published package is self-contained.

You can also clone the [GitHub repo](https://github.com/PyModel/designer-skill) and build from source if you want to read the source first.

---

## Verify the server is wired up

Three checks, in order of increasing depth.

### 1. CLI check — does Pythinker know about it?

```bash
pythinker mcp list
```

You should see `designer-skill` with its transport and command.

### 2. Connection test — can Pythinker actually reach the server?

```bash
pythinker mcp test designer-skill
```

This spins up the server, calls `tools/list`, prints the names, and exits. You should see the four tools: `anti_slop_checklist`, `dispatch_intent`, `get_design_system`, `get_reference`.

> If you see an error, jump to [Troubleshooting](#troubleshooting).

### 3. In-TUI check — is the server loaded into the active session?

Inside `pythinker tui` (or whatever TUI/REPL you use), type:

```
/mcp
```

You'll see a list of connected servers. `designer-skill` should be there. The `/mcp` command also has a `reconnect` subcommand for hot-reloading after config changes.

You can also list Pythinker's known tools:

```
/tools
```

You should see tool names starting with `mcp_designer-skill_` (e.g. `mcp_designer-skill_get_design_system`).

---

## Invoke the skill from Pythinker

Once the server is connected, you don't need any special command — just ask Pythinker to design something, in natural language. The agent will discover the tools and call them on its own.

**Vague request, mapped by the agent:**

```
You:  "Can you make my pricing page look less generic?"
Pythinker:  calls dispatch_intent("make my pricing page look less generic")
            → verb: bolder · colorize
            → reads: aesthetic-systems, design-principles, avoid-ai-slop
            → applies the rules
```

**Explicit intent:**

```
You:  "Use the designer-skill to audit the homepage for accessibility and
       AI-slop tells. Don't change anything — just report findings."
Pythinker:  calls anti_slop_checklist + get_reference("engineering-and-performance")
```

**Force a specific verb:**

```
You:  "Run the harden verb from the designer-skill playbook on this form.
       I need it to survive long input, RTL, and missing data."
Pythinker:  calls get_reference("command-playbook") to confirm the verb
            then get_reference("engineering-and-performance")
```

The verb vocabulary you'll see in `command-playbook` is a useful shorthand: `build`, `shape`, `audit`, `critique`, `polish`, `bolder`, `quieter`, `overdrive`, `animate`, `delight`, `layout`, `typeset`, `colorize`, `harden`, `optimize`, `distill`, `extract`, `brand`, `adapt`, `redesign`. Use any of them.

---

## Walkthrough — ask Pythinker to design a pricing page

Let's run a full design task end-to-end. The goal is for you to see the round-trip, not just the setup.

### The prompt

```
Use the designer-skill to design a pricing page for an analytics SaaS
called "Loopgate." Three tiers (Free / Team / Enterprise), monthly
and annual toggle, a comparison table, and an FAQ. Brand voice:
data-forward, opinionated, no buzzwords. Aesthetic: minimalist
editorial. Make it production-ready — every state, real copy, no
placeholder images.
```

### What happens inside the agent

A high-level trace (paraphrased — your real run will be longer):

1. **Pre-flight** — Pythinker calls `get_design_system` to load the SKILL.md router. The router tells it: scope the surface (it's a brand surface — distinctiveness is the bar), commit to one aesthetic, run the category-reflex check, build on the baseline.
2. **Intent dispatch** — Pythinker calls `dispatch_intent("design a pricing page for an analytics SaaS")` and gets back: verbs `build`, `harden`; reads `design-principles`, `aesthetic-systems`, `engineering-and-performance`, `avoid-ai-slop`.
3. **Load expert content** — Pythinker calls `get_reference("aesthetic-systems")`, `get_reference("avoid-ai-slop")`, etc. — typically 2-3 reference files in parallel.
4. **Apply rules** — the agent uses the loaded content as constraints. E.g. the `avoid-ai-slop` reference bans three-equal-cards, gradient text, em-dashes, and Inter — so the agent picks a more deliberate type pairing and writes copy without any of those tells.
5. **Ship-gate audit** — before delivering, the agent runs `anti_slop_checklist` mentally and confirms every item is satisfied.

### What you see in the TUI

You'll watch Pythinker call the MCP tools (visible in some TUIs as tool-call blocks), then return:

- A full pricing page (HTML, JSX, or your framework of choice).
- A brief note on which aesthetic system it committed to and why.
- A summary of the anti-slop checks it ran.

If the result *feels* off — say it went too safe, or you wanted it bolder — push back:

```
It's a bit safe. Run the "bolder" verb — bigger scale jumps, more
weight contrast, one color owning the surface.
```

The agent will re-read `aesthetic-systems`, push the contrast, and rerun the ship gate.

---

## The four tools, explained like you're five

| Tool | What it returns | When the agent should call it |
|---|---|---|
| `get_design_system` | The `SKILL.md` router — preflight, precedence rule, routing map, ship gate. | **Always first.** This is the entry point. |
| `get_reference` | The full text of one of the ten reference files (e.g. `aesthetic-systems`). | When the agent needs concrete values: a type scale, an easing curve, a palette. |
| `dispatch_intent` | Maps a natural-language request ("make it pop", "the spacing feels off") to a verb + the files to read. | When the user's request is vague and the agent isn't sure where to start. |
| `anti_slop_checklist` | The full anti-AI-slop reference — tells, category-reflex checks, output-completeness contract. | **Always last.** The ship gate. Run before declaring done. |

If you only memorize one thing: **get_design_system first, anti_slop_checklist last, dispatch_intent when in doubt, get_reference when you need concrete values.**

---

## The reference files — when to open which

Each file owns one concern. Don't read all ten for every task — that's wasteful. Read the one(s) the dispatched verb points to.

| File | What it owns | When to read |
|---|---|---|
| `design-principles.md` | Aesthetic-neutral baseline: typography ramp, spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96), color & contrast, layout & grid, hierarchy, depth. | Always — the neutral default. `layout`, `typeset`, `colorize`, `distill` verbs. |
| `aesthetic-systems.md` | Five opinionated design languages: Minimalist, Brutalist, Soft, High-end, Brand-identity. Concrete palettes, fonts, shadow tokens. | `bolder`, `quieter`, `brand`, `colorize`. Pick one system per surface. |
| `motion-and-interaction.md` | Easing curves, durations, springs, micro-interactions, scroll, reduced-motion. | `animate`, `delight`, `overdrive`. |
| `engineering-and-performance.md` | Component architecture, design tokens, hardware acceleration, responsive/fluid, a11y, Core Web Vitals, real-data hardening. | `build`, `polish`, `harden`, `optimize`, `adapt`, `extract`. |
| `avoid-ai-slop.md` | Tell ban-list, category-reflex checks, output-completeness contract, ship-gate checklist. | **Always at the end.** The always-run gate. |
| `refactor-and-redesign.md` | Audit, diagnose generic patterns, the redesign loop, image/reference-to-code. | `redesign`, `adapt`, `audit`. |
| `command-playbook.md` | Intent→verb dispatch table. 20+ verbs, what they do, which files to read. | When the user's intent is ambiguous. |
| `interaction-design.md` | Cognitive laws, state machines, forms, navigation, error UX, loading states. | `form`, `navigate`, `states`, `feel` verbs. |
| `visual-critique.md` | Seven-dimension critique instrument. | `score`, `critique` verbs. |
| `design-systems.md` | Token architecture, component specs, theming. | `system`, `extract` verbs. |

### The precedence rule (read this once, internalize it)

`design-principles.md` is the **aesthetic-neutral baseline**. It's the default lean. The moment you commit to an aesthetic system from `aesthetic-systems.md`, that system's rules **override** the baseline within its own surface.

Example: pure white is discouraged by default, but it's the **required** canvas for the Minimalist system. Blanket shadows are a "cheap default" by the baseline, but the **Soft** system requires diffused ambient shadows.

Don't mix two systems' signatures on one surface. Pick one, read its file, follow it.

### Cross-file ownership (don't re-derive, read the owner)

Each fact has one home. If a fact appears in two files, the more specific one wins:

- Concrete palettes, fonts, shadow tokens, per-system rules → `aesthetic-systems.md`
- Contrast ratios, type ramp, spacing scale, layout model → `design-principles.md`
- Easing curves, durations, spring config → `motion-and-interaction.md`
- GPU/hardware-accel, `will-change`, tokens, responsive, a11y engineering, CWV → `engineering-and-performance.md`

---

## Troubleshooting

### "Pythinker doesn't see the new server"

1. **Did you restart?** Edit the config or run `pythinker mcp add`, then quit the TUI and relaunch. (Or use `/mcp reconnect` inside the TUI.)
2. **Path:** confirm the file with `pythinker mcp list` — it prints the exact path.
3. **JSON syntax:** run `cat ~/.pythinker/mcp.json | jq .` to validate. A stray comma is the #1 culprit.

### "Tools list is empty / `pythinker mcp test designer-skill` errors"

Likely cause: the package can't be reached.

```bash
# Run the command manually to see the actual error:
npx -y designer-skill-mcp
```

If that fails:
- **Network blocked?** `npx` needs to hit the npm registry. Check your proxy / firewall.
- **Node version too old?** `node --version` should be ≥ 18. The package's `engines.node` is `>=18`.
- **Permission issue?** The `npm` cache directory needs to be writable.

### "I see `mcp_designer-skill_get_reference` but not the one I want"

The agent picks tools by name. If the agent isn't calling a specific tool, it usually means the request didn't trigger it. Rephrase with an explicit verb from `command-playbook.md` (e.g. "use the polish verb", "run the audit verb").

### "The output still looks AI-made"

The skill is guidance, not a guarantee. Run the ship gate yourself:

```
You: "Run anti_slop_checklist on the code you just produced and fix every issue."
```

If it still fails, the issue is in the model, not the skill. Try:
- A more deliberate prompt with a named aesthetic ("minimalist editorial", "brutalist data-dashboard") instead of "modern and clean".
- Asking the agent to *first* pick the aesthetic and justify it, *then* build.
- Breaking the work into smaller asks: layout first, typeset second, color third, motion last.

### "Tools don't show up after editing config"

Run `pythinker mcp list` to confirm the config path, validate JSON with `jq`, then restart Pythinker or `/mcp reconnect`.

### "How do I disable it temporarily?"

```bash
pythinker mcp remove designer-skill
```

To re-enable: `pythinker mcp add --transport stdio designer-skill -- npx -y designer-skill-mcp`.

---

## FAQ

**Q: Does this work with local models (Ollama, MLX, llama.cpp)?**
A: Yes. All four tools are pure markdown served from the bundled skill — no external API calls.

**Q: Will it slow Pythinker down?**
A: Negligibly. The MCP server stays idle until a tool is called. The first call to `get_design_system` loads the markdown from disk (a few hundred KB total) and caches it in memory. Subsequent calls are instant.

**Q: Can I use it with non-UI tasks?**
A: It's a no-op for backend logic, data pipelines, or anything non-visual. The router's `description` frontmatter tells the agent to use it only for UI work. If you ask Pythinker to refactor a Python function, the agent will ignore the designer-skill tools.

**Q: Is the skill just a prompt?**
A: It's a structured set of ten markdown files plus a small router. There's no fine-tuned model inside the package. The skill is plain prose rules that the *host* model reads as context. This is what makes it work with any model.

**Q: Can I edit the reference files?**
A: Yes — they're just markdown. If you install the package locally (Method 3), edit the files under `assets/skill/reference/` and rebuild. The MCP server reads from the bundled copy, not the source. If you want a shared team fork, host your own version of the GitHub repo and point the `args` at a custom path.

**Q: Does it work with React / Vue / Svelte / Astro / Next / Nuxt / Solid / Qwik / …?**
A: Yes. The skill is framework-agnostic. It gives principles (e.g. "use a 4pt spacing scale, weight 900 vs 200 for hierarchy, an OKLCH color ramp"). The agent translates those into whatever framework you use.

**Q: Can I trust the npm package?**
A: The package is published as [`designer-skill-mcp`](https://www.npmjs.com/package/designer-skill-mcp) under the MIT license. The source is at [github.com/PyModel/designer-skill](https://github.com/PyModel/designer-skill).

---

## What's next

You now have a working designer-skill MCP server feeding Pythinker a production-grade design vocabulary. Some directions to take it from here:

1. **Use it for a real refactor.** Pick a page that looks "AI-made" and ask Pythinker to redesign it without breaking functionality. The `refactor-and-redesign` reference walks through the audit → diagnose → redesign loop in detail.
2. **Pick an aesthetic system and commit.** Read `aesthetic-systems.md`. Pick one of the five (Minimalist, Brutalist, Soft, High-end, Brand-identity). Apply it consistently to your whole product.
3. **Run the ship gate on every PR.** Add a CI step that calls the agent with "audit this diff for AI-slop tells and accessibility issues." The agent will use `anti_slop_checklist` and `engineering-and-performance`.
4. **Combine with your existing skills.** designer-skill complements other Pythinker skills. The `simplify-code` skill cleans up logic; designer-skill cleans up presentation. Use both.

The skill's job is to make "AI-made" a phrase your users never say. Now go ship something that doesn't look like everyone else's site.

---

**Resources**

- designer-skill repo: <https://github.com/PyModel/designer-skill>
- npm package: <https://www.npmjs.com/package/designer-skill-mcp>
- Pythinker docs: <https://pymodel.github.io/pythinker-code/>
- MCP spec: <https://modelcontextprotocol.io>

**License:** MIT (designer-skill and this guide).
