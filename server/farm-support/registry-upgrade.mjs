import { openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inspectProductionStorage, storagePaths } from './production-store.mjs';
import { openStore } from './store.mjs';
import { exportRecoveryBundle, installStorageGuard } from './maintenance.mjs';
import { projectConfig } from '../../src/farm-support/project-config.js';
import { seedRegistry, assertVillageRegistry } from '../../src/farm-support/village-registry.js';
import { grantCapabilities } from '../../src/farm-support/permissions.js';

export function selectRegistryUpgradeAdmin(inspection, selected) {
  const { state, users } = inspection;
  const admins = state.grants.filter(g => g.active && g.role === 'admin' && users.some(u => u.id === g.userId) && (state.villageRegistryVersion === 1 || g.projectAdmin !== false));
  if (selected !== undefined) {
    if (!admins.some(g => g.userId === selected)) throw Error('UPGRADE_ADMIN_INVALID');
    return selected;
  }
  const candidates = state.villageRegistryVersion === 1
    ? admins.filter(g => g.projectAdmin === true).map(g => g.userId)
    : (state.activationClaims || []).filter(c => c.bootstrap === true && c.status === 'ACTIVE' && admins.some(g => g.userId === c.userId) && users.some(u => u.id === c.userId && u.activationClaimId === c.id)).map(c => c.userId);
  if (candidates.length !== 1) throw Error('UPGRADE_ADMIN_AMBIGUOUS');
  return candidates[0];
}
export function upgradeRegistryState(state, administrator) {
  const seeded = seedRegistry(projectConfig.villages), oldVillages = state.villages;
  Object.assign(state, seeded);
  state.villages = seeded.villages.map(v => ({ ...v, ...oldVillages.find(old => old.id === v.id), source: 'seed', createdBy: null, version: 1 }));
  for (const grant of state.grants) Object.assign(grant, { projectAdmin: grant.userId === administrator && grant.active && grant.role === 'admin', canCreateVillages: false, managedVillages: [], version: grantCapabilities(grant).version });
  assertVillageRegistry(state, projectConfig.villages);
}
export function inspectRegistryUpgrade({ config, verifiedMount, projectAdminUserId }) {
  const inspection = inspectProductionStorage(config, { verifiedMount, legacyRegistry: true });
  return { needed: inspection.state.villageRegistryVersion !== 1, eligibleAdminUserId: selectRegistryUpgradeAdmin(inspection, projectAdminUserId), registryRevision: inspection.state.registryRevision || 0, instanceId: config.instanceId };
}

// Operator must stop every writer and verify a private, isolated copy first.
// The lock protects cooperating maintenance/startup paths; it is not proof of a stopped service.
export async function applyRegistryUpgrade({ config, verifiedMount, projectAdminUserId, verifiedIdentity, backupKey }) {
  if (verifiedIdentity !== true) throw Error('IDENTITY_VERIFICATION_REQUIRED');
  const check = inspectRegistryUpgrade({ config, verifiedMount, projectAdminUserId });
  if (!check.needed) return { changed: false, registryRevision: check.registryRevision, backupReceipt: null };
  const lock = join(config.dataDir, '.registry-upgrade');
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); } catch { throw Error('MAINTENANCE_BUSY'); }
  let store;
  try {
    const recheck = inspectRegistryUpgrade({ config, verifiedMount, projectAdminUserId });
    if (JSON.stringify(recheck) !== JSON.stringify(check)) throw Error('UPGRADE_CHANGED_RETRY');
    const paths = storagePaths(config);
    store = openStore(paths.database, config.dataKey, { journalPath: paths.journal, journalIdentity: config.instanceId, create: false, migrate: false, environment: 'production' });
    installStorageGuard(store, config);
    const current = store.read(), revision = store.db.prepare('SELECT revision FROM fs_state WHERE id=1').get().revision;
    if (selectRegistryUpgradeAdmin({ state: current, users: store.db.prepare('SELECT id, activationClaimId FROM user').all() }, check.eligibleAdminUserId) !== check.eligibleAdminUserId || current.villageRegistryVersion !== undefined) throw Error('UPGRADE_CHANGED_RETRY');
    const backupReceipt = await exportRecoveryBundle({ store, config, outputFile: join(config.dataDir, 'pending-backup.bundle'), backupKey });
    store.transact(state => {
      if (store.db.prepare('SELECT revision FROM fs_state WHERE id=1').get().revision !== revision) throw Error('UPGRADE_CHANGED_RETRY');
      upgradeRegistryState(state, check.eligibleAdminUserId);
    });
    return { changed: true, registryRevision: 1, backupReceipt };
  } finally { store?.db.close(); closeSync(fd); unlinkSync(lock); }
}
