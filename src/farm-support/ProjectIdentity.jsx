import { useLocale } from './LocaleProvider.jsx';
import { projectConfig, validateProjectConfig } from './project-config.js';
import './project-identity.css';

export default function ProjectIdentity({ kind, project = projectConfig }) {
  const { locale, t } = useLocale();

  const p = validateProjectConfig(project);
  if (kind === 'brand') {
    const name = <>{p.projectName}<span>{p.projectNameEn}</span></>;
    return p.mainSiteUrl ? <a className="fs-brand fs-project-brand" href={p.mainSiteUrl}>{name}</a> : <div className="fs-brand fs-project-brand">{name}</div>;
  }
  if (kind === 'home') return p.mainSiteUrl ? <a className="fs-link" href={p.mainSiteUrl}>{t("返回项目主网站 · Project home")}</a> : null;
  if (kind === 'contact') return p.contactEmail ? <a className="fs-link" href={'mailto:' + encodeURIComponent(p.contactEmail).replace(/%40/g, '@')}>{p.contactEmail}</a> : <span>{t("请当面或通过已核实的方式联系本项目管理员。")}</span>;
  return null;
}
