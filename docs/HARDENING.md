# Verification contract and hardening

What the MCP server verifies, what it refuses to claim, and the bounds it runs under. Gate result `schemaVersion: 4`.

## Trust boundary

- **Project roots.** Every tool that reads files takes an absolute `cwd`. It must sit inside a root authorized by `--root` (repeatable) or `DESIGNER_SKILL_ROOTS`; with neither, a stdio client's declared MCP roots are used. A cwd outside every authorized root is `SCOPE_VIOLATION`; client roots that do not resolve to an existing local path are named in that error (`details.unusableRoots`), and a roots list the client cannot deliver is `SCOPE_VIOLATION` too. With no roots at all (a client that declares none and no `--root`), any existing directory is accepted — the host owns authorization.
- **HTTP.** Every HTTP bind refuses to start without at least one `--root`, since any local process or OS user can reach even a loopback port. The `Host` header (DNS-rebinding protection) and the bearer token are checked before the JSON body is parsed, and bodies are capped at 100 KB. A request whose `Origin` is not an accepted host (or is `null`) is refused with 403. Loopback binds accept only loopback Host names plus any `--allowed-host`; any other bind address also refuses to start without `DESIGNER_SKILL_HTTP_TOKEN` (clients send `Authorization: Bearer …`, compared in constant time).
- **Reads.** One reader (`assets/engine/node/scan-fs.mjs`) touches files: realpath inside the project root, `O_NOFOLLOW|O_NONBLOCK`, `fstat` on the open descriptor (FIFOs, devices and sockets are refused before any read), per-file and total byte caps, sha256 of every byte analyzed. Linked stylesheets resolve like a static web server (`?query`/`#fragment` stripped, `/…` against `webRoot`); remote, `//` and non-file hrefs are never fetched.
- **Isolation.** Detectors run in a worker thread with a deadline (`DESIGNER_SKILL_SCAN_TIMEOUT_MS`, default 60 s) and a 1 GiB heap limit. Exceeding either is `SCAN_LIMIT` naming the file.
- **Untrusted text.** Niblet results and design references are third-party data, framed as untrusted and capped (20,000 characters of text per block, 4 MiB of base64 images); the server never follows instructions or URLs in them.
- **Niblet catalogue.** The only outbound connection a tool makes itself (the update check on an interactive HTTP run contacts registry.npmjs.org unless `NO_UPDATE_NOTIFIER=1`; pages loaded by `verify_rendered` fetch their own subresources). It is made only when `NIBLET_TOKEN` holds a `niblet_at_` key and `NIBLET_DISABLED` is unset, to `NIBLET_API_ORIGIN` (https, bare origin; default `https://niblet-api.pymodel.com`) at `/mcp`, with redirects refused. Each call has a 15 s deadline; network errors, timeouts, 429 and 502–504 are retried (3 tries, 300 ms then 1.2 s apart); after that the catalogue is skipped for 60 s. A rejected key (401/403) and a malformed response are not retried, and a rejected key is not sent again until restart. Every one of these outcomes is guidance text, never a tool error, and no other tool depends on it.
- **Rendered check.** `verify_rendered` loads only a loopback http(s) URL or a file inside the project root; one definition of that scope (`assets/engine/node/local-url.mjs`) is applied to the URL passed in and to every top-level navigation. Each navigation is fetched without following redirects, so a redirect to another host is refused before that host is contacted, and the result is a `page-load` FAIL with nothing inspected or captured. A page that does not load is a FAIL, not a tool error. The browser runs in a child process that loads the project's own Playwright and axe-core (this package ships neither, and looks nowhere else), started without this server's credentials: environment variables whose names contain TOKEN, SECRET, PASSWORD, CREDENTIAL, API_KEY or PRIVATE_KEY, and all `NIBLET_*` and `DESIGNER_SKILL_*`, are not passed. The whole check has a 120 s deadline; at the deadline or on cancellation the process is killed. Screenshots go to a new temporary directory. Subresources (fonts, scripts, images) and iframes may still load from other hosts, and the project's Playwright runs with the user's file permissions: use it on projects whose dependencies you trust.

## Scan selection

- In a git work tree, candidates come from `git ls-files --cached --others --exclude-standard` (so `.gitignore` applies), with fsmonitor/untracked-cache disabled and `GIT_*` variables stripped; outside a work tree, or without git, a bounded filesystem walk. If git fails inside a work tree (timeout, output cap, `safe.directory` refusal), the walk still runs and `coverage.gitListingError` plus the gate summary state that `.gitignore` was not applied.
- Dependency, build, VCS, cache and virtualenv directories (`node_modules`, `dist`, `.venv`, `target`, …) are pruned and counted.
- Symlinks, special files and unreadable entries under a directory target are skipped, counted and named (first 20). An explicitly targeted symlink is `SCOPE_VIOLATION`.
- Binary files (NUL bytes or >10% undecodable) are unsupported, not "scanned".
- Bounds: 20,000 visited entries, 48 directory levels, 2,000 files, 2 MiB per file, 32 MiB total, 20,000 findings. Exceeding one is `SCAN_LIMIT` with `{bound, limit, observed, path}` — never a silently partial scan.

## Gate semantics

`review_and_gate` evaluates **required rules** — `broken-image`, `low-contrast`, `clipped-overflow-container`, plus any `blockingRules` — per scanned file:

| Rule status | Meaning |
|---|---|
| `RAN` | The rule was evaluated on every scanned file |
| `UNSUPPORTED` | A file type cannot express it statically (e.g. contrast in a CSS-only or TSX file), or it needs DESIGN.md tokens that are absent |
| `UNRESOLVED` | It applies but could not be evaluated: an unreadable/remote stylesheet, `@import`, colour-affecting `@container`/`@scope`, an unevaluable colour (`var()` with no value, `color-mix()`, `currentcolor`), or an invalid DESIGN.md |
| `WAIVED` | Listed in `detector.ignoreRules` of the **committed** `.designer-skill/config.json` |
| `NOT_RUN` | No file was scanned, so the rule was never evaluated |

`staticStatus` and `code`, first match wins:

| Condition | staticStatus | code |
|---|---|---|
| Nothing scanned, or every required rule waived | FAIL | `NO_SCAN_COVERAGE` |
| A required-rule finding | FAIL | `STATIC_FINDINGS` |
| A required rule UNRESOLVED | INCOMPLETE | `REQUIRED_RULES_UNRESOLVED` |
| A required rule UNSUPPORTED | INCOMPLETE | `REQUIRED_RULES_UNSUPPORTED` |
| A required rule WAIVED | PASS | `REQUIRED_RULES_WAIVED` |
| Otherwise | PASS | `ADDITIONAL_VERIFICATION_REQUIRED` |

Overall `status` / `uiReadiness` is `FAIL` when the static check fails and `NOT_VERIFIED` otherwise — never PASS. `text-overflow` is required but only a rendered check can evaluate it, so `checks` always reports `rendered: NOT_RUN` with that rule, alongside functional, accessibility and performance `NOT_RUN`. Style rules are advisory unless adopted through `blockingRules`.

The text result lists the summary and the first 20 findings (required rules first); the complete result — every finding, per-rule coverage with examples, per-file engine and gaps, and file hashes with their role (`selected`, `linked-stylesheet`, `design-system`) — is in `structuredContent`.

## Static cascade model

HTML is parsed (htmlparser2 + css-select + css-tree) and styles are computed statically: CSS Color 4 colours (hex, rgb/hsl, hwb, lab/lch, oklab/oklch, `color()` in srgb, srgb-linear and display-p3, 148 named colours); `var()` with cycle detection and a 64 KiB expansion budget; `@media` evaluated against a fixed screen environment (1280×800, light scheme, fine hover pointer); `@layer` order, reversed for `!important`; inline styles; translucent backgrounds composited over the nearest opaque ancestor. DOM depth above 512 is `SCAN_LIMIT`. Font-only stylesheet hosts (Google Fonts, Bunny, Typekit, cdnfonts) are skipped rather than reported unresolved. Other files use linear-time source patterns.

## Configuration policy

`.designer-skill/config.json` (committed) and `config.local.json` (per developer) are validated strictly; any error is `CONFIG_INVALID`, never a silent default.

- `ignoreRules` entries must be exact registry ids (no case variants or padding).
- Settings live under `detector`. The retired `hook` section is rejected with a rename hint, not read.
- A required or blocking rule may be waived **only** in the committed file. `config.local.json` cannot waive one through `ignoreRules` or `ignoreValues`, and cannot use `ignoreFiles` at all, since hiding a file hides every rule.
- `ignoreFiles` globs support `*`, `?`, `**` and `{a,b}` (≤64 alternatives, ≤512 characters). A glob without `/` matches the basename at any depth; a glob ending `/**` prunes the directory. Matching is linear in path and pattern length.
- `webRoot` must be an existing directory inside the project.

## Tests and acceptance

From `designer-skill-mcp`:

```sh
npm ci
npm run build
node --test checks/core.mjs
npm test
node scripts/smoke-tarball.mjs
```

Vitest covers the MCP contract through an in-memory client (output schemas enforced, `line ≥ 1`, structured error codes, root confinement, unknown palette seed), the gate rule matrix, config policy, colour parsing, cascade fidelity (`@media`, `@layer`, `var()`), component-syntax image bindings, ScanFS confinement (FIFO, `/dev/zero`, symlinks, byte caps), adversarial-input timing, the worker deadline, and the HTTP transport (Host validation, body cap, bearer token, port in use). `npm run typecheck` runs `tsc` over `src` and `test` together. `smoke-tarball.mjs` packs the package, installs the tarball with production dependencies only into an empty directory, runs the installed binary over stdio and exercises every tool family, every resource and the static-html gate.

CI runs Node 22 and 24, fails on generated-asset drift, and requires `versions` (`scripts/versions.mjs check`) and `validate-plugin` through the aggregate `test` check.

## Release

`scripts/release.sh` bumps and syncs every version touchpoint, verifies, commits, tags and pushes; `.github/workflows/publish.yml` publishes from a clean checkout of the tag (npm with provenance, MCP registry, GitHub release). Every step is idempotent. See `.claude/skills/release/SKILL.md`.

## Deliberately not claimed

No interaction, keyboard-flow or performance checks (`verify_rendered` covers one URL in one state), no visual diff, no Figma connector, no persisted approval enforcement, no proof that a model produces better designs. A direction PASS validates input only. `cwd` confinement is not a sandbox against a hostile local filesystem owner.

## Primary references

- MCP tools and structured results: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- CSS Color 4: https://www.w3.org/TR/css-color-4/
- CSS Cascade 5 (`@layer`): https://www.w3.org/TR/css-cascade-5/
- WCAG text contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Node releases: https://nodejs.org/en/about/previous-releases
