import { readFileSync } from 'node:fs';
import { readProductionConfig, isPersistentMount } from '../../server/farm-support/config.mjs';
import { inspectRegistryUpgrade, applyRegistryUpgrade } from '../../server/farm-support/registry-upgrade.mjs';
try {
  const args = process.argv.slice(2), apply = args[0] === '--apply';
  if (!(args.length === 1 && args[0] === '--check') && !(args.length === 5 && apply && args[1] === '--offline-confirmed' && args[2] === '--verified-identity' && args[3] === '--project-admin-user-id' && args[4])) throw Error('EXPLICIT_UPGRADE_OPERATION_REQUIRED');
  const config = readProductionConfig(process.env);
  const verifiedMount = process.platform === 'linux' && isPersistentMount(readFileSync('/proc/self/mountinfo', 'utf8'));
  const input = { config, verifiedMount, projectAdminUserId: apply ? args[4] : undefined };
  if (apply) {
    const backupKey = Buffer.from(process.env.FARM_BACKUP_KEY_BASE64 || '', 'base64');
    if (backupKey.length !== 32 || backupKey.toString('base64') !== process.env.FARM_BACKUP_KEY_BASE64) throw Error('BACKUP_KEY_REQUIRED');
    const result = await applyRegistryUpgrade({ ...input, verifiedIdentity: true, backupKey });
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    const check = inspectRegistryUpgrade(input);
    process.stdout.write(JSON.stringify({ needed: check.needed, registryRevision: check.registryRevision }) + '\n');
  }
} catch (error) { process.stderr.write((/^[A-Z_]+$/.test(error.message) ? error.message : 'REGISTRY_UPGRADE_FAILED') + '\n'); process.exitCode = 1; }
