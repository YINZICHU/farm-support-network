import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('factor setup and challenge expose labeled controls, backup-code recovery and no workspace data', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const mod = await vite.ssrLoadModule('/src/farm-support/AccountSecurity.jsx').catch(() => ({}));
    assert.equal(typeof mod.default, 'function', 'factor setup/challenge view must exist');
    const setup = renderToStaticMarkup(React.createElement(mod.default, { state: 'MFA_SETUP_REQUIRED', onSubmit() {}, onLogout() {} }));
    assert.match(setup, /type="password"/); assert.match(setup, /autoComplete="current-password"/); assert.match(setup, /<label/);
    const challenge = renderToStaticMarkup(React.createElement(mod.default, { state: 'MFA_CHALLENGE_REQUIRED', error: '验证码未通过', onSubmit() {}, onLogout() {} }));
    assert.match(challenge, /one-time-code/); assert.match(challenge, /恢复码/); assert.match(challenge, /role="alert"/);
    assert.match(challenge, /本项目管理员/); assert.doesNotMatch(challenge, /fs-record|fs-order-card|mailto:.*password=/);
  } finally { await vite.close(); }
});
test('account maintenance refuses missing explicit console operation without leaking runtime input', () => {
  const run = spawnSync(process.execPath, ['scripts/farm-support/account-recovery.mjs'], { encoding: 'utf8', env: { ...process.env, FARM_AUTH_SECRET: 'Fictional-Must-Not-Appear-In-Output' } });
  assert.equal(run.status, 1); assert.match(run.stderr, /ACCOUNT_OPERATION_REQUIRED/);
  assert.doesNotMatch(run.stdout + run.stderr, /Fictional-Must-Not-Appear-In-Output|at file:/);
});
