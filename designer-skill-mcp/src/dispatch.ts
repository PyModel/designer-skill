import { getCommandMetadata, resolveCommandVerb } from "./commands.js";
import type { ReferenceName } from "./skill.js";
import { DesignError } from "./scope.js";

export interface DispatchMatch { verb: string; files: ReferenceName[]; note: string; score: number }
export interface DispatchResult {
  matched: DispatchMatch[];
  recommendedReads: ReferenceName[];
  deferredReads: ReferenceName[];
  reason: "explicit" | "matched" | "no-match" | "out-of-scope";
  text: string;
}
const MAX_READS = 4;
function cueMatches(query: string, cue: string): boolean {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu");
  for (const match of query.matchAll(pattern)) {
    const prefix = query.slice(Math.max(0, match.index! - 32), match.index);
    if (!/\b(?:not|never|without|no|don't|do not)\s+$/u.test(prefix)) return true;
  }
  return false;
}

export function dispatchIntent(request: string): DispatchResult {
  if (!request.trim() || request.length > 8_000) throw new DesignError("INPUT_INVALID", "Request must contain 1-8,000 characters.");
  const query = request.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
  const meta = getCommandMetadata();
  let reason: DispatchResult["reason"] = "matched";
  let matched: DispatchMatch[] = [];
  const explicit = query.match(/^\/(?:designer(?:-skill)?[: ])?([a-z][a-z-]*)(?:\s|$)/u);
  let canonical: string | undefined;
  if (explicit) canonical = resolveCommandVerb(explicit[1]).canonical;
  else if (/^[a-z-]+$/.test(query)) {
    try { canonical = resolveCommandVerb(query).canonical; } catch (error) {
      if (!(error instanceof DesignError) || error.code !== "UNKNOWN_COMMAND") throw error;
    }
  }
  if (canonical) {
    reason = "explicit";
    matched = [{ verb: canonical, files: [...meta[canonical].reads], note: meta[canonical].description, score: 1 }];
  } else if (/\b(?:backend|database|postgresql|postgres|redis|cli|sql|data pipeline)\b/u.test(query) &&
      !/\b(?:ui|interface|frontend|css|forms?|navigation|visual|component|page|dashboard|screen)\b/u.test(query)) {
    reason = "out-of-scope";
  } else {
    matched = Object.entries(meta).map(([verb, entry]) => ({
      verb, files: [...entry.reads], note: entry.description,
      score: entry.cues.filter((cue) => cueMatches(query, cue)).length,
    })).filter((m) => m.score > 0).sort((a, b) => b.score - a.score || a.verb.localeCompare(b.verb)).slice(0, 3);
    if (!matched.length) reason = "no-match";
  }
  const allReads = [...new Set(matched.flatMap((m) => m.files))];
  if (reason === "no-match") allReads.push("command-playbook", "design-principles");
  const recommendedReads = allReads.slice(0, MAX_READS);
  const deferredReads = allReads.slice(MAX_READS);
  return {
    matched, recommendedReads, deferredReads, reason,
    text: reason === "out-of-scope" ? "Not a UI task. Do not activate the designer workflow." :
      `${matched.length ? matched.map((m) => `${m.verb}: ${m.note}`).join("\n") : "No specific command matched; inspect the request before acting."}\n` +
      `Load: ${recommendedReads.join(", ")}.` +
      (deferredReads.length ? ` Deferred: ${deferredReads.join(", ")}; load only with a task-specific reason.` : "") +
      "\nReview does not authorize edits. Use review_and_gate as static evidence, not a readiness certificate.",
  };
}
