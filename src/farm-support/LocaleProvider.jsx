import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translate } from './i18n.js';
import { projectConfig } from './project-config.js';
export const LocaleContext = createContext({ locale: 'zh', setLocale() {}, t: (key, values) => translate('zh', key, values) });
function initialLocale() {
  if (typeof window === 'undefined') return 'zh';
  const query = new URL(window.location.href).searchParams.get('lang');
  if (query !== null) return query === 'en' ? 'en' : 'zh';
  const pathLocale = window.location.pathname.match(/^\/(zh|en)\/tools\//)?.[1];
  if (pathLocale) return pathLocale;
  try { return window.localStorage.getItem('network.locale') === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}
export function LocaleProvider({ children }) {
  const [locale, update] = useState(initialLocale);
  const value = useMemo(() => ({ locale, setLocale: next => update(next === 'en' ? 'en' : 'zh'), t: (key, values) => translate(locale, key, values) }), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
    document.title = `${translate(locale, 'workspace.title')} | ${locale === 'en' ? projectConfig.projectNameEn : projectConfig.projectName}`;
    try { window.localStorage.setItem('network.locale', locale); } catch { /* preference is optional */ }
    const url = new URL(window.location.href); url.searchParams.set('lang', locale);
    if (/^\/(zh|en)\/tools\/$/.test(url.pathname)) url.pathname = `/${locale}/tools/`;
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale() { return useContext(LocaleContext); }
export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
  return <div className="fs-language-switch" role="group" aria-label={t('language')}><button type="button" lang="zh-CN" aria-pressed={locale === 'zh'} onClick={() => setLocale('zh')}>中文</button><button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button></div>;
}
