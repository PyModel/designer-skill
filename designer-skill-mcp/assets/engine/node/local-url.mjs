// The one definition of "a page on this machine" for the rendered check:
// a loopback http(s) server, or a file inside the project root. Used by the
// server before a check starts and by the browser worker on every navigation.
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** @returns {{ ok: true, url: URL } | { ok: false, code: 'INPUT_INVALID' | 'SCOPE_VIOLATION', message: string }} */
export function localUrl(raw, root) {
  let url;
  try { url = new URL(raw); } catch { return { ok: false, code: 'INPUT_INVALID', message: 'url must be an absolute http(s) or file URL.' }; }
  if (url.protocol === 'file:') {
    let real;
    try { real = realpathSync(fileURLToPath(url)); } catch { return { ok: false, code: 'INPUT_INVALID', message: 'file URL does not exist.' }; }
    if (!isWithin(realpathSync(root), real)) return { ok: false, code: 'SCOPE_VIOLATION', message: 'file URL is outside the project root.' };
    const local = pathToFileURL(real);
    local.search = url.search; local.hash = url.hash; // a hash-routed page is a different state
    return { ok: true, url: local };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !LOOPBACK.has(url.hostname)) {
    return { ok: false, code: 'SCOPE_VIOLATION', message: 'url must be a loopback http(s) address (a local dev server) or a file URL inside the project root.' };
  }
  return { ok: true, url };
}
