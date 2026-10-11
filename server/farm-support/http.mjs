import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { createAuthentication } from './auth.mjs';
import { createDomain, ServiceError } from './domain.mjs';
import { serviceVillages } from '../../src/farm-support/model.js';
import { projectConfig } from '../../src/farm-support/project-config.js';
import { publicFallback } from '../../src/farm-support/public-fallback.js';
import { createRegistrationService, canReviewRegistration } from './registration.mjs';
import { createRequestPolicy } from './http-policy.mjs';
import { serveProductionClient } from './static.mjs';
import { createActivationService, invitationDetails, authorizeInvitation } from './activation.mjs';
import { productionAuthPaths, handleProductionAuth, accountSecurityStatus, requirePrivilegedMfa } from './mfa.mjs';
import { exportRecoveryBundle, readPendingBackup } from './maintenance.mjs';
import { grantCapabilities, mayManageVillage } from '../../src/farm-support/permissions.js';

const digest = token => createHash('sha256').update(token).digest('hex');
export function issueInvitation(store, input, now = Date.now(), actor = null) {
  const token = randomBytes(32).toString('base64url');
  store.transact(s => {
    const normalized = invitationDetails(input, s);
    if (actor) { authorizeInvitation(s, actor, normalized); if (normalized.projectAdmin && input.projectAdminConfirmed !== true) throw new ServiceError('PROJECT_ADMIN_CONFIRMATION_REQUIRED', 400); }
    if (s.invitations.some(i => i.email === normalized.email && !i.used && i.expires > now)) throw new ServiceError('INVITATION_ALREADY_EXISTS');
    s.invitations.push({ ...normalized, id: randomUUID(), hash: digest(token), expires: now + 86400000, used: false, issuer: actor });
  });
  return token;
}
async function body(req) {
  if (req.validatedBody) return req.validatedBody;
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ServiceError('JSON_REQUIRED', 415);
  const pieces = []; let total = 0;
  for await (const chunk of req) { total += chunk.length; if (total > 32768) throw new ServiceError('BODY_TOO_LARGE', 413); pieces.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(pieces).toString('utf8')); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; } catch { throw new ServiceError('INVALID_JSON', 400); }
}
function send(res, status, payload) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
export async function startFarmServer({ store, secret, port = 4176, mode = 'local-demo', clientDir = resolve('dist/client'), mailer = null, demoMail = false } = {}) {
  if (mode !== 'local-demo' || process.env.NODE_ENV === 'production') throw Error('LOCAL_ONLY: production hosting, MFA and data governance have not been approved');
  return launchServer({ store, secret, port, clientDir, mailer, demoMail });
}
export async function startProductionServer({ store, config, clientDir = resolve('dist/client'), loopbackOnly = false }) {
  if (store.read().environment !== 'production') throw Error('PRODUCTION_STORAGE_REQUIRED');
  return launchServer({ store, secret: config.authSecret, port: config.port, clientDir, config, loopbackOnly });
}
async function launchServer({ store, secret, port, clientDir, mailer = null, demoMail = false, config = null, loopbackOnly = false }) {
  const production = !!config;
  if (!store || !secret || secret.length < 32) throw Error('Separate persistent local database and authentication secret required');
  let handle = async (req, res) => send(res, 503, { error: 'STARTING' });
  const server = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, { error: 'SERVER_ERROR' }); else res.end(); }); });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, production && !loopbackOnly ? '0.0.0.0' : '127.0.0.1', ok); });
  const origin = production ? config.origin : `http://127.0.0.1:${server.address().port}`;
  const policy = production ? createRequestPolicy({ origin }) : null;
  let auth;
  try { auth = await createAuthentication(store.db, secret, origin, { production, checkMfaAccount: production ? userId => policy.checkAccountAttempt({ identity: `mfa:${userId}` }) : undefined }); } catch (e) { await new Promise(ok => server.close(ok)); throw e; }
  const domain = createDomain(store), authHandler = toNodeHandler(auth), rates = new Map();
  const sender = production ? null : mailer || (demoMail ? (await import('./mail.mjs')).createDemoMailer({ origin }) : null);
  const registration = production ? null : createRegistrationService({ store, auth, mailer: sender, origin });
  const activationService = production ? createActivationService({ store, auth, origin }) : null;
  let activeApiRequests = 0;
  handle = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    const url = new URL(req.url, origin), prefix = '/api/farm-support';
    if (production) {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'");
      try { policy.checkRequest(req); } catch (e) { send(res, e.status, { error: e.code }); return; }
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) { if (req.method === 'HEAD') res.end(); else send(res, 200, { status: 'ready' }); return; }
    }
    if (req.headers.host !== new URL(origin).host) { send(res, 403, { error: 'HOST_DENIED' }); return; }
    if (url.pathname.startsWith(prefix)) {
      res.setHeader('Cache-Control', 'no-store');
      activeApiRequests++;
      try {
        if (production && store.maintenanceLocked) throw new ServiceError('MAINTENANCE_BUSY', 503);
        if (!production) {
        const ip = req.socket.remoteAddress, login = url.pathname.includes('/auth/sign-in') || url.pathname.endsWith('/activate') || /\/registration\/(request|complete)$/.test(url.pathname);
        const rateKey = `${ip}:${login ? 'identity' : 'api'}`, now = Date.now();
        if (rates.size > 1000) for (const [key, entry] of rates) if (entry.until < now) rates.delete(key);
        let rate = rates.get(rateKey); if (!rate || rate.until < now) { rate = { count: 0, until: now + 60000 }; rates.set(rateKey, rate); }
        if (++rate.count > (login ? 20 : 180)) throw new ServiceError('RATE_LIMITED', 429);
        }
        if (!['GET', 'POST'].includes(req.method)) throw new ServiceError('METHOD_DENIED', 405);
        if (req.method === 'POST' && req.headers.origin !== origin) throw new ServiceError('ORIGIN_DENIED', 403);
        const path = url.pathname.slice(prefix.length);
        // Compatibility marker, not authorization. Offline operator clients may
        // omit it; the web client supplies it on every protected interaction.
        if (!['/config', '/auth/sign-out'].includes(path) && req.headers['x-farm-project-version'] !== undefined && req.headers['x-farm-project-version'] !== digest(JSON.stringify(projectConfig))) throw new ServiceError('CONFIG_MISMATCH', 409);
        if (production) {
          const routes = { '/config': 'GET', '/account/status': 'GET', '/workspace': 'GET', '/print': 'GET', '/contact': 'GET', '/matches': 'POST', '/invitation': 'POST', '/command': 'POST', '/activate': 'POST', '/backup': 'POST', '/backup/download': 'GET', ...Object.fromEntries([...productionAuthPaths].map(p => [p, 'POST'])) };
          if (routes[path] !== req.method) throw new ServiceError('NOT_FOUND', 404);
          if (req.method === 'POST') req.validatedBody = await body(req);
          if (path === '/auth/sign-in/email' || path === '/activate') policy.checkIdentityAttempt({ email: req.validatedBody.email, identity: req.validatedBody.token });
          if (path.startsWith('/auth/two-factor/')) policy.checkGlobalIdentityAttempt();
          if (path === '/config') { send(res, 200, { environment: 'production', mainSiteOrigin: projectConfig.mainSiteUrl, registrationEnabled: false, project: projectConfig }); return; }
          if (path === '/activate') { send(res, 201, await activationService.activate(req.validatedBody)); return; }
        }
        if (!production && path === '/config' && req.method === 'GET') { send(res, 200, { environment: 'local-demo', mainSiteOrigin: projectConfig.mainSiteUrl, registrationEnabled: !!sender?.enabled, project: projectConfig }); return; }
        if (path === '/public' && req.method === 'GET') { send(res, 200, domain.publicConfig()); return; }
        if (path === '/registration/config' && req.method === 'GET') { send(res, 200, { enabled: !!sender?.enabled, environment: 'local-demo' }); return; }
        if (path === '/registration/request' && req.method === 'POST') {
          const now = Date.now();
          const input = await body(req);
          const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
          const emailKey = `registration-email:${digest(email)}`;
          let entry = rates.get(emailKey); if (!entry || entry.until <= now) { entry = { count: 0, until: now + 15 * 60000 }; rates.set(emailKey, entry); }
          if (++entry.count > 5) throw new ServiceError('RATE_LIMITED', 429);
          send(res, 202, await registration.request(input)); return;
        }
        if (path === '/registration/complete' && req.method === 'POST') { send(res, 201, await registration.complete(await body(req))); return; }
        if (path.startsWith('/auth/')) {
          if (!(production ? productionAuthPaths : new Set(['/auth/sign-in/email', '/auth/sign-out'])).has(path) || req.method !== 'POST') throw new ServiceError('NOT_FOUND', 404);
          if (production) {
            const response = await handleProductionAuth({ auth, store, origin, path, headers: fromNodeHeaders(req.headers), input: req.validatedBody });
            if (!response.ok && path === '/auth/sign-in/email') { send(res, response.status === 429 ? 429 : 401, { error: response.status === 429 ? 'RATE_LIMITED' : 'SIGN_IN_FAILED' }); return; }
            for (const [name, value] of response.headers) if (name.toLowerCase() !== 'set-cookie') res.setHeader(name, value);
            if (response.headers.getSetCookie().length) res.setHeader('set-cookie', response.headers.getSetCookie());
            res.statusCode = response.status; res.end(await response.text()); return;
          }
          if (!req.headers['content-length'] || Number(req.headers['content-length']) > 32768 || !req.headers['content-type']?.startsWith('application/json')) throw new ServiceError('INVALID_BODY', 400);
          await authHandler(req, res); return;
        }
        if (path === '/activate' && req.method === 'POST') {
          const input = await body(req); if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128 || typeof input.token !== 'string') throw new ServiceError('INVALID_INVITATION', 400);
          const invitation = store.transact(s => { const i = s.invitations.find(i => i.hash === digest(input.token)); if (!i || i.used || i.expires <= Date.now() || i.claimed) throw new ServiceError('INVITATION_EXPIRED_OR_USED'); if (i.issuer) authorizeInvitation(s, i.issuer, i); i.claimed = true; store.recordBoundary?.({ kind: 'consume-invitation', id: i.id, at: Date.now() }); return { ...i }; });
          // No asynchronous authentication call inside a business transaction.
          // A crash leaves the invitation claimed; an administrator must reissue, never auto-replay it.
          const created = await auth.api.createUser({ body: { email: invitation.email, name: invitation.name, password: input.password, role: 'user' } });
          store.transact(s => { const i = s.invitations.find(i => i.id === invitation.id); if (i.issuer) authorizeInvitation(s, i.issuer, i); i.used = true; const capabilities = grantCapabilities(i); s.grants.push({ userId: created.user.id, role: i.role, villages: capabilities.projectAdmin ? s.villages.map(v => v.id) : i.villages, active: true, ...capabilities }); s.audit.push({ actor: created.user.id, command: 'invitation.activated', object: i.id, at: Date.now() }); });
          send(res, 201, { activated: true, email: invitation.email }); return;
        }
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (!session) throw new ServiceError('LOGIN_REQUIRED', 401);
        const actor = session.user.id;
        if (production) {
          const grant = store.read().grants.find(g => g.userId === actor && g.active);
          if (!grant) throw new ServiceError('LOGIN_REQUIRED', 401);
          if (path === '/account/status') { send(res, 200, { status: await accountSecurityStatus({ session, grant, auth }) }); return; }
          await requirePrivilegedMfa({ session, grant, auth });
          const liveGrant = store.read().grants.find(g => g.userId === actor && g.active);
          if (!liveGrant) throw new ServiceError('LOGIN_REQUIRED', 401);
          if (JSON.stringify(grantCapabilities(liveGrant)) !== JSON.stringify(grantCapabilities(grant)) || liveGrant.role !== grant.role || JSON.stringify(liveGrant.villages) !== JSON.stringify(grant.villages)) throw new ServiceError('AUTHORIZATION_CHANGED', 403);
          if (path === '/backup' || path === '/backup/download') {
            if (!grantCapabilities(liveGrant).projectAdmin) throw new ServiceError('FORBIDDEN', 403);
            if (path === '/backup') {
              if (activeApiRequests !== 1) throw new ServiceError('MAINTENANCE_BUSY', 503);
              const encoded = req.validatedBody.backupKeyBase64;
              if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new ServiceError('INVALID_BACKUP_KEY', 400);
              const key = Buffer.from(encoded, 'base64');
              try { send(res, 201, await exportRecoveryBundle({ store, config, outputFile: resolve(config.dataDir, 'pending-backup.bundle'), backupKey: key })); }
              finally { key.fill(0); }
            } else {
              const { bytes, name } = readPendingBackup(config, url.searchParams.get('part'));
              res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
              res.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
              res.end(bytes);
            }
            return;
          }
        }
        if (path === '/account/status' && req.method === 'GET') { send(res, 200, registration.ownStatus(actor)); return; }
        if (path === '/registration/applications' && req.method === 'GET') { send(res, 200, registration.list(actor)); return; }
        if (path === '/registration/review' && req.method === 'POST') { send(res, 200, await registration.review(actor, await body(req))); return; }
        if (path === '/registration/demo-mail' && req.method === 'GET') {
          const state = store.read(), g = state.grants.find(g => g.userId === actor && g.active && g.role === 'admin');
          if (!g) throw new ServiceError('FORBIDDEN', 403);
          if (sender?.environment !== 'local-demo' || typeof sender.list !== 'function') throw new ServiceError('NOT_FOUND', 404);
          const messages = sender.list().filter(message => {
            if (serviceVillages.every(v => g.villages.includes(v.id))) return true;
            const r = state.registrations.find(r => r.email === message.to);
            return r && canReviewRegistration(g, r);
          });
          send(res, 200, { environment: 'local-demo', messages }); return;
        }
        if (path === '/workspace' && req.method === 'GET') { send(res, 200, domain.snapshot(actor)); return; }
        if (path === '/matches' && req.method === 'POST') {
          const input = await body(req);
          send(res, 200, domain.matches(actor, { request: input.request, version: input.version, start: input.start, end: input.end })); return;
        }
        if (path === '/print' && req.method === 'GET') { send(res, 200, domain.print(actor, url.searchParams.get('id'), url.searchParams.get('recipient'))); return; }
        if (path === '/contact' && req.method === 'GET') { if (!['person', 'request', 'order'].includes(url.searchParams.get('type'))) throw new ServiceError('INVALID_TYPE', 400); send(res, 200, domain.contact(actor, url.searchParams.get('type'), url.searchParams.get('id'))); return; }
        if (path === '/invitation' && req.method === 'POST') {
          const workspace = domain.snapshot(actor), input = await body(req);
          if (!production && (input.adultVerified !== true || !input.villages?.every(v => workspace.actor.villages.includes(v)) || (!workspace.actor.projectAdmin && (input.role !== 'coordinator' || input.projectAdmin || input.canCreateVillages || input.managedVillages?.length || !input.villages.every(v => mayManageVillage(workspace.actor, v)))))) throw new ServiceError('FORBIDDEN', 403);
          send(res, 201, { activationPath: `/farm-support/activate/#${production ? activationService.issue(actor, input) : issueInvitation(store, input, Date.now(), actor)}` }); return;
        }
        if (path === '/command' && req.method === 'POST') {
          const input = await body(req); if (typeof input.command !== 'string' || !input.payload || Array.isArray(input.payload) || typeof input.payload !== 'object') throw new ServiceError('INVALID_COMMAND', 400);
          const result = domain.dispatch(actor, input.command, input.payload, input.key);
          if (input.command === 'grant.revoke') store.db.prepare('DELETE FROM session WHERE userId=?').run(input.payload.userId);
          send(res, 200, result); return;
        }
        throw new ServiceError('NOT_FOUND', 404);
      } catch (e) { send(res, e.status || 500, { error: e.code || 'SERVER_ERROR' }); }
      finally { activeApiRequests--; }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'METHOD_DENIED' }); return; }
    if (production) { if (!serveProductionClient(req, res, clientDir)) send(res, 404, { error: 'NOT_FOUND' }); return; }
    let name; try { name = decodeURIComponent(url.pathname); } catch { send(res, 400, { error: 'INVALID_PATH' }); return; }
    const root = resolve(clientDir), file = resolve(root, `.${name}`);
    if (!file.startsWith(root + sep)) { send(res, 404, { error: 'NOT_FOUND' }); return; }
    const target = extname(name) ? file : resolve(root, 'index.html');
    if (!existsSync(target)) { send(res, 404, { error: 'NOT_FOUND' }); return; }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf' };
    res.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    const privatePage = /\/(?:farm-support)\/(manage|activate|register)(\/|$)/.test(name);
    res.setHeader('Cache-Control', privatePage ? 'no-store' : 'no-cache');
    if (privatePage) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    let content = req.method === 'HEAD' ? undefined : readFileSync(target);
    if (content && /^(\/zh|\/en)?\/farm-support\/?$/.test(name)) content = content.toString('utf8').replace('</body>', `${publicFallback(name.startsWith('/en') ? 'en' : 'zh')}</body>`);
    res.end(content);
  };
  return { origin, port: server.address().port, domain, auth, async close() { await new Promise(ok => { server.close(ok); server.closeIdleConnections(); }); } };
}
