import path from 'node:path';

// Directories never descended: dependency trees, VCS metadata, build output,
// virtualenvs and caches. Ignore globs can prune more (see the scan walker).
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', '.turbo', '.vercel', '.netlify', '.cache', '.parcel-cache',
  'coverage', '.nyc_output', 'target', 'vendor', 'bower_components', 'jspm_packages',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.idea',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.jsx', '.tsx', '.js', '.ts',
  '.vue', '.svelte', '.astro',
]);

const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// ---------------------------------------------------------------------------
// Import graph (multi-file awareness)
// ---------------------------------------------------------------------------

function resolveImport(specifier, fromDir, fileSet) {
  if (!/^[./]/.test(specifier)) return null; // skip bare specifiers
  const base = path.resolve(fromDir, specifier);
  if (fileSet.has(base)) return base;
  for (const ext of SCANNABLE_EXTENSIONS) {
    const withExt = base + ext;
    if (fileSet.has(withExt)) return withExt;
  }
  // index file convention
  for (const ext of SCANNABLE_EXTENSIONS) {
    const indexFile = path.join(base, 'index' + ext);
    if (fileSet.has(indexFile)) return indexFile;
  }
  return null;
}

// Linear-time specifier patterns (no span can cross a newline or backtrack
// over the file): from-clauses (imports and re-exports), bare imports,
// `import('…')`, CSS `@import`, SCSS `@use`/`@forward`.
const ES_SPECIFIER_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]?([^'");\s]+)['"]?\s*\)?/g;
const SCSS_USE_RE = /@(?:use|forward)\s+['"]([^'"\n]+)['"]/g;

/** `contents`: Map<absolute path, file text> for the selected files. */
function buildImportGraph(contents) {
  const fileSet = new Set(contents.keys());
  const graph = new Map();
  for (const [file, content] of contents) {
    const dir = path.dirname(file);
    const imports = new Set();
    for (const re of [ES_SPECIFIER_RE, CSS_IMPORT_RE, SCSS_USE_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        const resolved = resolveImport(m[1], dir, fileSet);
        if (resolved && resolved !== file) imports.add(resolved);
      }
    }
    graph.set(file, imports);
  }
  return graph;
}

export {
  SKIP_DIRS,
  SCANNABLE_EXTENSIONS,
  HTML_EXTENSIONS,
  resolveImport,
  buildImportGraph,
};
