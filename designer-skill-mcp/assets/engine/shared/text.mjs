// Linear-time text helpers. Every scan here is O(n) in the input: detectors
// run on untrusted files up to the per-file byte cap, so no helper may use a
// lazy/backtracking span whose cost grows with the number of openers.

const NAME_CHAR = /[a-z0-9-]/;

function findOpenTag(lower, name, from) {
  const open = `<${name}`;
  let start = lower.indexOf(open, from);
  while (start !== -1 && NAME_CHAR.test(lower[start + open.length] || '')) {
    start = lower.indexOf(open, start + 1);
  }
  return start;
}

/** Replace `<name …>…</name>` blocks (case-insensitive). An unterminated
 *  block consumes the rest of the input, as an HTML parser would. */
function stripElementBlocks(text, name, replacement = ' ') {
  const lower = text.toLowerCase();
  const close = `</${name}`;
  let out = '';
  let index = 0;
  for (;;) {
    const start = findOpenTag(lower, name, index);
    if (start === -1) return out + text.slice(index);
    out += text.slice(index, start) + replacement;
    const openEnd = lower.indexOf('>', start);
    const closeStart = openEnd === -1 ? -1 : lower.indexOf(close, openEnd + 1);
    const closeEnd = closeStart === -1 ? -1 : lower.indexOf('>', closeStart);
    if (closeEnd === -1) return out;
    index = closeEnd + 1;
  }
}

/** Replace `<!-- … -->` comments; an unterminated comment runs to the end. */
function stripHtmlComments(text, replacement = ' ') {
  let out = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf('<!--', index);
    if (start === -1) return out + text.slice(index);
    out += text.slice(index, start) + replacement;
    const end = text.indexOf('-->', start + 4);
    if (end === -1) return out;
    index = end + 3;
  }
}

/** Replace every `<…>` tag with `replacement`; a `<` with no closing `>` is text. */
function stripTags(text, replacement = ' ') {
  let out = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf('<', index);
    if (start === -1) return out + text.slice(index);
    const end = text.indexOf('>', start + 1);
    if (end === -1) return out + text.slice(index);
    out += text.slice(index, start) + replacement;
    index = end + 1;
  }
}

/** Blank CSS/JS block comments while preserving newlines (line numbers stay valid). */
function blankBlockComments(text) {
  let out = '';
  let index = 0;
  for (;;) {
    const start = text.indexOf('/*', index);
    if (start === -1) return out + text.slice(index);
    const end = text.indexOf('*/', start + 2);
    const stop = end === -1 ? text.length : end + 2;
    out += text.slice(index, start) + text.slice(start, stop).replace(/[^\n]/g, ' ');
    if (end === -1) return out;
    index = stop;
  }
}

/** 1-based line lookup for character offsets (binary search). */
function makeLineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return (offset) => {
    if (typeof offset !== 'number' || offset < 0) return undefined;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export { stripElementBlocks, stripHtmlComments, stripTags, blankBlockComments, makeLineIndex };
