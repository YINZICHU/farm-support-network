import { villageA, villageB } from '../fixture-villages.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { createDomain } from '../../server/farm-support/domain.mjs';

export function fixture() {
  const store = openStore(':memory:', randomBytes(32));
  let now = Date.parse('2026-10-12T00:00:00+08:00');
  store.transact(s => {
    s.program = 'OPEN'; s.villages.forEach(v => { v.state = 'OPEN'; });
    s.grants = [{ userId: 'adult', role: 'admin', villages: s.villages.map(v => v.id), active: true, projectAdmin: true, canCreateVillages: false, managedVillages: [], version: 1 }, { userId: 'local', role: 'coordinator', villages: [villageA], active: true, projectAdmin: false, canCreateVillages: false, managedVillages: [], version: 1 }, { userId: 'student', role: 'analyst', villages: [villageA], active: true, projectAdmin: false, canCreateVillages: false, managedVillages: [], version: 1 }];
  });
  const domain = createDomain(store, () => now);
  const call = (command, payload = {}, actor = 'adult', key = randomUUID()) => domain.dispatch(actor, command, payload, key);
  const addPerson = (name) => {
    const p = call('person.create', { name, phone: '13800001234', villages: [villageA, villageB], skills: ['sorting'], consent: true, verified: true });
    call('person.availability', { id: p.id, version: 1, start: '2026-10-12T07:00:00+08:00', end: '2026-10-12T20:00:00+08:00', evidence: '电话确认本人时段', consent: true }); return p.id;
  };
  const main = addPerson('虚构甲'), backup = addPerson('虚构乙');
  const request = (village = villageA, household = randomUUID()) => {
    const r = call('request.create', { village, household, name: '虚构农户', phone: '13800001234', task: 'sorting', note: '轻量分拣，不含重物', source: 'phone', actualAt: '2026-10-11T15:00:00+08:00', consent: true });
    return call('request.verify', { id: r.id, version: 1, evidence: '核实本人委托权限和安全范围', scopeSafe: true });
  };
  const terms = (r, overrides = {}) => ({ request: r.id, version: r.version, main, backup, start: '2026-10-12T09:00:00+08:00', end: '2026-10-12T10:00:00+08:00', site: '虚构地点，演示用', standard: '分拣一批轻量果品', prohibited: '不搬重物、不操作机械', safety: '工具、防护、天气核实后开工', backupTerms: '本人同意预留，启用前另行联系', feeMain: 5000, feeBackup: 1000, feeIncludes: '包含交接，不含额外任务', cancelTerms: '直接协商取消费用，不自动扣费', overtimePrice: 2000, overtimeMax: 60, mainHoldConsent: true, backupHoldConsent: true, ...overrides });
  const confirm = o => { for (const party of ['farmer', 'main', 'backup']) o = call('order.confirm', { id: o.id, version: o.version, party, evidence: '电话核实本人', method: 'phone', actualAt: new Date(now).toISOString(), agree: true }); return o; };
  return { store, domain, call, main, backup, request, terms, confirm, setTime: x => { now = Date.parse(x); } };
}
