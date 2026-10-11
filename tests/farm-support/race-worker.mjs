import { parentPort, workerData } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { openStore } from '../../server/farm-support/store.mjs';
import { createDomain } from '../../server/farm-support/domain.mjs';
const store = openStore(workerData.path, Buffer.from(workerData.key, 'hex'));
const sync = new Int32Array(workerData.barrier); Atomics.add(sync, 0, 1); parentPort.postMessage('ready');
Atomics.wait(sync, 1, 0);
try { const result = createDomain(store, () => workerData.now).dispatch(workerData.actor || 'adult', workerData.command || 'order.reserve', workerData.payload, workerData.idempotencyKey || randomUUID()); parentPort.postMessage({ ok: true, id: result.id }); }
catch (e) { parentPort.postMessage({ ok: false, error: e.code || e.message }); }
finally { store.db.close(); }
