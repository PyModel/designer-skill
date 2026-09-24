// ─── Section 2: Color Utilities ─────────────────────────────────────────────

function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;

  // rgb/rgba — use channel spread. Threshold 30 ≈ 11.7% of the 0–255 range.
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return (Math.max(+rgb[1], +rgb[2], +rgb[3]) - Math.min(+rgb[1], +rgb[2], +rgb[3])) < 30;
  }

  // oklch()/lch() — chroma is the second numeric component.
  // oklch chroma is ~0–0.4 in sRGB gamut; >= 0.02 reads as tinted, not gray.
  // lch chroma is ~0–150; >= 3 reads as tinted. jsdom emits both formats
  // literally (it does NOT convert them to rgb).
  const oklch = color.match(/oklch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (oklch) return parseFloat(oklch[1]) < 0.02;
  const lch = color.match(/lch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (lch) return parseFloat(lch[1]) < 3;

  // oklab()/lab() — a and b are signed axes; chroma = sqrt(a² + b²).
  // oklab a/b are ~-0.4..0.4, threshold 0.02. lab a/b are ~-128..127, threshold 3.
  const oklab = color.match(/oklab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (oklab) {
    const a = parseFloat(oklab[1]), b = parseFloat(oklab[2]);
    return Math.hypot(a, b) < 0.02;
  }
  const lab = color.match(/lab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (lab) {
    const a = parseFloat(lab[1]), b = parseFloat(lab[2]);
    return Math.hypot(a, b) < 3;
  }

  // hsl/hsla — saturation is the second numeric component (percent).
  // Modern jsdom usually converts hsl() to rgb, but handle it directly for
  // safety across versions and for any engine that preserves the format.
  const hsl = color.match(/hsla?\(\s*[\d.-]+\s*,?\s*([\d.]+)%/i);
  if (hsl) return parseFloat(hsl[1]) < 10;

  // hwb(hue whiteness% blackness%) — a pixel is fully gray when
  // whiteness + blackness >= 100; chroma-like saturation = 1 - (w+b)/100.
  const hwb = color.match(/hwb\(\s*[\d.-]+\s+([\d.]+)%\s+([\d.]+)%/i);
  if (hwb) {
    const w = parseFloat(hwb[1]), b = parseFloat(hwb[2]);
    return (1 - Math.min(100, w + b) / 100) < 0.1;
  }

  // Unknown / unrecognized format — err on the side of DETECTING rather
  // than silently skipping. This is the opposite of the previous default,
  // which was the root cause of the oklch bug.
  return false;
}

function parseRgb(color) {
  if (!color || color === 'transparent') return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

// ─── CSS Color 4 parser: the single color parser for every engine path ─────
// Returns {r,g,b,a} (sRGB bytes, clamped to gamut) or null when the value is
// not a concrete color (var(), currentcolor, relative/mixed colors, garbage).
// Callers must treat null as "unevaluable", never as "transparent".

const NAMED_COLOR_HEX = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff',
  blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
  cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9',
  darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f',
  darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1',
  darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969',
  dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080',
  green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4',
  indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa',
  lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899',
  lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32',
  linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd',
  mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970',
  mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080',
  oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500',
  orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093',
  papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd',
  powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f',
  royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57',
  seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd',
  slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4',
  tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0',
  violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00',
  yellowgreen: '9acd32',
};
const NAMED_COLORS = new Set([...Object.keys(NAMED_COLOR_HEX), 'transparent']);

const NUMBER_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i;

function parseComponent(raw) {
  const text = String(raw).trim().toLowerCase();
  if (text === 'none') return { value: 0, unit: '' };
  const m = text.match(NUMBER_RE);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: m[2] || '' } : null;
}

function splitColorFunctionArgs(body) {
  if (body.includes(',')) {
    const parts = body.split(',').map((p) => p.trim());
    return parts.some((p) => !p) ? null : { channels: parts.slice(0, 3), alpha: parts[3], legacy: true, count: parts.length };
  }
  const [main, alpha, extra] = body.split('/');
  if (extra !== undefined) return null;
  const channels = main.trim().split(/\s+/).filter(Boolean);
  return { channels, alpha: alpha?.trim(), legacy: false, count: channels.length + (alpha ? 1 : 0) };
}

function parseAlpha(raw) {
  if (raw === undefined) return 1;
  const c = parseComponent(raw);
  if (!c || (c.unit && c.unit !== '%')) return null;
  const a = c.unit === '%' ? c.value / 100 : c.value;
  return Math.min(1, Math.max(0, a));
}

function hueDegrees(c) {
  if (!c) return null;
  if (c.unit === '%') return null;
  if (c.unit === 'rad') return c.value * (180 / Math.PI);
  if (c.unit === 'grad') return c.value * 0.9;
  if (c.unit === 'turn') return c.value * 360;
  return c.value;
}

// percent-or-number channel: `ref` is what 100% maps to.
function scaled(c, ref) {
  if (!c || (c.unit && c.unit !== '%')) return null;
  return c.unit === '%' ? (c.value / 100) * ref : c.value;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toByte = (x) => Math.round(clamp01(x) * 255);

function srgbEncode(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  return sign * (abs <= 0.0031308 ? 12.92 * abs : 1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
}

function srgbDecode(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  return sign * (abs <= 0.04045 ? abs / 12.92 : Math.pow((abs + 0.055) / 1.055, 2.4));
}

function mul3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Matrices from CSS Color 4 §18 (sample code).
const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const XYZ_D65_TO_LINEAR_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LINEAR_P3_TO_XYZ_D65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const D50_WHITE = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

function fromLinearSrgb([r, g, b], a) {
  return { r: toByte(srgbEncode(r)), g: toByte(srgbEncode(g)), b: toByte(srgbEncode(b)), a };
}

function labToRgb(L, A, B, alpha) {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (L + 16) / 116;
  const fx = A / 500 + fy;
  const fz = fy - B / 200;
  const xyz50 = [
    (fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k) * D50_WHITE[0],
    (L > k * e ? fy ** 3 : L / k) * D50_WHITE[1],
    (fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k) * D50_WHITE[2],
  ];
  return fromLinearSrgb(mul3(XYZ_D65_TO_LINEAR_SRGB, mul3(D50_TO_D65, xyz50)), alpha);
}

function oklabToRgb(L, A, B, alpha) {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return fromLinearSrgb([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ], alpha);
}

function hslToRgb(h, s, l, alpha) {
  const hue = (((h % 360) + 360) % 360) / 30;
  const sat = clamp01(s);
  const light = clamp01(l);
  const f = (n) => {
    const k = (n + hue) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: toByte(f(0)), g: toByte(f(8)), b: toByte(f(4)), a: alpha };
}

function parseHex(hex) {
  if (![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

function parseCssColor(input) {
  if (typeof input !== 'string') return null;
  const str = input.trim().toLowerCase();
  if (!str) return null;
  if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (NAMED_COLOR_HEX[str]) return parseHex(NAMED_COLOR_HEX[str]);
  if (str[0] === '#') return /^#[0-9a-f]+$/.test(str) ? parseHex(str.slice(1)) : null;
  const fn = str.match(/^([a-z-]+)\(([^()]*)\)$/);
  if (!fn) return null; // nested functions: var(), calc(), color-mix(), relative syntax
  const [, name, body] = fn;
  if (/\bfrom\b/.test(body)) return null;
  const args = splitColorFunctionArgs(body);
  if (!args) return null;
  const alpha = parseAlpha(args.alpha);
  if (alpha === null) return null;
  const [c0, c1, c2] = args.channels.map(parseComponent);

  if (name === 'rgb' || name === 'rgba') {
    if (args.channels.length !== 3 || !c0 || !c1 || !c2) return null;
    const ch = [c0, c1, c2].map((c) => scaled(c, 255));
    if (ch.some((v) => v === null)) return null;
    return { r: toByte(ch[0] / 255), g: toByte(ch[1] / 255), b: toByte(ch[2] / 255), a: alpha };
  }
  if (name === 'hsl' || name === 'hsla') {
    if (args.channels.length !== 3) return null;
    const h = hueDegrees(c0), s = scaled(c1, 100), l = scaled(c2, 100);
    if (h === null || s === null || l === null) return null;
    if (args.legacy && (c1.unit !== '%' || c2.unit !== '%')) return null;
    return hslToRgb(h, s / 100, l / 100, alpha);
  }
  if (name === 'hwb') {
    if (args.channels.length !== 3 || args.legacy) return null;
    const h = hueDegrees(c0), w = scaled(c1, 100), bl = scaled(c2, 100);
    if (h === null || w === null || bl === null) return null;
    let white = clamp01(w / 100), black = clamp01(bl / 100);
    if (white + black >= 1) {
      const gray = white / (white + black);
      return { r: toByte(gray), g: toByte(gray), b: toByte(gray), a: alpha };
    }
    const base = hslToRgb(h, 1, 0.5, alpha);
    const mix = (v) => toByte((v / 255) * (1 - white - black) + white);
    return { r: mix(base.r), g: mix(base.g), b: mix(base.b), a: alpha };
  }
  if (name === 'lab' || name === 'lch' || name === 'oklab' || name === 'oklch') {
    if (args.channels.length !== 3 || args.legacy || !c0 || !c1 || !c2) return null;
    const ok = name.startsWith('ok');
    const L = scaled(c0, ok ? 1 : 100);
    if (L === null) return null;
    if (name.endsWith('lab')) {
      const A = scaled(c1, ok ? 0.4 : 125), B = scaled(c2, ok ? 0.4 : 125);
      if (A === null || B === null) return null;
      return ok ? oklabToRgb(L, A, B, alpha) : labToRgb(L, A, B, alpha);
    }
    const C = scaled(c1, ok ? 0.4 : 150), H = hueDegrees(c2);
    if (C === null || H === null) return null;
    const rad = (H * Math.PI) / 180;
    const A = C * Math.cos(rad), B = C * Math.sin(rad);
    return ok ? oklabToRgb(L, A, B, alpha) : labToRgb(L, A, B, alpha);
  }
  if (name === 'color') {
    const [space, ...rest] = args.channels;
    if (args.legacy || rest.length !== 3) return null;
    const vals = rest.map((r) => scaled(parseComponent(r), 1));
    if (vals.some((v) => v === null)) return null;
    if (space === 'srgb') return fromLinearSrgb(vals.map(srgbDecode), alpha);
    if (space === 'srgb-linear') return fromLinearSrgb(vals, alpha);
    if (space === 'display-p3') {
      return fromLinearSrgb(mul3(XYZ_D65_TO_LINEAR_SRGB, mul3(LINEAR_P3_TO_XYZ_D65, vals.map(srgbDecode))), alpha);
    }
    return null;
  }
  return null;
}

/** True when a raw CSS value is a concrete, parseable color. */
function isCssColor(value) {
  return parseCssColor(value) !== null;
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function parseGradientColors(bgImage) {
  if (!bgImage || !bgImage.includes('gradient')) return [];
  const colors = [];
  for (const m of bgImage.matchAll(/rgba?\([^)]+\)/g)) {
    const c = parseRgb(m[0]);
    if (c) colors.push(c);
  }
  for (const m of bgImage.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1];
    if (h.length === 6) {
      colors.push({ r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 });
    } else {
      colors.push({ r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 });
    }
  }
  return colors;
}

function hasChroma(c, threshold = 30) {
  if (!c) return false;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) >= threshold;
}

function getHue(c) {
  if (!c) return 0;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

function colorToHex(c) {
  if (!c) return '?';
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export {
  NAMED_COLORS,
  parseCssColor,
  isCssColor,
  isNeutralColor,
  parseRgb,
  relativeLuminance,
  contrastRatio,
  parseGradientColors,
  hasChroma,
  getHue,
  colorToHex,
};
