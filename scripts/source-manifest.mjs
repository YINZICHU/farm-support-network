import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { listReleaseFiles } from './check-release.mjs';
import { approvedResourceBytes } from '../src/farm-support/resource-approval.js';

export function createSourceManifest(root) {
  const files = listReleaseFiles(root).filter(path => path !== 'docs/source-manifest.json').map(path => {
    const raw = Object.hasOwn(approvedResourceBytes, path);
    const content = raw ? readFileSync(join(root, path)) : Buffer.from(readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n'));
    return { path, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), normalization: raw ? 'raw' : 'UTF-8 LF' };
  });
  return { schemaVersion: 2, algorithm: 'SHA256', files };
}
export function verifySourceManifest(root) {
  try { return JSON.stringify(JSON.parse(readFileSync(join(root, 'docs/source-manifest.json'), 'utf8'))) === JSON.stringify(createSourceManifest(root)); }
  catch { return false; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const manifest = createSourceManifest(process.cwd());
    writeFileSync(resolve('docs/source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Reviewed source manifest written: ${manifest.files.length} files; text UTF-8 LF and binary raw SHA256.`);
  } catch { console.error('RELEASE_INPUT_DENIED'); process.exitCode = 1; }
}
