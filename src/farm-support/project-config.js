import input from '../../config/project.json' with { type: 'json' };

const fail = () => { throw Error('INVALID_PROJECT_CONFIG'); };
const controls = /[\u0000-\u001f\u007f-\u009f]/;
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  if (Object.keys(value).length !== names.length || !names.every(key => Object.hasOwn(value, key))) fail();
}
function text(value) {
  if (typeof value !== 'string' || controls.test(value) || !value.trim() || value.trim().length > 80) fail();
  return value.trim();
}
export function validateProjectConfig(value) {
  fields(value, ['schemaVersion', 'projectName', 'projectNameEn', 'contactEmail', 'mainSiteUrl', 'villages']);
  if (value.schemaVersion !== 1) fail();
  const projectName = text(value.projectName), projectNameEn = text(value.projectNameEn);
  let contactEmail = value.contactEmail, mainSiteUrl = value.mainSiteUrl;
  if (contactEmail === '') contactEmail = null;
  if (contactEmail !== null && (typeof contactEmail !== 'string' || controls.test(contactEmail) || contactEmail.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(contactEmail))) fail();
  if (mainSiteUrl === '') mainSiteUrl = null;
  if (mainSiteUrl !== null) {
    if (typeof mainSiteUrl !== 'string' || controls.test(mainSiteUrl) || mainSiteUrl.trim() !== mainSiteUrl) fail();
    let url; try { url = new URL(mainSiteUrl); } catch { fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || /[?#]/.test(mainSiteUrl)) fail();
    mainSiteUrl = url.origin;
  }
  if (!Array.isArray(value.villages) || !value.villages.length) fail();
  const ids = new Set();
  const villages = value.villages.map(v => {
    fields(v, ['id', 'zh', 'en']);
    if (typeof v.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(v.id) || ['constructor', 'prototype', '__proto__'].includes(v.id) || ids.has(v.id)) fail();
    ids.add(v.id);
    return Object.freeze({ id: v.id, zh: text(v.zh), en: text(v.en) });
  });
  return Object.freeze({ schemaVersion: 1, projectName, projectNameEn, contactEmail, mainSiteUrl, villages: Object.freeze(villages) });
}
export function sameProjectConfig(a, b) {
  try { return JSON.stringify(validateProjectConfig(a)) === JSON.stringify(validateProjectConfig(b)); } catch { return false; }
}
export const projectConfig = validateProjectConfig(input);
