// Smoke-test the actual packed artifact outside the checkout; no dev-source fallback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'designer-packed-'));
try {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
    cwd, encoding: 'utf8', timeout: 60_000,
  }));
  assert.equal(packed.length, 1);
  const name = packed[0].filename;
  assert.equal(typeof name, 'string');
  assert(!isAbsolute(name) && !name.includes('/') && !name.includes('\\'));
  const archive = join(temporary, name);
  execFileSync('tar', ['-xzf', archive, '-C', temporary], { timeout: 30_000 });
  const root = join(temporary, 'package');
  const skillRoot = join(root, 'assets', 'skill');
  const manifest = JSON.parse(readFileSync(join(skillRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.algorithm, 'sha256');
  for (const [path, digest] of Object.entries(manifest.files)) {
    assert(!isAbsolute(path) && !path.split('/').includes('..'));
    assert.equal(createHash('sha256').update(readFileSync(join(skillRoot, path))).digest('hex'), digest, path);
  }
  for (const file of ['input.schema.json', 'run-report.schema.json']) {
    const schema = JSON.parse(readFileSync(join(skillRoot, 'schemas', file), 'utf8'));
    assert.equal(schema.type, 'object'); assert(schema.$schema);
  }
  const skill = await import(pathToFileURL(join(root, 'dist', 'skill.js')).href);
  assert(skill.getSkillRouter().includes('Overview & Execution Contract'));
  for (const name of skill.REFERENCE_NAMES) assert(skill.getReferenceDoc(name).trim().length > 0, name);
  const commands = await import(pathToFileURL(join(root, 'dist', 'commands.js')).href);
  const listed = commands.listCommands();
  assert(listed.some((command) => command.verb === 'css'));
  for (const command of listed) for (const name of commands.getCommandReads(command.verb)) assert(skill.isReferenceName(name));
  console.log(`Packed artifact passed: ${listed.length} commands, ${skill.REFERENCE_NAMES.length} references, 2 schemas, content hashes.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
