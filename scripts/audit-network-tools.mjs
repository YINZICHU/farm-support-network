import { readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const candidateNames = Object.freeze([
  'rural-health-care-survey-template-zh.docx', 'semi-structured-interview-template-zh.docx',
  'healthcare-friction-action-planning-template-zh.xlsx', 'research-image-consent-template-bilingual.docx',
  'village-replication-toolkit.pptx', 'healthcare-friction-framework-zh.pdf', 'healthcare-friction-framework-en.pdf',
  'farming-health-calendar-zh.png', 'health-guide-front-zh.png', 'health-guide-back-zh.png',
  'navigation-card-front-zh.png', 'navigation-card-back-zh.png', 'bus-care-card-zh.png', 'travel-reminder-zh.png',
  'journey-maps-overview-zh.png', 'journey-map-a-zh.png', 'journey-map-b-zh.png', 'journey-map-c-zh.png', 'journey-map-d-zh.png',
]);

// Bounded OOXML inventory, not a sanitizer or a privacy/rights certification.
export function officeEntries(bytes) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('invalid ZIP directory');
  const count = bytes.readUInt16LE(end + 10); let at = bytes.readUInt32LE(end + 16), total = 0; const entries = [];
  if (count > 3000) throw Error('ZIP inventory too large');
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) throw Error('invalid ZIP entry');
    const method = bytes.readUInt16LE(at + 10), compressed = bytes.readUInt32LE(at + 20), size = bytes.readUInt32LE(at + 24);
    const n = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + n).toString('utf8');
    total += size; if (size > 32 * 1024 * 1024 || total > 128 * 1024 * 1024 || ![0,8].includes(method) || bytes.readUInt16LE(at + 8) & 1) throw Error('unsupported ZIP entry');
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw Error('invalid local ZIP entry');
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    if (start + compressed > bytes.length) throw Error('truncated ZIP entry');
    const raw = bytes.subarray(start, start + compressed), data = method === 8 ? inflateRawSync(raw, { maxOutputLength: 32 * 1024 * 1024 }) : raw;
    if (data.length !== size) throw Error('ZIP size mismatch');
    entries.push({ name, data }); at += 46 + n + extra + comment;
  }
  return entries;
}

export async function auditNetworkTools({ sourceRoot }) {
  const rows = [];
  for (const filename of candidateNames) {
    const findings = [], path = join(sourceRoot, filename.endsWith('.png') ? 'images' : 'downloads', filename);
    let bytes;
    try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) throw Error(); bytes = await readFile(path); }
    catch { rows.push({ filename, bytes: 0, sha256: null, status: 'excluded', findings: ['missing or unsupported exact candidate'] }); continue; }
    if (/\.(docx|xlsx|pptx)$/.test(filename)) {
      try {
        for (const { name, data } of officeEntries(bytes)) {
          if (/comments/i.test(name)) findings.push(`comments: ${name}`);
          if (/embeddings|vbaProject|activeX|customXml/i.test(name)) findings.push(`embedded or active content: ${name}`);
          if (/notesSlides|docProps/i.test(name)) findings.push(`notes/properties require manual inspection: ${name}`);
          if (/\.xml$|\.rels$/.test(name)) {
            const text = data.toString('utf8');
            if (/<(?:\w+:)?(?:vanish|webHidden)\b|state="(?:veryHidden|hidden)"|hidden="1"/i.test(text)) findings.push(`hidden content: ${name}`);
            if (/<(?:\w+:)?(?:ins|del|moveFrom|moveTo|trackRevisions)\b/.test(text)) findings.push(`tracked changes: ${name}`);
            if (/TargetMode="External"|externalLink/i.test(text)) findings.push(`external reference: ${name}`);
          }
        }
      } catch { findings.push('Office inventory failed; do not approve'); }
      findings.push('Review complete body/tables/cells, authorship and third-party reuse rights; render original for visual inspection.');
    } else if (filename.endsWith('.pdf')) {
      findings.push('Review all PDF pages, metadata, annotations, attachments, scripts and third-party reuse rights.');
      if (/\/(?:EmbeddedFile|JavaScript|JS|Launch|AcroForm)\b/.test(bytes.toString('latin1'))) findings.push('PDF active/attached content requires review');
    } else findings.push('Inspect every image visually for identifying data, source rights and local-only instructions; inspect PNG metadata.');
    rows.push({ filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), status: 'review-required', findings: [...new Set(findings)] });
  }
  return rows;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(JSON.stringify(await auditNetworkTools({ sourceRoot: resolve(process.argv[2] || '../care-in-farming-contact-release/public/project-assets') }), null, 2));
