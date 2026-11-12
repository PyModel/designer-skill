# @pymodel/designer-skill-mcp

MCP guidance and static verification for UI design, implementation and review. Use project evidence first, preserve authorized scope, and distinguish a static check from rendered UI readiness.

## Install a published release

```json
{
  "mcpServers": {
    "designer-skill": {
      "command": "npx",
      "args": ["-y", "@pymodel/designer-skill-mcp@latest"]
    }
  }
}
```

Add `"--root", "/abs/project"` to `args` to confine every tool to that project; without it, the client's declared MCP roots are used. Use an explicitly selected version for a reproducible deployment. Installing `@latest` does not install an unmerged development branch. No model API key is required by the guidance tools. The host must authorize the project root and any file changes.

## Workflow and tools

Start with `get_preflight_brief`, then `load_project_context` using the actual **absolute** project directory. Audit and planning requests do not authorize implementation edits. Missing PRODUCT.md does not discard DESIGN.md or force setup.

<!-- tools:start -->
| Tool | Purpose |
|---|---|
| `get_preflight_brief` | Compact scope and verification contract; call first |
| `load_project_context` | Read PRODUCT.md and DESIGN.md and detect design tooling (tokens, shadcn, Storybook, Tailwind, Playwright); requires `cwd` |
| `get_skill_contract` | This skill's full SKILL.md contract and reference routing map (not the project's design system) |
| `get_reference` | Load one named reference (designer or `ux/*`) on demand |
| `list_commands` | Discover canonical commands and aliases |
| `get_command` | Command help and reference names, not eagerly loaded documents |
| `dispatch_intent` | Route a request to commands and topic references; names every match, recommends at most four reads |
| `validate_design_direction` | Validate inspected `contextSources` and preservation/new-direction inputs; stores nothing |
| `get_palette_seed` | Optional seed for an authorized new palette |
| `check_contrast` | WCAG 2.2 contrast for explicit color pairs, with large-text thresholds and advisory APCA Lc |
| `convert_design_tokens` | W3C Design Tokens (DTCG) JSON to CSS custom properties or a Tailwind v4 `@theme` block |
| `detect_antipatterns` | Bounded static scan: coverage, per-file engine and gaps, file hashes; requires `cwd` and `target` |
| `review_and_gate` | Static verification per required rule; never an overall PASS by design; requires `cwd` and `target` |
| `verify_rendered` | Load a local page in a real browser: load, console errors, broken images, clipped text, overflow, axe-core, screenshots. Uses the project's Playwright; `NOT_RUN` without it |
| `find_ui_references` | Optional Niblet catalogue: real product screens for one design question (needs `NIBLET_TOKEN`); untrusted results |
| `get_design_reference` | Optional Niblet catalogue: recorded colors, typography and components for a web screen or pack |
| `find_ui_materials` | Optional Niblet catalogue: license-recorded fonts, icons, animated icons and components |
| `get_ui_component` | Optional Niblet catalogue: a component's shadcn registry item; authorizes no install or write |
<!-- tools:end -->

**Resources:** `designer://skill` and `designer://reference/{+name}` (names include `ux/*`).

**Prompt:** `design`, with `task` and optional `aesthetic`. The prompt does not load the entire reference library.

A direction PASS validates input only; it does not persist approval or prevent writes through other tools. `review_and_gate` (result `schemaVersion: 4`) reports each required rule as `RAN`, `UNSUPPORTED`, `UNRESOLVED`, `WAIVED` or `NOT_RUN`, and `staticStatus: PASS | FAIL | INCOMPLETE`; overall `status` and `uiReadiness` are only ever `FAIL | NOT_VERIFIED`. A CSS- or component-only scan cannot evaluate contrast statically, so it is `INCOMPLETE`, not PASS. Rendered checks come from `verify_rendered` (its own result, `scope: "rendered"`) or the host's browser; functional checks need separate evidence.

Style rules are advisory unless adopted through `blockingRules`. Required rules can be waived only in the committed `.designer-skill/config.json`; the per-developer `config.local.json` cannot waive them and cannot use `ignoreFiles`. Empty, ignored-only or fully waived scans, invalid configuration and unsupported scope never become success. Semantics and bounds: [HARDENING.md](../docs/HARDENING.md).

## Niblet catalogue (optional)

Every tool works with no account and no key. The four catalogue tools add real product screens, recorded design references, license-recorded fonts and icons, and React component source from the hosted Niblet MCP: this server is its MCP client and passes the tools through, images included, so no second server needs configuring.

To turn it on: Sign up at [niblet.pymodel.com](https://niblet.pymodel.com), create an MCP key at [niblet.pymodel.com/account](https://niblet.pymodel.com/account) (keys start with `niblet_at_`), set it as `NIBLET_TOKEN` in this server's environment and restart the client.

```json
{ "mcpServers": { "designer-skill": { "command": "npx", "args": ["-y", "@pymodel/designer-skill-mcp@latest"], "env": { "NIBLET_TOKEN": "niblet_at_…" } } } }
```

| State | What a catalogue tool answers |
|---|---|
| No `NIBLET_TOKEN` | Setup guidance (the sign-up steps above); nothing is sent |
| `NIBLET_DISABLED=1` | "Disabled"; nothing is sent, even with a key |
| `NIBLET_TOKEN` is not a `niblet_at_` key | Guidance; the value is never sent |
| Key rejected (401/403) | Guidance to create a fresh key; not retried |
| Network error, timeout, 429, 502–504 | Retried (3 tries, 15 s each); then "unavailable", and the catalogue is skipped for 60 s |

None of these is a tool error, and no other tool depends on the catalogue: the agent continues from the project and the bundled references. Results are third-party data, marked untrusted and size-bounded. `get_ui_component` returns source; it authorizes no file write and no dependency install. Follow the bundled `niblet-catalogue` reference for licenses and target-path validation. If a Niblet server is also connected directly, use one of the two per question. Neither certifies rendered quality.

## Environment

| Variable | Effect |
|---|---|
| `DESIGNER_SKILL_ROOTS` | Comma-separated authorized project roots (same as repeated `--root`) |
| `DESIGNER_SKILL_CONTEXT_DIR` | Directory searched first for PRODUCT.md and DESIGN.md; must be inside the project |
| `DESIGNER_SKILL_SCAN_TIMEOUT_MS` | Per-scan deadline in ms (default 60000) |
| `DESIGNER_SKILL_HTTP_TOKEN` | Bearer token required on every HTTP request when set |
| `NIBLET_TOKEN` | Niblet account key; enables the catalogue tools |
| `NIBLET_DISABLED` | `1` turns the catalogue off |
| `NIBLET_API_ORIGIN` | Catalogue origin override (https, bare origin; default `https://niblet-api.pymodel.com`) |
| `NO_UPDATE_NOTIFIER` | `1` skips update checks |

A client that declares no MCP roots and passes no `--root` gets `SCOPE_VIOLATION` from the file-reading tools; add `--root`.

Tool failures return `isError` with one text block holding JSON `{ "code", "message", "details"? }` (no `structuredContent`); a schema-invalid call is `INPUT_INVALID`.

## HTTP transport

```sh
designer-skill-mcp --http --port 3017 --root /abs/project          # loopback only
DESIGNER_SKILL_HTTP_TOKEN=… designer-skill-mcp --http --host 0.0.0.0 --root /abs/project --allowed-host design.internal
```

Stateless Streamable HTTP on `POST /mcp`. Every HTTP bind requires at least one `--root`, validates the Host header and refuses a browser `Origin` that is not an accepted host; a non-loopback bind also requires `DESIGNER_SKILL_HTTP_TOKEN` (sent as `Authorization: Bearer …`) and at least one `--allowed-host`. `designer-skill-mcp --help` lists every flag and variable.

## Development and validation

Run from this directory. CI exercises Node 22 and 24 with the committed lockfile.

```sh
npm ci
npm run build
node --test checks/core.mjs
npm run typecheck
npm test
node scripts/smoke-tarball.mjs
node dist/index.js --help
```

The canonical skill is `skills/designer-skill/`. `npm run sync-skill` first generates its UX mirror from the sole authoring home, `skills/ux-designer/references/`, then copies the router, 51 references, scripts and schemas into `assets/skill/` with content hashes. Filesystem-only maintainers can run `node scripts/sync-ux.mjs` from the repository root. Missing canonical source fails instead of silently publishing stale content.

`smoke-tarball.mjs` installs the packed tarball with production dependencies only into an empty directory, runs the installed binary over stdio and exercises every tool family and resource. It is not a browser test; the `verify_rendered` tests in `test/audit-fixes.test.ts` drive a real browser when one is installed.

## Report validation

Run-report v2 distinguishes check kinds and requires observed rendered evidence for UI PASS. Structurally validate the bundled report/verification-plan schemas, then run `assets/skill/scripts/validate-report.mjs REPORT PLAN AUTHORIZED_ROOT` with Node for semantic plan matching, final revisions, confined artifact existence and hashes. Exit 0 certifies only report validation. A host-owned plan and honest evidence production remain necessary; a model cannot authorize its own waived checks. Report v1 is rejected, not silently converted. Deploy matching schema/validator assets to host readers and writers together.

## Version and updates

The server does not auto-install updates. An interactive HTTP run may print one stderr line: an available update, or why the check failed. Stdio runs never check.

```sh
designer-skill-mcp --version
designer-skill-mcp --check-update
```

Disable update notices with `NO_UPDATE_NOTIFIER=1` or `--no-update-notifier`.

Plugin installations and npm installations are separate. Publish coordinated versions and refresh the relevant client installation; do not assume changing source updates an installed server.

## Release

Maintainers: `.claude/skills/release/SKILL.md`. `scripts/release.sh` prepares and tags; the tag-triggered `publish.yml` workflow publishes with provenance.

## License

MIT
