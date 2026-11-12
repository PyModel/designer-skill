// W3C Design Tokens (DTCG 2025.10) → CSS custom properties or a Tailwind v4 @theme block.
// Pure conversion of the JSON it is given: nothing is read from or written to disk.
import { DesignError } from "./scope.js";

export interface FlatToken { path: string[]; type: string | null; value: string }
export type TokenFormat = "css" | "tailwind";

const MAX_TOKENS = 5_000;
const MAX_DEPTH = 16;
const ALIAS = /^\{([^{}]+)\}$/;
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** One token value as CSS text; null when the value has no CSS form (composite types). */
function cssValue(value: unknown, type: string | null): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (type === "fontFamily") return value.map((v) => (/^[a-z-]+$/i.test(String(v)) ? String(v) : JSON.stringify(String(v)))).join(", ");
    if (type === "cubicBezier" && value.length === 4) return `cubic-bezier(${value.join(", ")})`;
    return null;
  }
  if (!isObject(value)) return null;
  if (typeof value.value === "number" && typeof value.unit === "string") return `${value.value}${value.unit}`; // dimension, duration
  if (typeof value.colorSpace === "string" && Array.isArray(value.components)) {
    const alpha = typeof value.alpha === "number" && value.alpha < 1 ? ` / ${value.alpha}` : "";
    // hex carries no alpha: use it only for an opaque color.
    if (typeof value.hex === "string" && !alpha) return value.hex;
    const parts = value.components.join(" ");
    return ["oklch", "oklab", "lab", "lch", "hsl", "hwb"].includes(value.colorSpace)
      ? `${value.colorSpace}(${parts}${alpha})` : `color(${value.colorSpace} ${parts}${alpha})`;
  }
  return null;
}

export function flattenTokens(document: unknown): { tokens: FlatToken[]; skipped: string[] } {
  if (!isObject(document)) throw new DesignError("INPUT_INVALID", "Design tokens must be a JSON object.");
  const raw = new Map<string, { path: string[]; type: string | null; value: unknown }>();
  const walk = (node: Json, path: string[], inherited: string | null) => {
    if (path.length > MAX_DEPTH) throw new DesignError("INPUT_INVALID", `Design tokens nest deeper than ${MAX_DEPTH} groups.`);
    const type = typeof node.$type === "string" ? node.$type : inherited;
    if ("$value" in node) {
      if (raw.size >= MAX_TOKENS) throw new DesignError("INPUT_INVALID", `Design tokens exceed ${MAX_TOKENS} tokens.`);
      raw.set(path.join("."), { path, type, value: node.$value });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith("$") && isObject(child)) walk(child, [...path, key], type);
    }
  };
  walk(document, [], null);

  const resolve = (key: string, seen: string[]): { type: string | null; value: unknown } | null => {
    const token = raw.get(key);
    if (!token || seen.includes(key)) return null; // missing target or alias cycle
    const alias = typeof token.value === "string" ? token.value.match(ALIAS) : null;
    if (!alias) return token;
    const target = resolve(alias[1], [...seen, key]);
    return target && { type: token.type ?? target.type, value: target.value };
  };
  const tokens: FlatToken[] = [];
  const skipped: string[] = [];
  for (const [key, token] of raw) {
    const resolved = resolve(key, []);
    const value = resolved && cssValue(resolved.value, resolved.type);
    if (resolved && value !== null) tokens.push({ path: token.path, type: resolved.type, value });
    else skipped.push(key);
  }
  return { tokens, skipped };
}

const slug = (path: string[]) => path.join("-").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/-+/g, "-").toLowerCase();

/** Tailwind v4 theme namespaces by token type; a path already starting with the namespace is not doubled. */
const TAILWIND_NAMESPACE: Record<string, string> = { color: "color", fontFamily: "font", fontWeight: "font-weight", duration: "duration", cubicBezier: "ease", shadow: "shadow" };
function tailwindName(token: FlatToken): string {
  const name = slug(token.path);
  const namespace = token.type === "dimension"
    ? (/(^|-)(radius|rounded)(-|$)/.test(name) ? "radius" : /(^|-)(space|spacing)(-|$)/.test(name) ? "spacing" : null)
    : (token.type && TAILWIND_NAMESPACE[token.type]) || null;
  if (!namespace) return name;
  const rest = name.replace(new RegExp(`^(?:${namespace}s?|colors?|radius|rounded|spac(?:e|ing)|fonts?)-`), "");
  return `${namespace}-${rest}`;
}

export function convertDesignTokens(document: unknown, format: TokenFormat): { css: string; tokenCount: number; skipped: string[] } {
  const { tokens, skipped } = flattenTokens(document);
  if (!tokens.length) throw new DesignError("INPUT_INVALID", "No tokens with a $value were found. Expected the W3C Design Tokens (DTCG) format.");
  // Two token paths can flatten to one custom property; the first keeps the name, the rest are reported.
  const byName = new Map<string, string>();
  for (const t of tokens) {
    const name = format === "tailwind" ? tailwindName(t) : slug(t.path);
    if (byName.has(name)) skipped.push(`${t.path.join(".")} (name --${name} already used)`);
    else byName.set(name, t.value);
  }
  const lines = [...byName].map(([name, value]) => `  --${name}: ${value};`);
  return { css: `${format === "tailwind" ? "@theme" : ":root"} {\n${lines.join("\n")}\n}`, tokenCount: lines.length, skipped };
}
