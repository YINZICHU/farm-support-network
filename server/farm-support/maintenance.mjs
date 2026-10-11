import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { statfsSync, statSync, lstatSync, existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, openSync, writeFileSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { seal, unseal, hash, boundaryChain } from './sealed.mjs';
import { storagePaths, inspectProductionStorage } from './production-store.mjs';
import { openStore } from './store.mjs';
import { requiresManagementMfa, grantCapabilities } from '../../src/farm-support/permissions.js';
const MiB = 1024 ** 2;
const failure = (code, status = 503) => { throw Object.assign(Error(code), { code, status }); };
const size = path => existsSync(path) ? statSync(path).size : 0;
export function availableBytes(path) { const fs = statfsSync(path, { bigint: true }); return Number(fs.bavail * fs.bsize); }
export function storageBudget({ availableBytes: available, stateBytes, journalBytes }) {
  if (![available, stateBytes, journalBytes].every(n => Number.isFinite(n) && n >= 0)) return { acceptWrites: false, reason: 'INVALID_CAPACITY' };
  const reason = available < 128 * MiB ? 'LOW_SPACE' : stateBytes > 8 * MiB ? 'STATE_LIMIT' : journalBytes > 16 * MiB ? 'JOURNAL_LIMIT' : null;
  return { acceptWrites: reason === null, reason };
}
export function installStorageGuard(store, config, { available = () => availableBytes(config.dataDir) } = {}) {
  store.storageStatus = (state = store.read()) => storageBudget({ availableBytes: available(), stateBytes: Buffer.byteLength(JSON.stringify(state)), journalBytes: size(storagePaths(config).journal) });
  store.availableBytes = available;
  store.setWriteGuard(state => { if (!store.storageStatus(state).acceptWrites) failure('STORAGE_READ_ONLY'); });
}
function regularAncestors(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (!existsSync(current) || lstatSync(current).isSymbolicLink() || !lstatSync(current).isDirectory()) failure('PRIVATE_DIRECTORY_REQUIRED');
    if (dirname(current) === current) return;
  }
}
function privateWrite(path, bytes) { const fd = openSync(path, 'wx', 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } }
function readBounded(path, max) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) failure('BACKUP_FILE_INVALID');
  return readFileSync(path);
}
function checkKey(config, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || key.equals(config.dataKey) || key.toString('base64') === config.authSecret || key.toString('hex') === config.authSecret) failure('SEPARATE_BACKUP_KEY');
}
function identity(config) { return { instanceId: config.instanceId, origin: config.origin, authDigest: hash(config.authSecret), dataDigest: hash(config.dataKey) }; }
function verifyIdentity(actual, config) { if (JSON.stringify(actual) !== JSON.stringify(identity(config))) failure('BACKUP_IDENTITY'); }

export async function exportRecoveryBundle({ store, config, outputFile, backupKey }) {
  checkKey(config, backupKey);
  if (resolve(outputFile) !== resolve(config.dataDir, 'pending-backup.bundle')) failure('PRIVATE_BACKUP_PATH');
  regularAncestors(config.dataDir);
  for (const suffix of ['', '.boundary', '.receipt.json']) if (existsSync(outputFile + suffix)) failure('BACKUP_PENDING', 409);
  store.assertWritable();
  const paths = storagePaths(config), peak = size(paths.database) + size(paths.database + '-wal') + size(paths.journal);
  if (peak > 48 * MiB || store.availableBytes() < 128 * MiB + 4 * peak) failure('STORAGE_READ_ONLY');
  if (store.db.isTransaction) failure('MAINTENANCE_BUSY');
  store.maintenanceLocked = true;
  let temp;
  try {
    temp = mkdtempSync(join(config.dataDir, '.backup-work-'));
    const before = readBounded(paths.journal, 16 * MiB), checkpoint = boundaryChain(before.toString('utf8'), config.dataKey, config.instanceId).checkpoint;
    await store.backup(join(temp, 'snapshot.sqlite'));
    const after = readBounded(paths.journal, 16 * MiB);
    if (!before.equals(after)) failure('BACKUP_CHANGED_RETRY');
    const database = readBounded(join(temp, 'snapshot.sqlite'), 32 * MiB), marker = readBounded(paths.marker, 4096).toString('utf8');
    const checkpointId = randomUUID();
    const common = { version: 1, identity: identity(config), checkpointId, checkpoint };
    const bundle = seal({ ...common, database: database.toString('base64'), databaseHash: hash(database), marker }, backupKey);
    const boundary = seal({ ...common, journal: after.toString('utf8') }, backupKey);
    privateWrite(outputFile, bundle);
    privateWrite(outputFile + '.boundary', boundary);
    const receipt = { checkpointId, sha256: hash(bundle), boundarySha256: hash(boundary) };
    privateWrite(outputFile + '.receipt.json', JSON.stringify(receipt) + '\n');
    return { checkpointId, sha256: receipt.sha256 };
  } finally {
    // This exclusive temporary directory contains only the snapshot created above.
    if (temp && dirname(temp) === resolve(config.dataDir) && temp.startsWith(join(config.dataDir, '.backup-work-'))) rmSync(temp, { recursive: true, force: true });
    store.maintenanceLocked = false;
  }
}

export function readPendingBackup(config, part) {
  const suffix = { bundle: '', boundary: '.boundary', receipt: '.receipt.json' }[part];
  if (suffix === undefined) failure('INVALID_BACKUP_PART', 400);
  regularAncestors(config.dataDir);
  const output = join(config.dataDir, 'pending-backup.bundle');
  if (!existsSync(output + '.receipt.json')) failure('BACKUP_NOT_READY', 409);
  const receipt = JSON.parse(readBounded(output + '.receipt.json', 4096).toString('utf8'));
  const bytes = readBounded(output + suffix, 64 * MiB);
  if (part !== 'receipt' && hash(bytes) !== (part === 'bundle' ? receipt.sha256 : receipt.boundarySha256)) failure('BACKUP_HASH_MISMATCH');
  return { bytes, name: 'farm-recovery' + (suffix || '.bundle') };
}

export async function restoreRecoveryBundle({ bundleFile, latestBoundaryFile, expectedCheckpoint, config, targetDir, backupKey, legacyUpgrade }) {
  checkKey(config, backupKey);
  if (!isAbsolute(targetDir) || resolve(targetDir) === resolve(config.dataDir) || existsSync(targetDir)) failure('RESTORE_TARGET');
  regularAncestors(dirname(targetDir));
  if (typeof expectedCheckpoint !== 'string' || !/^[a-f0-9-]{36}$/.test(expectedCheckpoint)) failure('LATEST_CHECKPOINT_REQUIRED');
  const bundle = unseal(readBounded(bundleFile, 64 * MiB), backupKey), boundary = unseal(readBounded(latestBoundaryFile, 24 * MiB), backupKey);
  verifyIdentity(bundle.identity, config); verifyIdentity(boundary.identity, config);
  if (bundle.version !== 1 || boundary.version !== 1 || boundary.checkpointId !== expectedCheckpoint) failure('LATEST_CHECKPOINT_MISMATCH');
  const chain = boundaryChain(boundary.journal, config.dataKey, config.instanceId);
  if (JSON.stringify(chain.checkpoint) !== JSON.stringify(boundary.checkpoint) || chain.heads[bundle.checkpoint.sequence] !== bundle.checkpoint.head) failure('BOUNDARY_CHECKPOINT');
  const database = Buffer.from(bundle.database, 'base64');
  if (database.length > 32 * MiB || hash(database) !== bundle.databaseHash || availableBytes(dirname(targetDir)) < 128 * MiB + database.length * 4) failure('RESTORE_CAPACITY_OR_HASH');
  mkdirSync(targetDir, { mode: 0o700 });
  privateWrite(join(targetDir, '.restoring'), expectedCheckpoint);
  const restoredConfig = { ...config, dataDir: targetDir }, paths = storagePaths(restoredConfig);
  privateWrite(paths.database, database); privateWrite(paths.journal, boundary.journal); privateWrite(paths.marker, bundle.marker);
  let db = new DatabaseSync(paths.database, { readOnly: true });
  try { if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') failure('RESTORE_INTEGRITY'); } finally { db.close(); }
  // Verify marker, schema, seed IDs and latest authority before touching auth state.
  const inspection = inspectProductionStorage(restoredConfig, { verifiedMount: true, legacyRegistry: true, restoringCheckpoint: expectedCheckpoint });
  let legacyAdministrator, upgrade;
  if (inspection.state.villageRegistryVersion === undefined) {
    if (legacyUpgrade?.verifiedIdentity !== true) failure('IDENTITY_VERIFICATION_REQUIRED');
    if (Object.keys(legacyUpgrade).some(k => !['verifiedIdentity', 'projectAdminUserId'].includes(k)) || typeof legacyUpgrade.projectAdminUserId !== 'string') failure('UPGRADE_ADMIN_INVALID');
    const module = await import('./registry-upgrade.mjs');
    legacyAdministrator = module.selectRegistryUpgradeAdmin(inspection, legacyUpgrade.projectAdminUserId);
    upgrade = module.upgradeRegistryState;
  }
  const store = openStore(paths.database, config.dataKey, { journalPath: paths.journal, journalIdentity: config.instanceId, create: false, migrate: false, environment: 'production', invalidateSessions: true });
  try {
    store.transact(s => {
      if (s.instanceId !== config.instanceId || s.environment !== 'production') failure('RESTORE_IDENTITY');
      if (upgrade) upgrade(s, legacyAdministrator);
      for (const claim of s.activationClaims) { if (claim.status !== 'ACTIVE') { claim.status = 'NEEDS_RECOVERY'; claim.expires = 0; } delete claim.resetToken; }
      for (const invite of s.invitations) { invite.used = true; invite.claimed = true; }
      for (const r of s.registrations) { r.used = true; r.claimed = true; }
      const previouslyPrivileged = new Set(chain.entries.filter(b => b.kind === 'permissions-reduced').map(b => b.userId));
      for (const grant of s.grants.filter(g => g.active && (requiresManagementMfa(g) || previouslyPrivileged.has(g.userId)))) {
        grant.active = false; grant.recoveryId = `restore-${expectedCheckpoint}`;
        grant.canCreateVillages = false; grant.managedVillages = []; grant.version = grantCapabilities(grant).version + 1;
      }
      const revoked = new Set(chain.entries.filter(b => b.kind === 'revoke').map(b => b.userId));
      for (const grant of s.grants.filter(g => !g.active && !revoked.has(g.userId))) grant.recoveryId = `restore-${expectedCheckpoint}`;
      store.db.prepare('DELETE FROM session').run(); store.db.prepare('DELETE FROM verification').run();
      // Old authenticator secrets/used recovery-code sets are never reactivated.
      store.db.prepare('DELETE FROM twoFactor').run(); store.db.prepare('UPDATE user SET twoFactorEnabled=0').run();
      s.restoreCheckpoint = expectedCheckpoint;
    });
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { store.db.close(); }
  // All checks precede removing the marker; any failure leaves an unusable isolated target.
  const { openProductionStore } = await import('./production-store.mjs');
  unlinkSync(join(targetDir, '.restoring'));
  try { const verified = openProductionStore(restoredConfig, { verifiedMount: true }); verified.db.close(); }
  catch (error) { privateWrite(join(targetDir, '.restoring'), expectedCheckpoint); throw error; }
  return { sessionsCleared: true };
}
