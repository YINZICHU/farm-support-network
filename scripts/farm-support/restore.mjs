import { readProductionConfig } from '../../server/farm-support/config.mjs';
import { restoreRecoveryBundle } from '../../server/farm-support/maintenance.mjs';
try {
  if (process.argv.slice(2).join(' ') !== '--isolated-restore --latest-checkpoint-verified') throw Error('EXPLICIT_RESTORE_OPERATION_REQUIRED');
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 16384) throw Error('INPUT_TOO_LARGE'); }
  const { backupKeyBase64, ...options } = JSON.parse(input);
  if (Object.keys(options).some(k => !['bundleFile', 'latestBoundaryFile', 'expectedCheckpoint', 'targetDir', 'legacyUpgrade'].includes(k))) throw Error('INVALID_RESTORE_INPUT');
  const backupKey = Buffer.from(backupKeyBase64 || '', 'base64');
  try { await restoreRecoveryBundle({ ...options, config: readProductionConfig(process.env), backupKey }); }
  finally { backupKey.fill(0); }
  process.stdout.write('Isolated restore verified; sessions cleared. Live storage was not replaced.\n');
} catch (error) { process.stderr.write((/^[A-Z_]+$/.test(error.message) ? error.message : 'RESTORE_FAILED') + '\n'); process.exitCode = 1; }
