# Known drift at v0.24.0 (re-verified 2026-11-12)

Open:

- `server.ts` SERVER_NAME `designer-skill-mcp` vs config key `designer-skill` (low).
- `.codex-plugin/plugin.json` displayName `Designer Skill` vs `designer-skill` in the Claude and Cursor manifests (low).
- `skills.sh.json` lists `release`, which lives only at `.claude/skills/release/SKILL.md` (low, inferred).
- SECURITY.md supports the `0.x` range, not an exact version (low).

Closed since the v0.22.0 audit: blog version pin (now in PIN_TARGETS), blog niblet.com domain, PyModel LLC ownership lines, lockfile vulnerabilities (npm audit 0).
