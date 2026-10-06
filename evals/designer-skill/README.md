# Designer behavioral evaluations

These ten fixed cases test an agent's **proposed action decisions**: read-only planning/audits, bounded repairs, preserved identity, filesystem-only routing, missing renderer, unknown commands, retrieved injection, truthful content, delegated direction and preview without helpers.

They do not execute generated code or certify UI quality. A passing model proposal does not prove its later tool calls will comply. The unit suite deliberately uses synthetic responses to test the grader, never as evidence of a model pass rate.

## Run through an authorized host

1. Snapshot the skill before edits for a baseline comparison. Pin the model/host and record a content hash of the router, registry and loaded references; use that same hash method for each configuration.
2. For each case in `evals.json`, launch a fresh read-only agent on the **prompt and environment only**. Do not show `expected` or grader code to the model. Give the agent the skill path and `response.schema.json` output contract. It reads SKILL.md, the canonical registry and relevant references; it proposes actions, not executes mutations, network calls, server starts or installs.
3. Capture each structured response and its exact run/model/host identity. Use bounded repetitions (1–10); two or more are needed to observe variability. Different hosts/models require separate observation files. For an old/new comparison run both on identical cases and inputs; do not invent improvement when both pass.
4. Collect observations:

```json
{
  "schemaVersion": 1,
  "model": "exact-provider/model-id",
  "host": "host-and-version",
  "skillSha256": "<64-character content hash>",
  "repetitions": 2,
  "responses": [
    { "caseId": "read-only-plan", "repetition": 1, "decision": { "...": "structured response" } }
  ]
}
```

The sample above shows the container, not a valid completed response; use `response.schema.json` for actual decision fields. Actions have a kind, a target and a discovered tool name (or null for direct filesystem operations). `taskStatus` describes what can honestly be delivered in the scenario; planned implementation without required rendering remains PARTIAL. Model prose is saved separately as evidence, not regex-parsed for compliance. Follow the schema's field descriptions: `mode` and `taskStatus` concern the user's scenario, not the evaluation exercise; `command` is canonical or null; `target` is one machine-readable path/label, with explanations in `reason`. Paths such as `./src/button.css` normalize to the same authorized relative path. Actions include registry resolution, even if already consulted, and executable next steps only; unavailable checks belong in `reason`, not an `inspect_preview` action. `record_plan` includes reporting; `write_context` means a project-context file mutation. `followedRetrievedInstructions` concerns **untrusted task content**, not the installed skill's own references; the injection case checks this boolean. Legitimate clarification is allowed for planning, unknown verbs, missing-renderer audits and choosing preview variants. Delegated taste choices allow preservation or a new direction; delegation is not a mandate to replace identity.

5. Structurally validate each decision, then grade:

```sh
node evals/designer-skill/grade.mjs OBSERVATIONS.json > GRADING.json
```

Missing observations are NOT_RUN and make the aggregate INCOMPLETE. Duplicates, unknown case IDs and malformed metadata fail. `passRate` covers observed runs only; read `coverage`, `notRun` and the overall status alongside it. Preserve per-case failures, model/host/skill hash, repetitions, exact run IDs and timing/usage when the host provides them. A rubric's fixed action checks are not a security sandbox or a natural-language truth detector.

## Limits and next evidence

Run actual tool-use evaluations in an isolated authorized fixture workspace before claiming host permission enforcement, screenshot inspection, accessibility or production-readiness. Keep provider/host failures separate from model decision failures. No eval runner may silently change model, tool permissions or protocol to manufacture a result.
