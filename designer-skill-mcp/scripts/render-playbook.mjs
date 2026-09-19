// Rewrites the Read column of skills/designer-skill/reference/command-playbook.md
// from the compiled verb registry (dist/dispatch.js) — the single source of
// verb → reference reads. Run by `npm run build` after tsc. The trigger and
// moves columns stay hand-written; only the derived column is generated.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VERB_REGISTRY } from "../dist/dispatch.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const playbook = resolve(pkgRoot, "..", "skills", "designer-skill", "reference", "command-playbook.md");

const lines = readFileSync(playbook, "utf8").split("\n");
let inDispatchTable = false;
let rewritten = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith("## ")) inDispatchTable = line.startsWith("## Dispatch table");
  if (!inDispatchTable || !line.startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  // ["", verb, cue, moves, read, ""]
  const verb = cells[1];
  if (!verb || cells.length < 6 || !VERB_REGISTRY[verb]) continue;
  const reads = VERB_REGISTRY[verb].files.map((f) => `${f}.md`).join(", ");
  if (cells[4] === reads) continue;
  cells[4] = reads;
  lines[i] = `| ${cells.slice(1, -1).join(" | ")} |`;
  rewritten++;
}
if (rewritten > 0) writeFileSync(playbook, lines.join("\n"), "utf8");
console.log(`[render-playbook] Read column checked against the registry; rewrote ${rewritten} verb row(s).`);
