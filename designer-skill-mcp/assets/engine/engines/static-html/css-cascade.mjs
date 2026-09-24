import { profileStep, recordProfileEvent } from '../../profile/profiler.mjs';
import { resolveLengthPx } from '../../rules/checks.mjs';
import { parseCssColor } from '../../shared/color.mjs';

// The engine never touches the filesystem: linked stylesheets arrive through
// `options.readStylesheet(href, fromFile)`, owned by the scan's confined reader.

class EngineLimitError extends Error {
  constructor(message) {
    super(message);
    this.code = 'SCAN_LIMIT';
  }
}

// Browsers cap HTML tree depth (Blink: 512); deeper trees are not renderable.
const MAX_DOM_DEPTH = 512;
// A custom property's substituted value may not exceed this (var() bombs).
const MAX_VAR_VALUE_LENGTH = 64 * 1024;
const MAX_VAR_DEPTH = 32;

// ---------------------------------------------------------------------------
// var() substitution (CSS Variables 1): nested fallbacks, cycle detection,
// and a size budget. `null` = invalid at computed-value time.
// ---------------------------------------------------------------------------

function findClosingParen(text, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevelComma(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) return [text.slice(0, i), text.slice(i + 1)];
  }
  return [text, undefined];
}

function substituteVars(raw, customProps, depth = 0, active = new Set()) {
  if (typeof raw !== 'string' || !raw.includes('var(')) return raw;
  if (depth > MAX_VAR_DEPTH) return null;
  let out = '';
  let index = 0;
  const lower = raw.toLowerCase();
  while (index < raw.length) {
    const start = lower.indexOf('var(', index);
    if (start === -1) { out += raw.slice(index); break; }
    const end = findClosingParen(raw, start + 3);
    if (end === -1) return null;
    out += raw.slice(index, start);
    const [nameRaw, fallback] = splitTopLevelComma(raw.slice(start + 4, end));
    const name = nameRaw.trim();
    let value = null;
    if (!active.has(name)) {
      const defined = customProps.get(name);
      if (defined !== undefined && defined !== null) value = defined;
    }
    if (value === null && fallback !== undefined) {
      value = substituteVars(fallback.trim(), customProps, depth + 1, active);
    }
    if (value === null) return null;
    out += value;
    if (out.length > MAX_VAR_VALUE_LENGTH) return null;
    index = end + 1;
  }
  return out.length > MAX_VAR_VALUE_LENGTH ? null : out;
}

// ---------------------------------------------------------------------------
// Media queries (Media Queries 4) evaluated against one declared static
// environment. Unknown features evaluate false, as in browsers.
// ---------------------------------------------------------------------------

const STATIC_MEDIA_ENV = Object.freeze({
  type: 'screen',
  width: 1280,
  height: 800,
  resolution: 1,
  features: {
    orientation: 'landscape',
    'prefers-color-scheme': 'light',
    'prefers-reduced-motion': 'no-preference',
    'prefers-contrast': 'no-preference',
    'prefers-reduced-transparency': 'no-preference',
    'forced-colors': 'none',
    'inverted-colors': 'none',
    hover: 'hover',
    'any-hover': 'hover',
    pointer: 'fine',
    'any-pointer': 'fine',
    scripting: 'enabled',
    update: 'fast',
    'display-mode': 'browser',
    'color-gamut': 'srgb',
    grid: '0',
    color: '8',
    monochrome: '0',
  },
});

function mediaLengthPx(text) {
  const m = String(text).trim().match(/^(-?\d*\.?\d+)(px|em|rem)?$/i);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (!unit) return value === 0 ? 0 : null;
  return unit === 'px' ? value : value * 16;
}

function mediaFeatureValue(name, env) {
  if (name === 'width') return { kind: 'length', value: env.width };
  if (name === 'height') return { kind: 'length', value: env.height };
  if (name === 'aspect-ratio') return { kind: 'ratio', value: env.width / env.height };
  if (name === 'resolution') return { kind: 'resolution', value: env.resolution };
  if (name === 'color' || name === 'monochrome' || name === 'grid') return { kind: 'number', value: Number(env.features[name]) };
  if (Object.hasOwn(env.features, name)) return { kind: 'keyword', value: env.features[name] };
  return null;
}

function parseMediaOperand(kind, text) {
  const t = String(text).trim().toLowerCase();
  if (kind === 'length') return mediaLengthPx(t);
  if (kind === 'ratio') {
    const m = t.match(/^(\d*\.?\d+)\s*(?:\/\s*(\d*\.?\d+))?$/);
    return m ? Number(m[1]) / Number(m[2] || 1) : null;
  }
  if (kind === 'resolution') {
    const m = t.match(/^(\d*\.?\d+)(dppx|x|dpi|dpcm)$/);
    if (!m) return null;
    const v = Number(m[1]);
    return m[2] === 'dpi' ? v / 96 : m[2] === 'dpcm' ? (v * 2.54) / 96 : v;
  }
  if (kind === 'number') return /^\d+$/.test(t) ? Number(t) : null;
  return t;
}

function compareMedia(left, op, right) {
  if (left === null || right === null) return false;
  if (op === '<') return left < right;
  if (op === '<=') return left <= right;
  if (op === '>') return left > right;
  if (op === '>=') return left >= right;
  return left === right;
}

function evalMediaFeature(text, env) {
  const t = text.trim().toLowerCase();
  const plain = t.match(/^([a-z-]+)\s*(?::\s*(.+))?$/);
  if (plain) {
    let name = plain[1];
    let op = '=';
    if (name.startsWith('min-')) { name = name.slice(4); op = '>='; }
    else if (name.startsWith('max-')) { name = name.slice(4); op = '<='; }
    const feature = mediaFeatureValue(name, env);
    if (!feature) return false;
    if (plain[2] === undefined) {
      if (op !== '=') return false;
      return feature.kind === 'keyword' ? feature.value !== 'none' && feature.value !== 'no-preference' : feature.value !== 0;
    }
    if (feature.kind === 'keyword') return op === '=' && feature.value === plain[2].trim();
    return compareMedia(feature.value, op, parseMediaOperand(feature.kind, plain[2]));
  }
  const range = t.match(/^(.+?)\s*(<=|>=|<|>|=)\s*(.+?)(?:\s*(<=|>=|<|>|=)\s*(.+))?$/);
  if (!range) return false;
  const [, a, op1, b, op2, c] = range;
  const flip = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };
  if (/^[a-z-]+$/.test(b) && c !== undefined) {
    const feature = mediaFeatureValue(b, env);
    if (!feature || feature.kind === 'keyword') return false;
    return compareMedia(parseMediaOperand(feature.kind, a), op1, feature.value) &&
      compareMedia(feature.value, op2, parseMediaOperand(feature.kind, c));
  }
  if (/^[a-z-]+$/.test(a)) {
    const feature = mediaFeatureValue(a, env);
    if (!feature || feature.kind === 'keyword') return false;
    return compareMedia(feature.value, op1, parseMediaOperand(feature.kind, b));
  }
  if (/^[a-z-]+$/.test(b)) {
    const feature = mediaFeatureValue(b, env);
    if (!feature || feature.kind === 'keyword') return false;
    return compareMedia(feature.value, flip[op1], parseMediaOperand(feature.kind, a));
  }
  return false;
}

// condition := 'not' group | group (('and'|'or') group)*
function evalMediaCondition(text, env) {
  const tokens = [];
  let i = 0;
  const src = text.trim();
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') {
      const end = findClosingParen(src, i);
      if (end === -1) return false;
      tokens.push({ group: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const word = src.slice(i).match(/^[a-z-]+/i);
    if (!word) return false;
    tokens.push({ word: word[0].toLowerCase() });
    i += word[0].length;
  }
  const evalGroup = (token) => {
    if (!token?.group) return false;
    const inner = token.group.trim();
    return /^\(|^not\s/i.test(inner) ? evalMediaCondition(inner, env) : evalMediaFeature(inner, env);
  };
  if (tokens[0]?.word === 'not') return tokens.length === 2 && !evalGroup(tokens[1]);
  let result = evalGroup(tokens[0]);
  for (let k = 1; k < tokens.length; k += 2) {
    const op = tokens[k]?.word;
    const next = evalGroup(tokens[k + 1]);
    if (op === 'and') result = result && next;
    else if (op === 'or') result = result || next;
    else return false;
  }
  return result;
}

function mediaQueryMatches(query, env) {
  let q = query.trim().toLowerCase();
  if (!q) return true;
  let negate = false;
  if (q.startsWith('not ')) { negate = true; q = q.slice(4).trim(); }
  else if (q.startsWith('only ')) q = q.slice(5).trim();
  let result;
  if (q.startsWith('(')) {
    result = evalMediaCondition(q, env);
  } else {
    const m = q.match(/^([a-z-]+)\s*(?:and\s+([\s\S]+))?$/);
    if (!m) return false;
    const typeMatches = m[1] === 'all' || m[1] === env.type;
    result = typeMatches && (m[2] === undefined || evalMediaCondition(m[2], env));
  }
  return negate ? !result : result;
}

function mediaListMatches(list, env = STATIC_MEDIA_ENV) {
  const text = String(list || '').trim();
  if (!text) return true;
  return splitCssList(text).some((query) => mediaQueryMatches(query, env));
}

// ---------------------------------------------------------------------------
// Static HTML/CSS detection (default for local HTML files)
// ---------------------------------------------------------------------------

const STATIC_INHERITED_PROPS = new Set([
  'color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight',
  'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'hyphens',
  'webkitHyphens',
]);

const STATIC_DEFAULT_STYLE = {
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopColor: 'rgb(0, 0, 0)',
  borderRightColor: 'rgb(0, 0, 0)',
  borderBottomColor: 'rgb(0, 0, 0)',
  borderLeftColor: 'rgb(0, 0, 0)',
  borderRadius: '0px',
  outlineWidth: '0px',
  outlineColor: 'rgb(0, 0, 0)',
  outlineStyle: 'none',
  boxShadow: 'none',
  fontFamily: '',
  fontSize: '16px',
  fontStyle: 'normal',
  fontWeight: '400',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  textTransform: 'none',
  textAlign: 'start',
  hyphens: 'manual',
  webkitHyphens: 'manual',
  transitionProperty: '',
  transitionTimingFunction: '',
  animationName: '',
  animationTimingFunction: '',
  webkitBackgroundClip: '',
  backgroundClip: '',
  width: '',
  height: '',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  marginTop: '0px',
  marginRight: '0px',
  marginBottom: '0px',
  marginLeft: '0px',
  position: 'static',
  visibility: 'visible',
  top: 'auto',
  right: 'auto',
  bottom: 'auto',
  left: 'auto',
  inset: '',
  display: '',
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
};

const STATIC_PROP_MAP = {
  'background-color': 'backgroundColor',
  'background-image': 'backgroundImage',
  'background-clip': 'backgroundClip',
  '-webkit-background-clip': 'webkitBackgroundClip',
  'border-radius': 'borderRadius',
  'border-top-width': 'borderTopWidth',
  'border-right-width': 'borderRightWidth',
  'border-bottom-width': 'borderBottomWidth',
  'border-left-width': 'borderLeftWidth',
  'border-top-color': 'borderTopColor',
  'border-right-color': 'borderRightColor',
  'border-bottom-color': 'borderBottomColor',
  'border-left-color': 'borderLeftColor',
  'outline-width': 'outlineWidth',
  'outline-color': 'outlineColor',
  'outline-style': 'outlineStyle',
  'box-shadow': 'boxShadow',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-style': 'fontStyle',
  'font-weight': 'fontWeight',
  'line-height': 'lineHeight',
  'letter-spacing': 'letterSpacing',
  'text-transform': 'textTransform',
  'text-align': 'textAlign',
  'hyphens': 'hyphens',
  '-webkit-hyphens': 'webkitHyphens',
  'transition-property': 'transitionProperty',
  'transition-timing-function': 'transitionTimingFunction',
  'animation-name': 'animationName',
  'animation-timing-function': 'animationTimingFunction',
  'width': 'width',
  'height': 'height',
  'padding-top': 'paddingTop',
  'padding-right': 'paddingRight',
  'padding-bottom': 'paddingBottom',
  'padding-left': 'paddingLeft',
  'margin-top': 'marginTop',
  'margin-right': 'marginRight',
  'margin-bottom': 'marginBottom',
  'margin-left': 'marginLeft',
  'position': 'position',
  'visibility': 'visibility',
  'top': 'top',
  'right': 'right',
  'bottom': 'bottom',
  'left': 'left',
  'inset': 'inset',
  'display': 'display',
  'overflow': 'overflow',
  'overflow-x': 'overflowX',
  'overflow-y': 'overflowY',
};

function splitCssList(value) {
  const parts = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === quote && value[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = value.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function splitCssTokens(value) {
  const tokens = [];
  let depth = 0, quote = '', current = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      current += ch;
      if (ch === quote && value[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (/\s/.test(ch) && depth === 0) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function cssPropToCamel(prop) {
  if (!prop) return prop;
  const mapped = STATIC_PROP_MAP[prop];
  if (mapped) return mapped;
  return prop.replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());
}

function staticColorToCss(c) {
  if (!c) return '';
  if (c.a != null && c.a < 1) return `rgba(${c.r}, ${c.g}, ${c.b}, ${Number(c.a.toFixed(3))})`;
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function parseStaticColor(value) {
  return parseCssColor(String(value || ''));
}

// First color-like token of a shorthand (background/border/outline).
function extractStaticColor(value) {
  if (!value) return '';
  for (const token of splitCssTokens(String(value).trim())) {
    if (/^var\(/i.test(token) || /^currentcolor$/i.test(token) || parseCssColor(token)) return token;
  }
  return '';
}

const COLOR_PROPS = new Set([
  'color', 'backgroundColor', 'outlineColor',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
]);

// Returns the computed value, or null when the declaration is invalid at
// computed-value time (unresolvable var()), which makes the property unset.
function normalizeStaticCssValue(prop, value, customProps, parentStyle, currentStyle = null) {
  const resolved = substituteVars(String(value || '').trim(), customProps);
  if (resolved === null) return null;
  let out = resolved.trim();
  if (out === 'inherit') return parentStyle?.[prop] || STATIC_DEFAULT_STYLE[prop] || '';
  if (out === 'initial') return STATIC_DEFAULT_STYLE[prop] ?? '';
  if (out === 'unset' || out === 'revert' || out === 'revert-layer') {
    return STATIC_INHERITED_PROPS.has(prop) ? (parentStyle?.[prop] || STATIC_DEFAULT_STYLE[prop] || '') : (STATIC_DEFAULT_STYLE[prop] ?? '');
  }
  if (COLOR_PROPS.has(prop)) {
    if (/^currentcolor$/i.test(out)) return prop === 'color' ? (parentStyle?.color || STATIC_DEFAULT_STYLE.color) : 'currentcolor';
    const parsed = parseStaticColor(out);
    if (parsed) out = staticColorToCss(parsed);
  }
  if (prop === 'fontSize') {
    const base = parseFloat(parentStyle?.fontSize) || 16;
    const px = resolveLengthPx(out, base);
    if (px != null) out = `${px}px`;
  }
  if (prop === 'letterSpacing') {
    const base = parseFloat(currentStyle?.fontSize || parentStyle?.fontSize) || 16;
    const px = resolveLengthPx(out, base);
    if (px != null) out = `${px}px`;
  }
  if (prop === 'lineHeight' && out !== 'normal') {
    const base = parseFloat(currentStyle?.fontSize || parentStyle?.fontSize) || 16;
    const px = resolveLengthPx(out, base);
    if (px != null) out = `${px}px`;
  }
  return out;
}

function expandStaticBoxValues(tokens) {
  if (tokens.length === 0) return ['0px', '0px', '0px', '0px'];
  if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]];
  if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]];
  if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]];
  return [tokens[0], tokens[1], tokens[2], tokens[3]];
}

function parseStaticBorder(value) {
  const tokens = splitCssTokens(value);
  let width = '', color = '';
  for (const token of tokens) {
    if (!width && /^-?[\d.]+(?:px|rem|em|%)$/.test(token)) width = token;
    if (!color) color = extractStaticColor(token);
  }
  return { width, color };
}

function parseStaticFont(value) {
  const out = [];
  const slashParts = value.match(/(?:^|\s)([\d.]+(?:px|rem|em|%))(?:\/([^\s]+))?/);
  if (/\bitalic\b/i.test(value)) out.push(['fontStyle', 'italic']);
  const weight = value.match(/\b([1-9]00|bold|normal|lighter|bolder)\b/i);
  if (weight) out.push(['fontWeight', weight[1]]);
  if (slashParts) {
    out.push(['fontSize', slashParts[1]]);
    if (slashParts[2]) out.push(['lineHeight', slashParts[2]]);
    const familyStart = value.indexOf(slashParts[0]) + slashParts[0].length;
    const family = value.slice(familyStart).trim();
    if (family) out.push(['fontFamily', family]);
  }
  return out;
}

function parseStaticTransition(value) {
  const props = [];
  const timings = [];
  for (const item of splitCssList(value)) {
    const tokens = splitCssTokens(item);
    const timing = tokens.find(token => /^(?:ease|linear|step-|cubic-bezier\()/i.test(token));
    if (timing) timings.push(timing);
    const prop = tokens.find(token => /^[a-z-]+$/i.test(token) && !/^(?:ease|linear|infinite|alternate|forwards|backwards|both|normal|none)$/.test(token) && !/s$/.test(token));
    if (prop) props.push(prop);
  }
  return {
    property: props.join(', '),
    timing: timings.join(', '),
  };
}

function parseStaticAnimation(value) {
  const names = [];
  const timings = [];
  for (const item of splitCssList(value)) {
    const tokens = splitCssTokens(item);
    const timing = tokens.find(token => /^(?:ease|linear|step-|cubic-bezier\()/i.test(token));
    if (timing) timings.push(timing);
    const name = tokens.find(token =>
      /^[a-z_-][\w-]*$/i.test(token) &&
      !/^(?:ease|linear|infinite|alternate|forwards|backwards|both|normal|none|running|paused)$/.test(token)
    );
    if (name) names.push(name);
  }
  return {
    name: names.join(', '),
    timing: timings.join(', '),
  };
}

function expandStaticDeclaration(prop, value) {
  const p = prop.toLowerCase();
  const v = String(value || '').trim();
  if (!v) return [];
  if (p.startsWith('--')) return [[p, v]];
  if (p === 'background') {
    const out = [];
    const hasImage = /gradient|url\(/i.test(v);
    if (hasImage) out.push(['backgroundImage', v]);
    const beforeImage = hasImage ? v.split(/(?:repeating-)?(?:linear|radial|conic)-gradient\(|url\(/i)[0] : v;
    const color = extractStaticColor(hasImage ? beforeImage : v);
    if (color) out.push(['backgroundColor', color]);
    return out;
  }
  if (p === 'border') {
    const parsed = parseStaticBorder(v);
    const out = [];
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parsed.width) out.push([`border${side}Width`, parsed.width]);
      if (parsed.color) out.push([`border${side}Color`, parsed.color]);
    }
    return out;
  }
  if (p === 'outline') {
    // `outline` shorthand: width | style | color, in any order. Reuse the
    // border parser for width + color, then sniff a style keyword from the
    // tokens (solid|dashed|...). `outline: 0` (single-token zero) zeros
    // the width and effectively hides the outline.
    const tokens = splitCssTokens(v);
    const parsed = parseStaticBorder(v);
    const styleToken = tokens.find(t =>
      /^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(t)
    );
    const out = [];
    if (parsed.width) out.push(['outlineWidth', parsed.width]);
    if (parsed.color) out.push(['outlineColor', parsed.color]);
    if (styleToken) out.push(['outlineStyle', styleToken.toLowerCase()]);
    // `outline: 0` with no other tokens: explicit zero width.
    if (!parsed.width && /^0(?:px|rem|em|%)?$/.test(v.trim())) {
      out.push(['outlineWidth', '0px']);
    }
    return out;
  }
  const sideMatch = p.match(/^border-(top|right|bottom|left)$/);
  if (sideMatch) {
    const parsed = parseStaticBorder(v);
    const side = sideMatch[1][0].toUpperCase() + sideMatch[1].slice(1);
    return [
      ...(parsed.width ? [[`border${side}Width`, parsed.width]] : []),
      ...(parsed.color ? [[`border${side}Color`, parsed.color]] : []),
    ];
  }
  if (p === 'border-width') {
    const vals = expandStaticBoxValues(splitCssTokens(v));
    return [
      ['borderTopWidth', vals[0]],
      ['borderRightWidth', vals[1]],
      ['borderBottomWidth', vals[2]],
      ['borderLeftWidth', vals[3]],
    ];
  }
  if (p === 'border-color') {
    const vals = expandStaticBoxValues(splitCssTokens(v));
    return [
      ['borderTopColor', vals[0]],
      ['borderRightColor', vals[1]],
      ['borderBottomColor', vals[2]],
      ['borderLeftColor', vals[3]],
    ];
  }
  if (p === 'padding') {
    const vals = expandStaticBoxValues(splitCssTokens(v));
    return [
      ['paddingTop', vals[0]],
      ['paddingRight', vals[1]],
      ['paddingBottom', vals[2]],
      ['paddingLeft', vals[3]],
    ];
  }
  if (p === 'margin') {
    const vals = expandStaticBoxValues(splitCssTokens(v));
    return [
      ['marginTop', vals[0]],
      ['marginRight', vals[1]],
      ['marginBottom', vals[2]],
      ['marginLeft', vals[3]],
    ];
  }
  if (p === 'font') return parseStaticFont(v);
  if (p === 'transition') {
    const parsed = parseStaticTransition(v);
    return [
      ...(parsed.property ? [['transitionProperty', parsed.property]] : []),
      ...(parsed.timing ? [['transitionTimingFunction', parsed.timing]] : []),
    ];
  }
  if (p === 'animation') {
    const parsed = parseStaticAnimation(v);
    return [
      ...(parsed.name ? [['animationName', parsed.name]] : []),
      ...(parsed.timing ? [['animationTimingFunction', parsed.timing]] : []),
    ];
  }
  const mapped = cssPropToCamel(p);
  if (STATIC_DEFAULT_STYLE[mapped] != null || STATIC_INHERITED_PROPS.has(mapped)) {
    return [[mapped, v]];
  }
  return [];
}

// Lexicographic layer comparison; returns sign(b - a). Unlayered = Infinity.
function compareLayerKeys(a = [Infinity], b = [Infinity]) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x !== y) return y > x ? 1 : -1;
  }
  return 0;
}

// CSS Cascade 5 order: importance, element-attached (inline), layers
// (reversed for !important), specificity, source order. True when b wins.
function compareStaticPriority(a, b) {
  if (!a) return true;
  if (!!b.important !== !!a.important) return !!b.important;
  if (!!b.inline !== !!a.inline) return !!b.inline;
  if (!b.inline) {
    const layer = compareLayerKeys(a.layer, b.layer);
    if (layer !== 0) return b.important ? layer < 0 : layer > 0;
  }
  for (let i = 0; i < 3; i++) {
    if ((b.specificity[i] || 0) !== (a.specificity[i] || 0)) {
      return (b.specificity[i] || 0) > (a.specificity[i] || 0);
    }
  }
  return b.order >= a.order;
}

function staticSpecificity(selector) {
  const noWhere = selector.replace(/:where\([^)]*\)/g, '');
  const ids = (noWhere.match(/#[\w-]+/g) || []).length;
  const classes = (noWhere.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length;
  const stripped = noWhere
    .replace(/#[\w-]+/g, ' ')
    .replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?/g, ' ')
    .replace(/[*>+~(),]/g, ' ');
  const types = (stripped.match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
  return [ids, classes, types];
}

function applyStaticDeclaration(specified, node, prop, value, meta) {
  let map = specified.get(node);
  if (!map) { map = new Map(); specified.set(node, map); }
  for (const [expandedProp, expandedValue] of expandStaticDeclaration(prop, value)) {
    const existing = map.get(expandedProp);
    const next = { ...meta, prop: expandedProp, value: expandedValue };
    if (compareStaticPriority(existing, next)) map.set(expandedProp, next);
  }
}

function parseStaticStyleAttribute(styleText, orderBase = 0) {
  const decls = [];
  for (const part of String(styleText || '').split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const prop = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    const important = /!important\s*$/i.test(value);
    value = value.replace(/\s*!important\s*$/i, '').trim();
    decls.push({ prop, value, important, order: orderBase + decls.length });
  }
  return decls;
}

function createCascadeState() {
  return { order: 0, layers: { children: new Map(), next: 0 }, anonymousLayers: 0, gaps: [] };
}

function declareLayer(parent, dottedName) {
  let node = parent.node;
  const path = [...parent.path];
  for (const part of dottedName.split('.')) {
    const name = part.trim();
    let child = node.children.get(name);
    if (!child) {
      child = { index: node.next++, children: new Map(), next: 0 };
      node.children.set(name, child);
    }
    path.push(child.index);
    node = child;
  }
  return { node, path };
}

const COLOR_AFFECTING_PROP = /(?:^|-)(?:color|background)/i;

function blockAffectsColor(block, csstree) {
  let affects = false;
  csstree.walk(block, (node) => {
    if (node.type === 'Declaration' && COLOR_AFFECTING_PROP.test(node.property)) affects = true;
  });
  return affects;
}

function collectStaticCssRules(cssText, csstree, state = createCascadeState()) {
  const rules = [];
  let ast;
  try {
    ast = csstree.parse(cssText, { positions: false, parseValue: true, parseCustomProperty: false });
  } catch {
    state.gaps.push({ kind: 'UNRESOLVED_STYLESHEET', detail: 'stylesheet could not be parsed' });
    return rules;
  }
  const root = { node: state.layers, path: [] };
  const walkList = (list, layer) => {
    list?.forEach?.(node => {
      if (node.type === 'Rule' && node.block) {
        const selectorText = csstree.generate(node.prelude).trim();
        const declarations = [];
        node.block.children?.forEach?.(child => {
          if (child.type !== 'Declaration') return;
          declarations.push({
            prop: child.property,
            value: csstree.generate(child.value).trim(),
            important: !!child.important,
          });
        });
        const layerKey = [...layer.path, Infinity];
        for (const selector of splitCssList(selectorText)) {
          if (selector) rules.push({ selector, declarations, specificity: staticSpecificity(selector), order: state.order++, layer: layerKey });
        }
        return;
      }
      if (node.type !== 'Atrule') return;
      const name = String(node.name || '').toLowerCase();
      const prelude = node.prelude ? csstree.generate(node.prelude).trim() : '';
      if (name === 'layer') {
        if (!node.block) {
          for (const layerName of splitCssList(prelude)) declareLayer(layer, layerName);
          return;
        }
        const target = prelude ? declareLayer(layer, prelude) : declareLayer(layer, `\u0000anonymous-${state.anonymousLayers++}`);
        walkList(node.block.children, target);
        return;
      }
      if (name === 'media') {
        if (node.block && mediaListMatches(prelude)) walkList(node.block.children, layer);
        return;
      }
      if (name === 'supports') {
        if (node.block) walkList(node.block.children, layer);
        return;
      }
      if (name === 'import') {
        state.gaps.push({ kind: 'UNRESOLVED_STYLESHEET', detail: `@import ${prelude} is not followed` });
        return;
      }
      if ((name === 'container' || name === 'scope') && node.block && blockAffectsColor(node.block, csstree)) {
        state.gaps.push({ kind: 'UNRESOLVED_STYLESHEET', detail: `@${name} ${prelude} depends on rendered layout` });
      }
    });
  };
  walkList(ast.children, root);
  return rules;
}

class StaticElement {
  constructor(node, doc) {
    this.node = node;
    this._doc = doc;
    this.nodeType = 1;
    this.tagName = String(node.name || '').toUpperCase();
    this.nodeName = this.tagName;
  }
  get parentElement() {
    let cur = this.node.parent;
    while (cur && cur.type !== 'tag') cur = cur.parent;
    return cur ? this._doc.wrap(cur) : null;
  }
  get previousElementSibling() {
    let cur = this.node.prev;
    while (cur && cur.type !== 'tag') cur = cur.prev;
    return cur ? this._doc.wrap(cur) : null;
  }
  get children() {
    return (this.node.children || []).filter(child => child.type === 'tag').map(child => this._doc.wrap(child));
  }
  get childNodes() {
    return (this.node.children || []).map(child => {
      if (child.type === 'text') return { nodeType: 3, textContent: child.data || '' };
      if (child.type === 'tag') return this._doc.wrap(child);
      return { nodeType: 8, textContent: child.data || '' };
    });
  }
  get textContent() {
    let out = '';
    const stack = [this.node];
    while (stack.length) {
      const node = stack.pop();
      if (node.type === 'text' || node.type === 'cdata') out += node.data || '';
      else if (node.children && node.type !== 'comment') {
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      }
    }
    return out;
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  getAttribute(name) {
    return this.node.attribs?.[name] ?? null;
  }
  querySelector(selector) {
    try {
      const found = this._doc.selectOne(selector, this.node.children || []);
      return found ? this._doc.wrap(found) : null;
    } catch {
      return null;
    }
  }
  querySelectorAll(selector) {
    try {
      return this._doc.selectAll(selector, this.node.children || []).map(node => this._doc.wrap(node));
    } catch {
      return [];
    }
  }
  closest(selector) {
    let cur = this.node;
    while (cur && cur.type === 'tag') {
      try {
        if (this._doc.is(cur, selector)) return this._doc.wrap(cur);
      } catch {
        return null;
      }
      cur = cur.parent;
      while (cur && cur.type !== 'tag') cur = cur.parent;
    }
    return null;
  }
  contains(other) {
    let cur = other?.node || null;
    while (cur) {
      if (cur === this.node) return true;
      cur = cur.parent;
    }
    return false;
  }
}

class StaticDocument {
  constructor(root, modules) {
    this.root = root;
    this.selectAll = modules.selectAll;
    this.selectOne = modules.selectOne;
    this.is = modules.is;
    this._wrappers = new WeakMap();
    this._styleMap = new WeakMap();
  }
  wrap(node) {
    let wrapped = this._wrappers.get(node);
    if (!wrapped) {
      wrapped = new StaticElement(node, this);
      this._wrappers.set(node, wrapped);
    }
    return wrapped;
  }
  querySelectorAll(selector) {
    try {
      return this.selectAll(selector, this.root.children || []).map(node => this.wrap(node));
    } catch {
      return [];
    }
  }
  querySelector(selector) {
    try {
      const found = this.selectOne(selector, this.root.children || []);
      return found ? this.wrap(found) : null;
    } catch {
      return null;
    }
  }
  get documentElement() {
    return this.querySelector('html');
  }
  get body() {
    return this.querySelector('body');
  }
  setStyle(node, style) {
    this._styleMap.set(node, style);
  }
  getStyle(el) {
    return this._styleMap.get(el.node) || makeStaticStyle();
  }
}

function makeStaticStyle(values = {}, unevaluable = null) {
  const style = { ...STATIC_DEFAULT_STYLE, ...values };
  style.getPropertyValue = (prop) => {
    const key = cssPropToCamel(prop);
    return style[key] || style[prop] || '';
  };
  if (unevaluable?.size) Object.defineProperty(style, '__unevaluable', { value: unevaluable, enumerable: false });
  return style;
}

function buildStaticWindow(staticDoc, gaps = []) {
  return {
    document: staticDoc,
    getComputedStyle: (el) => staticDoc.getStyle(el),
    reportGap: (gap) => gaps.push(gap),
  };
}

// Font-CSS APIs only serve @font-face rules; they cannot change colors,
// clipping or layout, so skipping them does not reduce rule coverage.
const FONT_ONLY_STYLESHEET_HOSTS = new Set(['fonts.googleapis.com', 'fonts.bunny.net', 'use.typekit.net', 'fonts.cdnfonts.com']);

function isFontOnlyStylesheet(href) {
  try {
    return FONT_ONLY_STYLESHEET_HOSTS.has(new URL(href, 'https://placeholder.invalid/').hostname);
  } catch {
    return false;
  }
}

function elementText(node) {
  let out = '';
  for (const child of node.children || []) if (child.type === 'text') out += child.data || '';
  return out;
}

// <style> and <link rel=stylesheet> in document order (their cascade order).
// Linked sheets are read only through options.readStylesheet.
function collectStaticStylesheets(root, modules, filePath, options = {}) {
  const sheets = [];
  const gaps = [];
  for (const node of modules.selectAll('style, link', root.children || [])) {
    const media = node.attribs?.media;
    if (media && !mediaListMatches(media)) continue;
    if (node.name === 'style') {
      sheets.push({ css: elementText(node), source: null });
      continue;
    }
    const rel = String(node.attribs?.rel || '').toLowerCase().split(/\s+/);
    if (!rel.includes('stylesheet') || rel.includes('alternate')) continue;
    const href = String(node.attribs?.href || '').trim();
    if (!href || isFontOnlyStylesheet(href)) continue;
    const result = options.readStylesheet
      ? options.readStylesheet(href, filePath)
      : { ok: false, reason: 'no stylesheet reader' };
    if (result.ok) sheets.push({ css: result.css, source: result.path });
    else gaps.push({ kind: 'UNRESOLVED_STYLESHEET', detail: `${href}: ${result.reason}` });
  }
  return { sheets, gaps };
}

function indexNodes(allNodes) {
  const byId = new Map();
  const byClass = new Map();
  const byTag = new Map();
  const push = (map, key, node) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(node);
  };
  for (const node of allNodes) {
    push(byTag, node.name, node);
    const id = node.attribs?.id;
    if (id) push(byId, id, node);
    for (const cls of String(node.attribs?.class || '').split(/\s+/)) if (cls) push(byClass, cls, node);
  }
  return { byId, byClass, byTag };
}

// Candidate elements from the rightmost compound selector; null = all.
function selectorCandidates(selector, index) {
  let depth = 0;
  let i = selector.length - 1;
  for (; i >= 0; i--) {
    const ch = selector[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') depth--;
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\t' || ch === '\n')) break;
  }
  const compound = selector.slice(i + 1).trim();
  if (!compound || compound.includes('\\') || compound.includes('|')) return null;
  const bare = compound.replace(/\([^()]*\)/g, '').replace(/\[[^\]]*\]/g, '');
  const id = bare.match(/#([\w-]+)/);
  if (id) return index.byId.get(id[1]) || [];
  const cls = bare.match(/\.([\w-]+)/);
  if (cls) return index.byClass.get(cls[1]) || [];
  const tag = bare.match(/^([a-zA-Z][\w-]*)/);
  if (tag) return index.byTag.get(tag[1].toLowerCase()) || [];
  return null;
}

function buildStaticStyleMap(root, staticDoc, sheets, modules, profile, filePath, gaps = []) {
  const specified = new Map();
  const allNodes = modules.selectAll('*', root.children || []);
  const state = createCascadeState();
  const rules = profileStep(profile, {
    engine: 'static-html',
    phase: 'parse-css',
    ruleId: 'css-rules',
    target: filePath,
  }, () => sheets.flatMap((sheet) => collectStaticCssRules(sheet.css, modules.csstree, state)));
  gaps.push(...state.gaps);

  profileStep(profile, {
    engine: 'static-html',
    phase: 'selector-match',
    ruleId: 'css-selectors',
    target: filePath,
  }, () => {
    const index = indexNodes(allNodes);
    const compiled = new Map();
    for (const rule of rules) {
      let matched;
      try {
        let test = compiled.get(rule.selector);
        if (!test) compiled.set(rule.selector, (test = modules.compile(rule.selector)));
        const candidates = selectorCandidates(rule.selector, index) ?? allNodes;
        matched = candidates.filter((node) => test(node));
      } catch {
        recordProfileEvent(profile, {
          engine: 'static-html',
          phase: 'selector-match',
          ruleId: 'unsupported-selector',
          target: filePath,
          ms: 0,
          findings: 0,
          detail: rule.selector,
        });
        continue;
      }
      for (const node of matched) {
        for (const decl of rule.declarations) {
          applyStaticDeclaration(specified, node, decl.prop, decl.value, {
            important: decl.important,
            specificity: rule.specificity,
            order: rule.order,
            layer: rule.layer,
            inline: false,
          });
        }
      }
    }

    let inlineOrder = state.order + 1;
    for (const node of allNodes) {
      const styleText = node.attribs?.style;
      if (!styleText) continue;
      for (const decl of parseStaticStyleAttribute(styleText, inlineOrder)) {
        applyStaticDeclaration(specified, node, decl.prop, decl.value, {
          important: decl.important,
          specificity: [1, 0, 0],
          order: decl.order,
          inline: true,
        });
      }
      inlineOrder += 1000;
    }
  });

  const computeNode = (node, parentStyle, parentCustom) => {
    const specifiedMap = specified.get(node) || new Map();
    // Children share the parent's map until they declare a custom property.
    let customProps = parentCustom;
    for (const [prop, decl] of specifiedMap) {
      if (!prop.startsWith('--')) continue;
      const value = substituteVars(decl.value, customProps);
      if (customProps === parentCustom) customProps = new Map(parentCustom);
      customProps.set(prop, value);
    }
    const values = {};
    for (const prop of Object.keys(STATIC_DEFAULT_STYLE)) {
      if (STATIC_INHERITED_PROPS.has(prop) && parentStyle?.[prop] != null) values[prop] = parentStyle[prop];
      else values[prop] = STATIC_DEFAULT_STYLE[prop];
    }
    const ordered = [...specifiedMap].filter(([prop]) => !prop.startsWith('--'));
    ordered.sort(([a], [b]) => (a === 'color' ? -1 : b === 'color' ? 1 : 0));
    for (const [prop, decl] of ordered) {
      const value = normalizeStaticCssValue(prop, decl.value, customProps, parentStyle, values);
      if (value !== null) values[prop] = value;
    }
    const unevaluable = new Set();
    for (const prop of COLOR_PROPS) {
      if (values[prop] === 'currentcolor') values[prop] = values.color;
      const value = values[prop];
      if (value && !/^rgba?\(/.test(value)) unevaluable.add(prop);
    }
    const style = makeStaticStyle(values, unevaluable);
    staticDoc.setStyle(node, style);
    return { style, customProps };
  };

  profileStep(profile, {
    engine: 'static-html',
    phase: 'cascade',
    ruleId: 'compute-styles',
    target: filePath,
  }, () => {
    const stack = [];
    for (let i = (root.children || []).length - 1; i >= 0; i--) {
      const child = root.children[i];
      if (child.type === 'tag') stack.push([child, null, new Map(), 1]);
    }
    while (stack.length) {
      const [node, parentStyle, parentCustom, depth] = stack.pop();
      if (depth > MAX_DOM_DEPTH) {
        throw new EngineLimitError(`HTML nesting exceeds ${MAX_DOM_DEPTH} levels in ${filePath}.`);
      }
      const { style, customProps } = computeNode(node, parentStyle, parentCustom);
      const children = node.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i].type === 'tag') stack.push([children[i], style, customProps, depth + 1]);
      }
    }
  });
}

export {
  EngineLimitError,
  STATIC_MEDIA_ENV,
  STATIC_INHERITED_PROPS,
  STATIC_DEFAULT_STYLE,
  STATIC_PROP_MAP,
  substituteVars,
  mediaListMatches,
  splitCssList,
  splitCssTokens,
  cssPropToCamel,
  staticColorToCss,
  parseStaticColor,
  extractStaticColor,
  normalizeStaticCssValue,
  expandStaticBoxValues,
  parseStaticBorder,
  parseStaticFont,
  parseStaticTransition,
  parseStaticAnimation,
  expandStaticDeclaration,
  compareStaticPriority,
  staticSpecificity,
  applyStaticDeclaration,
  parseStaticStyleAttribute,
  createCascadeState,
  collectStaticCssRules,
  StaticElement,
  StaticDocument,
  makeStaticStyle,
  buildStaticWindow,
  collectStaticStylesheets,
  buildStaticStyleMap,
};
