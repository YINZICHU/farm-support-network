// Full-suite acceptance in disposable source copies. Vite and Node both read
// the same customized file, unlike an in-memory JSON override in one runtime.
import { mkdtempSync, mkdirSync, copyFileSync, symlinkSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { listReleaseFiles } from '../scripts/check-release.mjs';
const source = process.cwd(), files = listReleaseFiles(source);
for (const count of [3, 1]) {
  const root = mkdtempSync(join(tmpdir(), 'network-custom-suite-'));
  try {
    for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); copyFileSync(join(source, file), join(root, file)); }
    symlinkSync(realpathSync(join(source, 'node_modules')), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const input = JSON.parse(readFileSync(join(root, 'config/project.json'), 'utf8'));
    input.villages = ['north', 'south', 'east'].slice(0, count).map(id => ({ id, zh: '虚构 ' + id, en: 'Fictional ' + id }));
    writeFileSync(join(root, 'config/project.json'), JSON.stringify(input));
    const result = spawnSync(process.execPath, ['--import', './tests/cross-village-setup.mjs', '--test', 'tests/*.test.mjs', 'tests/farm-support/*.test.mjs'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    console.log(`Configured full suite: ${count} village(s)`);
    console.log(result.stdout); if (result.stderr) console.error(result.stderr);
    if (result.status !== 0) { process.exitCode = 1; break; }
  } finally {
    // The exact mkdtemp path is the only deletion target; remove its dependency
    // link itself, never traverse into the source checkout's node_modules.
    if (!resolve(root).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/') + 'network-custom-suite-')) throw Error('UNSAFE_FIXTURE_PATH');
    rmSync(join(root, 'node_modules'), { force: true }); rmSync(root, { recursive: true, force: true });
  }
}
