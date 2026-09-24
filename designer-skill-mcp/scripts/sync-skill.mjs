// Canonical skill content is copied into the self-contained npm package.
// skills/ is the single source of truth. Every synced assets/ directory must be
// declared in shipped-roots.mjs (the manifest of the shipped surface), so the
// sync step can never produce a bundled directory the package whitelist omits.
import { existsSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHIPPED_DIR_ROOTS } from './shipped-roots.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MODULES = [
  { src: resolve(pkgRoot, '..', 'skills', 'designer-skill'), dest: 'skill', subdirs: ['reference', 'scripts', 'schemas'] },
  { src: resolve(pkgRoot, '..', 'skills', 'ux-designer'), dest: 'ux-designer', subdirs: ['references'] },
];

// npm drops these from a tarball even when `files` whitelists their directory,
// so a manifest listing one would fail every install-time hash check.
const NPM_IGNORED = /^(?:\..*|node_modules|package-lock\.json|npm-debug\.log|npm-shrinkwrap\.json|.*\.orig|CVS|config\.gypi)$/;

function hashDirectory(root, dir, files) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(dir, entry.name);
    if (NPM_IGNORED.test(entry.name)) {
      throw new Error(`${relative(root, path)}: npm never packs this name; rename or remove it from the canonical skill source.`);
    }
    if (entry.isDirectory()) hashDirectory(root, path, files);
    else if (entry.isFile()) {
      const rel = relative(root, path).split('\\').join('/');
      files[rel] = createHash('sha256').update(readFileSync(path)).digest('hex');
    } else {
      throw new Error(`Unsupported packaged entry: ${entry.name}`);
    }
  }
}

for (const { src, dest: destName, subdirs } of MODULES) {
  const shipped = `assets/${destName}`;
  if (!SHIPPED_DIR_ROOTS.includes(shipped)) {
    throw new Error(`${shipped} is synced but missing from SHIPPED_ROOTS; the npm whitelist and the shipped surface would diverge.`);
  }

  if (!existsSync(join(src, 'SKILL.md'))) {
    throw new Error(`Canonical skill source is missing (${src}). Refusing to publish stale bundled assets.`);
  }
  for (const dir of subdirs) {
    if (!existsSync(join(src, dir))) throw new Error(`Missing canonical skill directory: ${join(src, dir)}`);
  }

  // The target is a fixed generated, gitignored directory, never a caller-supplied path.
  const dest = join(pkgRoot, 'assets', destName);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(src, 'SKILL.md'), join(dest, 'SKILL.md'));
  for (const dir of subdirs) cpSync(join(src, dir), join(dest, dir), { recursive: true });

  const files = {};
  hashDirectory(dest, dest, files);
  writeFileSync(join(dest, 'manifest.json'), JSON.stringify({ schemaVersion: 1, algorithm: 'sha256', files }, null, 2) + '\n');
  console.log(`[sync-skill] bundled ${destName}: ${Object.keys(files).length} files with content hashes`);
}
