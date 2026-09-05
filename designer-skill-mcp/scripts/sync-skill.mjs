// Canonical skill content is copied into the self-contained npm package.
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(pkgRoot, '..', 'skills', 'designer-skill');
const dest = join(pkgRoot, 'assets', 'skill');

if (!existsSync(join(src, 'SKILL.md'))) {
  throw new Error('Canonical skill source is missing. Refusing to publish stale bundled assets.');
}
for (const dir of ['reference', 'scripts', 'schemas']) {
  if (!existsSync(join(src, dir))) throw new Error(`Missing canonical skill directory: ${dir}`);
}

// The target is a fixed generated, gitignored directory, never a caller-supplied path.
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(join(src, 'SKILL.md'), join(dest, 'SKILL.md'));
for (const dir of ['reference', 'scripts', 'schemas']) cpSync(join(src, dir), join(dest, dir), { recursive: true });

const files = {};
function hashDirectory(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) hashDirectory(path);
    else if (entry.isFile()) files[relative(dest, path).split('\\').join('/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    else throw new Error(`Unsupported packaged entry: ${entry.name}`);
  }
}
hashDirectory(dest);
writeFileSync(join(dest, 'manifest.json'), JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files }, null, 2) + '\n');
console.log(`[sync-skill] bundled ${Object.keys(files).length} files including schemas and content hashes`);
