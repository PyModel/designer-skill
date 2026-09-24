#!/usr/bin/env node
// Version single source of truth: designer-skill-mcp/package.json.
//   node scripts/versions.mjs check          exit 1 listing every drifted file
//   node scripts/versions.mjs sync <x.y.z>   write <x.y.z> everywhere (package.json included)
// Pins use one self-matching form, `@pymodel/designer-skill-mcp@x.y.z`, so a
// sync can never write a string its own check or next sync fails to match.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'designer-skill-mcp/package.json';
const PKG_NAME = '@pymodel/designer-skill-mcp';
const SEMVER = /^\d+\.\d+\.\d+$/;
const PIN_RE = /@pymodel\/designer-skill-mcp@(\d+\.\d+\.\d+)/g;
const REGISTRY_DESCRIPTION_MAX = 100;

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const writeJson = (rel, value) => writeFileSync(join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`);
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// [file, read(json) → version(s), write(json, v)]
const JSON_TARGETS = [
  [PKG, (j) => [j.version], (j, v) => { j.version = v; }],
  ['designer-skill-mcp/package-lock.json', (j) => [j.version, j.packages?.['']?.version],
    (j, v) => { j.version = v; if (j.packages?.['']) j.packages[''].version = v; }],
  ['designer-skill-mcp/server.json', (j) => [j.version, ...j.packages.map((p) => p.version)],
    (j, v) => { j.version = v; for (const p of j.packages) p.version = v; }],
  ['.claude-plugin/plugin.json', (j) => [j.version], (j, v) => { j.version = v; }],
  ['.codex-plugin/plugin.json', (j) => [j.version], (j, v) => { j.version = v; }],
  ['.cursor-plugin/plugin.json', (j) => [j.version], (j, v) => { j.version = v; }],
];
// Files that must pin the exact release (at least one pin each).
const PIN_TARGETS = ['mcp.json', 'README.md', 'commands/designer-setup.md'];

function check() {
  const expected = readJson(PKG).version;
  const problems = [];
  if (!SEMVER.test(expected)) problems.push(`${PKG}: version "${expected}" is not x.y.z`);
  for (const [file, get] of JSON_TARGETS) {
    for (const found of get(readJson(file))) if (found !== expected) problems.push(`${file}: ${found} ≠ ${expected}`);
  }
  for (const file of PIN_TARGETS) {
    const pins = [...readText(file).matchAll(PIN_RE)].map((m) => m[1]);
    if (!pins.length) problems.push(`${file}: no ${PKG_NAME}@x.y.z pin`);
    for (const pin of pins) if (pin !== expected) problems.push(`${file}: pin @${pin} ≠ ${expected}`);
  }
  const server = readJson('designer-skill-mcp/server.json');
  if (server.description.length > REGISTRY_DESCRIPTION_MAX) {
    problems.push(`designer-skill-mcp/server.json: description is ${server.description.length} chars (registry max ${REGISTRY_DESCRIPTION_MAX})`);
  }
  if (server.packages.some((p) => p.identifier !== PKG_NAME)) problems.push(`designer-skill-mcp/server.json: package identifier ≠ ${PKG_NAME}`);
  return { expected, problems };
}

function sync(version) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" is not x.y.z`);
  for (const [file, , set] of JSON_TARGETS) {
    const json = readJson(file);
    set(json, version);
    writeJson(file, json);
  }
  for (const file of PIN_TARGETS) {
    const text = readText(file);
    const next = text.replace(PIN_RE, `${PKG_NAME}@${version}`);
    if (next === text && ![...text.matchAll(PIN_RE)].length) throw new Error(`${file}: no ${PKG_NAME}@x.y.z pin to update`);
    writeFileSync(join(ROOT, file), next);
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'sync') {
  sync(arg);
  console.log(`synced ${arg}`);
} else if (mode === 'check') {
  const { expected, problems } = check();
  if (problems.length) {
    console.error(`Version drift (source of truth ${PKG} = ${expected}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`versions consistent at ${expected}`);
} else {
  console.error('usage: versions.mjs check | sync <x.y.z>');
  process.exit(2);
}
