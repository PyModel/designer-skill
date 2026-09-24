import { finding } from './findings.mjs';
import { GENERIC_FONTS } from './shared/constants.mjs';
import { resolveLengthPx } from './rules/checks.mjs';
import { parseCssColor } from './shared/color.mjs';
import { blankBlockComments } from './shared/text.mjs';

// Blank <!-- … --> comments, preserving newlines so line numbers stay valid.
function stripHtmlCommentsKeepLines(text) {
  let out = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf('<!--', index);
    if (start === -1) return out + text.slice(index);
    const end = text.indexOf('-->', start + 4);
    const stop = end === -1 ? text.length : end + 3;
    out += text.slice(index, start) + text.slice(start, stop).replace(/[^\n]/g, ' ');
    if (end === -1) return out;
    index = stop;
  }
}

const COLOR_CHANNEL_TOLERANCE = 6;
const RADIUS_TOLERANCE_PX = 0.5;

const CSS_COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]+\)|oklch\([^)]+\)|hsla?\([^)]+\)/gi;
const FONT_DECL_RE = /font-family\s*:\s*([^;}\n]+)/gi;
const FONT_JS_RE = /fontFamily\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const GOOGLE_FONT_RE = /fonts\.googleapis\.com\/css2?\?[^"'\s)<>]*/gi;
const BORDER_RADIUS_RE = /border-radius\s*:\s*([^;}\n]+)/gi;
const BORDER_RADIUS_JS_RE = /borderRadius\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const STATIC_DESIGN_SKIP_TAGS = new Set(['head', 'title', 'meta', 'link', 'style', 'script', 'noscript', 'template', 'source']);

// { status: 'absent' } when there is no frontmatter block, { status: 'invalid' }
// when a block is opened but never closed, else { status: 'ok', data }.
function readFrontmatter(md) {
  const lines = String(md || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { status: 'absent' };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return { status: 'ok', data: parseYamlSubset(lines.slice(1, i).join('\n')) };
  }
  return { status: 'invalid', reason: 'frontmatter block is not closed with ---' };
}

function parseFrontmatter(md) {
  const result = readFrontmatter(md);
  return result.status === 'ok' ? result.data : null;
}

function parseYamlSubset(yaml) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const raw of String(yaml || '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const content = raw.slice(indent);
    const colonIdx = findTopLevelColon(content);
    if (colonIdx === -1) continue;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();

    const key = unquoteYamlKey(content.slice(0, colonIdx).trim());
    const rest = stripInlineYamlComment(content.slice(colonIdx + 1).trim());
    const parent = stack[stack.length - 1].obj;

    if (rest === '') {
      const obj = {};
      parent[key] = obj;
      stack.push({ indent, obj });
    } else {
      parent[key] = parseScalar(rest);
    }
  }

  return root;
}

function findTopLevelColon(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ':') {
      return i;
    }
  }
  return -1;
}

function unquoteYamlKey(key) {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

function stripInlineYamlComment(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote && s[i - 1] !== '\\') inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && i > 0 && /\s/.test(s[i - 1])) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

function parseScalar(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

function normalizeFontName(value) {
  return String(value || '')
    .trim()
    .replace(/\s*!important\s*$/i, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function splitFontStack(stack) {
  return String(stack || '')
    .replace(/\s*!important\s*$/i, '')
    .split(',')
    .map(normalizeFontName)
    .filter(Boolean);
}

function primaryFont(stack) {
  if (!stack || /var\(/i.test(stack) || !isLiteralFontStack(stack)) return '';
  return splitFontStack(stack).find(font => !GENERIC_FONTS.has(font)) || '';
}

function isLiteralFontStack(stack) {
  const text = String(stack || '');
  return !/[$`{}]|\s\+\s|\|\|/.test(text);
}

function cssColorLabel(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function colorKey(color) {
  if (!color) return '';
  return `${color.r},${color.g},${color.b}`;
}

function colorsClose(a, b) {
  if (!a || !b) return false;
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
  ) <= COLOR_CHANNEL_TOLERANCE;
}

function parseDesignColor(value) {
  return parseCssColor(String(value || ''));
}

function addDesignColor(out, value, label) {
  const parsed = parseDesignColor(value);
  if (!parsed) return;
  const key = colorKey(parsed);
  if (!out.allowedColorKeys.has(key)) {
    out.allowedColorKeys.set(key, { color: parsed, labels: [] });
  }
  out.allowedColorKeys.get(key).labels.push(label || cssColorLabel(value));
}

function addColorObject(out, colors, prefix = 'colors') {
  if (!colors || typeof colors !== 'object') return;
  for (const [name, value] of Object.entries(colors)) {
    if (typeof value === 'string') {
      addDesignColor(out, value, `${prefix}.${name}`);
    }
  }
}

function addSidecarColors(out, sidecar) {
  const colorMeta = sidecar?.extensions?.colorMeta;
  if (!colorMeta || typeof colorMeta !== 'object') return;

  for (const [name, meta] of Object.entries(colorMeta)) {
    if (!meta || typeof meta !== 'object') continue;
    if (typeof meta.canonical === 'string') addDesignColor(out, meta.canonical, `sidecar.${name}`);
    if (Array.isArray(meta.tonalRamp)) {
      for (const [index, value] of meta.tonalRamp.entries()) {
        if (typeof value === 'string') addDesignColor(out, value, `sidecar.${name}.tonalRamp[${index}]`);
      }
    }
  }
}

function addTypographyFonts(out, typography) {
  if (!typography || typeof typography !== 'object') return;
  for (const role of Object.values(typography)) {
    if (!role || typeof role !== 'object') continue;
    if (typeof role.fontFamily !== 'string') continue;
    for (const font of splitFontStack(role.fontFamily)) {
      if (!GENERIC_FONTS.has(font)) out.allowedFonts.add(font);
    }
  }
}

function addRoundedScale(out, rounded) {
  if (!rounded || typeof rounded !== 'object') return;
  for (const [rawName, value] of Object.entries(rounded)) {
    const name = unquoteYamlKey(rawName).toLowerCase();
    addRoundedToken(out, name, value);
  }
}

function addRoundedToken(out, name, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const raw = String(value).trim();
  if (!raw || /var\(/i.test(raw) || raw.includes('%')) return;
  const px = resolveLengthPx(raw, 16);
  if (px == null || !Number.isFinite(px)) return;
  out.allowedRadii.push({ name, value: raw, px });
  if (/(^|\.)(full|pill|round|rounded-full)$/.test(name)) out.hasPillRadius = true;
}

function addSidecarRadii(out, sidecar) {
  const roundedMeta = sidecar?.extensions?.roundedMeta;
  if (!roundedMeta || typeof roundedMeta !== 'object') return;

  for (const [rawName, meta] of Object.entries(roundedMeta)) {
    const name = unquoteYamlKey(rawName).toLowerCase();
    if (typeof meta === 'string' || typeof meta === 'number') {
      addRoundedToken(out, `sidecar.${name}`, meta);
      continue;
    }
    if (!meta || typeof meta !== 'object') continue;
    for (const key of ['canonical', 'value']) {
      if (typeof meta[key] === 'string' || typeof meta[key] === 'number') {
        addRoundedToken(out, `sidecar.${name}.${key}`, meta[key]);
      }
    }
    for (const key of ['values', 'aliases']) {
      if (!Array.isArray(meta[key])) continue;
      for (const [index, value] of meta[key].entries()) {
        addRoundedToken(out, `sidecar.${name}.${key}[${index}]`, value);
      }
    }
    if (/^(full|pill|round|rounded-full)$/.test(name) || /^(full|pill|round)$/i.test(String(meta.role || ''))) {
      out.hasPillRadius = true;
    }
  }
}

function normalizeDesignSystem(input = {}) {
  const frontmatter = input.frontmatter || {};
  const sidecar = input.sidecar || null;
  const out = {
    present: true,
    allowedFonts: new Set(),
    allowedColorKeys: new Map(),
    allowedRadii: [],
    hasPillRadius: false,
  };

  addTypographyFonts(out, frontmatter.typography);
  addColorObject(out, frontmatter.colors);
  addSidecarColors(out, sidecar);
  addRoundedScale(out, frontmatter.rounded);
  addSidecarRadii(out, sidecar);

  out.hasFonts = out.allowedFonts.size > 0;
  out.hasColors = out.allowedColorKeys.size > 0;
  out.hasRadii = out.allowedRadii.length > 0;
  return out;
}

// Pure: the caller (the scan's confined reader) supplies DESIGN.md text and an
// optional sidecar JSON text. Returns
// { status: 'absent'|'no-tokens'|'loaded'|'invalid', designSystem, reason }.
function loadDesignSystem({ markdown, sidecarJson } = {}) {
  if (typeof markdown !== 'string') return { status: 'absent', designSystem: null };
  const frontmatter = readFrontmatter(markdown);
  if (frontmatter.status === 'invalid') return { status: 'invalid', designSystem: null, reason: `DESIGN.md ${frontmatter.reason}` };
  let sidecar = null;
  if (typeof sidecarJson === 'string') {
    try {
      sidecar = JSON.parse(sidecarJson);
    } catch (error) {
      return { status: 'invalid', designSystem: null, reason: `design sidecar is not valid JSON (${error.message})` };
    }
    if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) {
      return { status: 'invalid', designSystem: null, reason: 'design sidecar must be a JSON object' };
    }
  }
  if (frontmatter.status === 'absent' && !sidecar) return { status: 'no-tokens', designSystem: null };
  const designSystem = normalizeDesignSystem({ frontmatter: frontmatter.data || {}, sidecar });
  const hasTokens = designSystem.hasFonts || designSystem.hasColors || designSystem.hasRadii;
  return { status: hasTokens ? 'loaded' : 'no-tokens', designSystem: hasTokens ? designSystem : null };
}

function isAllowedFont(font, designSystem) {
  if (!font || GENERIC_FONTS.has(font)) return true;
  if (!designSystem?.hasFonts) return true;
  return designSystem.allowedFonts.has(font);
}

function isAllowedColorRaw(raw, designSystem) {
  if (!designSystem?.hasColors) return true;
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === 'transparent' || text === 'currentcolor' || text === 'inherit' || text === 'initial') return true;
  if (text.includes('var(')) return true;
  const parsed = parseDesignColor(text);
  if (!parsed) return true;
  if ((parsed.a ?? 1) <= 0.05) return true;
  for (const entry of designSystem.allowedColorKeys.values()) {
    if (colorsClose(parsed, entry.color)) return true;
  }
  return false;
}

function isAllowedRadiusRaw(raw, designSystem) {
  if (!designSystem?.hasRadii) return true;
  const text = String(raw || '').trim().toLowerCase();
  if (!text || text === '0' || text === 'none' || text === 'initial' || text === 'inherit') return true;
  if (text.includes('var(') || text.includes('%')) return true;
  const px = resolveLengthPx(text, 16);
  if (px == null || !Number.isFinite(px) || px <= RADIUS_TOLERANCE_PX) return true;
  if (designSystem.hasPillRadius && px >= 99) return true;
  return designSystem.allowedRadii.some(entry => Math.abs(entry.px - px) <= RADIUS_TOLERANCE_PX);
}

// Block comments are blanked before scanning (see checkSourceDesignSystem);
// a line comment is recognized by its leading `//`.
function lineLooksCommented(line) {
  return String(line || '').trimStart().startsWith('//');
}

// Context checks look only at a bounded window around the match: the
// declaration a color literal belongs to is local, and scanning the whole
// line prefix per match is quadratic on minified CSS.
const COLOR_CONTEXT_WINDOW = 256;

function isProbablyColorLiteral(line, match) {
  const raw = match?.[0] || '';
  const index = match.index ?? -1;
  if (index < 0) return false;
  const before = line.slice(Math.max(0, index - COLOR_CONTEXT_WINDOW), index);
  const after = line.slice(index + raw.length, index + raw.length + COLOR_CONTEXT_WINDOW);
  if (isInsideCssAttributeSelector(before, after)) return false;

  if (raw.startsWith('#')) {
    if (before.endsWith('&')) return false; // HTML numeric entity, e.g. &#8596;
    let p = before.length - 1;
    while (p >= 0 && /\s/.test(before[p])) p--;
    const prevNonSpace = p >= 0 ? before[p] : '';
    const nextNonSpace = after.match(/^\s*(\S)/)?.[1] || '';
    if (prevNonSpace === '>' && nextNonSpace === '<') return false; // plain text, e.g. PR #155
  }

  const styleContext = /(?:^|[{\s;"'`(,])(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke)\s*:\s*[^;{}"'`]*$/i.test(before);
  const cssFunctionContext = /(?:linear-gradient|radial-gradient|conic-gradient|color-mix)\([^)]*$/i.test(before);
  const jsColorKeyContext = /(?:^|[,{]\s*)(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke|boxShadow|textShadow)\s*[:=]\s*["'`]?[^"'`,}]*$/i.test(before);

  return styleContext || cssFunctionContext || jsColorKeyContext;
}

function isInsideCssAttributeSelector(before, after) {
  const lastOpen = before.lastIndexOf('[');
  if (lastOpen === -1 || before.lastIndexOf(']') > lastOpen) return false;
  const close = after.indexOf(']');
  const block = after.indexOf('{');
  return close !== -1 && (block === -1 || close < block);
}

function makeDesignFinding(id, filePath, snippet, line, extras = {}) {
  return { ...finding(id, filePath, snippet, line), ...extras };
}

function decodeGoogleFamily(value) {
  const family = String(value || '').split(':')[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(family);
  } catch {
    return family;
  }
}

function checkFontStack(stack, filePath, line, designSystem, context) {
  const primary = primaryFont(stack);
  if (!primary || isAllowedFont(primary, designSystem)) return [];
  const display = primary.replace(/\b\w/g, ch => ch.toUpperCase());
  return [makeDesignFinding(
    'design-system-font',
    filePath,
    `${context}: ${display} is not declared in DESIGN.md typography`,
    line,
    { ignoreValue: display },
  )];
}

function extractRadiusTokens(value) {
  return String(value || '')
    .replace(/\s*\/\s*/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function checkRadiusValue(value, filePath, line, designSystem, context) {
  const findings = [];
  for (const token of extractRadiusTokens(value)) {
    if (isAllowedRadiusRaw(token, designSystem)) continue;
    findings.push(makeDesignFinding(
      'design-system-radius',
      filePath,
      `${context}: ${token} is outside the DESIGN.md rounded scale`,
      line,
      { ignoreValue: token },
    ));
  }
  return findings;
}

function checkSourceDesignSystem(content, filePath, options = {}) {
  const designSystem = options.designSystem;
  if (!designSystem?.present) return [];

  const findings = [];
  const lines = blankBlockComments(stripHtmlCommentsKeepLines(String(content || ''))).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    if (lineLooksCommented(line)) continue;

    if (designSystem.hasFonts) {
      for (const match of line.matchAll(FONT_DECL_RE)) {
        findings.push(...checkFontStack(match[1], filePath, lineNum, designSystem, 'font-family'));
      }
      for (const match of line.matchAll(FONT_JS_RE)) {
        findings.push(...checkFontStack(match[1], filePath, lineNum, designSystem, 'fontFamily'));
      }
      for (const match of line.matchAll(GOOGLE_FONT_RE)) {
        const url = match[0];
        for (const familyMatch of url.matchAll(/[?&]family=([^&]+)/g)) {
          const font = normalizeFontName(decodeGoogleFamily(familyMatch[1]));
          if (!font || isAllowedFont(font, designSystem)) continue;
          const display = decodeGoogleFamily(familyMatch[1]);
          findings.push(makeDesignFinding(
            'design-system-font',
            filePath,
            `Google Fonts: ${display} is not declared in DESIGN.md typography`,
            lineNum,
            { ignoreValue: display },
          ));
        }
      }
    }

    if (designSystem.hasColors) {
      for (const match of line.matchAll(CSS_COLOR_RE)) {
        if (!isProbablyColorLiteral(line, match)) continue;
        const raw = cssColorLabel(match[0]);
        if (isAllowedColorRaw(raw, designSystem)) continue;
        findings.push(makeDesignFinding(
          'design-system-color',
          filePath,
          `Undocumented color ${raw} is outside DESIGN.md colors`,
          lineNum,
          { ignoreValue: raw },
        ));
      }
    }

    if (designSystem.hasRadii) {
      for (const match of line.matchAll(BORDER_RADIUS_RE)) {
        findings.push(...checkRadiusValue(match[1], filePath, lineNum, designSystem, 'border-radius'));
      }
      for (const match of line.matchAll(BORDER_RADIUS_JS_RE)) {
        findings.push(...checkRadiusValue(match[1], filePath, lineNum, designSystem, 'borderRadius'));
      }
    }
  }

  return dedupeDesignFindings(findings);
}

function hasDirectText(el) {
  return Array.from(el.childNodes || []).some(node => node.nodeType === 3 && node.textContent.trim().length > 0);
}

function sampleText(el) {
  const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
  return text ? ` "${text.slice(0, 40)}"` : '';
}

function collectStaticDesignSystemFindings(document, window, filePath, designSystem) {
  if (!designSystem?.present) return [];
  const findings = [];
  const seenFonts = new Set();
  const seenColors = new Set();
  const seenRadii = new Set();

  for (const el of document.querySelectorAll('*')) {
    if (shouldSkipStaticDesignElement(el, window)) continue;
    const tag = el.tagName?.toLowerCase?.() || 'unknown';
    const style = window.getComputedStyle(el);

    if (designSystem.hasFonts && hasDirectText(el)) {
      const font = primaryFont(style.fontFamily || '');
      if (font && !seenFonts.has(font) && !isAllowedFont(font, designSystem)) {
        seenFonts.add(font);
        findings.push(makeDesignFinding(
          'design-system-font',
          filePath,
          `${tag}${sampleText(el)} uses ${font}; not declared in DESIGN.md typography`,
          0,
          { ignoreValue: font },
        ));
      }
    }

    if (designSystem.hasColors) {
      const colorChecks = [];
      if (hasDirectText(el)) colorChecks.push(['text color', style.color]);
      if (!isTransparentCss(style.backgroundColor)) colorChecks.push(['background', style.backgroundColor]);
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if ((parseFloat(style[`border${side}Width`]) || 0) > 0) {
          colorChecks.push([`border-${side.toLowerCase()}`, style[`border${side}Color`]]);
        }
      }
      if ((parseFloat(style.outlineWidth) || 0) > 0) colorChecks.push(['outline', style.outlineColor]);

      for (const [kind, raw] of colorChecks) {
        const label = cssColorLabel(raw);
        if (isAllowedColorRaw(label, designSystem)) continue;
        const key = `${kind}:${label}`;
        if (seenColors.has(key)) continue;
        seenColors.add(key);
        findings.push(makeDesignFinding(
          'design-system-color',
          filePath,
          `${kind} ${label} on ${tag}${sampleText(el)} is outside DESIGN.md colors`,
          0,
          { ignoreValue: label },
        ));
      }
    }

    if (designSystem.hasRadii) {
      const rawRadius = String(style.borderRadius || '').trim();
      if (!rawRadius) continue;
      for (const token of extractRadiusTokens(rawRadius)) {
        if (isAllowedRadiusRaw(token, designSystem)) continue;
        if (seenRadii.has(token)) continue;
        seenRadii.add(token);
        findings.push(makeDesignFinding(
          'design-system-radius',
          filePath,
          `border-radius ${token} on ${tag}${sampleText(el)} is outside the DESIGN.md rounded scale`,
          0,
          { ignoreValue: token },
        ));
      }
    }
  }

  return findings;
}

function shouldSkipStaticDesignElement(el, window) {
  const tag = el.tagName?.toLowerCase?.() || '';
  if (STATIC_DESIGN_SKIP_TAGS.has(tag)) return true;

  let current = el;
  while (current) {
    if (current.getAttribute?.('hidden') !== null || current.getAttribute?.('aria-hidden') === 'true') return true;
    const style = window.getComputedStyle(current);
    const display = String(style.display || '').toLowerCase();
    const visibility = String(style.visibility || '').toLowerCase();
    if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') return true;
    current = current.parentElement;
  }
  return false;
}

function isTransparentCss(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text === 'transparent') return true;
  const parsed = parseDesignColor(text);
  return parsed ? (parsed.a ?? 1) <= 0.05 : false;
}

function canonicalDesignFindingKey(item) {
  if (!item?.antipattern?.startsWith?.('design-system-')) return null;
  const value = item.ignoreValue || item.value || '';
  if (item.antipattern === 'design-system-font') {
    const context = /google fonts/i.test(item.snippet || '') ? 'google-font' : 'font';
    const font = normalizeFontName(value);
    return font ? `${item.antipattern}:${context}:${font}` : null;
  }
  if (item.antipattern === 'design-system-color') {
    const parsed = parseDesignColor(value);
    if (parsed) return `${item.antipattern}:color:${colorKey(parsed)}`;
    const label = cssColorLabel(value).toLowerCase();
    return label ? `${item.antipattern}:color:${label}` : null;
  }
  if (item.antipattern === 'design-system-radius') {
    const px = resolveLengthPx(String(value || '').trim(), 16);
    if (px != null && Number.isFinite(px)) return `${item.antipattern}:radius:${Math.round(px * 100) / 100}`;
    const label = String(value || '').trim().toLowerCase();
    return label ? `${item.antipattern}:radius:${label}` : null;
  }
  return null;
}

function mergeDesignSystemFindings(...groups) {
  const out = [];
  const seen = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const key = canonicalDesignFindingKey(item);
      if (key) {
        if (seen.has(key)) {
          const existing = out[seen.get(key)];
          if ((existing.line || 0) <= 0 && (item.line || 0) > 0) existing.line = item.line;
          continue;
        }
        seen.set(key, out.length);
      }
      out.push(item);
    }
  }
  return out;
}

function dedupeDesignFindings(findings) {
  const out = [];
  const seen = new Set();
  for (const item of findings) {
    const key = [
      item.antipattern,
      item.line || 0,
      normalizeFontName(item.ignoreValue || item.snippet || ''),
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export {
  parseFrontmatter,
  normalizeDesignSystem,
  loadDesignSystem,
  isAllowedFont,
  isAllowedColorRaw,
  isAllowedRadiusRaw,
  checkSourceDesignSystem,
  collectStaticDesignSystemFindings,
  mergeDesignSystemFindings,
};
