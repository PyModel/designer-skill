#!/usr/bin/env bash
# Prepare a designer-skill-mcp release: bump + sync every version, verify, commit, tag, push.
# Publishing (npm with provenance, MCP registry, GitHub release) runs in
# .github/workflows/publish.yml from a clean checkout of the pushed tag, so
# what ships is exactly what was tagged. Every step is safe to rerun.
#
# Usage:
#   ./scripts/release.sh "Release notes"            # next minor (0.17.0 → 0.18.0)
#   ./scripts/release.sh 0.17.1 "Hotfix notes"      # explicit x.y.z (a leading v is accepted)
#   PUBLISH_LOCAL=1 ./scripts/release.sh "Notes"    # npm publish from this machine's npm
#                                                     login (no provenance) before pushing
#                                                     the tag; CI then skips its npm publish
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/designer-skill-mcp"
PKG_NAME="@pymodel/designer-skill-mcp"
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }
current_version() { node -p "require('${PKG_DIR}/package.json').version"; }

# --- Arguments: strict x.y.z, one optional leading v -------------------------
if [[ $# -gt 0 && "$1" =~ ^v?[0-9] ]]; then
  VERSION="${1#v}"
  shift
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version \"$VERSION\" is not x.y.z"
elif git rev-parse -q --verify "refs/tags/v$(current_version)" >/dev/null &&
  [[ "$(git rev-parse "v$(current_version)^{commit}")" == "$(git rev-parse HEAD)" ]]; then
  # A previous run already committed and tagged the bump: resume it, never bump twice.
  VERSION="$(current_version)"
else
  # shellcheck disable=SC2016 # JS template literal, not shell expansion
  VERSION="$(node -e 'const [a, b] = process.argv[1].split(".").map(Number); console.log(`${a}.${b + 1}.0`)' "$(current_version)")"
fi
NOTES="${*:-Release designer-skill-mcp v${VERSION}.}"
TAG="v${VERSION}"
echo "==> ${PKG_NAME}: $(current_version) → ${VERSION} (${TAG})"

# --- Preflight ---------------------------------------------------------------
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "release from main"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"
on_npm() { npm view "${PKG_NAME}@${VERSION}" version >/dev/null 2>&1; }
if [[ "${PUBLISH_LOCAL:-}" == 1 ]]; then npm whoami >/dev/null 2>&1 || die "npm is not logged in"; fi
git fetch --quiet origin main --tags

# Build, verify and publish from a clean worktree of the tag, never from this tree.
publish_local() {
  if on_npm; then echo "==> ${PKG_NAME}@${VERSION} already on npm"; return; fi
  local wt
  wt="$(mktemp -d)"
  git worktree add --quiet --detach "$wt" "$TAG"
  # One && chain: bash ignores `set -e` inside a subshell on the left of `||`,
  # so each step must gate the next explicitly or a failed test would still publish.
  (
    cd "$wt/designer-skill-mcp" &&
      npm ci &&
      npm run build &&
      git diff --exit-code -- assets/ &&
      node --test checks/core.mjs &&
      npm run typecheck &&
      npm test &&
      node scripts/smoke-tarball.mjs &&
      npm publish --access public --ignore-scripts
  ) || { git worktree remove --force "$wt"; die "local publish failed; fix and rerun (the tag is reused)"; }
  git worktree remove --force "$wt"
}

push_release() {
  [[ "${PUBLISH_LOCAL:-}" == 1 ]] && publish_local
  git push origin HEAD:main
  git push origin "refs/tags/${TAG}"
}

# --- Resume: an earlier run committed and tagged but did not finish pushing --
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  [[ "$(git rev-parse "${TAG}^{commit}")" == "$(git rev-parse HEAD)" ]] || die "tag ${TAG} exists on another commit"
  git merge-base --is-ancestor origin/main HEAD || die "origin/main moved past the release commit"
  echo "==> ${TAG} already tagged at HEAD; resuming"
  push_release
  echo "==> Done. publish.yml finishes ${TAG}."
  exit 0
fi

on_npm && die "${PKG_NAME}@${VERSION} is already on npm; choose a new version"

[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || die "main is not in sync with origin/main"
command -v claude >/dev/null 2>&1 || die "'claude' CLI not found; it validates the plugin manifest"

# --- Bump, verify, commit ----------------------------------------------------
RELEASE_FILES=(
  designer-skill-mcp/package.json designer-skill-mcp/package-lock.json designer-skill-mcp/server.json
  .claude-plugin/plugin.json .codex-plugin/plugin.json .cursor-plugin/plugin.json
  mcp.json README.md commands/designer-setup.md
)
# Until the release commit exists, any failure restores the version files so a
# rerun starts from the same clean tree.
restore_release_files() { git checkout --quiet HEAD -- "${RELEASE_FILES[@]}"; }
trap 'restore_release_files; echo "release aborted; version files restored" >&2' EXIT

node scripts/versions.mjs sync "$VERSION"
node scripts/versions.mjs check
claude plugin validate --strict "$ROOT"

(
  cd "$PKG_DIR"
  npm ci
  npm run build
  git -C "$ROOT" diff --exit-code -- designer-skill-mcp/assets/ || die "generated assets drifted from skills/; commit the sync first"
  node --test checks/core.mjs
  npm run typecheck
  npm test
  node scripts/smoke-tarball.mjs
)

git add -- "${RELEASE_FILES[@]}"
unexpected="$(git status --porcelain | grep -v '^M  ' || true)"
[[ -z "$unexpected" ]] || die "release left unexpected changes: ${unexpected}"
git commit -m "Release designer-skill-mcp v${VERSION}" -m "$NOTES"
trap - EXIT
git tag -a "$TAG" -m "designer-skill-mcp v${VERSION}" -m "$NOTES"

# --- Push (publish.yml takes over on the tag) --------------------------------
# Direct push to main relies on repo admins bypassing main's required checks.
push_release
echo "==> Done. publish.yml finishes ${TAG}: npm (skipped if published), MCP registry, GitHub release."
