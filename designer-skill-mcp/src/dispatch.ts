import { getCommandMetadata, resolveCommandVerb } from "./commands.js";
import type { ReferenceId } from "./skill.js";
import { DesignError } from "./scope.js";

export interface DispatchMatch { verb: string; files: ReferenceId[]; note: string; score: number }
export interface DispatchResult {
  matched: DispatchMatch[];
  /** Verbs whose cues matched but fell outside the top three; never silently dropped. */
  alsoMatched: string[];
  recommendedReads: ReferenceId[];
  deferredReads: ReferenceId[];
  reason: "explicit" | "matched" | "no-match" | "out-of-scope";
  text: string;
}
const MAX_READS = 4;
const MAX_MATCHES = 3;

/** Plugin slash commands the host runs itself (commands/*.md); they are not designer verbs. */
export const HOST_COMMANDS: readonly string[] = ["designer-setup", "designer-status"];

/**
 * Subject-matter references no single verb owns. A matching cue puts the
 * reference first in the read list: the topic is more specific than the verb.
 */
export const TOPIC_READS: ReadonlyArray<{ cues: readonly string[]; reads: readonly ReferenceId[] }> = [
  { cues: ["data table", "data grid", "table", "tables", "rows", "columns", "pagination"], reads: ["ux/21-data-tables"] },
  { cues: ["chart", "charts", "graph", "data viz", "data visualization", "dashboard", "sparkline"], reads: ["ux/18-data-visualization"] },
  { cues: ["notification", "notifications", "toast", "toasts", "alert banner", "badge count"], reads: ["ux/17-notifications"] },
  { cues: ["search", "autocomplete", "typeahead", "filters", "no results"], reads: ["ux/19-search-ux"] },
  { cues: ["chat", "chatbot", "copilot", "ai assistant", "prompt box", "generative ui", "streaming response"], reads: ["ux/14-ai-ux-patterns"] },
  { cues: ["i18n", "rtl", "localization", "localisation", "translation", "translations", "pluralization"], reads: ["ux/23-internationalization"] },
  { cues: ["voice", "speech", "multimodal", "dictation"], reads: ["ux/24-voice-and-multimodal"] },
  { cues: ["canvas", "whiteboard", "infinite canvas", "zoom and pan", "minimap"], reads: ["ux/13a-canvas-navigation", "ux/13b-canvas-objects-performance"] },
  { cues: ["presence", "multiplayer", "live cursors", "collaborative", "real-time sync", "offline"], reads: ["ux/12a-presence-awareness", "ux/12b-conflict-resolution-sync"] },
  { cues: ["dark pattern", "dark patterns", "consent", "cookie banner", "ethical", "cancel flow"], reads: ["ux/15-ethical-design"] },
  { cues: ["user research", "usability test", "usability testing", "interview", "interviews", "survey"], reads: ["ux/10-user-research"] },
  { cues: ["laws of ux", "fitts", "hick", "cognitive load"], reads: ["ux/02-laws-of-ux"] },
  { cues: ["visual design", "visual hierarchy", "whitespace"], reads: ["ux/04-visual-design"] },
  { cues: ["niblet", "real screens", "reference screen", "reference screens", "screen catalogue", "screen catalog"], reads: ["niblet-catalogue"] },
  { cues: ["dependency", "dependencies", "library", "which package", "component library", "icon set"], reads: ["dependency-selection"] },
  { cues: ["verify", "verification", "evidence", "gate", "screenshot", "rendered check"], reads: ["verification-and-recovery"] },
  { cues: ["provenance", "attribution", "credits"], reads: ["craft-provenance"] },
  { cues: ["feels like", "what is it called", "name this motion", "motion term"], reads: ["motion-vocabulary"] },
  { cues: ["ios", "swiftui", "uikit", "android", "jetpack compose", "kotlin", "macos", "appkit", "winui", "react native", "flutter", "native app"], reads: ["native-platforms"] },
];

const BACKEND_WORDS = /\b(?:backend|database|postgresql|postgres|redis|cli|sql|data pipeline)\b/u;
// Broad on purpose: one of these beside a backend word means the request is about an interface.
const UI_WORDS = /\b(?:ui|ux|interface|frontend|css|forms?|navigation|visual|components?|pages?|dashboard|screens?|buttons?|modals?|dialogs?|layout|design|redesign|styles?|styling|theme|typography|fonts?|icons?|menus?|sidebar|header|footer|cards?|tables?|rows|website|landing|charts?|graphs?|colou?rs?|palette|dark mode|light mode|dropdowns?|tooltips?|animations?|motion|panels?|editor|toasts?|tabs?|spacing|responsive|mobile|hover|focus|contrast|accessib\w+|a11y|empty state|loading state|skeleton|hero|app)\b/u;

const NATIVE_NOTE = "Native platform request: read native-platforms first. The platform's own guidelines outrank the web-first references, and the static and rendered checks here cover web source only.";

// An instruction not to do something, up to three words before the cue in the same clause
// ("don't add any animation", "without gradients", "no animations"). A described lack or
// dislike is a request, not a negation: "has no dark mode", "is not responsive", "I don't like the charts".
const WORDS = String.raw`(?:[^\s,.;:!?]+\s+)`;
const NEGATED = new RegExp(String.raw`(?:\b(?:don't|do not|never)\s+(?!(?:like|love|enjoy|see|know|understand|think|get|have)\b)${WORDS}{0,3}` +
  String.raw`|\bwithout\s+${WORDS}{0,3}|(?<!\b(?:has|have|had|is|are|was|got|with|there's)\s)\bno\s+${WORDS}{0,2})$`, "u");

function cueMatches(query: string, cue: string): boolean {
  const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu");
  for (const match of query.matchAll(pattern)) {
    const prefix = query.slice(Math.max(0, match.index! - 48), match.index);
    if (!NEGATED.test(prefix)) return true;
  }
  return false;
}

export function dispatchIntent(request: string): DispatchResult {
  if (!request.trim() || request.length > 8_000) throw new DesignError("INPUT_INVALID", "Request must contain 1-8,000 characters.");
  // Typographic apostrophes (’ ʼ ‘) must not defeat negation cues like "don't".
  const query = request.normalize("NFKC").replace(/[‘’ʼ]/g, "'").toLowerCase().trim().replace(/\s+/g, " ");
  const meta = getCommandMetadata();
  const none = { matched: [], alsoMatched: [], recommendedReads: [], deferredReads: [] };
  const explicit = query.match(/^\/(?:designer(?:-skill)?[: ])?([a-z][a-z-]*)(?:\s|$)/u);
  if (explicit && HOST_COMMANDS.includes(explicit[1])) {
    return { ...none, reason: "out-of-scope",
      text: `/${explicit[1]} is a plugin slash command the host runs itself, not a designer verb. Run it in the host; use list_commands for designer verbs.` };
  }
  let reason: DispatchResult["reason"] = "matched";
  let matched: DispatchMatch[] = [];
  let alsoMatched: string[] = [];
  let topicReads: ReferenceId[] = [];
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
  } else if (BACKEND_WORDS.test(query) && !UI_WORDS.test(query)) {
    // A backend word with no UI word at all: verb cues like "optimize" or "performance" are not UI signals here.
    reason = "out-of-scope";
  } else {
    const all = Object.entries(meta).map(([verb, entry]) => ({
      verb, files: [...entry.reads], note: entry.description,
      score: entry.cues.filter((cue) => cueMatches(query, cue)).length,
    })).filter((m) => m.score > 0).sort((a, b) => b.score - a.score || (a.verb < b.verb ? -1 : a.verb > b.verb ? 1 : 0));
    matched = all.slice(0, MAX_MATCHES);
    alsoMatched = all.slice(MAX_MATCHES).map((m) => m.verb);
    topicReads = [...new Set(TOPIC_READS.filter((t) => t.cues.some((cue) => cueMatches(query, cue))).flatMap((t) => t.reads))];
    if (!matched.length && !topicReads.length) reason = "no-match";
  }
  if (reason === "out-of-scope") return { ...none, reason, text: "Not a UI task. Do not activate the designer workflow." };
  const allReads = [...new Set([...topicReads, ...matched.flatMap((m) => m.files)])];
  if (reason === "no-match") allReads.push("command-playbook", "design-principles");
  const recommendedReads = allReads.slice(0, MAX_READS);
  const deferredReads = allReads.slice(MAX_READS);
  const native = /\b(?:ios|swiftui|uikit|android|jetpack compose|kotlin|macos|appkit|winui|react native|flutter)\b/u.test(query);
  return {
    matched, alsoMatched, recommendedReads, deferredReads, reason,
    text: `${matched.length ? matched.map((m) => `${m.verb}: ${m.note}`).join("\n") : "No specific command matched; inspect the request before acting."}\n` +
      (alsoMatched.length ? `Also matched (lower score, not loaded): ${alsoMatched.join(", ")}. Call get_command for any that apply.\n` : "") +
      `Load: ${recommendedReads.join(", ")}.` +
      (deferredReads.length ? ` Deferred: ${deferredReads.join(", ")}; load only with a task-specific reason.` : "") +
      (native ? `\n${NATIVE_NOTE}` : "") +
      "\nReview does not authorize edits. Use review_and_gate as static evidence, not a readiness certificate.",
  };
}
