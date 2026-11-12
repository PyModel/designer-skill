---
name: designer-skill-mcp-consistency
description: Use when changing designer-skill-mcp versions or names.
category: release
---

# designer-skill-mcp: name, pin and ownership consistency

Before calling a designer-skill-mcp change consistent, check every name, version pin and ownership line across package.json, server.json, plugin manifests, mcp.json, README, docs/ and docs/blog/. Pins outside `PIN_TARGETS` (`scripts/versions.mjs`) are checked by no script; add a file there when it gains a pin.

- Core names are consistent (npm `@pymodel/designer-skill-mcp`, mcpName `io.github.PyModel/designer-skill-mcp`, bin `designer-skill-mcp`). Keep them.
- Three names, each with one job: `designer-skill-mcp` is the server and package identifier (`SERVER_NAME`), `designer-skill` is the config key and plugin name, and `Designer Skill` is the human title (`SERVER_TITLE` and every manifest's display name). Never change one side silently.
- Copyright and credit lines say `© <year> PyModel LLC` (LICENSE, README, Info.plist, footers).
- Blog and docs use the live domain (niblet.pymodel.com) and current version pins.
- Moving or renaming a test file, or rewording a reference doc, breaks names pinned elsewhere. Grep README.md and docs/ for the old test path (`test/rendered.test.ts` went stale when rendered tests moved into `test/audit-fixes.test.ts`). When `test/reference-reachability.test.ts` pins a phrase from a reference doc, update that assertion in the same change (`remote-only` became `this server's pass-through` in the niblet catalogue doc), then rerun the suite.
- Open drift at v0.24.0: `references/known-drift-2026-11-12.md`. Re-verify with a fresh grep before acting on it.
- A tool rename (e.g. `get_design_system` to `get_skill_contract`) needs a grep of the old name across README, docs/ and the skill folders before the change is called consistent.
