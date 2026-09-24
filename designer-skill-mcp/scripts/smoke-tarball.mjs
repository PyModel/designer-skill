// Clean-install smoke test of the exact packed artifact: npm pack → install the
// tarball with production dependencies only into an empty directory → run the
// installed bin over stdio → exercise every tool family through a real client.
// Nothing resolves from this checkout, so a missing file or undeclared
// dependency fails here instead of on users' machines.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const temporary = mkdtempSync(join(tmpdir(), 'designer-smoke-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'inherit'] });

let client;
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], pkgDir));
  assert(packed && !isAbsolute(packed.filename) && !/[\\/]/.test(packed.filename), 'npm pack produced one local tarball');
  const shipped = new Set(packed.files.map((f) => f.path));
  for (const required of ['dist/index.js', 'assets/engine/node/scan-worker.mjs', 'assets/engine/registry/antipatterns.mjs',
    'assets/skill/manifest.json', 'assets/ux-designer/manifest.json']) {
    assert(shipped.has(required), `tarball is missing ${required}`);
  }
  for (const path of shipped) assert(!/^(src|test|scripts)\//.test(path), `tarball ships dev file ${path}`);

  const app = join(temporary, 'app');
  const project = join(temporary, 'project');
  for (const dir of [app, project]) execFileSync('mkdir', ['-p', dir]);
  writeFileSync(join(app, 'package.json'), '{"private":true}');
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', join(temporary, packed.filename)], app);
  const installed = join(app, 'node_modules', ...pkg.name.split('/'));

  for (const bundle of ['skill', 'ux-designer']) {
    const root = join(installed, 'assets', bundle);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    for (const [path, digest] of Object.entries(manifest.files)) {
      assert(!isAbsolute(path) && !path.split('/').includes('..'), path);
      assert.equal(createHash('sha256').update(readFileSync(join(root, path))).digest('hex'), digest, `${bundle}/${path}`);
    }
  }

  writeFileSync(join(project, 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body>\n<p style="color:#777;background:#888">Low contrast</p>\n</body></html>\n');

  client = new Client({ name: 'smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(installed, pkg.bin['designer-skill-mcp']), '--root', project, '--no-update-notifier'],
    cwd: app,
    stderr: 'inherit',
  }));

  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.equal(tools.length, 14, `expected 14 tools, got ${tools.length}: ${tools.join(', ')}`);

  const gate = await client.callTool({ name: 'review_and_gate', arguments: { cwd: project, target: '.' } });
  assert.notEqual(gate.isError, true, JSON.stringify(gate.content));
  assert.equal(gate.structuredContent.schemaVersion, 3);
  assert.equal(gate.structuredContent.code, 'STATIC_FINDINGS');
  const finding = gate.structuredContent.findings.find((f) => f.antipattern === 'low-contrast');
  assert(finding && finding.line === 2, 'static-html engine ran from the installed tarball (low-contrast at line 2)');
  assert.equal(gate.structuredContent.ruleCoverage.find((c) => c.rule === 'low-contrast').status, 'RAN');
  const scan = await client.callTool({ name: 'detect_antipatterns', arguments: { cwd: project, target: '.' } });
  assert.equal(scan.structuredContent.scannedFiles[0].engine, 'static-html');

  const outside = await client.callTool({ name: 'load_project_context', arguments: { cwd: app } });
  assert.equal(outside.isError, true, 'cwd outside --root is refused');

  const refs = (await client.listResources()).resources.filter((r) => r.uri.startsWith('designer://reference/'));
  assert(refs.length >= 40, `expected every reference as a resource, got ${refs.length}`);
  for (const { uri } of refs) {
    const { contents } = await client.readResource({ uri });
    assert(contents[0].text.trim().length > 0, uri);
  }

  const palette = await client.callTool({ name: 'get_palette_seed', arguments: { from: 'smoke' } });
  assert.notEqual(palette.isError, true, 'palette script loads from the installed tarball');
  const unknownSeed = await client.callTool({ name: 'get_palette_seed', arguments: { id: 'no-such-seed' } });
  assert.equal(unknownSeed.isError, true);

  for (const verb of ['build', 'css', 'review']) {
    const help = await client.callTool({ name: 'get_command', arguments: { verb } });
    assert.notEqual(help.isError, true, verb);
  }
  console.log(`Clean-install smoke passed: ${packed.filename}, ${tools.length} tools, ${refs.length} references, static-html gate.`);
} finally {
  await client?.close();
  rmSync(temporary, { recursive: true, force: true });
}
