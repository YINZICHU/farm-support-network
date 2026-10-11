import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, join, sep, extname } from 'node:path';
import { approvedResourceBytes, assertApprovedResource } from '../../src/farm-support/resource-approval.js';

const routes = new Set(['/', '/farm-support/manage', '/farm-support/manage/', '/farm-support/activate', '/farm-support/activate/', '/zh/tools/', '/en/tools/']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function serveProductionClient(req, res, clientDir) {
  if (!['GET','HEAD'].includes(req.method)) return false;
  let path;
  try { path = decodeURIComponent(req.url.split('?')[0]); } catch { return false; }
  if (/\\|\0/.test(path) || path.split('/').some(part => part.startsWith('.'))) return false;
  const resource = Object.hasOwn(approvedResourceBytes, `public${path}`);
  const relative = resource ? path.slice(1) : routes.has(path) ? 'index.html' : /^\/assets\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(path) ? path.slice(1) : null;
  const downloadTypes = { '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pdf':'application/pdf', '.png':'image/png' };
  if (!relative || !(resource ? downloadTypes : types)[extname(relative)]) return false;
  const root = resolve(clientDir), file = resolve(root, relative);
  if (!file.startsWith(root + sep) || !existsSync(root) || lstatSync(root).isSymbolicLink()) return false;
  let current = root;
  for (const part of relative.split('/')) {
    current = join(current, part);
    if (!existsSync(current) || lstatSync(current).isSymbolicLink()) return false;
  }
  if (!lstatSync(file).isFile()) return false;
  let bytes;
  try {
    if (resource && lstatSync(file).size !== approvedResourceBytes[`public${path}`].bytes) return false;
    bytes = readFileSync(file);
    if (resource) assertApprovedResource(`public${path}`, bytes);
  } catch { return false; }
  res.setHeader('Content-Type', (resource ? downloadTypes : types)[extname(relative)]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', bytes.length);
  if (resource) res.setHeader('Content-Disposition', `attachment; filename="${relative.split('/').pop()}"`);
  res.end(req.method === 'HEAD' ? undefined : bytes);
  return true;
}
