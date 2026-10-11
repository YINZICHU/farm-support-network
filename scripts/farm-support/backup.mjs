import { mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
try {
  if (process.argv.slice(2).join(' ') !== '--authenticated-export') throw Error('EXPLICIT_BACKUP_OPERATION_REQUIRED');
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16384) throw Error('INPUT_TOO_LARGE'); }
  const { origin, sessionCookie, backupKeyBase64, outputDirectory } = JSON.parse(input);
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || typeof sessionCookie !== 'string' || /[\r\n]/.test(sessionCookie)) throw Error('INVALID_BACKUP_INPUT');
  if (!isAbsolute(outputDirectory) || existsSync(outputDirectory)) throw Error('NEW_PRIVATE_DIRECTORY_REQUIRED');
  for (let path = dirname(resolve(outputDirectory)); ; path = dirname(path)) {
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw Error('PRIVATE_DIRECTORY_REQUIRED');
    if (dirname(path) === path) break;
  }
  const headers = { origin, cookie: sessionCookie, 'content-type': 'application/json' };
  const created = await fetch(origin + '/api/farm-support/backup', { method: 'POST', headers, body: JSON.stringify({ backupKeyBase64 }), redirect: 'error' });
  if (!created.ok) throw Error('AUTHENTICATED_BACKUP_FAILED');
  const result = await created.json();
  mkdirSync(outputDirectory, { mode: 0o700 });
  for (const [part, suffix] of [['receipt', '.receipt.json'], ['boundary', '.boundary'], ['bundle', '.bundle']]) {
    const response = await fetch(origin + '/api/farm-support/backup/download?part=' + part, { headers, redirect: 'error' });
    if (!response.ok) throw Error('BACKUP_DOWNLOAD_FAILED');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 64 * 1024 ** 2) throw Error('BACKUP_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks);
    if (part === 'bundle' && createHash('sha256').update(bytes).digest('hex') !== result.sha256) throw Error('BACKUP_HASH_MISMATCH');
    const fd = openSync(join(outputDirectory, 'farm-recovery' + suffix), 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  }
  process.stdout.write('Encrypted backup retrieved. Verify receipt and keep the key separately.\n');
} catch (error) { process.stderr.write((/^[A-Z_]+$/.test(error.message) ? error.message : 'BACKUP_FAILED') + '\n'); process.exitCode = 1; }
