import { villageA, villageB } from '../fixture-villages.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
// Vite renders the real configured file, not the optional second scope added
// in memory for isolated one-village authorization tests.
const renderedVillageCount = JSON.parse(readFileSync('config/project.json', 'utf8')).villages.length;

async function components(t) {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  t.after(() => vite.close());
  const registration = await vite.ssrLoadModule('/src/farm-support/Registration.jsx').catch(() => ({}));
  assert.equal(typeof registration.RegistrationView, 'function', 'registration view is implemented');
  const approvals = await vite.ssrLoadModule('/src/farm-support/AccountApprovals.jsx');
  return { ...registration, ...approvals };
}
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('coordinator form collects only necessary application fields and labels all configured villages', async t => {
  const { RegistrationView } = await components(t);
  for (const locale of ['zh', 'en']) {
    const html = render(RegistrationView, { locale, mode: 'request', config: { enabled: true, environment: 'local-demo' } });
    for (const field of ['email', 'name', 'villages', 'consent']) assert.ok(html.includes(`name="${field}"`));
    assert.equal((html.match(/name="villages"/g) || []).length, renderedVillageCount);
    assert.doesNotMatch(html, /name="(?:password|phone|role|medical|identity)"/);
    assert.match(html, /<fieldset/); assert.match(html, /<legend/);
    assert.match(html, /未发往真实邮箱|not sent to a real email/);
    assert.match(html, /href="\/farm-support\/manage\/"/);
  }
});

test('pending and disabled account views contain no workspace data and offer refresh and logout', async t => {
  const { RegistrationView } = await components(t);
  for (const status of ['PENDING', 'REJECTED', 'DISABLED']) {
    const html = render(RegistrationView, { locale: 'zh', mode: 'status', account: { status, requestedVillages: [villageA] } });
    assert.match(html, /aria-live="polite"/); assert.match(html, /退出/); assert.match(html, /刷新状态/);
    assert.doesNotMatch(html, /人员名单|联系电话|服务单详情|授权账号/);
    if (status === 'PENDING') assert.match(html, /等待管理员分配权限/);
  }
});

test('password setup requires explicit submission and disabled registration never claims sent', async t => {
  const { RegistrationView } = await components(t);
  const html = render(RegistrationView, { locale: 'en', mode: 'verify', tokenPresent: true });
  assert.match(html, /autocomplete="new-password"/i); assert.match(html, /minLength="12"/i);
  assert.match(html, /type="submit"/); assert.match(html, /name="confirmPassword"/);
  const missing = render(RegistrationView, { mode: 'verify', tokenPresent: false });
  assert.doesNotMatch(missing, /<form/);
  const unavailable = render(RegistrationView, { mode: 'request', config: { enabled: false } });
  assert.match(unavailable, /注册暂未开放/); assert.doesNotMatch(unavailable, /<form|已发送/);
});

test('admin application form only permits allowed roles and approved village choices', async t => {
  const { ApplicationCard } = await components(t);
  const html = render(ApplicationCard, { application: { id: 'r', name: 'Test', email: 'fictional@example.test', status: 'PENDING', requestedVillages: [villageA], version: 1 }, villages: [villageA], busy: false });
  for (const role of ['coordinator', 'reviewer', 'analyst']) assert.ok(html.includes(`value="${role}"`));
  assert.doesNotMatch(html, /value="admin"/); assert.ok(!html.includes(`value="${villageB}"`));
  assert.match(html, /name="adultVerified"/); assert.match(html, /核实/);
  assert.match(html, /<button(?=[^>]*name="decision")(?=[^>]*value="approve")/); assert.match(html, /<button(?=[^>]*name="decision")(?=[^>]*value="reject")/);
});

test('registration feedback follows the current language instead of retaining submitted language', async t => {
  const { RegistrationView } = await components(t);
  const feedback = { mode: 'request', config: { enabled: true }, noticeKey: 'receivedDemo', errorKey: 'REGISTRATION_MAIL_FAILED' };
  const zh = render(RegistrationView, { ...feedback, locale: 'zh' });
  const en = render(RegistrationView, { ...feedback, locale: 'en' });
  assert.match(zh, /申请已受理/); assert.match(zh, /验证邮件未能发出/);
  assert.match(en, /Request received/); assert.match(en, /The email could not be sent/);
  assert.doesNotMatch(en, /申请已受理|验证邮件未能发出/);
  assert.match(render(RegistrationView, { ...feedback, locale: 'en', errorKey: 'chooseVillage' }), /Choose a village or enter the name of another village/);
  assert.match(render(RegistrationView, { ...feedback, locale: 'en', errorKey: 'UNEXPECTED_PROVIDER_DETAIL' }), /Unable to complete this request/);
});

test('both registration languages offer an optional labelled other-village field', async t => {
  const { RegistrationView } = await components(t);
  for (const locale of ['zh', 'en']) {
    const props = { locale, config: { enabled: true }, mode: 'request' };
    const initial = render(RegistrationView, props);
    assert.match(initial, /name="otherVillageEnabled"/);
    assert.doesNotMatch(initial, /name="otherVillage"/);
    const expanded = render(RegistrationView, { ...props, otherVillageEnabled: true });
    assert.match(expanded, /<input(?=[^>]*name="otherVillage")(?=[^>]*required)(?=[^>]*maxLength="80")(?=[^>]*aria-describedby="fs-other-village-hint")/i);
    assert.match(expanded, locale === 'zh' ? /其他村庄（填写名称）/ : /Other village \(enter name\)/);
    assert.match(expanded, /id="fs-other-village-hint"/);
    assert.equal((expanded.match(/name="villages"/g) || []).length, renderedVillageCount);
  }
});

test('pending and approval views display the requested village as escaped text, not an access choice', async t => {
  const { RegistrationView, ApplicationCard } = await components(t);
  const application = { id: 'r', userId: 'u', name: 'Test', email: 'fictional@example.test', status: 'PENDING', requestedVillages: [], requestedOtherVillage: '<b>虚构接入村</b>', version: 1 };
  for (const locale of ['zh', 'en']) {
    const pending = render(RegistrationView, { locale, mode: 'status', account: application });
    assert.match(pending, /&lt;b&gt;虚构接入村&lt;\/b&gt;/);
    assert.doesNotMatch(pending, /<b>虚构接入村<\/b>/);
  }
  const review = render(ApplicationCard, { application, villages: [villageA], busy: false });
  assert.match(review, /&lt;b&gt;虚构接入村&lt;\/b&gt;/);
  assert.match(review, /新村庄接入申请/);
  assert.doesNotMatch(review, /<input[^>]*value="[^\"]*虚构接入村/);
});
