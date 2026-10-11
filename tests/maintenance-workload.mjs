import { villageA } from './fixture-villages.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionStorage, openProductionStore } from '../server/farm-support/production-store.mjs';
import { exportRecoveryBundle, restoreRecoveryBundle } from '../server/farm-support/maintenance.mjs';
const dir = mkdtempSync(join(tmpdir(), 'farm-capacity-fixture-'));
const config = { dataDir: dir, origin: 'https://capacity.example.test', authSecret: randomBytes(48).toString('hex'), dataKey: randomBytes(32), instanceId: 'fictional-capacity-instance' };
let store;
try {
  await provisionStorage(config, { verifiedMount: true }); store = openProductionStore(config, { verifiedMount: true });
  store.transact(s => {
    for (let i = 0; i < 1000; i++) {
      s.people.push({ id: 'fictional-person-' + i, code: 'P-' + i, villages: [villageA], skills: ['grapes'], availability: [], status: 'ACTIVE', consent: true });
      s.requests.push({ id: 'fictional-request-' + i, household: 'synthetic-' + i, village: villageA, status: 'CLOSED', enteredAt: 1 });
    }
    for (let i = 0; i < 10000; i++) s.audit.push({ command: 'synthetic-workload', object: 'fixture-' + i, at: i });
  });
  const key = randomBytes(32), outputFile = join(dir, 'pending-backup.bundle');
  const result = await exportRecoveryBundle({ store, config, outputFile, backupKey: key });
  const targetDir = join(dir, 'isolated-restored');
  await restoreRecoveryBundle({ bundleFile: outputFile, latestBoundaryFile: outputFile + '.boundary', expectedCheckpoint: result.checkpointId, config, targetDir, backupKey: key });
  const restored = openProductionStore({ ...config, dataDir: targetDir }, { verifiedMount: true });
  try { if (restored.read().requests.length !== 1000) throw Error('COUNT_MISMATCH'); } finally { restored.db.close(); }
  process.stdout.write(JSON.stringify({ rssBytes: process.resourceUsage().maxRSS * 1024, people: 1000, requests: 1000, audit: 10000, restored: true }) + '\n');
} finally { store?.db.close(); rmSync(dir, { recursive: true, force: true }); }
