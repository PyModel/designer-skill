---
name: release
description: Release designer-skill-mcp (maintainers only). Use when asked to ship, publish, cut a release, bump the version or push a release tag for designer-skill-mcp.
---

# release

Repo-local maintainer skill; it is not shipped to plugin users.

## Pipeline

`scripts/release.sh` prepares and tags; `.github/workflows/publish.yml` publishes from a clean checkout of the tag.

```bash
./scripts/release.sh "Release notes"          # next minor: 0.17.0 → 0.18.0
./scripts/release.sh 0.17.1 "Hotfix notes"    # explicit x.y.z (v0.17.1 also accepted)
```

`release.sh`:
1. Preflight: on `main`, clean tree, in sync with `origin/main`, `gh` authenticated, `claude` CLI present, version not already on npm.
2. `node scripts/versions.mjs sync <version>` writes the version to package.json, the lockfile, server.json, the three plugin manifests, the pinned `mcp.json` and the doc pins (`@pymodel/designer-skill-mcp@x.y.z`), then `versions.mjs check`.
3. `claude plugin validate --strict`, `npm ci`, build, generated-asset drift check, `checks/core.mjs`, `npm test`, clean-install tarball smoke.
4. Commits only the release files, tags `v<version>`, pushes `main` and the tag.

Rerunning after a partial run is safe: an existing tag at HEAD resumes at the push.

`publish.yml` (on `v*.*.*` tags) re-verifies versions against the tag, rebuilds and tests, then:
- `npm publish --provenance` (skipped if the version exists; needs the `NPM_TOKEN` secret in the `npm` environment);
- MCP registry `mcp-publisher validate` + `publish` via GitHub OIDC (fatal on failure);
- `gh release create` from the tag notes (skipped if it exists).

A failed publish run is re-run from the Actions tab; each step skips completed work.

## Verify

```bash
node scripts/versions.mjs check
npm view @pymodel/designer-skill-mcp version
gh release view v<version>
```

## Do not

- Publish from a local working tree (`npm publish` by hand) — the tag is the source of truth.
- Edit version fields by hand; use `versions.mjs sync`.
- Add `Co-authored-by` or agent attribution to commits or tags.
