import { startRuntime, reportStartupFailure } from './runtime.mjs';

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--start') throw Error('PROVISION_REQUIRES_START');
  await startRuntime({ provision: true });
} catch (error) { reportStartupFailure(error); }
