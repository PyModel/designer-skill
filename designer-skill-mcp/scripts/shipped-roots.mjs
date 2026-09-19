// Single owner of the published package surface. Every consumer of the
// shipped-roots list reads it here: sync-skill.mjs (asserts its copy targets),
// shipped-content.test.ts (walks the roots), pack.test.ts (asserts the tarball).
// package.json "files" cannot import, so the tests assert it matches this list.
export const SHIPPED_ROOTS = ["dist", "assets/skill", "assets/ux-designer", "assets/engine", "README.md"];

/** Roots that are directories — package.json "files" must list each of these. */
export const SHIPPED_DIR_ROOTS = SHIPPED_ROOTS.filter((p) => !p.includes("."));
