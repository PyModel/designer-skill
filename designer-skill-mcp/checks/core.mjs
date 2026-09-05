// Dependency-free regression tests against compiled production modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { selectScanFiles, validateConfigFiles } from '../dist/scope.js';
import { evaluateGate, validateRegistry } from '../dist/gate.js';
import { dispatchIntent } from '../dist/dispatch.js';
import { listCommands, getCommandReads, resolveCommandVerb, validateCommandMetadata } from '../dist/commands.js';
import { loadProjectContext, formatProjectContext } from '../dist/context.js';
import { commitDesignDirection } from '../dist/direction.js';
import { getSkillRouter } from '../dist/skill.js';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'designer-regression-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const registry = [
  { id: 'overused-font', category: 'slop' }, { id: 'low-contrast', category: 'quality' },
  { id: 'broken-image', category: 'quality' },
];
const finding = (id) => ({ file: 'app.css', antipattern: id, snippet: 'sample', description: 'test fixture' });
const report = (findings = [], scannedFiles = 1) => ({
  target: '.', findings, files: [], ignoredRules: [], ignoredValues: 0,
  coverage: { candidateFiles: scannedFiles, scannedFiles, ignoredFiles: 0, unsupportedFiles: 0, excludedDirectories: 0, bytesScanned: scannedFiles * 10 },
});

test('empty scan fails instead of returning a perfect score', () => {
  const result = evaluateGate(report([], 0), registry);
  assert.equal(result.staticStatus, 'FAIL'); assert.equal(result.code, 'NO_SCAN_COVERAGE');
  assert.notEqual(result.status, 'PASS');
});
test('static success never claims UI PASS', () => {
  const result = evaluateGate(report(), registry);
  assert.equal(result.staticStatus, 'PASS'); assert.equal(result.status, 'NOT_VERIFIED');
  assert.equal(result.uiReadiness, 'NOT_VERIFIED');
  assert.ok(result.checks.slice(1).every((c) => c.status === 'NOT_RUN' && c.producer === null));
});
test('style preferences are advisory unless explicitly adopted', () => {
  const sample = report([finding('overused-font')]);
  assert.equal(evaluateGate(sample, registry).blockingCount, 0);
  assert.equal(evaluateGate(sample, registry, ['overused-font']).blockingCount, 1);
});
test('accessibility findings cannot be offset by style scores', () => {
  assert.equal(evaluateGate(report([finding('low-contrast')]), registry).staticStatus, 'FAIL');
});
test('findings are deduplicated by file, line, rule and snippet', () => {
  const f = finding('broken-image');
  assert.equal(evaluateGate(report([f, { ...f }]), registry).findingCount, 1);
});
test('missing, malformed and duplicate registries fail closed', () => {
  for (const value of [undefined, {}, [], [{ id: '', category: 'slop' }], [registry[0], registry[0]]]) {
    assert.throws(() => validateRegistry(value), { code: 'REGISTRY_INVALID' });
  }
});
test('unknown rule emissions and unknown project policy fail closed', () => {
  assert.throws(() => evaluateGate(report([finding('unknown')]), registry), { code: 'REGISTRY_INVALID' });
  assert.throws(() => evaluateGate(report(), registry, ['unknown']), { code: 'REGISTRY_INVALID' });
});
test('ignored-only selection records zero coverage', (t) => {
  const root = workspace(t); writeFileSync(join(root, 'app.css'), 'body {}');
  const selected = selectScanFiles(root, '.', new Set(['.css']), new Set(), () => true);
  assert.equal(selected.coverage.candidateFiles, 1); assert.equal(selected.coverage.ignoredFiles, 1);
  assert.equal(selected.files.length, 0);
  assert.equal(evaluateGate({ ...report(), coverage: selected.coverage }, registry).code, 'NO_SCAN_COVERAGE');
});
test('unsupported files are visible but never scanned as code', (t) => {
  const root = workspace(t); writeFileSync(join(root, 'notes.md'), 'Notes');
  const selected = selectScanFiles(root, 'notes.md', new Set(['.css']), new Set(), () => false);
  assert.equal(selected.coverage.unsupportedFiles, 1); assert.equal(selected.files.length, 0);
});
test('traversal and symlink escapes fail before reading content', (t) => {
  const root = workspace(t), other = workspace(t); writeFileSync(join(other, 'private.css'), 'secret');
  assert.throws(() => selectScanFiles(root, join(other, 'private.css'), new Set(['.css']), new Set(), () => false), { code: 'SCOPE_VIOLATION' });
  symlinkSync(join(other, 'private.css'), join(root, 'escape.css'));
  assert.throws(() => selectScanFiles(root, '.', new Set(['.css']), new Set(), () => false), { code: 'SCOPE_VIOLATION' });
});
test('oversized source fails rather than silently truncating', (t) => {
  const root = workspace(t); writeFileSync(join(root, 'large.css'), Buffer.alloc(2 * 1024 * 1024 + 1));
  assert.throws(() => selectScanFiles(root, '.', new Set(['.css']), new Set(), () => false), { code: 'SCAN_LIMIT' });
});
test('standard excluded directories are counted', (t) => {
  const root = workspace(t); mkdirSync(join(root, 'node_modules')); writeFileSync(join(root, 'a.css'), 'a {}');
  const selected = selectScanFiles(root, '.', new Set(['.css']), new Set(['node_modules']), () => false);
  assert.equal(selected.coverage.excludedDirectories, 1); assert.equal(selected.files.length, 1);
});
test('DESIGN.md survives missing PRODUCT.md', (t) => {
  const root = workspace(t); writeFileSync(join(root, 'DESIGN.md'), 'Approved blue identity');
  const ctx = loadProjectContext(root);
  assert.equal(ctx.hasDesign, true); assert.equal(ctx.hasProduct, false);
  assert.match(formatProjectContext(ctx), /Approved blue identity/); assert.match(formatProjectContext(ctx), /NO_PRODUCT_MD/);
  assert.doesNotMatch(formatProjectContext(ctx), /Stop the current UI task/);
});
test('project documents resolve independently across directories', (t) => {
  const root = workspace(t); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'PRODUCT.md'), '## Register\nproduct\n'); writeFileSync(join(root, 'docs/DESIGN.md'), 'Identity');
  const ctx = loadProjectContext(root);
  assert.equal(ctx.register, 'product'); assert.equal(ctx.designPath, join('docs', 'DESIGN.md'));
});
test('context symlink cannot escape approved project root', (t) => {
  const root = workspace(t), other = workspace(t); writeFileSync(join(other, 'context'), 'Private');
  symlinkSync(join(other, 'context'), join(root, 'DESIGN.md'));
  assert.throws(() => loadProjectContext(root), { code: 'SCOPE_VIOLATION' });
});
test('all commands resolve consistently across discovery, dispatch and reads', () => {
  for (const { verb } of listCommands()) {
    const dispatched = dispatchIntent(verb);
    assert.equal(dispatched.matched[0].verb, verb);
    assert.deepEqual(dispatched.matched[0].files, getCommandReads(verb));
  }
  assert.ok(listCommands().some((c) => c.verb === 'css'));
  assert.equal(resolveCommandVerb(' AUDIT ').canonical, 'check');
});
test('unknown explicit command does not fall back to generic work', () => {
  assert.throws(() => dispatchIntent('/does-not-exist do something'), { code: 'UNKNOWN_COMMAND' });
  assert.throws(() => getCommandReads('toString'), { code: 'UNKNOWN_COMMAND' });
});
test('substring collisions do not activate form or type', () => {
  const verbs = dispatchIntent('Assess this platform prototype').matched.map((m) => m.verb);
  assert.ok(!verbs.includes('form')); assert.ok(!verbs.includes('type'));
});
test('backend-only work is out of scope and loads no references', () => {
  const result = dispatchIntent('Optimize PostgreSQL database performance');
  assert.equal(result.reason, 'out-of-scope'); assert.deepEqual(result.recommendedReads, []);
});
test('negated animation request does not activate motion', () => {
  assert.ok(!dispatchIntent('do not animate').matched.some((m) => m.verb === 'motion'));
});
test('reference loading is bounded and excess references are explicit', () => {
  const result = dispatchIntent('Build a landing page with forms, form validation and typography fonts');
  assert.ok(result.recommendedReads.length <= 4);
  assert.ok(result.deferredReads.every((r) => !result.recommendedReads.includes(r)));
});
test('invalid registry aliases and missing references are rejected', () => {
  const entry = { description: 'Test', argumentHint: '', aliases: [], cues: ['test'], reads: ['design-principles'] };
  assert.throws(() => validateCommandMetadata({ test: { ...entry, aliases: ['test'] } }), { code: 'REGISTRY_INVALID' });
  assert.throws(() => validateCommandMetadata({ test: { ...entry, reads: ['missing'] } }), { code: 'REGISTRY_INVALID' });
});
test('bounded repair can preserve identity without inventing a scene', () => {
  const result = commitDesignDirection({ mode: 'preserve', register: 'product', designRead: 'Repair field alignment in the existing account form.', contextSources: ['src/account.css'] });
  assert.equal(result.status, 'PASS'); assert.equal(result.scope, 'input-validation');
});
test('custom visual language and one appropriate layout are valid', () => {
  const result = commitDesignDirection({ register: 'brand', designRead: 'Design the museum ticketing page for returning visitors.', contextSources: ['PRODUCT.md'], aesthetic: 'museum-wayfinding', typographyDirection: 'Approved single type family', layoutFamilies: ['single-column'], inverseTestPass: false });
  assert.equal(result.status, 'PASS');
});
test('direction input still rejects invalid calibration and absent context', () => {
  const result = commitDesignDirection({ register: 'product', mode: 'preserve', designRead: 'Repair the existing settings form layout.', contextSources: [], designVariance: 11 });
  assert.equal(result.status, 'FAIL'); assert.ok(result.fixes.some((f) => f.includes('contextSources')));
});
test('router follows the five-section contract', () => {
  const skill = getSkillRouter();
  for (const heading of ['1. Overview', '2. Input Schema', '3. Deterministic', '4. Verification', '5. Failure Recovery']) assert.ok(skill.includes(heading));
});

test('zero-byte scans and entirely disabled rule sets do not pass', () => {
  const empty = report(); empty.coverage.bytesScanned = 0;
  assert.equal(evaluateGate(empty, registry).staticStatus, 'FAIL');
  const disabled = report(); disabled.ignoredRules = registry.map((rule) => rule.id);
  assert.equal(evaluateGate(disabled, registry).staticStatus, 'FAIL');
});
test('malformed detector config cannot silently become defaults', (t) => {
  const root = workspace(t); mkdirSync(join(root, '.designer-skill'));
  for (const content of ['{broken', '[]', '{"detector":{"ignoreRules":false}}', '{"detector":{"designSystem":{"enabled":"false"}}}']) {
    writeFileSync(join(root, '.designer-skill/config.json'), content);
    assert.throws(() => validateConfigFiles(root), { code: 'CONFIG_INVALID' });
  }
});
