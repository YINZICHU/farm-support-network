import { DatabaseSync, backup } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { serviceVillages } from '../../src/farm-support/model.js';
import { seedRegistry } from '../../src/farm-support/village-registry.js';
import { boundaryChain } from './sealed.mjs';
import { applyPermissionBoundary } from '../../src/farm-support/permissions.js';

function initialState(environment) {
  return { schema: 1, environment, program: 'PREPARING', ...seedRegistry(serviceVillages), grants: [], invitations: [], people: [], requests: [], orders: [], bookings: [], audit: [], idempotency: {}, complaints: [], rulesVersion: 1 };
}
export function openStore(path, key, { journalPath, journalIdentity = null, allowJournalBootstrap = false, invalidateSessions = false, create = true, migrate = true, environment = 'local-demo' } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('A separate 32-byte encryption key is required');
  if (!['local-demo', 'production'].includes(environment)) throw Error('STORAGE_ENVIRONMENT');
  if (!create && (!existsSync(path) || !journalPath || !existsSync(journalPath))) throw Error('STORAGE_MISSING');
  if (journalPath && !existsSync(journalPath)) {
    if (path !== ':memory:' && existsSync(path) && !allowJournalBootstrap) throw Error('CURRENT_JOURNAL_REQUIRED: do not restore an old or missing privacy journal');
    const fd = openSync(journalPath, 'wx', 0o600); closeSync(fd);
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000;');
  if (create) db.exec('PRAGMA journal_mode=WAL;');
  if (migrate) db.exec(readFileSync(new URL('../../migrations/farm-support/001.sql', import.meta.url), 'utf8'));
  const encode = s => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(s), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  };
  const decode = raw => {
    const b = Buffer.from(raw), decipher = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    decipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8'));
  };
  const read = () => {
    const state = decode(db.prepare('SELECT encrypted FROM fs_state WHERE id=1').get().encrypted);
    state.registrations ??= [];
    state.activationClaims ??= [];
    return state;
  };
  if (!db.prepare('SELECT id FROM fs_state WHERE id=1').get()) {
    if (!create) { db.close(); throw Error('STORAGE_MISSING'); }
    db.prepare('INSERT INTO fs_state VALUES(1,0,?)').run(encode(initialState(environment)));
  }
  // Fail closed on corrupt state/key; never reset an existing database.
  try { read(); } catch (e) { db.close(); throw e; }
  let writeGuard = null, replaying = true;
  const chain = () => boundaryChain(readFileSync(journalPath, 'utf8'), key, journalIdentity);
  if (journalIdentity) {
    try {
      const { heads } = chain(), checkpoint = read().boundaryCheckpoint;
      if (checkpoint && heads[checkpoint.sequence] !== checkpoint.head) throw Error('BOUNDARY_CHECKPOINT');
    } catch (error) { db.close(); throw error; }
  }
  const api = { db, read, journalPath, journalConfigured: !!journalPath, maintenanceLocked: false,
    setWriteGuard(guard) { writeGuard = guard; },
    assertWritable(state = read()) {
      if (api.maintenanceLocked) throw Object.assign(Error('MAINTENANCE_BUSY'), { code: 'MAINTENANCE_BUSY', status: 503 });
      if (!replaying && writeGuard) writeGuard(state);
    },
    boundaryCheckpoint() { return journalIdentity ? chain().checkpoint : null; },
    recordBoundary(record) {
    if (!journalPath) return;
    api.assertWritable();
    const previous = journalIdentity ? chain().checkpoint : null;
    const line = encode(previous ? { version: 1, instanceId: journalIdentity, sequence: previous.sequence + 1, previous: previous.head, record } : record).toString('base64') + '\n';
    const fd = openSync(journalPath, 'a', 0o600);
    try { if (writeSync(fd, line) !== Buffer.byteLength(line)) throw Error('BOUNDARY_WRITE_FAILED'); fsyncSync(fd); } finally { closeSync(fd); }
  }, async backup(path) { await backup(db, path); }, transact(fn) {
    api.assertWritable();
    db.exec('BEGIN IMMEDIATE');
    try {
      const state = read(), result = fn(state);
      if (result?.then) throw Error('Async work is prohibited inside a reservation transaction');
      if (journalIdentity) state.boundaryCheckpoint = chain().checkpoint;
      api.assertWritable(state);
      db.prepare('UPDATE fs_state SET revision=revision+1, encrypted=? WHERE id=1').run(encode(state));
      db.exec('COMMIT'); return result;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } };
  // This separate current journal must not be replaced by an old database backup.
  // A boundary written before a failed commit is deliberately reapplied fail-closed.
  if (journalPath && existsSync(journalPath)) {
    const boundaries = journalIdentity ? chain().entries : readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(line => decode(Buffer.from(line, 'base64')));
    const latestRecovery = new Map(boundaries.filter(b => b.kind === 'credential-recovery').map(b => [b.userId, b.recoveryId]));
    const reducedUsers = new Set();
    api.transact(s => {
      for (const b of boundaries) {
        if (b.kind === 'revoke') { const g = s.grants.find(g => g.userId === b.userId); if (g) { g.active = false; delete g.recoveryId; } }
        else if (b.kind === 'permissions-reduced') { for (const g of s.grants.filter(g => g.userId === b.userId)) if (applyPermissionBoundary(g, b)) reducedUsers.add(g.userId); }
        else if (b.kind === 'consume-invitation') { const i = s.invitations.find(i => i.id === b.id); if (i) { i.used = true; i.claimed = true; } }
        else if (b.kind === 'activation-consumed') {
          const claim = s.activationClaims.find(c => c.id === b.id);
          if (claim && claim.status === 'ISSUED') claim.status = 'NEEDS_RECOVERY';
        }
        else if (b.kind === 'credential-recovery') {
          if (b.recoveryId !== latestRecovery.get(b.userId)) continue;
          const user = db.prepare('SELECT recoveryId FROM user WHERE id=?').get(b.userId);
          if (user?.recoveryId !== b.recoveryId) for (const g of s.grants.filter(g => g.userId === b.userId)) g.active = false;
          db.prepare('DELETE FROM session WHERE userId=?').run(b.userId);
        }
        else if (['registration-token-invalidated', 'registration-token-consumed'].includes(b.kind)) {
          const r = s.registrations.find(r => r.id === b.id && r.tokenHash === b.tokenHash);
          if (r) { r.used = true; r.claimed = true; }
        }
        else if (b.kind === 'remove-contact') {
          const obj = (b.type === 'person' ? s.people : s.requests).find(x => x.id === b.id);
          if (obj) { delete obj.name; delete obj.phone; obj.contactRemovedAt = b.at; }
          for (const o of s.orders.filter(o => o.request === b.id && b.type === 'request')) { delete o.terms.site; for (const h of o.history) delete h.terms.site; if (o.proposal) delete o.proposal.terms.site; for (const p of o.proposalArchive || []) delete p.terms.site; }
          // Saved mutation replies must not resurrect a deleted location or contact.
          for (const token of Object.keys(s.idempotency)) { const result = s.idempotency[token].result; if (result.id === b.id || (b.type === 'request' && result.request === b.id)) delete s.idempotency[token]; }
        } else throw Error('Invalid privacy boundary journal');
      }
    });
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session'").get()) {
      if (invalidateSessions) db.prepare('DELETE FROM session').run();
      else for (const g of read().grants.filter(g => !g.active || reducedUsers.has(g.userId))) db.prepare('DELETE FROM session WHERE userId=?').run(g.userId);
    }
  }
  replaying = false;
  return api;
}
