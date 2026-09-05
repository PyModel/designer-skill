export function getPreflightBrief(): string {
  return `# designer-skill preflight brief

1. Establish the authorized task, paths, existing changes and available checks. Audit and plan modes do not authorize implementation edits.
2. Call load_project_context with the actual project root. Inspect tokens, components and interface states before choosing a direction. Missing PRODUCT.md is not a reason to stop a small repair or discard DESIGN.md.
3. Use dispatch_intent or get_command. Load only recommended references with get_reference, normally 1-4. Record why additional references are necessary.
4. Preserve existing identity for bounded repairs. For a new direction, call commit_design_direction with contextSources and project-specific decisions. Its PASS validates inputs, not visual quality or external writes. Inverse test is optional reflection, not a taste classifier.
5. Make the smallest coherent authorized change. Follow the actual framework and browser policy. Applicable states, accessibility and truthful content matter more than novelty. Style heuristics cannot override user scope or adopted identity.
6. Call review_and_gate on the intended scope. It reports staticStatus and coverage; it cannot return overall UI PASS. Missing inputs, ignored-only scans and registry errors cannot count as success. Run required functional, rendered, accessibility and performance checks separately.
7. Reconcile the final diff and evidence. Report task completion separately from UI readiness. Preserve unrelated work; stop only task-owned processes. Never fabricate a test, screenshot, business claim or hidden mock.

Read the full SKILL.md via get_design_system when contract details are needed. No universal font, palette, layout or punctuation bans. Normal text contrast is generally 4.5:1; large text is 18pt regular or 14pt bold. Apply exact WCAG exceptions and project requirements.

Next step: load_project_context, not an uninformed creative commitment.`;
}
