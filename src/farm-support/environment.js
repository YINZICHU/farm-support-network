import { projectConfig } from './project-config.js';
import { translate } from './i18n.js';
export const mainSiteOrigin = projectConfig.mainSiteUrl;
export function environmentCopy(environment, locale = 'zh') {
  const mode = environment === 'production' ? 'production' : 'demo';
  return { ...Object.fromEntries(['label', 'notice', 'operator', 'admin', 'scope'].map(key => [key, translate(locale, `environment.${mode}.${key}`)])), saved: translate(locale, `notice.saved.${mode}`) };
}
