import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function seal(value, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), payload]);
}
export function unseal(raw, key) {
  const bytes = Buffer.from(raw);
  if (bytes.length < 28) throw Error('SEALED_DATA_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
export function boundaryChain(text, key, instanceId) {
  if (text && !text.endsWith('\n')) throw Error('BOUNDARY_TRUNCATED');
  const lines = text ? text.slice(0, -1).split('\n') : [], entries = [], heads = ['0'.repeat(64)];
  for (const [index, line] of lines.entries()) {
    if (!line || !/^[A-Za-z0-9+/]+=*$/.test(line)) throw Error('BOUNDARY_INVALID');
    const item = unseal(Buffer.from(line, 'base64'), key);
    if (item.version !== 1 || item.instanceId !== instanceId || item.sequence !== index + 1 || item.previous !== heads.at(-1) || !item.record) throw Error('BOUNDARY_CHAIN_INVALID');
    heads.push(hash(line)); entries.push(item.record);
  }
  return { entries, heads, checkpoint: { sequence: lines.length, head: heads.at(-1) } };
}
