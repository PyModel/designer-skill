# Review follow-up to PR 45

This follow-up tracks code-verified findings rather than accepting automated review advice blindly.

## Decisions

- Fix checkout credential persistence in both verification workflows.
- Give the explicit DESIGNER_SKILL_CONTEXT_DIR precedence over conventional context locations; preserve containment checks.
- Read bounded source snapshots through validated file descriptors. Reuse immutable text for import analysis and HTML detection. Include stylesheet/configuration/design inputs in evidence and validate that inputs have not changed.
- Skip discovered symlinks only when they resolve within the project; count them. Explicit symlink scan targets and escaping links remain errors.
- Permit COMPLETE with NOT_VERIFIED when scoped requirements are met; never equate static success with overall UI readiness. Required checks that were not run still prevent COMPLETE.
- Preserve the MCP SDK's observed isError results for invalid tool input. Replacing passing assertions with rejected-promise assertions is not justified.
- Treat the delight command's 'easter egg' search cue as ordinary UI vocabulary, not an instruction to expand permissions. No security rule is suppressed.
- Canonicalize direction IDs, return typed content/registry errors, and handle mistyped explicit commands without executing a fallback workflow.

## Dependencies

The follow-up declares the previously missing HTML parser runtime dependencies. Compatible dependency updates are resolved from the package manifest without running installation lifecycle scripts during lock generation. Node 22 is the minimum supported runtime and type declarations target that baseline. Node 22 and 24 run the full integration suite.

## Acceptance

Require the TypeScript build, core regressions, Vitest integration tests, packed artifact verification and the plugin scanner. Add regressions for every corrected review behavior. Snapshot protections are defense in depth, not a substitute for running the MCP process with restricted filesystem permissions. Report remote stylesheets and unsupported cascade behavior as limitations, not browser verification.

## Migration and rollback

Deploy the server, engine and skill assets together. Refresh client tool schemas because coverage and dependency evidence fields are additive. Preserve existing command names and aliases. No package is published by this change. Revert the coordinated follow-up commits to restore the prior code if an integration regresses; do not represent missing verification as PASS. The temporary lock-resolution workflow is removed after generating the lockfile.
