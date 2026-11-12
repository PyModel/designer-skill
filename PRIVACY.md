# Privacy

Designer Skill is a skill and a local MCP server. It runs on your machine, has no account, and sends no telemetry or analytics.

## What leaves your machine

- **Niblet catalogue (optional).** Only when `NIBLET_TOKEN` is set and an agent calls a catalogue tool, the server sends that tool's arguments (for example a search query) and the key to `niblet-api.pymodel.com`. Without a key, or with `NIBLET_DISABLED=1`, nothing is sent. Use of the catalogue is covered by Niblet's own terms at https://niblet.pymodel.com.
- **Update check.** `--check-update`, and an interactive HTTP run, ask `registry.npmjs.org` for the latest version number. `NO_UPDATE_NOTIFIER=1` turns this off.
- **Rendered checks.** `verify_rendered` opens only pages on your machine. A page it opens can itself load images, scripts or frames from other hosts.

## What stays on your machine

Project files and design context are read locally and review results go back to your agent. The only files the server writes are `verify_rendered` screenshots, in the system temporary directory.

Details and limits: [docs/HARDENING.md](docs/HARDENING.md). Questions: open an issue at https://github.com/PyModel/designer-skill/issues.

© 2026 PyModel LLC
