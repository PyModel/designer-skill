// Scan executor. Runs inside a worker thread so the caller can enforce a
// wall-clock deadline and a heap limit: a pathological input can at worst
// time out or exhaust this worker, never block or crash the MCP server.
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { detectHtml } from '../engines/static-html/detect-html.mjs';
import { detectText } from '../engines/regex/detect-text.mjs';
import { loadDesignSystem } from '../design-system.mjs';
import { filterDetectionFindings } from '../lib/designer-skill-config.mjs';
import { buildImportGraph, HTML_EXTENSIONS } from './file-system.mjs';
import { ScanError, createScanFs } from './scan-fs.mjs';

async function runScan(job) {
  const { root, files, policy, design, limits } = job;
  const scanFs = createScanFs({
    root,
    webRoot: job.webRoot || root,
    maxFileBytes: limits.maxFileBytes,
    maxTotalBytes: limits.maxTotalBytes,
  });

  const designResult = policy.designSystemEnabled && design
    ? loadDesignSystem({
      markdown: design.markdownPath === undefined ? undefined : readDesignDocument(scanFs, root, design.markdownPath),
      sidecarJson: design.sidecarPath === undefined ? undefined : readDesignDocument(scanFs, root, design.sidecarPath),
    })
    : { status: policy.designSystemEnabled ? 'absent' : 'disabled', designSystem: null };

  const contents = new Map();
  const scanned = [];
  let unsupportedBinary = 0;
  for (const rel of files) {
    const result = scanFs.read(path.join(root, rel), 'selected');
    if (!result.ok) {
      throw new ScanError(result.code === 'SIZE_LIMIT' ? 'SCAN_LIMIT' : result.code === 'SCOPE_VIOLATION' ? 'SCOPE_VIOLATION' : 'CONCURRENT_CHANGE',
        `Selected input ${rel} could not be scanned: ${result.reason}.`, { path: rel, reason: result.reason });
    }
    if (result.binary) { unsupportedBinary++; continue; }
    contents.set(path.join(root, rel), result.text);
    scanned.push({ rel, bytes: result.bytes, text: result.text });
  }

  const graph = buildImportGraph(contents);
  const importers = new Map();
  for (const [importer, imports] of graph) {
    for (const imported of imports) {
      const rel = path.relative(root, importer).split(path.sep).join('/');
      importers.set(imported, [...(importers.get(imported) ?? []), rel]);
    }
  }

  const options = {
    readStylesheet: scanFs.readStylesheet,
    ...(designResult.designSystem ? { designSystem: designResult.designSystem } : {}),
  };
  const findings = [];
  const fileMeta = [];
  let bytesScanned = 0;
  for (const file of scanned) {
    parentPort?.postMessage({ type: 'progress', file: file.rel });
    const ext = path.extname(file.rel).toLowerCase();
    const result = HTML_EXTENSIONS.has(ext)
      ? await detectHtml(file.rel, { ...options, content: file.text })
      : detectText(file.text, file.rel, options);
    const importedBy = importers.get(path.join(root, file.rel));
    for (const finding of result.findings) {
      findings.push(importedBy ? { ...finding, importedBy } : finding);
    }
    if (findings.length > limits.maxFindings) {
      throw new ScanError('SCAN_LIMIT', `Scan exceeds ${limits.maxFindings} findings at ${file.rel}. Narrow the target.`,
        { bound: 'findings', limit: limits.maxFindings, observed: findings.length, path: file.rel });
    }
    fileMeta.push({ path: file.rel, engine: result.engine, fullPage: result.fullPage, gaps: result.gaps });
    bytesScanned += file.bytes;
  }

  return {
    findings: filterDetectionFindings(findings, policy),
    fileMeta,
    files: scanFs.evidence(),
    bytesScanned,
    unsupportedBinary,
    designSystem: { status: designResult.status, ...(designResult.reason ? { reason: designResult.reason } : {}) },
  };
}

function readDesignDocument(scanFs, root, rel) {
  const result = scanFs.read(path.join(root, rel), 'design-system');
  if (!result.ok) {
    throw new ScanError(result.code === 'SCOPE_VIOLATION' ? 'SCOPE_VIOLATION' : 'CONTEXT_INVALID',
      `Design document ${rel} could not be read: ${result.reason}.`, { path: rel, reason: result.reason });
  }
  return result.text;
}

if (parentPort && workerData?.job) {
  runScan(workerData.job).then(
    (result) => parentPort.postMessage({ type: 'result', result }),
    (error) => parentPort.postMessage({
      type: 'error',
      error: { code: error?.code || 'OPERATION_FAILED', message: error?.message || String(error), details: error?.details },
    }),
  );
}

export { runScan };
