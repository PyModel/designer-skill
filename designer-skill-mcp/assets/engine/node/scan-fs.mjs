// The scan's only file reader. Every byte the engine analyzes — selected
// files, linked stylesheets, DESIGN.md — passes through here: confined to the
// project root, regular files only (FIFOs/devices/sockets are refused before
// any read), size-capped per file and in total, and hashed into evidence.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const OPEN_FLAGS = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);

class ScanError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    if (details) this.details = details;
  }
}

function isWithin(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function createScanFs({ root: rootInput, webRoot: webRootInput, maxFileBytes, maxTotalBytes }) {
  // Canonical roots, so containment compares realpaths on both sides.
  const root = fs.realpathSync(rootInput);
  const webRoot = webRootInput ? fs.realpathSync(webRootInput) : root;
  let totalBytes = 0;
  const reads = new Map(); // realpath -> { path, sha256, role, bytes, text }

  function charge(bytes, rel) {
    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      throw new ScanError('SCAN_LIMIT', `Scan exceeds ${maxTotalBytes} total bytes at ${rel}. Narrow the target.`,
        { bound: 'totalBytes', limit: maxTotalBytes, observed: totalBytes, path: rel });
    }
  }

  /** { ok: true, text, path, sha256, bytes } | { ok: false, code, reason } */
  function read(absPath, role) {
    let real;
    try {
      real = fs.realpathSync(absPath);
    } catch (error) {
      return { ok: false, code: 'NOT_FOUND', reason: error.code === 'ENOENT' ? 'file not found' : `unreadable (${error.code})` };
    }
    if (!isWithin(root, real)) return { ok: false, code: 'SCOPE_VIOLATION', reason: 'outside the project root' };
    const rel = path.relative(root, real).split(path.sep).join('/');
    const cached = reads.get(real);
    if (cached) return { ok: true, text: cached.text, path: cached.path, sha256: cached.sha256, bytes: cached.bytes };
    let fd;
    try {
      fd = fs.openSync(real, OPEN_FLAGS);
    } catch (error) {
      return { ok: false, code: 'UNREADABLE', reason: `unreadable (${error.code})` };
    }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return { ok: false, code: 'NOT_REGULAR_FILE', reason: 'not a regular file' };
      if (stat.size > maxFileBytes) {
        return { ok: false, code: 'SIZE_LIMIT', reason: `larger than ${maxFileBytes} bytes` };
      }
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const n = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (n === 0) break;
        length += n;
      }
      if (length > stat.size) return { ok: false, code: 'CONCURRENT_CHANGE', reason: 'file grew while being read' };
      const bytes = buffer.subarray(0, length);
      charge(length, rel);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const entry = { path: rel, sha256, role, bytes: length, binary: isBinary(bytes), text: bytes.toString('utf8') };
      reads.set(real, entry);
      return { ok: true, text: entry.text, path: rel, sha256, bytes: length, binary: entry.binary };
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Resolve a <link href> the way a static web server would. */
  function readStylesheet(href, fromRel) {
    const raw = String(href || '').trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
      return { ok: false, reason: 'remote or non-file stylesheet is not fetched' };
    }
    let clean;
    try {
      clean = decodeURIComponent(raw.split(/[?#]/)[0]);
    } catch {
      return { ok: false, reason: 'href is not valid percent-encoding' };
    }
    if (!clean) return { ok: false, reason: 'empty href' };
    const abs = clean.startsWith('/')
      ? path.join(webRoot, clean)
      : path.resolve(path.dirname(path.join(root, fromRel)), clean);
    if (!isWithin(root, abs)) return { ok: false, reason: 'outside the project root' };
    const result = read(abs, 'linked-stylesheet');
    return result.ok ? { ok: true, css: result.text, path: result.path } : { ok: false, reason: result.reason };
  }

  function evidence() {
    return [...reads.values()].map(({ path: p, sha256, role }) => ({ path: p, sha256, role }));
  }

  return { read, readStylesheet, evidence, get totalBytes() { return totalBytes; } };
}

// NUL bytes, or mostly-undecodable text, mean the file is not source code.
function isBinary(bytes) {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return true;
  const text = sample.toString('utf8');
  let replacement = 0;
  for (const ch of text) if (ch === '�') replacement++;
  return text.length > 0 && replacement / text.length > 0.1;
}

export { ScanError, createScanFs, isWithin };
