import { readFileSync } from 'node:fs';
import { readProductionConfig, isPersistentMount } from '../../server/farm-support/config.mjs';
import { provisionStorage, openProductionStore } from '../../server/farm-support/production-store.mjs';
import { startProductionServer } from '../../server/farm-support/http.mjs';

export function reportStartupFailure(error) {
  const code = String(error.message || '').split(':')[0];
  console.error(`Startup refused: ${/^[A-Z][A-Z_]{2,60}$/.test(code) ? code : 'STARTUP_FAILED'}`);
  process.exitCode = 1;
}

export async function startRuntime({ provision = false } = {}) {
  const config = readProductionConfig(process.env);
  if (process.platform !== 'linux') throw Error('MOUNT_REQUIRED');
  const verifiedMount = isPersistentMount(readFileSync('/proc/self/mountinfo', 'utf8'));
  if (!verifiedMount) throw Error('MOUNT_REQUIRED');
  if (provision) await provisionStorage(config, { verifiedMount });
  const store = openProductionStore(config, { verifiedMount });
  let running;
  try { running = await startProductionServer({ store, config }); }
  catch (error) { store.db.close(); throw error; }
  let closing = false;
  const stop = async () => {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => process.exit(1), 15000); deadline.unref();
    try { await running.close(); store.db.close(); }
    finally { clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log('Backend ready; persistent storage validated.');
  return { ...running, close: stop };
}
