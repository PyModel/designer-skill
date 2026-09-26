# Verification and Recovery

The detail behind SKILL.md Steps 6–7 and the Failure Recovery section: what counts as evidence, how the static gate reports, how rendered checks run, and what to do when anything fails.

## Evidence rules

- Run the project's discovered format, type-check, build and relevant test commands before any static or rendered claim.
- Every required check records a status, exact tool or command, producer, revision and evidence artifact. Manual attestations stay distinct from executed checks.
- Missing, ignored or unsupported scan inputs never count as a successful required scan. Missing registry, scan errors, stale evidence or zero applicable scanned files block a static PASS.
- Evidence goes stale when a relevant input changes: re-run affected checks after the last edit.
- Style scores never offset failed functional or accessibility requirements. Report lab measurements separately from field performance data.

## Static gate

`review_and_gate({"target": TARGET, "cwd": PROJECT_ROOT})` is supplemental static evidence. It returns `schemaVersion: 3`:

- per-rule coverage: `RAN`, `UNSUPPORTED`, `UNRESOLVED` or `WAIVED`;
- `staticStatus`: `PASS`, `FAIL` or `INCOMPLETE`, where `INCOMPLETE` means a required rule could not run on the scanned files (report it as a gap, never a pass);
- scan coverage counts;
- overall `NOT_VERIFIED` or `FAIL`, never overall PASS, because a static gate cannot certify rendered UI readiness.

`detect_antipatterns` output is defect evidence only, never proof the work is finished.

## Rendered checks

Use the project's browser or native test harness. Control fixtures, fonts, viewport, device scale, browser and operating system, and capture before and after states. Exercise the relevant primary task, keyboard path, focus, responsive reflow, long content, themes and reduced motion. Inspect the rendered output as well as automated reports. Update a screenshot baseline only for an intended change, never to erase a failure.

## Accessibility reference points

Normal text generally requires 4.5:1; large text is 18pt regular or 14pt bold, not 18px/14px. The WCAG 2.2 AA target size is 24 CSS pixels with defined exceptions; a 44px project target is a stricter policy. Follow the precise applicable criteria, not a simplified checklist. Automated testing alone does not establish full conformance.

## Reporting

Produce the report with `schemas/run-report.schema.json` plus artifact-existence and hash checks. List observed defects immediately, including unrelated ones, without silently expanding scope.

- `taskStatus`: `COMPLETE`, `PARTIAL` or `BLOCKED`.
- `uiReadiness`, independently: `PASS`, `FAIL` or `NOT_VERIFIED`.

An audit can be complete while the interface fails. A plan can be complete without a rendered interface. Implementation with missing requested verification is partial, not "production-ready".

## Failure triage

Diagnose before retrying.

| Trigger | Diagnostic step | Mitigation / rollback | Escalation |
|---|---|---|---|
| Invalid scope, traversal or unsafe origin | Inspect normalized values, real paths, symlink ancestry and allowed origins | Stop access; keep scope as approved | `INPUT_INVALID` or `SCOPE_VIOLATION` |
| Missing context, tool, preview or credentials | Read the capability inventory and exact failure without printing secrets | Continue only safe supported work; mark unavailable checks NOT_RUN | `CAPABILITY_MISSING` with affected requirements |
| Unknown verb or missing reference or registry | Inspect the canonical registry, aliases, package layout and asset manifest | Stop the affected operation; keep every check at its required level | `REGISTRY_INVALID` |
| Build, test or scan failure | Capture command, exit code, relevant redacted output and input revision | Diagnose, then make a scoped repair within the cycle budget | `VERIFICATION_FAILED` |
| Empty or ignored-only scan | Compare intended scope with scanned, skipped and unsupported counts | Correct scope or justify non-applicability; never return a scan PASS | `NO_SCAN_COVERAGE` |
| Regression or changed concurrent input | Compare current hashes, starting hashes and task-owned edits | Revert only verified task-owned hunks; preserve concurrent changes; stop on conflicts | `REGRESSION` or `CONCURRENT_CHANGE` |
| Repair budget exhausted | Review the repeated failure signature and attempted fixes | Stop mutation; leave an honest partial result and the precise next action | `REPAIR_BUDGET_EXHAUSTED` |

## Escalation output

Include `code`, `phase`, `target`, `observed`, `expected`, `evidence`, `attempts`, `rollback` and `nextAction`. `rollback` is one of `not-needed`, `completed`, `partial` or `blocked`.
