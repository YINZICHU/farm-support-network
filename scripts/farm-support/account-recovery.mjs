import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProductionConfig, isPersistentMount } from '../../server/farm-support/config.mjs';
import { openProductionStore } from '../../server/farm-support/production-store.mjs';
import { createAuthentication } from '../../server/farm-support/auth.mjs';
import { bootstrapAdministrator, recoverAdministrator } from '../../server/farm-support/activation.mjs';

// Run manually inside the authenticated hosting console after verifying the person.
// Identity details arrive via stdin, never command arguments; no passwords are accepted.
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !['--bootstrap', '--recover'].includes(args[0]) || args[1] !== '--identity-verified') throw Error('ACCOUNT_OPERATION_REQUIRED');
  const config = readProductionConfig(process.env);
  if (process.platform !== 'linux' || !isPersistentMount(readFileSync('/proc/self/mountinfo', 'utf8'))) throw Error('MOUNT_REQUIRED');
  let text = '';
  for await (const piece of process.stdin) { text += piece.toString('utf8'); if (Buffer.byteLength(text) > 4096) throw Error('INPUT_TOO_LARGE'); }
  let input; try { input = JSON.parse(text); } catch { throw Error('INVALID_INPUT'); }
  const keys = args[0] === '--bootstrap' ? ['email', 'name'] : ['claimId', 'resetMfa'];
  if (!input || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw Error('INVALID_INPUT');
  const store = openProductionStore(config, { verifiedMount: true });
  try {
    const auth = await createAuthentication(store.db, config.authSecret, config.origin, { production: true });
    const options = { store, auth, origin: config.origin, handoffFile: join(config.dataDir, 'administrator-activation.txt'), verifiedIdentity: true, ...input };
    if (args[0] === '--bootstrap') bootstrapAdministrator(options);
    else await recoverAdministrator(options);
    console.log('Private administrator handoff created. Retrieve it privately, then remove the handoff file after use.');
  } finally { store.db.close(); }
} catch (e) {
  const code = String(e.code || e.message || '').split(':')[0];
  console.error(`Account operation refused: ${/^[A-Z][A-Z_]{2,60}$/.test(code) ? code : 'ACCOUNT_OPERATION_FAILED'}`);
  process.exitCode = 1;
}
