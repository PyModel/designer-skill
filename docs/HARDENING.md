# Evidence-backed designer contract migration

## Scope

This revision fixes false-success static gates, drifting command definitions, context ordering, unnecessary creative-direction requirements, incorrect accessibility guidance, and unbounded initial reference loading. It preserves the twelve MCP tool names, fifteen reference names and existing command aliases. Dependencies and package version are unchanged; this is a coordinated source revision, not an npm publication.

## Breaking contract changes

| Previous behavior | New behavior | Caller migration |
|---|---|---|
| A score of 85 with no blocking style findings produced overall PASS | Gate `schemaVersion: 2` returns `staticStatus` separately; overall `status` / `uiReadiness` is FAIL or NOT_VERIFIED | Stop consuming `score` or treating a static scan as a release certificate. Inspect `checks`, `coverage`, `files` and findings. |
| Context and scan tools defaulted to the MCP process directory | MCP calls require an absolute `cwd` | Pass the host-authorized project root explicitly. Programmatic core adapters retain their documented default for compatibility. |
| Direction commitment forced preset aesthetics and an inverse-test assertion | Direction input requires `contextSources`; `mode: preserve` supports bounded repairs; custom systems are accepted | Load context first. Skip direction ceremony for audits. Add actual inspected sources; never fabricate approval. |
| Unknown command help silently fell back | Unknown explicit commands return a typed error | Discover commands or route natural language; do not treat an error as permission to execute. |
| `get_command` eagerly returned complete references | It returns help and reference names | Call `get_reference` only for selected documents. |
| Missing PRODUCT.md hid DESIGN.md and forced setup | Context documents resolve independently; setup is optional | Inspect available identity and code; do not overwrite context to satisfy a tool. |
| Malformed configuration and a missing registry could weaken checks silently | Invalid configuration and registry fail explicitly | Repair the input or installation; do not disable validation as recovery. |
| External context directories and scan targets could be supplied | Reads are checked against the explicit project root; scan symlinks are rejected | Keep approved inputs within the authorized root or select an appropriate separately authorized root. |

A direction PASS means input validation only. Its SHA-256 identifier hashes the submitted record; it does not verify that sources were read, persist an approval, or prevent writes through other host tools. The host owns authorization. `cwd` is not an authentication boundary, and these filesystem checks are not a hostile-filesystem sandbox.

## Verification semantics

A completed audit can report `taskStatus: COMPLETE` while `uiReadiness: FAIL`. A static-only implementation report cannot claim rendered readiness. The normalized input and run-report schemas under `skills/designer-skill/schemas/` describe the agent's report, not a promise that every field is an MCP argument. JSON Schema defaults do not populate values. Runtime authorization, artifact existence and hash validation remain separate checks.

Gate evidence includes scanned/candidate/ignored/unsupported file counts, excluded directories, bytes scanned, selected-file hashes, ignored policy and deduplicated findings. Functional, rendered, accessibility and performance checks remain NOT_RUN until the host produces separate evidence. File hashes help identify stale evidence but do not represent a transactional snapshot of the entire repository or all imported assets.

The scanner is bounded to 2,000 files, 2 MiB per file, 32 MiB selected data, 20,000 visited entries and 48 directory levels. Narrow an oversized scope rather than treating a partial scan as complete. Known generated/dependency directories are explicitly excluded and counted. Source patterns are heuristics, not a complete browser accessibility audit. Stylistic findings are advisory unless an explicit `blockingRules` policy adopts them. Broken images, contrast, overflow and clipped overlays require review by default.

## Tests and acceptance

From `designer-skill-mcp` with the committed lockfile and a supported Node runtime:

```sh
npm ci
npm run build
node --test checks/core.mjs
npm test
node scripts/verify-package.mjs
```

The core suite exercises empty/ignored scans, advisory policy, registry failures, path confinement, configuration validation, independent context documents, registry parity, negative routing, reference budgets and preservation mode. Vitest adds actual bundled-detector and MCP client/server tests. Package verification unpacks the tarball outside the checkout and reads commands, references, schemas and manifest hashes without a development-source fallback. It is a content/loader smoke test, not a clean dependency-install or browser test.

CI covers Node 22 and 24 and retains the required aggregate `test` check. The package engine range is not changed in this patch; the supported publication floor must be reconciled with dependency requirements during release. A successful core test does not establish that the full dependency build, browser behavior or comparative model evaluation has passed.

## Release and rollout

Merge only after the configured checks pass and the behavior changes are reviewed. Deploy the server, canonical skill, reference changes, registry and generated assets together. Rebuild packaged content; restart long-lived MCP processes to discard cached guidance; refresh client tool schemas. First validate a temporary fixture with a valid CSS file, an empty directory and an ignored-only file. Verify that no static-only path reports overall PASS.

The sync step requires canonical source and copies `schemas` in addition to existing content. Its manifest hashes shipped skill files and contains no timestamps, making unchanged content stable across builds. Missing canonical source fails rather than silently publishing stale assets.

## Rollback and recovery

For a pre-release branch, revert the coordinated commit group rather than mixing old server instructions with new result contracts. Do not ship the previous false-PASS behavior as a fallback: disable the release claim and report NOT_VERIFIED while repairing the client/server integration. Preserve prior package artifacts for investigation, not as evidence of verification for a different revision. Do not publish a package version already used for different content.

Within an agent task, revert only verified task-owned hunks, preserve pre-existing staged/unstaged/untracked changes and stop only task-owned processes. Report new defects immediately with paths and evidence. Never use blanket repository cleanup to manufacture a clean status.

## Deliberately not claimed

This revision does not add a Figma connector, a product-specific browser harness, a universal token migration, persisted approval enforcement, or proof that a model produces better designs. Those capabilities require their own authorization, dependencies and comparative evaluations. The revised contract requires actual evidence rather than claiming them from a static score.

## Primary references

- Agent Skills guidance: https://agentskills.io/skill-creation/best-practices
- MCP structured tool results: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- WCAG text contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG target size: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- DTCG 2025.10: https://www.designtokens.org/TR/2025.10/
- Playwright visual snapshots: https://playwright.dev/docs/test-snapshots
- Playwright accessibility: https://playwright.dev/docs/accessibility-testing
- Node releases: https://nodejs.org/en/about/previous-releases
