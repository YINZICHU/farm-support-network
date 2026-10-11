import { startRuntime, reportStartupFailure } from './runtime.mjs';

try { await startRuntime(); } catch (error) { reportStartupFailure(error); }
