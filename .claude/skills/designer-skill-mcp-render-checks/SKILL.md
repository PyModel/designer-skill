---
name: designer-skill-mcp-render-checks
description: Use when editing verify_rendered or its Playwright checks.
category: mcp-server
---

# designer-skill-mcp: rendered checks

A rendered check judges where the page ends up. A page that fails to load is a finding (`page-load` FAIL), not a tool error.

- The browser runs in a child process (`assets/engine/node/rendered-worker.mjs`), forked by `src/rendered.ts` with credential environment variables removed. Keep project code out of the server process.
- One scope rule, `assets/engine/node/local-url.mjs`, covers the input URL and every main-frame navigation. Do not write a second copy.
- Playwright's `page.route` does not see redirect hops. Confine navigation with `route.fetch({ maxRedirects: 0 })`, refuse a non-local `Location`, then `route.fulfill`. A redirect to another host must be refused before that host is contacted; the test asserts zero requests reached it.
- Subresources and iframes are not confined. Keep that limit stated in `docs/HARDENING.md`.
- Keep the query and hash of file URLs; `#/settings` is a different state.
- No browser driver means `NOT_RUN` with the reason. Never PASS. Playwright and axe-core load from the project only; the package has no fallback.
- The whole check has one deadline (`renderedPolicy.deadlineMs`); the deadline and a client cancel both kill the child.
- In the worker use `process.on('message')`, not `once`: `once` lets the process exit before the check runs.
- Tests live in the `verify_rendered` block of `test/audit-fixes.test.ts`; `scripts/smoke-tarball.mjs` calls the tool from the packed tarball.
