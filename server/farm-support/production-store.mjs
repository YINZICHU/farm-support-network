import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, timingSafeEqual, createDecipheriv } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync, mkdtempSync, copyFileSync, chmodSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from './store.mjs';
import { createAuthentication } from './auth.mjs';
import { installStorageGuard } from './maintenance.mjs';
import { projectConfig } from '../../src/farm-support/project-config.js';
import { assertVillageRegistry } from '../../src/farm-support/village-registry.js';
import { boundaryChain } from './sealed.mjs';
import { applyPermissionBoundary } from '../../src/farm-support/permissions.js';

export function assertConfiguredVillageIds(state, villages = projectConfig.villages) {
  const expected = new Set(villages.map(v => v.id));
  const stored = state?.villages;
  if (!Array.isArray(stored) || stored.length !== expected.size || new Set(stored.map(v => v?.id)).size !== expected.size || !stored.every(v => expected.has(v?.id))) throw Error('CONFIG_VILLAGE_MISMATCH');
}

export const storageSchema = 3;
export function storagePaths(config) {
  return { database: join(config.dataDir, 'farm.sqlite'), journal: join(config.dataDir, 'privacy.log'), marker: join(config.dataDir, 'instance.json'), pending: join(config.dataDir, '.provisioning') };
}
function identity(config) {
  return { schema: storageSchema, environment: 'production', instanceId: config.instanceId, origin: config.origin, authDigest: createHash('sha256').update(config.authSecret).digest('hex') };
}
function proof(config, data) { return createHmac('sha256', config.dataKey).update(JSON.stringify(data)).digest('hex'); }
function validateDirectory(config, verifiedMount) {
  if (verifiedMount !== true) throw Error('MOUNT_REQUIRED');
  let path = resolve(config.dataDir);
  for (;;) {
    if (!existsSync(path)) throw Error('STORAGE_MISSING');
    if (lstatSync(path).isSymbolicLink()) throw Error('STORAGE_SYMLINK');
    if (!lstatSync(path).isDirectory()) throw Error('STORAGE_DIRECTORY_REQUIRED');
    const parent = dirname(path); if (parent === path) break; path = parent;
  }
}
function regularFile(path, required = true) {
  if (!existsSync(path)) { if (required) throw Error('STORAGE_MISSING'); return; }
  const info = lstatSync(path);
  if (info.isSymbolicLink()) throw Error('STORAGE_SYMLINK');
  if (!info.isFile()) throw Error('STORAGE_FILE_REQUIRED');
}
function writeExclusive(path, data) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path) {
  if (process.platform !== 'linux') return;
  const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
}

// SQLite's read-only WAL connection can still modify/create sidecars. Inspect an
// isolated private snapshot instead; include committed WAL pages, never use
// immutable=1 on the live database (it would ignore pending WAL transactions).
function inspectionSnapshot(paths) {
  const dir = mkdtempSync(join(tmpdir(), 'network-storage-inspection-'));
  chmodSync(dir, 0o700);
  const source = [paths.database, ...(existsSync(paths.database + '-wal') ? [paths.database + '-wal'] : [])];
  const signatures = files => files.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]);
  const before = signatures(source);
  const target = join(dir, 'farm.sqlite');
  const close = () => {
    // Only exact files in our just-created private directory, no recursive delete.
    for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(target + suffix)) unlinkSync(target + suffix);
    rmdirSync(dir);
  };
  try {
    for (const file of source) { const out = target + file.slice(paths.database.length); copyFileSync(file, out); chmodSync(out, 0o600); }
    const after = signatures(source);
    const copied = source.map(file => [file, createHash('sha256').update(readFileSync(target + file.slice(paths.database.length))).digest('hex')]);
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(copied) || existsSync(paths.database + '-wal') !== (source.length === 2)) throw Error('STORAGE_BUSY');
    return { target, close };
  } catch (error) { close(); throw error; }
}

// Call only from explicitly selected provisioning, never from normal startup/build.
export async function provisionStorage(config, { verifiedMount } = {}) {
  validateDirectory(config, verifiedMount);
  const paths = storagePaths(config);
  if (existsSync(paths.marker)) throw Error('ALREADY_INITIALIZED');
  if (readdirSync(config.dataDir).length) throw Error('STORAGE_PARTIAL: explicit repair required');
  writeExclusive(paths.pending, JSON.stringify({ instanceId: config.instanceId, schema: storageSchema }));
  writeExclusive(paths.database, '');
  let store;
  try {
    store = openStore(paths.database, config.dataKey, { journalPath: paths.journal, journalIdentity: config.instanceId, allowJournalBootstrap: true, environment: 'production' });
    store.transact(state => { state.instanceId = config.instanceId; });
    await createAuthentication(store.db, config.authSecret, config.origin, { production: true, runMigrations: true });
    store.db.exec(readFileSync(new URL('../../migrations/farm-support/002-activation.sql', import.meta.url), 'utf8'));
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { store?.db.close(); }
  const data = identity(config);
  writeExclusive(paths.marker, JSON.stringify({ ...data, proof: proof(config, data) }) + '\n');
  syncDirectory(config.dataDir);
  unlinkSync(paths.pending);
  syncDirectory(config.dataDir);
}

// Validate identity and encrypted state before opening any writable connection.
export function inspectProductionStorage(config, { verifiedMount, legacyRegistry = false, restoringCheckpoint } = {}) {
  validateDirectory(config, verifiedMount);
  const paths = storagePaths(config);
  if (existsSync(paths.pending)) throw Error('STORAGE_PARTIAL: explicit repair required');
  const restoring = join(config.dataDir, '.restoring');
  if (existsSync(restoring) && (!restoringCheckpoint || readFileSync(restoring, 'utf8') !== restoringCheckpoint)) throw Error('RESTORE_INCOMPLETE');
  for (const path of [paths.database, paths.journal, paths.marker]) regularFile(path);
  for (const suffix of ['-wal', '-shm', '-journal']) regularFile(paths.database + suffix, false);
  let marker; try { marker = JSON.parse(readFileSync(paths.marker, 'utf8')); } catch { throw Error('STORAGE_IDENTITY'); }
  if (marker.schema !== storageSchema) throw Error('STORAGE_SCHEMA');
  const { proof: signature, ...data } = marker, expected = identity(config);
  if (JSON.stringify(data) !== JSON.stringify(expected) || !/^[a-f0-9]{64}$/.test(signature || '') || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(proof(config, expected), 'hex'))) throw Error('STORAGE_IDENTITY');
  const inspection = inspectionSnapshot(paths);
  let db;
  try {
    db = new DatabaseSync(inspection.target, { readOnly: true });
    const bytes = Buffer.from(db.prepare('SELECT encrypted FROM fs_state WHERE id=1').get().encrypted);
    const decipher = createDecipheriv('aes-256-gcm', config.dataKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const state = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (state.schema !== 1 || state.environment !== 'production' || state.instanceId !== config.instanceId) throw Error('STORAGE_IDENTITY');
    if (legacyRegistry && state.villageRegistryVersion === undefined) {
      if (state.seedVillageIds !== undefined || state.registryRevision !== undefined) throw Error('REGISTRY_VERSION_INVALID');
      assertConfiguredVillageIds(state);
    } else assertVillageRegistry(state, projectConfig.villages);
    for (const table of ['user', 'session', 'account', 'verification', 'twoFactor']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw Error('STORAGE_SCHEMA');
    }
    const boundaries = boundaryChain(readFileSync(paths.journal, 'utf8'), config.dataKey, config.instanceId);
    if (state.boundaryCheckpoint && boundaries.heads[state.boundaryCheckpoint.sequence] !== state.boundaryCheckpoint.head) throw Error('BOUNDARY_CHECKPOINT');
    // A newer revocation must also bound a legacy administrator eligibility check.
    for (const b of boundaries.entries) if (b.kind === 'revoke') for (const g of state.grants.filter(g => g.userId === b.userId)) g.active = false;
    for (const b of boundaries.entries) if (b.kind === 'permissions-reduced') for (const g of state.grants.filter(g => g.userId === b.userId)) applyPermissionBoundary(g, b);
    return { state, revision: db.prepare('SELECT revision FROM fs_state WHERE id=1').get().revision,
      users: db.prepare('SELECT id, activationClaimId FROM user').all() };
  } finally { db?.close(); inspection.close(); }
}

export function openProductionStore(config, { verifiedMount } = {}) {
  if (existsSync(join(config.dataDir, '.registry-upgrade'))) throw Error('MAINTENANCE_BUSY');
  inspectProductionStorage(config, { verifiedMount });
  const paths = storagePaths(config);
  const store = openStore(paths.database, config.dataKey, { journalPath: paths.journal, journalIdentity: config.instanceId, create: false, migrate: false, environment: 'production' });
  installStorageGuard(store, config);
  return store;
}
