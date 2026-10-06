// skills/ux-designer/references is the sole authoring home. The standalone
// designer skill receives generated copies; contributors never edit both trees.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function syncUxReferences(source = join(repo, 'skills/ux-designer/references'), target = join(repo, 'skills/designer-skill/reference/ux')) {
  const src = resolve(source), dest = resolve(target);
  const rel = relative(src, dest);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('UX mirror must be outside its authoring directory.');
  if (!lstatSync(src).isDirectory() || lstatSync(src).isSymbolicLink()) throw new Error('UX source must be a real directory.');
  if (existsSync(dest) && (!lstatSync(dest).isDirectory() || lstatSync(dest).isSymbolicLink())) throw new Error('UX mirror must be a real directory.');
  const entries = readdirSync(src, { withFileTypes: true });
  if (!entries.length) throw new Error('UX source must contain regular Markdown files; directory is empty.');
  const invalidSource = entries.find(e => !e.isFile() || !e.name.endsWith('.md'));
  if (invalidSource) throw new Error(`UX source must contain only regular Markdown files: ${invalidSource.name}.`);
  const expected = new Map(entries.map(e => [e.name, readFileSync(join(src, e.name))]));
  const existing = existsSync(dest) ? readdirSync(dest, { withFileTypes: true }) : [];
  const invalidMirror = existing.find(e => !e.isFile() || !e.name.endsWith('.md'));
  if (invalidMirror) throw new Error(`Unexpected mirror entry ${invalidMirror.name}; refusing to overwrite user-owned content.`);
  mkdirSync(dest, { recursive: true });
  let copied = 0, removed = 0;
  for (const [name, bytes] of expected) {
    const path = join(dest, name);
    if (existsSync(path) && readFileSync(path).equals(bytes)) continue;
    const temporary = join(dest, `.sync-${randomUUID()}`);
    try {
      writeFileSync(temporary, bytes, { flag: 'wx' });
      renameSync(temporary, path);
      copied++;
    } finally { rmSync(temporary, { force: true }); }
  }
  for (const entry of existing) if (!expected.has(entry.name)) { rmSync(join(dest, entry.name)); removed++; }
  return { copied, removed, total: expected.size };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(syncUxReferences()));
