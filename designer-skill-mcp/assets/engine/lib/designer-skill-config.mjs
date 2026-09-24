/**
 * Pure detector-config semantics shared by the scan: ignore-rule filtering,
 * scoped ignore values, and project-relative glob matching. Reading and
 * validating `.designer-skill/config*.json` belongs to the scan's policy owner
 * (src/scope.ts); this module never touches the filesystem.
 */

import { parseCssColor } from '../shared/color.mjs';

function uniqueStrings(values) {
  return Array.from(new Set(values.map(String)));
}

export function normalizeIgnoreValue(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeIgnoreRule(rule) {
  return String(rule || '').trim().toLowerCase();
}

function colorIgnoreKey(value) {
  const color = parseIgnoreColor(value);
  if (!color) return '';
  return `${color.r},${color.g},${color.b},${Math.round(color.a * 255)}`;
}

function parseIgnoreColor(value) {
  return parseCssColor(String(value || ''));
}

function ignoreValueMatches(rule, entryValue, findingValue) {
  if (entryValue === findingValue) return true;
  if (rule !== 'design-system-color') return false;
  const entryColor = colorIgnoreKey(entryValue);
  return Boolean(entryColor && entryColor === colorIgnoreKey(findingValue));
}

export function normalizeIgnoreValueEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const rule = normalizeIgnoreRule(entry.rule);
    const value = normalizeIgnoreValue(entry.value);
    if (!rule || !value) continue;
    const normalized = { rule, value };
    const files = uniqueStrings([
      ...(typeof entry.file === 'string' && entry.file.trim() ? [entry.file.trim()] : []),
      ...(Array.isArray(entry.files) ? entry.files.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : []),
    ]);
    if (files.length > 0) normalized.files = files;
    if (typeof entry.reason === 'string' && entry.reason.trim()) {
      normalized.reason = entry.reason.trim();
    }
    if (typeof entry.createdAt === 'string' && entry.createdAt.trim()) {
      normalized.createdAt = entry.createdAt.trim();
    }
    out.push(normalized);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Globs: `**` (any number of segments), `*`, `?`, `{a,b}`. Matching is by
// path segment (dynamic programming), so cost is O(glob segments × path
// segments) with no regex backtracking across `/`.
// ---------------------------------------------------------------------------

const MAX_GLOB_LENGTH = 512;
const MAX_BRACE_EXPANSIONS = 64;
const compiledGlobs = new Map();

function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  const close = glob.indexOf('}', open);
  if (close === -1) return [glob];
  const out = [];
  for (const option of glob.slice(open + 1, close).split(',')) {
    for (const rest of expandBraces(glob.slice(close + 1))) {
      out.push(glob.slice(0, open) + option + rest);
      if (out.length > MAX_BRACE_EXPANSIONS) throw new Error('glob expands to too many alternatives');
    }
  }
  return out;
}

// `*` and `?` within one path segment, matched with the two-pointer
// wildcard algorithm: O(segment × pattern) worst case, never backtracking
// exponentially the way a `[^/]*a[^/]*a…` regex does.
function segmentMatcher(pattern) {
  return {
    test(text) {
      let p = 0, t = 0, star = -1, mark = 0;
      while (t < text.length) {
        if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) { p++; t++; }
        else if (p < pattern.length && pattern[p] === '*') { star = p++; mark = t; }
        else if (star !== -1) { p = star + 1; t = ++mark; }
        else return false;
      }
      while (pattern[p] === '*') p++;
      return p === pattern.length;
    },
  };
}

function compileGlob(glob) {
  let compiled = compiledGlobs.get(glob);
  if (compiled) return compiled;
  if (glob.length > MAX_GLOB_LENGTH) throw new Error(`glob longer than ${MAX_GLOB_LENGTH} characters`);
  compiled = expandBraces(glob.replace(/^\.\//, '')).map((variant) => {
    const segments = [];
    for (const part of variant.split('/').filter(Boolean)) {
      if (part === '**' && segments[segments.length - 1] === '**') continue;
      segments.push(part === '**' ? '**' : segmentMatcher(part));
    }
    return { segments, anchored: variant.includes('/') };
  });
  compiledGlobs.set(glob, compiled);
  return compiled;
}

function matchSegments(patterns, parts) {
  const memo = new Map();
  const visit = (i, j) => {
    const key = i * 4096 + j;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (i === patterns.length) result = j === parts.length;
    else if (patterns[i] === '**') result = visit(i + 1, j) || (j < parts.length && visit(i, j + 1));
    else result = j < parts.length && patterns[i].test(parts[j]) && visit(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

function toPosixParts(relPath) {
  return String(relPath || '').split(/[\\/]+/).filter((part) => part && part !== '.');
}

/** True when a project-relative path matches a glob. Globs without `/`
 *  match the basename at any depth (like .gitignore). */
export function matchesGlob(relPath, glob) {
  const parts = toPosixParts(relPath);
  if (!parts.length) return false;
  return compileGlob(String(glob)).some(({ segments, anchored }) =>
    anchored ? matchSegments(segments, parts) : matchSegments(segments, parts.slice(-1)));
}

export function matchesAnyGlob(relPath, globs) {
  if (!Array.isArray(globs) || globs.length === 0) return false;
  return globs.some((glob) => matchesGlob(relPath, glob));
}

/** Throws when a glob cannot be compiled (config validation uses this). */
export function assertValidGlob(glob) {
  compileGlob(String(glob));
}

/** A project-relative file is ignored when any ignoreFiles glob matches it. */
export function shouldIgnoreDetectionFile(relPath, config) {
  return matchesAnyGlob(relPath, config?.ignoreFiles);
}

/** A directory can be pruned when a glob ending in `/**` covers everything under it. */
export function shouldPruneDetectionDirectory(relDir, config) {
  const globs = config?.ignoreFiles;
  if (!Array.isArray(globs)) return false;
  return globs.some((glob) => {
    const text = String(glob);
    if (!text.endsWith('/**')) return false;
    const prefix = text.slice(0, -3);
    return prefix !== '' && prefix !== '**' && matchesGlob(relDir, prefix);
  });
}

export function filterDetectionFindings(findings, config) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  const ignoreRules = new Set((config?.ignoreRules || []).map((rule) => normalizeIgnoreRule(rule)));
  const ignoreValues = normalizeIgnoreValueEntries(config?.ignoreValues || []);
  return findings.filter((finding) => {
    if (!finding || typeof finding !== 'object') return false;
    if (ignoreRules.has(normalizeIgnoreRule(finding.antipattern))) return false;
    if (isIgnoredFindingValue(finding, ignoreValues)) return false;
    return true;
  });
}

function isIgnoredFindingValue(finding, ignoreValues) {
  if (!Array.isArray(ignoreValues) || ignoreValues.length === 0) return false;
  const rule = normalizeIgnoreRule(finding.antipattern);
  const value = extractFindingIgnoreValue(finding);
  if (!rule || !value) return false;
  return ignoreValues.some((entry) => {
    const wildcardValue = entry.value === '*';
    if (entry.rule !== rule || (!wildcardValue && !ignoreValueMatches(rule, entry.value, value))) return false;
    if (!Array.isArray(entry.files) || entry.files.length === 0) return !wildcardValue;
    return findingMatchesScopedIgnoreFile(finding, entry.files);
  });
}

function findingMatchesScopedIgnoreFile(finding, globs) {
  return matchesAnyGlob(String(finding?.file || '').trim(), globs);
}

export function extractFindingIgnoreValue(finding) {
  if (!finding || typeof finding !== 'object') return '';
  const rule = normalizeIgnoreRule(finding.antipattern);
  const directValueRules = new Set([
    'overused-font',
    'bounce-easing',
    'design-system-font',
    'design-system-color',
    'design-system-radius',
  ]);
  if (!directValueRules.has(rule)) return '';
  return normalizeIgnoreValue(extractFindingIgnoreValueRaw(finding, rule));
}

function extractFindingIgnoreValueRaw(finding, rule = normalizeIgnoreRule(finding?.antipattern)) {
  const direct = cleanIgnoreValueDisplay(finding.ignoreValue || finding.value || '');
  if (direct) return direct;

  const candidates = [finding.detail, finding.snippet].filter((v) => typeof v === 'string' && v);
  for (const text of candidates) {
    if (rule === 'bounce-easing') {
      const motion = extractMotionIgnoreValue(text);
      if (motion) return motion;
      continue;
    }

    const primary = text.match(/Primary font:\s*([^()\n;]+)/i);
    if (primary) return cleanIgnoreValueDisplay(primary[1]);

    const family = text.match(/font-family\s*:\s*["']?([^'",;\n]+)/i);
    if (family) return cleanIgnoreValueDisplay(family[1]);

    const google = text.match(/[?&]family=([^&:;\n]+)/i);
    if (google) {
      try {
        return cleanIgnoreValueDisplay(decodeURIComponent(google[1]));
      } catch {
        return cleanIgnoreValueDisplay(google[1]);
      }
    }
  }

  return '';
}

function extractMotionIgnoreValue(text) {
  const tailwind = text.match(/\banimate-bounce\b/i);
  if (tailwind) return cleanIgnoreValueDisplay(tailwind[0]);

  const bezier = text.match(/cubic-bezier\([^)]+\)/i);
  if (bezier) return cleanIgnoreValueDisplay(bezier[0]);

  const animation = text.match(/animation(?:-name)?\s*:\s*([^;\n]+)/i);
  if (animation) {
    const token = animation[1]
      .split(/[,\s]+/)
      .find((part) => /bounce|elastic|wobble|jiggle|spring/i.test(part));
    if (token) return cleanIgnoreValueDisplay(token);
  }

  return '';
}

function cleanIgnoreValueDisplay(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ');
}

