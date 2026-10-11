import { resourceCatalog } from './resource-catalog.js';
import { translate } from './i18n.js';
import ProjectIdentity from './ProjectIdentity.jsx';
export default function ToolsPage({ locale = 'zh' }) {
  const t = (key, values) => translate(locale, key, values);
  return <main className="fs-tools-page">
    <ProjectIdentity kind="brand" />
    <nav aria-label={t('tools.navigation')}><a href={`/farm-support/manage/?lang=${locale}`}>{t('tools.workbench')}</a><a href={`/${locale === 'zh' ? 'en' : 'zh'}/tools/`}>{locale === 'zh' ? 'English' : '中文'}</a></nav>
    <header><p className="fs-eyebrow">NETWORK · {t('tools.public')}</p><h1>{t('tools.title')}</h1><p>{t('tools.intro')}</p></header>
    <p className="fs-notice">{t('tools.boundary')}</p>
    <section className="fs-tools-grid" aria-label={t('tools.catalog')}>
      {resourceCatalog.map(row => <article key={row.id} id={row.id} className="fs-tool-card">
        <p className="fs-eyebrow">{row.format} · {t(`tools.language.${row.language}`)} · {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'zh-CN', { maximumFractionDigits: 2 }).format(row.bytes / 1024 / 1024)} MiB</p>
        <h2>{row.title[locale]}</h2><p>{row.purpose[locale]}</p>
        <a className="fs-primary" href={row.path.replace(/^public/,'')} download aria-label={`${t('tools.download')} ${row.title[locale]} (${row.format}, ${t(`tools.language.${row.language}`)})`}>{t('tools.download')} · {row.format}</a>
        <p className="fs-muted">{row.adaptation[locale]}</p><small>{row.sourceCredit[locale]}</small>
      </article>)}
    </section>
    <section aria-labelledby="tools-pending"><h2 id="tools-pending">{t('tools.pendingTitle')}</h2><p>{t('tools.pending')}</p></section>
  </main>;
}
