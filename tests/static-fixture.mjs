import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function temporaryClient(t) {
  const dir = mkdtempSync(join(tmpdir(), 'farm-client-test-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
