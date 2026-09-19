# Designer Skill

A UI-design skill product: two bundled skill modules, an MCP server that
serves them with bounded, evidence-first contracts, and a vendored static
detector. This glossary is the canonical language for all of it.

## Language

### Routing

**Verb**:
A canonical action key in the command registry (e.g. `build`, `css`, `tone`).
_Avoid_: command name, action, intent

**Command**:
A user-facing invocation of a verb, via the discovery tools. Every command
resolves to exactly one verb.
_Avoid_: verb (when speaking of the invocation, not the key)

**Alias**:
An alternate spelling that resolves to one canonical verb.

**Cue**:
A natural-language trigger phrase the dispatcher scores against a request.

**Reads**:
The reference documents a verb requires before acting.

**Deferred reads**:
Reference candidates beyond the four-document dispatch cap; loaded only with
a task-specific reason.

**Dispatch**:
Routing an explicit or natural-language request to verbs and their reads.
_Avoid_: routing, matching

**Out-of-scope**:
A request that is not UI work; dispatch refuses it rather than guessing.

### Content

**Reference**:
One bundled guidance document. designer-skill references are bare names;
ux-designer references use the `ux/` namespace.
_Avoid_: doc, file, guide

**Router**:
A module's SKILL.md: the entry contract that routes to its references.

**ux-designer**:
The second skill module: a UX depth library (accessibility, IA, canvas apps,
AI patterns), disjoint from designer-skill's craft references.

**Bundled asset**:
The packaged copy of skill content inside the npm package, with a dev-tree
source of truth.
_Avoid_: asset (unqualified), content folder

**Shipped surface**:
Exactly what the npm tarball contains; owned by one manifest.
_Avoid_: whitelist, package contents

**Engine**:
The vendored antipattern detector, shipped inside the package.

### Verification

**Static scan**:
A bounded file scan for antipattern findings, with hashes and coverage.
_Avoid_: audit, lint

**Coverage**:
Evidence of what a scan actually examined: candidate, scanned, ignored and
unsupported file counts plus bytes scanned. An empty scan is no evidence.

**Finding**:
One detected antipattern occurrence in a scanned file.

**Blocking rule**:
An antipattern whose finding forces static FAIL. Other findings are advisory.
_Avoid_: error, violation

**Gate**:
The `review_and_gate` verdict: a staticStatus plus coverage, never an overall
UI verdict. Overall it can only be FAIL or NOT_VERIFIED, never PASS.
_Avoid_: ship gate, check pass, readiness certificate

**NOT_VERIFIED**:
The gate's best overall outcome: statics passed, rendered and behavioral
checks remain someone else's evidence.

### Direction

**Direction record**:
The validated input for a new visual direction: register, design read,
context sources, aesthetic and typographic decisions.
_Avoid_: design spec, brief

**Design read**:
A concrete written observation of the current interface that grounds a
direction.
_Avoid_: analysis, audit

**Context sources**:
The specific project files inspected before committing to a direction.

**Register**:
Whether a direction serves the brand's identity or the product's function:
`brand` or `product`.

**Mode**:
Whether work preserves existing identity (`preserve`) or changes it
(`change`); audits and bounded repairs need no direction record at all.

**Inverse test**:
Optional reflection: would a generic assistant have produced the same output?
Advisory, never a taste classifier.

### Context and extras

**Preflight brief**:
The compact entry guidance every task starts from, instead of a loaded
reference library.

**Project context**:
PRODUCT.md and DESIGN.md evidence read independently, with missing documents
never forcing setup.
_Avoid_: project config, settings

**Niblet catalogue**:
Optional real-screen reference retrieval from niblet.com. Retrieval is
advisory context, never a style mandate; unconfigured access degrades to
setup guidance.
_Avoid_: image search, inspiration lookup

**Palette seed**:
Optional generated color seed for authorized new-identity work only.
