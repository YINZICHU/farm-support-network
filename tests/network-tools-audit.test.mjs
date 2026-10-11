import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditNetworkTools } from '../scripts/audit-network-tools.mjs';

// A fictional stored-ZIP fixture; no resident records or source assets.
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), data = Buffer.from(text), h = Buffer.alloc(30), c = Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n); offset += h.length + n.length + data.length;
  }
  const d = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, d, end]);
}
test('hidden response/comment/embedded object requires review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'network-audit-'));
  try {
    await mkdir(join(root, 'downloads'));
    await writeFile(join(root, 'downloads/rural-health-care-survey-template-zh.docx'), zip({
      'word/document.xml': '<w:document><w:vanish/><w:t>Fictional hidden response</w:t><w:ins/></w:document>',
      'word/comments.xml': '<w:comment>Fictional reviewer note</w:comment>',
      'word/embeddings/fictional.bin': 'Fictional embedded object',
    }));
    const row = (await auditNetworkTools({ sourceRoot: root })).find(r => r.filename === 'rural-health-care-survey-template-zh.docx');
    assert.equal(row.status, 'review-required');
    assert.match(row.findings.join(' '), /hidden/i); assert.match(row.findings.join(' '), /comment/i); assert.match(row.findings.join(' '), /embedded/i);
    assert.equal((await auditNetworkTools({ sourceRoot: root })).length, 19);
  } finally { await rm(root, { recursive: true, force: true }); }
});
