export const productionDataDir = '/var/data/farm-support';
import { projectConfig } from '../../src/farm-support/project-config.js';
export const mainSiteOrigin = projectConfig.mainSiteUrl;

export function readProductionConfig(env) {
  const fail = field => { throw Error(`CONFIG_${field}`); };
  if (env.NODE_ENV !== 'production') fail('ENVIRONMENT');
  let url;
  try { url = new URL(env.FARM_ORIGIN); } catch { fail('ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('ORIGIN');
  if (!/^\d{1,5}$/.test(env.PORT || '') || Number(env.PORT) < 1 || Number(env.PORT) > 65535) fail('PORT');
  if (env.FARM_DATA_DIR !== productionDataDir) fail('DATA_DIR');
  if (typeof env.FARM_AUTH_SECRET !== 'string' || Buffer.byteLength(env.FARM_AUTH_SECRET) < 32) fail('AUTH_SECRET');
  const dataKey = Buffer.from(env.FARM_DATA_KEY_BASE64 || '', 'base64');
  if (dataKey.length !== 32 || dataKey.toString('base64') !== env.FARM_DATA_KEY_BASE64) fail('DATA_KEY');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(env.FARM_INSTANCE_ID || '')) fail('INSTANCE_ID');
  return Object.freeze({ origin: url.origin, port: Number(env.PORT), dataDir: productionDataDir, authSecret: env.FARM_AUTH_SECRET, dataKey, instanceId: env.FARM_INSTANCE_ID, mainSiteOrigin });
}

export function isPersistentMount(mountInfo) {
  return typeof mountInfo === 'string' && mountInfo.split('\n').some(line => {
    const [mount, filesystem] = line.split(' - ');
    if (!filesystem) return false;
    const fields = mount.split(' ');
    const point = fields[4]?.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    return point === productionDataDir && fields[5]?.split(',').includes('rw');
  });
}
