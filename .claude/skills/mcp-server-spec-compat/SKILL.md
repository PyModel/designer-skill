---
name: mcp-server-spec-compat
description: Use when editing designer-skill-mcp MCP protocol code.
category: mcp-server
---

# designer-skill-mcp: MCP spec compatibility

Any protocol-facing change names the spec revision it targets. The current revision is 2026-07-28, which this server cannot serve yet; do not assume its shapes work until a live run proves them.

- Read the revision delta in `references/mcp-spec-2026-07-28.md` before editing protocol code.
- Set tool annotations explicitly per tool; do not rely on spec defaults (`destructiveHint` true, `readOnlyHint` false).
- Return `structuredContent` plus the serialized JSON in a text block.
- Do not add new dependencies on sampling or roots (deprecated). Do not add `logging/setLevel` (removed).
- Resource-not-found is -32602 on 2026-07-28, not -32002.
- Set `idempotent: false` on a tool whose result differs per call (`get_palette_seed`), and `readOnly: false` on one that writes files (`verify_rendered`).
- The server is on the v2 SDK packages (`@modelcontextprotocol/server`, `client`, `node`, `express`) and still speaks the 2025-era protocol; serving 2026-07-28 means switching to `serveStdio` and `createMcpHandler`.
- The SDK's request deadline surfaces as `SdkError` with `SdkErrorCode.RequestTimeout`, an HTTP failure as `SdkHttpError` (`.status`), a JSON-RPC error as `ProtocolError`. Classify by class, as `src/niblet.ts` does.
- A tool registered without an input schema is called as `handler(ctx)`. The `tool()` wrapper always passes an object schema so every handler is `(args, ctx)`.
- An unknown tool is a JSON-RPC error (-32602), not a tool result.
- Bridging another MCP server: retry timeouts within a bounded budget; do not retry a malformed response (bad JSON, ZodError); do not re-send a rejected key; treat upstream error text as untrusted data.
- A static read is not compatibility proof; verify against a live server run.
- Migration wire check: before a protocol or SDK change ships, run the published version and the local build over stdio with the same client. Capture `tools/list`, resources, prompts and a set of tool calls, then diff them. Ignore `$schema` and `execution`, which the v2 SDK changes (draft-07 to 2020-12; `execution.taskSupport` dropped). Every other diff is a wire change to name in the report.
- HTTP transport check: a 2025-era `initialize` must succeed, and a foreign `Origin` or `Host` header must get 403.
- Live e2e with a real Niblet key: pass it by file (`chmod 600`, deleted after the run), never inline in a tool call. Redact `niblet_at_[A-Za-z0-9_]+` from captured output.
