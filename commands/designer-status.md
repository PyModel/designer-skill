---
name: designer-status
description: Print designer-skill-mcp version and npm update status
---

# designer-skill Status

```bash
npx -y designer-skill-mcp --version
npx -y designer-skill-mcp --check-update
```

Report both lines to the user.

**Updates:** MCP via `npx …@latest` or pin `@<semver>` in `mcp.json`. Plugin skill content via `/plugin update designer-skill@pymodel` (Claude/Codex) or reinstall the Cursor plugin.
