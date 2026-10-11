import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { approvedResourceBytes, assertApprovedResource } from '../src/farm-support/resource-approval.js';
import { resourceCatalog } from '../src/farm-support/resource-catalog.js';

test('binary approval rejects a replacement even if catalog is edited', () => {
  const entry = resourceCatalog[0], original = readFileSync(entry.path), changed = Buffer.from(original);
  changed[changed.length - 1] ^= 1;
  const editedCatalog = { ...entry, bytes: changed.length, sha256: createHash('sha256').update(changed).digest('hex') };
  assert.notEqual(editedCatalog.sha256, approvedResourceBytes[entry.path].sha256);
  assert.throws(() => assertApprovedResource(editedCatalog.path, changed), /RESOURCE_NOT_APPROVED/);
  assert.throws(() => assertApprovedResource('public/network-tools/unknown.docx', original), /RESOURCE_NOT_APPROVED/);
});
test('catalog labels actual original language and exact bytes', () => {
  const entry = resourceCatalog.find(r => r.id === 'farming-health-calendar-zh');
  assert.equal(entry.language, 'zh'); assert.equal(entry.format, 'PNG');
  for (const row of resourceCatalog) {
    const copied = readFileSync(row.path);
    assert.equal(row.bytes, copied.length); assert.equal(row.sha256,createHash('sha256').update(copied).digest('hex')); assertApprovedResource(row.path, copied);
    for (const key of ['title','purpose','adaptation','sourceCredit']) { assert.ok(row[key].zh); assert.ok(row[key].en); }
  }
  const review = JSON.parse(readFileSync('docs/tool-resource-review.json', 'utf8'));
  assert.equal(review.resources.length, 19);
  assert.deepEqual(review.resources.filter(r => r.status === 'accepted').map(r => r.path).sort(), resourceCatalog.map(r => r.path).sort());
});
