import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('candidate cards distinguish usual time from confirmation and do not auto-assign', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { CandidateResults } = await vite.ssrLoadModule('/src/farm-support/MatchDialog.jsx');
    const html = renderToStaticMarkup(React.createElement(CandidateResults, { result: {
      candidates: [ { id: 'p1', code: 'P-1', availabilityStatus: 'usual', reasons: ['通常可用星期和时段相符；本次日期仍需本人确认'] } ],
      checkedAt: Date.parse('2026-10-12T09:00:00+08:00'), capacityAvailable: true,
    }, onContact() {}, busy: false }));
    assert.match(html, /通常时段相符/); assert.match(html, /需本人确认/);
    assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/);
    assert.match(html, /<button[^>]*type="button"[^>]*>.*?联系资料/s);
    assert.doesNotMatch(html, /已安排成功|自动派单|type="submit"/);
  } finally { await vite.close(); }
});

test('no-match and capacity-full states offer next steps without promising availability', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { CandidateResults } = await vite.ssrLoadModule('/src/farm-support/MatchDialog.jsx');
    const html = renderToStaticMarkup(React.createElement(CandidateResults, { result: { candidates: [], checkedAt: Date.now(), capacityAvailable: false }, busy: false }));
    assert.match(html, /名额已占用/); assert.match(html, /换一个时段|候补/);
    assert.doesNotMatch(html, /已预约|已安排成功/);
  } finally { await vite.close(); }
});
