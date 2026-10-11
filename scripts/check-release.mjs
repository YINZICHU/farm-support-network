import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { approvedResourceBytes, assertApprovedResource } from '../src/farm-support/resource-approval.js';

const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.node-version', '.gitignore', '.gitattributes', '.env.example', 'README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md', 'index.html', 'vite.config.mjs', 'render.yaml']);
const sourceDirs = new Set(['src', 'server', 'migrations', 'scripts', 'tests', 'docs', '.github', 'config', 'templates']);
const exactFiles = new Set(['config/project.json', 'templates/people.csv', 'templates/availability.csv', 'templates/requests.csv', 'templates/examples/person-create.json', 'templates/examples/request-create.json', 'templates/examples/matches.json', '.github/workflows/ci.yml', 'docs/quick-start.md', 'docs/api.md', 'docs/data-fields.md', 'docs/deployment.md', 'docs/operations.md', 'docs/identity-operations.md', 'docs/source-manifest.json']);
const excluded = new Set(['.git', 'node_modules', '.superpowers', 'dist']);
for (const path of ['docs/network-acceptance.md','docs/tool-resource-review.json','docs/tools-usage.md','docs/tools-usage.en.md','docs/superpowers/specs/2026-10-11-bilingual-network-village-tools-design.md','docs/superpowers/plans/2026-10-11-bilingual-network-village-tools.md']) exactFiles.add(path);
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.css', '.html', '.json', '.sql', '.md', '.yml', '.yaml']);
const assetExtensions = new Set(['.html', '.js', '.css', '.svg', '.png', '.ico', '.woff2']);
const forbidden = /(?:^|\/)(?:\.env(?!\.example$)|\.farm-support-runtime|\.runtime|backups?|project-assets|secrets?)(?:\/|\.|$)|\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|pem|key|p12|pfx|map|docx?|xlsx?|pdf|rtf|zip|tar|gz|log)$/i;
const credentialPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{32,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b/;
const originalAsset = /care-in-farming-seasons\.com|care-in-farming-backend\.onrender\.com|careinfarming@163\.com|\/project-assets\//i;
const blankCsvHeaders = {
  'templates/people.csv': 'name,phone,villages,skills,consent,verified,pattern_days,pattern_start,pattern_end',
  'templates/availability.csv': 'id,version,start,end,evidence,consent',
  'templates/requests.csv': 'village,household,name,phone,task,note,source,actualAt,consent',
};

function jsonSecret(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => /^(?:password|token|sessionCookie|authSecret|dataKey(?:Base64)?|backupKey(?:Base64)?|FARM_AUTH_SECRET|FARM_DATA_KEY_BASE64)$/i.test(key) && entry !== null && entry !== '' || jsonSecret(entry));
}
function fileViolation(path, content, artifact = false) {
  const resourcePath = artifact ? `public/${path}` : path;
  if (Object.hasOwn(approvedResourceBytes, resourcePath)) {
    try { assertApprovedResource(resourcePath, content); return null; } catch { return 'reviewed resource bytes differ'; }
  }
  if (resourcePath.startsWith('public/network-tools/')) return 'tool not independently approved';
  const backupCommand = !artifact && path === 'scripts/farm-support/backup.mjs';
  if ((!backupCommand && forbidden.test(path)) || /(?:^|\/)(?:pending-backup|farm-recovery)(?:\.|\/|$)/i.test(path)) return 'private or unrelated file';
  if (path === 'scripts/farm-support/local.mjs') return 'demo provisioning script';
  if (content.length > 4 * 1024 * 1024) return 'oversized source or asset needs explicit review';
  if (credentialPattern.test(content.toString('utf8'))) return 'credential-like content';
  if (!artifact && path === '.env.example') {
    return content.toString('utf8').split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#') && !/^[A-Z][A-Z0-9_]*=\s*$/.test(line)) ? 'environment template must contain names only' : null;
  }
  const top = path.split('/')[0];
  const exactOnly = ['config', 'templates', 'docs', '.github'].includes(top);
  if (artifact ? !assetExtensions.has(extname(path)) : !path.includes('/') ? !rootFiles.has(path) : exactOnly ? !exactFiles.has(path) : !sourceDirs.has(top) || !sourceExtensions.has(extname(path))) return 'file not allowlisted';
  if (content.length > 4 * 1024 * 1024) return 'oversized source or asset needs explicit review';
  if (!artifact && Object.hasOwn(blankCsvHeaders, path) && content.toString('utf8').replace(/\r\n/g, '\n') !== blankCsvHeaders[path] + '\n') return 'CSV release template must be exact header only';
  if (!artifact || ['.html', '.js', '.css', '.svg'].includes(extname(path))) {
    const text = content.toString('utf8');
    if (credentialPattern.test(text)) return 'credential-like content';
    if (artifact && originalAsset.test(text)) return 'original instance or research asset reference';
    if (!artifact && extname(path) === '.json') {
      try { if (jsonSecret(JSON.parse(text))) return 'secret-bearing JSON is not a template'; }
      catch { return 'invalid structured source'; }
    }
  }
  return null;
}

export function inspectRelease({ root, artifactRoot }) {
  const violations = [];
  const reject = (path, reason) => violations.push(`${path}: ${reason}`);
  function walk(base, relative = '', artifact = false) {
    const absolute = join(base, relative);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) { reject(relative || '.', 'symbolic links are not release inputs'); return; }
    if (!relative && !info.isDirectory()) { reject('.', 'release root must be a directory'); return; }
    const backupCommand = !artifact && info.isFile() && relative === 'scripts/farm-support/backup.mjs';
    const resource = Object.hasOwn(approvedResourceBytes, artifact ? `public/${relative}` : relative);
    if (relative && !resource && ((!backupCommand && forbidden.test(relative)) || /(?:^|\/)(?:pending-backup|farm-recovery)(?:\.|\/|$)/i.test(relative))) { reject(relative, 'private or unrelated file'); return; }
    if (info.isDirectory()) {
      if (relative && !artifact && !sourceDirs.has(relative.split('/')[0]) && !['public','public/network-tools'].includes(relative)) { reject(relative, 'directory not allowlisted'); return; }
      for (const name of readdirSync(absolute).sort()) {
        if (!relative && !artifact && excluded.has(name)) continue;
        walk(base, relative ? `${relative}/${name}` : name, artifact);
      }
      return;
    }
    if (!info.isFile()) { reject(relative, 'unsupported file type'); return; }
    if (info.size > (resource ? approvedResourceBytes[artifact ? `public/${relative}` : relative].bytes : 4 * 1024 * 1024)) { reject(relative, 'oversized source or asset needs explicit review'); return; }
    const reason = fileViolation(relative, readFileSync(absolute), artifact);
    if (reason) reject(relative, reason);
  }
  if (!existsSync(root)) reject('.', 'source root missing'); else walk(resolve(root));
  if (artifactRoot) {
    if (!existsSync(artifactRoot)) reject('dist/client', 'built output missing');
    else {
      const start = violations.length;
      walk(resolve(artifactRoot), '', true);
      for (let i = start; i < violations.length; i++) violations[i] = `dist/client/${violations[i]}`;
      if (!existsSync(join(artifactRoot, 'index.html'))) reject('dist/client/index.html', 'entry point missing');
    }
  }
  return { ok: violations.length === 0, violations };
}

export function listReleaseFiles(root) {
  if (!inspectRelease({ root }).ok) throw Error('RELEASE_INPUT_DENIED');
  const files = [];
  function walk(relative = '') {
    for (const name of readdirSync(join(root, relative)).sort()) {
      if (!relative && excluded.has(name)) continue;
      const path = relative ? `${relative}/${name}` : name;
      if (lstatSync(join(root, path)).isDirectory()) walk(path); else files.push(path);
    }
  }
  walk(); return files.sort();
}

export function inspectGitHistory(root) {
  const violations = [], checked = new Set();
  const git = (args, raw = false) => execFileSync('git', ['-c', `safe.directory=${resolve(root).replace(/\\/g,'/')}`, ...args], { cwd: root, encoding: raw ? undefined : 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 34 * 1024 * 1024 });
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') return { ok: false, violations: ['history: shallow or incomplete repository; full history required'] };
    const commits = git(['rev-list', '--all']).trim().split(/\s+/).filter(Boolean);
    if (!commits.length) throw Error('NO_HISTORY');
    for (const commit of commits) {
      for (const line of git(['ls-tree', '-rz', '--long', commit]).split('\0').filter(Boolean)) {
        const tab = line.indexOf('\t'), path = line.slice(tab + 1), [mode, type, hash, size] = line.slice(0, tab).trim().split(/\s+/);
        const key = `${mode}:${hash}:${path}`; if (checked.has(key)) continue; checked.add(key);
        const limit = approvedResourceBytes[path]?.bytes ?? 4 * 1024 * 1024;
        const reason = type !== 'blob' || !['100644', '100755'].includes(mode) ? 'unsupported history entry' : Number(size) > limit ? 'oversized history input' : fileViolation(path, git(['cat-file', 'blob', hash], true));
        if (reason) violations.push(`history/${commit.slice(0, 7)}/${path}: ${reason}`);
      }
    }
  } catch { violations.push('history: inspection could not complete'); }
  return { ok: violations.length === 0, violations };
}

async function main() {
  const result = inspectRelease({ root: process.cwd(), artifactRoot: resolve('dist/client') });
  const history = inspectGitHistory(process.cwd());
  const violations = [...result.violations, ...history.violations];
  if (!violations.length) {
    const { verifySourceManifest } = await import('./source-manifest.mjs');
    if (!verifySourceManifest(process.cwd())) violations.push('docs/source-manifest.json: inventory differs; review and regenerate');
  }
  if (!violations.length) console.log('Release inventory passed: source, history, built assets and SHA256 manifest.');
  else { for (const violation of violations) console.error(violation); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Let this module finish loading before the manifest module imports its
  // exported inventory function. Top-level await here would form a load cycle.
  main().catch(() => { console.error('RELEASE_INSPECTION_FAILED'); process.exitCode = 1; });
}
