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
| `load_project_context` | Read PRODUCT.md and DESIGN.md independently; requires `cwd` |
| `get_design_system` | Full SKILL.md contract and reference routing map |
| `get_reference` | Load one named reference (designer or `ux/*`) on demand |
| `anti_slop_checklist` | Advisory style, truthful-content and completeness guidance |
| `list_commands` | Discover canonical commands and aliases |
| `get_command` | Command help and reference names, not eagerly loaded documents |
| `dispatch_intent` | Route requests with explicit negative triggers and deferred reads |
| `commit_design_direction` | Validate inspected `contextSources` and preservation/new-direction inputs |
| `get_palette_seed` | Optional seed for an authorized new palette |
| `detect_antipatterns` | Bounded static scan: coverage, per-file engine and gaps, file hashes; requires `cwd` and `target` |
| `review_and_gate` | Static verification per required rule; requires `cwd` and `target` |
| `find_ui_references` | Optional text-only Niblet catalogue search or selected-screen metadata (needs `NIBLET_TOKEN`); untrusted results, URLs never fetched automatically |
| `get_design_reference` | Optional niblet structured reference for a web screen (needs `NIBLET_TOKEN`); untrusted results |
| `find_ui_materials` | Niblet materials routing guidance (fonts, icons, animated icons, components); no materials fetched here; retrieval runs on the Niblet MCP package or hosted MCP; kind `pack` is refused |
<!-- tools:end -->

**Resources:** `designer://skill` and `designer://reference/{+name}` (names include `ux/*`).

**Prompt:** `design`, with `task` and optional `aesthetic`. The prompt does not load the entire reference library.

A direction PASS validates input only; it does not persist approval or prevent writes through other tools. `review_and_gate` (result `schemaVersion: 3`) reports each required rule as `RAN`, `UNSUPPORTED`, `UNRESOLVED` or `WAIVED`, and `staticStatus: PASS | FAIL | INCOMPLETE`; overall `status` and `uiReadiness` are only ever `FAIL | NOT_VERIFIED`. A CSS- or component-only scan cannot evaluate contrast statically, so it is `INCOMPLETE`, not PASS. Rendered, functional and accessibility checks need separate evidence.

Style rules are advisory unless adopted through `blockingRules`. Required rules can be waived only in the committed `.designer-skill/config.json`; the per-developer `config.local.json` cannot waive them and cannot use `ignoreFiles`. Empty, ignored-only or fully waived scans, invalid configuration and unsupported scope never become success. Semantics and bounds: [HARDENING.md](../docs/HARDENING.md).

## Pairing with Niblet

Prefer the separately connected Niblet MCP's server-qualified catalogue tools for images and materials; discover its schema before calling. This server's same-named tools are text/routing fallbacks, not proxies for Niblet's complete MCP. Setting `NIBLET_TOKEN` enables only screen/design-reference REST reads here; Niblet MCP requires its own host connection. Hosted `get_ui_component` supplies React source, but retrieval does not authorize source writes or dependency installation. Follow the bundled `niblet-catalogue` reference for licenses, target-path validation and bounded retrieval. Neither service certifies rendered quality.

## HTTP transport

```sh
designer-skill-mcp --http --port 3017 --root /abs/project          # loopback only
DESIGNER_SKILL_HTTP_TOKEN=… designer-skill-mcp --http --host 0.0.0.0 --root /abs/project --allowed-host design.internal
```

Stateless Streamable HTTP on `POST /mcp`. Every HTTP bind requires at least one `--root`; a non-loopback bind also requires `DESIGNER_SKILL_HTTP_TOKEN` (sent as `Authorization: Bearer …`). `designer-skill-mcp --help` lists every flag and variable.

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

The canonical skill is `skills/designer-skill/`. `npm run sync-skill` first generates its UX mirror from the sole authoring home, `skills/ux-designer/references/`, then copies the router, 50 references, scripts and schemas into `assets/skill/` with content hashes. Filesystem-only maintainers can run `node scripts/sync-ux.mjs` from the repository root. Missing canonical source fails instead of silently publishing stale content.

`smoke-tarball.mjs` installs the packed tarball with production dependencies only into an empty directory, runs the installed binary over stdio and exercises every tool family and resource. It is not a browser test.

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
