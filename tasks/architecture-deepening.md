# Architecture deepening — designer-skill-mcp

Status: DONE — all 5 candidates + niblet reference integration. Build green, 76/76 tests green, pack ships 89 files (skill 21 + ux 27 + engine 20 + dist 18). `check` reads identical across playbook / get_command / dispatch (5 files each).

Implements the 5 candidates from the architecture review (report: $TMPDIR/architecture-review-20260919-183245.html).
Jev (TypeSafe noul) endorsements: shipped-manifest 0.85 · verb-registry 0.84 · asset-resolver 0.83 · gate-module 0.78 · registration-helper 0.59.

## 1. Shipped surface gets one owner (P0 — npm pack currently ships zero skill content)
- [ ] `scripts/shipped-roots.mjs` — single `SHIPPED_ROOTS` export
- [ ] `package.json` files: add `assets/ux-designer`
- [ ] `sync-skill.mjs`: assert every synced `assets/*` dir is in SHIPPED_ROOTS
- [ ] `shipped-content.test.ts`: roots from manifest + assert package.json files covers all dir roots
- [ ] `test/pack.test.ts`: `npm pack` → tarball contains every root; extract → `createServer()` via InMemoryTransport → `get_reference` smoke test
- [ ] Run `npm run sync-skill` (assets/skill is gitignored, regenerates)

## 2. One bundled-asset seam (4 resolvers → 1 module, palette by import not spawn)
- [ ] `src/assets.ts` — `resolveBundled(kind, {file})` owning packaged→dev fallback (skill / ux-designer / engine)
- [ ] palette.mjs: extract `renderPalette(options)` export + CLI guard (keep CLI behavior)
- [ ] palette.ts: dynamic import + cache, no spawnSync
- [ ] skill.ts / commands.ts / detect.ts / gate.ts route through assets.ts

## 3. Design-verb registry (reads live in ONE place)
- [ ] dispatch.ts: export `VERB_REGISTRY`, `readsFor()`, `ALWAYS_READS`
- [ ] commands.ts: delete `COMMAND_READS`, derive from registry
- [ ] `scripts/render-playbook.mjs`: rewrite command-playbook.md Read column from `dist/registry.js` (build: after tsc)
- [ ] `test/registry.test.ts`: every read is a valid ReferenceId; metadata verbs ⊆ registry; playbook Read column == registry; SKILL.md threshold == GATE_CONTRACT.passScore

## 4. Ship gate deepened + tested
- [ ] gate.ts: export `GATE_CONTRACT` + `gateRequirementText()`; slop-registry path via assets.ts
- [ ] brief.ts / dispatch.ts / server.ts prose derives from GATE_CONTRACT (no restated 85s)
- [ ] detect.ts: engine import cached once per process
- [ ] `test/gate.test.ts` + fixtures: clean.html → PASS 100/0; slop.html → FAIL, deterministic score
- [x] `commands/improvecodebase-design.md` removed from repo; SKILL.md threshold checked by test (prose already says 85)

## 5. server.ts envelope + contract dedup
- [ ] `const text = …` envelope helper; every tool handler shrinks to it
- [ ] direction.ts: export `directionInputSchema` (zod shape) — server.ts stops duplicating 13 describe() strings
- [ ] review_and_gate description from `gateRequirementText()`; design prompt reads via `ALWAYS_READS`

## Verify
- [ ] `npm run build` green (sync + tsc + render-playbook)
- [ ] `npm test` green (all suites)
- [ ] `npm pack --dry-run` shows skill + ux-designer + engine + dist
- [ ] `check` reads identical across playbook / get_command / dispatch
