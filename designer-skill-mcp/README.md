# @pymodel/designer-skill-mcp

MCP guidance and static verification for UI design, implementation and review. Use project evidence first, preserve authorized scope, and distinguish a static check from rendered UI readiness.

> This source revision introduces gate result schema v2. It is not an npm release. Existing published packages can retain the previous contract until a coordinated release. Read [the migration guide](../docs/HARDENING.md) before updating clients.

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

Use an explicitly selected version for a reproducible deployment. Installing `@latest` does not install an unmerged development branch. No model API key is required by the guidance tools. The host must authorize the project root and any file changes.

## Workflow and tools

Start with `get_preflight_brief`, then `load_project_context` using the actual **absolute** project directory. Audit and planning requests do not authorize implementation edits. Missing PRODUCT.md does not discard DESIGN.md or force setup.

| Tool | Purpose |
|---|---|
| `get_preflight_brief` | Compact scope and verification contract; call first |
| `load_project_context` | Read PRODUCT.md and DESIGN.md independently; requires `cwd` |
| `get_design_system` | Full SKILL.md contract and reference routing map |
| `get_reference` | Load one named reference on demand |
| `list_commands` | Discover canonical commands and aliases through help |
| `get_command` | Command help and reference names, not eagerly loaded documents |
| `dispatch_intent` | Route requests with explicit negative triggers and deferred reads |
| `commit_design_direction` | Validate inspected `contextSources` and preservation/new-direction inputs |
| `get_palette_seed` | Optional seed for an authorized new palette |
| `detect_antipatterns` | Bounded static scan with coverage and file hashes; requires `cwd` and `target` |
| `review_and_gate` | Static status, findings and unverified UI checks; requires `cwd` and `target` |
| `anti_slop_checklist` | Advisory style, truthful-content and completeness guidance |

**Resources:** `designer://skill` and `designer://reference/{name}`.

**Prompt:** `design`, with `task` and optional `aesthetic`. The prompt does not load the entire reference library.

A direction PASS validates input only; it does not persist approval or prevent writes through other tools. `review_and_gate` exposes `staticStatus: PASS | FAIL`, but overall `status` and `uiReadiness` are `FAIL | NOT_VERIFIED`. There is no aesthetic score or overall static-only PASS. Required browser, functional and accessibility checks need separate evidence.

Style rules are advisory unless explicitly adopted through `blockingRules`. Empty/ignored-only scans, invalid registry/configuration and unsupported scope never become success. Refresh client tool schemas and restart long-lived processes when migrating.

## Development and validation

Run from this directory. CI exercises Node 22 and 24 with the committed lockfile.

```sh
npm ci
npm run build
node --test checks/core.mjs
npm test
node scripts/verify-package.mjs
node dist/index.js
```

The canonical skill is `skills/designer-skill/`. Build copies its router, references, scripts and schemas into `assets/skill/` and writes content hashes. Missing canonical source fails instead of silently publishing stale content.

Packed-content verification unpacks outside the checkout and validates packaged documents, schemas, hashes and command routing. It is not a browser test or a clean dependency-install test. See [the migration guide](../docs/HARDENING.md) for scope limits, evidence semantics and rollback.

## Version and updates

The server does not auto-install updates. It may display an update notice on stderr.

```sh
designer-skill-mcp --version
designer-skill-mcp --check-update
```

Disable update notices with `NO_UPDATE_NOTIFIER=1` or `--no-update-notifier`.

Plugin installations and npm installations are separate. Publish coordinated versions and refresh the relevant client installation; do not assume changing source updates an installed server.

## Release

From the repository root, follow `skills/release/SKILL.md`:

```sh
./scripts/release.sh "Describe the verified changes."
```

Do not publish this contract under a previously released version. Require build, tests, packaging and security checks before release. The package engine range remains unchanged in this source patch; reconcile the publication floor with verified dependency requirements during release.

## License

MIT
