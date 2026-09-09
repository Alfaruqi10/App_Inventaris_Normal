import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : (entry.name.endsWith('.gs') ? [target] : []);
  }));
  return nested.flat();
}

const gasFiles = await files(path.resolve('src/backend'));
const failures = [];
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ansla-gas-syntax-'));
try {
  for (let index = 0; index < gasFiles.length; index++) {
    const file = gasFiles[index];
    // Node refuses the Apps Script .gs extension before parsing. A temporary
    // .cjs copy makes this a pure syntax check without evaluating any code.
    const candidate = path.join(temporaryDirectory, `${index}.cjs`);
    await writeFile(candidate, await readFile(file));
    const result = spawnSync(process.execPath, ['--check', candidate], { encoding: 'utf8' });
    if (result.status !== 0) failures.push({ file, error: result.stderr || result.stdout });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (failures.length) {
  failures.forEach(({ file, error }) => console.error(`${file}\n${error}`));
  process.exitCode = 1;
} else {
  console.log(`Apps Script syntax: PASS (${gasFiles.length} .gs files)`);
}
