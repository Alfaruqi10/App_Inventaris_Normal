import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

async function files(dir, predicate) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target, predicate) : (predicate(entry.name) ? [target] : []);
  }));
  return nested.flat();
}

const root = path.resolve('.');
const checks = [];
const backendRoot = path.join(root, 'src/backend');
for (const source of await files(backendRoot, name => name.endsWith('.gs'))) {
  checks.push({ source, dist: path.join(root, 'dist', path.relative(backendRoot, source)) });
}
for (const source of await files(path.join(root, 'src/frontend'), name => /\.(js|json|html)$/.test(name))) {
  const relative = path.relative(path.join(root, 'src/frontend'), source);
  const topLevelDirs = ['BusinessAnalytics', 'NotificationCenter', 'ProductionCenter', 'RecoveryCenter', 'ai', 'components'];
  if (topLevelDirs.includes(relative.split(path.sep)[0])) checks.push({ source, dist: path.join(root, 'dist', relative) });
}
for (const filename of ['sales-ledger.js', 'sw.js', 'manifest.json', 'appsscript.json']) {
  checks.push({ source: path.join(root, filename), dist: path.join(root, 'dist', filename) });
}

const failures = [];
for (const check of checks) {
  try {
    const [source, dist] = await Promise.all([readFile(check.source), readFile(check.dist)]);
    if (!source.equals(dist)) failures.push(`${path.relative(root, check.source)} differs from ${path.relative(root, check.dist)}`);
  } catch (error) {
    failures.push(`${path.relative(root, check.source)}: ${error.code || error.message}`);
  }
}

if (failures.length) {
  failures.forEach(failure => console.error(failure));
  process.exitCode = 1;
} else {
  console.log(`Source/dist parity: PASS (${checks.length} files)`);
}
