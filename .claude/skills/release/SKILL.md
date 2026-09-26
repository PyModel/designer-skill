---
name: release
description: Cut and publish a designer-skill-mcp release (maintainers only).
disable-model-invocation: true
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
3. `claude plugin validate --strict`, `npm ci`, build, generated-asset drift check, `checks/core.mjs`, `npm run typecheck`, `npm test`, clean-install tarball smoke.
4. Commits only the release files, tags `v<version>`, pushes `main` and the tag.

Rerunning after a partial run is safe: an existing tag at HEAD resumes at the push.

`PUBLISH_LOCAL=1 ./scripts/release.sh "Notes"` publishes to npm from this machine's npm login (no provenance) before pushing the tag. It builds, tests and smoke-tests a clean worktree of the tag first. npm processes uploads asynchronously; the CI npm job waits up to 10 minutes for the version and then skips it. It is now only a fallback: the npm trusted publisher is configured (2026-09-24), so a plain `./scripts/release.sh` lets CI publish with provenance.

`publish.yml` (on `v*.*.*` tags) re-verifies versions against the tag, rebuilds and tests, then:
- `npm publish --provenance` via npm trusted publishing (OIDC, no token; skipped if the version exists). One-time setup on npmjs.com: package Settings → Trusted publisher → GitHub Actions, `PyModel/designer-skill`, workflow `publish.yml`, environment `npm`, with direct publishing allowed (`npm trust github … --allow-publish`). Configured 2026-09-24 (saving needs the owner's security key; `npm trust github` cannot do it from a 2FA-bypass token). If the CI publish fails, the job waits for a `PUBLISH_LOCAL=1` publish;
- MCP registry `mcp-publisher validate` + `publish` via GitHub OIDC (fatal on failure). The namespace is case-sensitive: `io.github.PyModel/*`;
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
