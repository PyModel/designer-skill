#!/usr/bin/env bash
# Prepare a designer-skill-mcp release: bump + sync every version, verify, commit, tag, push.
# Publishing (npm with provenance, MCP registry, GitHub release) runs in
# .github/workflows/publish.yml from a clean checkout of the pushed tag, so
# what ships is exactly what was tagged. Every step is safe to rerun.
#
# Usage:
#   ./scripts/release.sh "Release notes"            # next minor (0.17.0 → 0.18.0)
#   ./scripts/release.sh 0.17.1 "Hotfix notes"      # explicit x.y.z (a leading v is accepted)
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
if npm view "${PKG_NAME}@${VERSION}" version >/dev/null 2>&1; then
  die "${PKG_NAME}@${VERSION} is already on npm; choose a new version"
fi
git fetch --quiet origin main --tags

# --- Resume: an earlier run committed and tagged but did not finish pushing --
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  [[ "$(git rev-parse "${TAG}^{commit}")" == "$(git rev-parse HEAD)" ]] || die "tag ${TAG} exists on another commit"
  git merge-base --is-ancestor origin/main HEAD || die "origin/main moved past the release commit"
  echo "==> ${TAG} already tagged at HEAD; pushing"
  git push origin HEAD:main
  git push origin "refs/tags/${TAG}"
  echo "==> Done. publish.yml publishes ${TAG}."
  exit 0
fi

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
git push origin HEAD:main
git push origin "refs/tags/${TAG}"
echo "==> Done. publish.yml publishes ${TAG} to npm, the MCP registry and GitHub releases."
