import { getAntipattern } from './registry/antipatterns.mjs';

function getAP(id) {
  const ap = getAntipattern(id);
  if (!ap) throw new Error(`Detector emitted unregistered rule "${id}".`);
  return ap;
}

// `line` is 1-based when the source position is known and absent otherwise.
function finding(id, filePath, snippet, line) {
  const ap = getAP(id);
  const out = { antipattern: id, name: ap.name, description: ap.description, severity: ap.severity || 'warning', file: filePath, snippet };
  if (Number.isInteger(line) && line > 0) out.line = line;
  return out;
}

export { getAP, finding };
