#!/usr/bin/env bash
# Release designer-skill-mcp: bump versions, test, commit, tag, push, npm publish, GitHub release.
#
# Default version bump: +0.1.0 minor (0.10.0 → 0.11.0). Pass an explicit semver to override.
#
# Usage:
#   ./scripts/release.sh "Release notes"
#   ./scripts/release.sh 0.11.1 "Hotfix notes"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/designer-skill-mcp"

read_current_version() {
  node -p "require('${PKG_DIR}/package.json').version"
}

next_minor_version() {
  node -e "
    const [major, minor] = process.argv[1].split('.').map(Number);
    if ([major, minor].some((n) => Number.isNaN(n))) process.exit(1);
    console.log(\`\${major}.\${minor + 1}.0\`);
  " "$(read_current_version)"
}

is_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

if [[ $# -eq 0 ]]; then
  VERSION="$(next_minor_version)"
  NOTES="Release designer-skill-mcp v${VERSION}."
elif is_semver "${1:-}"; then
  VERSION="$1"
  shift || true
  NOTES="${*:-Release designer-skill-mcp v${VERSION}.}"
else
  VERSION="$(next_minor_version)"
  NOTES="$*"
fi

CURRENT="$(read_current_version)"
echo "==> Current version: ${CURRENT}"
echo "==> Target version:  ${VERSION} (default bump: +0.1.0 minor)"

TAG="v${VERSION}"

echo "==> Bump package to ${VERSION}"
cd "$PKG_DIR"
npm version "$VERSION" --no-git-tag-version --allow-same-version

echo "==> Sync plugin manifests"
node <<NODE
const fs = require("fs");
const paths = [
  ["${ROOT}/.claude-plugin/plugin.json", (s) => JSON.stringify({ ...JSON.parse(s), version: "${VERSION}" }, null, 2) + "\n"],
  ["${ROOT}/.codex-plugin/plugin.json", (s) => JSON.stringify({ ...JSON.parse(s), version: "${VERSION}" }, null, 2) + "\n"],
  ["${ROOT}/.cursor-plugin/plugin.json", (s) => JSON.stringify({ ...JSON.parse(s), version: "${VERSION}" }, null, 2) + "\n"],
  ["${PKG_DIR}/server.json", (s) => JSON.stringify({ ...JSON.parse(s), version: "${VERSION}", packages: [{ ...JSON.parse(s).packages[0], version: "${VERSION}" }] }, null, 2) + "\n"],
];
for (const [file, transform] of paths) {
  fs.writeFileSync(file, transform(fs.readFileSync(file, "utf8")));
}
NODE

echo "==> Update doc version pins"
node <<NODE
const fs = require("fs");
const version = "${VERSION}";
const pin = \`@\${version}\`;
const files = [
  ["${ROOT}/README.md", (s) => s.replace(/pin \`@[0-9]+\.[0-9]+\.[0-9]+\`/g, \`pin \${pin}\`)],
  ["${ROOT}/commands/designer-setup.md", (s) => s.replace(/with \`@[0-9]+\.[0-9]+\.[0-9]+\`/g, \`with \${pin}\`)],
];
for (const [file, transform] of files) {
  if (fs.existsSync(file)) fs.writeFileSync(file, transform(fs.readFileSync(file, "utf8")));
}
NODE

echo "==> Validate Claude plugin manifest"
if ! command -v claude >/dev/null 2>&1; then
  echo "ERROR: 'claude' CLI not found; cannot validate plugin manifest before release." >&2
  exit 127
fi
claude plugin validate --strict "$ROOT"

echo "==> Build and test"
npm run build
npm test

echo "==> Commit"
cd "$ROOT"
git add \
  designer-skill-mcp/package.json \
  designer-skill-mcp/package-lock.json \
  designer-skill-mcp/server.json \
  .claude-plugin/plugin.json \
  .codex-plugin/plugin.json \
  .cursor-plugin/plugin.json \
  README.md \
  commands/designer-setup.md

if ! git diff --cached --quiet; then
  git commit -m "$(cat <<EOF
Release designer-skill-mcp v${VERSION}.

${NOTES}
EOF
)"
else
  echo "No version file changes to commit."
fi

echo "==> Tag ${TAG}"
git tag -a "$TAG" -m "$(cat <<EOF
designer-skill-mcp v${VERSION}

${NOTES}
EOF
)"

echo "==> Push branch and tag"
# Direct push to main: relies on repo admins being exempt from main's required
# status checks (classic protection enforce_admins=off + Repository-admin on the
# main-hardening ruleset bypass list). Run releases from an admin-authed session
# (npm whoami / gh auth as elkaix). Non-admin pushes to main stay gated by checks.
git push origin HEAD
git push origin "$TAG"

echo "==> Publish to npm"
cd "$PKG_DIR"
npm publish --access public

echo "==> Publish to MCP Registry (optional; requires mcp-publisher login)"
if command -v mcp-publisher >/dev/null 2>&1; then
  mcp-publisher publish || echo "warn: mcp-publisher publish failed (run manually after login)"
else
  echo "skip: mcp-publisher not installed (brew install mcp-publisher)"
fi

echo "==> Create GitHub release"
cd "$ROOT"
gh release create "$TAG" \
  --title "designer-skill-mcp v${VERSION}" \
  --notes "$NOTES"

echo "==> Done: ${TAG} published to git, npm, and GitHub."
