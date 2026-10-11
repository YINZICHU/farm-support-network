const apiError = (code, status = 0) => Object.assign(Error(code), { code, status });
const configurationListeners = new Set();
export function onConfigurationMismatch(listener) { configurationListeners.add(listener); return () => configurationListeners.delete(listener); }
function invalidateConfiguration(error) { for (const listener of configurationListeners) listener(error); return error; }
export async function requestApi(path, data) {
  let response;
  try {
    const headers = data ? { 'content-type': 'application/json' } : {};
    if (!['/config', '/auth/sign-out'].includes(path)) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(projectConfig)));
      headers['x-farm-project-version'] = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    response = await fetch(`/api/farm-support${path}`, { method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  } catch { throw apiError('NETWORK_UNCONFIRMED'); }
  const decoded = await response.json().catch(() => null);
  if (response.ok && (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))) throw apiError('RESPONSE_UNCONFIRMED');
  const result = decoded && typeof decoded === 'object' ? decoded : {};
  if (!response.ok && result.error === 'CONFIG_MISMATCH') throw invalidateConfiguration(apiError('CONFIG_MISMATCH', response.status));
  if (!response.ok) throw apiError(typeof result.error === 'string' ? result.error : path.includes('sign-in') ? 'SIGN_IN_FAILED' : 'SERVER_ERROR', response.status);
  return result;
}
export function actionEnvelope(command, payload, key = crypto.randomUUID()) { return { command, payload, key }; }
import { projectConfig, sameProjectConfig } from './project-config.js';
export async function loadClientConfig() {
  const config = await requestApi('/config');
  if (!['production', 'local-demo'].includes(config.environment) || !sameProjectConfig(config.project, projectConfig) || config.mainSiteOrigin !== projectConfig.mainSiteUrl || typeof config.registrationEnabled !== 'boolean' || (config.environment === 'production' && config.registrationEnabled)) throw invalidateConfiguration(apiError('CONFIG_MISMATCH'));
  return config;
}
export function prepareMutation(retry, command, payload) {
  const input = { command, payload };
  if (!retry.current || JSON.stringify(retry.current.input) !== JSON.stringify(input)) {
    retry.current = { input: structuredClone(input), envelope: actionEnvelope(command, structuredClone(payload)) };
  }
  return retry.current.envelope;
}

// MatchDialog owns query errors and discards abandoned responses. Only an
// authenticated-session failure may change the surrounding workspace.
export async function requestMatches(input, isCurrent, onUnauthorized) {
  try {
    const result = await requestApi('/matches', input);
    if (isCurrent()) return result;
  } catch (error) {
    if ((error.status === 401 || error.code === 'AUTHORIZATION_CHANGED' || error.code === 'CONFIG_MISMATCH') && isCurrent()) onUnauthorized(error);
    throw error;
  }
}
