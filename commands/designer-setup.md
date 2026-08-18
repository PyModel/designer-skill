---
name: designer-setup
description: Verify designer-skill MCP is installed and reachable
---

# designer-skill Setup

## Step 1: Check MCP package

```bash
npx -y @pymodel/designer-skill-mcp --version
```

If this prints a version, the npm package resolves. If not, check Node.js (18+) and network access.

## Step 2: Verify MCP is connected

In Cursor: **Settings → Tools & MCP** — confirm `designer-skill` is listed and enabled.

Or test from the shell:

```bash
npx -y @pymodel/designer-skill-mcp --check-update
```

## Step 3: Smoke test

Ask the agent:

```
Use designer-skill: call get_preflight_brief, then commit_design_direction for a sample brand landing page direction, then list_commands.
```

You should see the skill router and command list.

## Manual MCP config

If the plugin did not wire MCP, add repo-root `mcp.json` (or `.cursor/mcp.json`):

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

Pin a version for teams: replace `@latest` with @0.15.0.
