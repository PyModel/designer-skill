# @pymodel/designer-skill-mcp

Plug-and-play [MCP](https://modelcontextprotocol.io) server that gives your coding agent **UI superpowers**.

Add one line to your agent config. No API key. Your agent gets design tools, reference docs, and a ship gate.

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

**Registry** (after npm publish, from `designer-skill-mcp/`):

```bash
brew install mcp-publisher
mcp-publisher login github
mcp-publisher publish
```

## Tools

| Tool | Purpose |
|---|---|
| `get_design_system` | SKILL.md router (call first) |
| `load_project_context` | Read PRODUCT.md / DESIGN.md from the project |
| `get_reference` | One of fifteen reference files by name |
| `list_commands` | All design verbs with descriptions |
| `get_command` | Full guidance + references for a specific verb |
| `dispatch_intent` | Map a request ("make it pop", "it feels off") to design verb(s) + files |
| `detect_antipatterns` | Deterministic scan (44 rules), no LLM, no API key |
| `get_palette_seed` | OKLCH brand-seed for greenfield palette work |
| `anti_slop_checklist` | Ship gate before finishing any UI work |

**Resources:** `designer://skill` · `designer://reference/{name}`

**Prompt:** `design` (args: `task`, optional `aesthetic`)

## Dev

```bash
npm install
npm run build
npm test
node dist/index.js
# or: npx -y @pymodel/designer-skill-mcp
```

## Version and updates

The server does **not** auto-install updates. On startup it may show a weekly stderr notice when a newer npm release exists.

```bash
designer-skill-mcp --version        # print installed version
designer-skill-mcp --check-update   # query npm and print upgrade status
```

Upgrade:

```bash
npx -y @pymodel/designer-skill-mcp@latest
```

Opt out: `NO_UPDATE_NOTIFIER=1`, `--no-update-notifier`, or configstore (`~/.config/configstore/update-notifier-designer-skill-mcp.json`).

**Plugin installs** (Claude Code / Codex / Cursor) are separate from npm — bump the plugin version on release, then:

```bash
/plugin marketplace update pymodel
/plugin update designer-skill@pymodel
```

Cursor: reinstall or update the plugin from marketplace; MCP args live in repo `mcp.json`.

Canonical skill content: `skills/designer-skill/` (synced to `assets/skill/` on build).

## Release

From repo root (see `skills/release/SKILL.md`):

```bash
./scripts/release.sh "What changed in this release."
```

**Default bump:** +0.1.0 minor (`0.10.0` → `0.11.0`). Pass an explicit semver only for hotfixes or breaking releases:

```bash
./scripts/release.sh 0.11.1 "Hotfix."
```

## License

MIT
