import { useLocale } from './farm-support/LocaleProvider.jsx';
import { useEffect } from 'react';
import Workspace from './farm-support/Workspace.jsx';
import ToolsPage from './farm-support/ToolsPage.jsx';
import ProjectIdentity from './farm-support/ProjectIdentity.jsx';
import { projectConfig } from './farm-support/project-config.js';

export const mainSiteOrigin = projectConfig.mainSiteUrl;

export function BackendApp({ path = window.location.pathname }) {
  const { locale, t } = useLocale();

  useEffect(() => {
    // A fixed destination never carries activation fragments into another route.
    if (path === '/') window.location.replace(`/farm-support/manage/?lang=${locale}`);
  }, [path]);
  if (path === '/farm-support/manage/' || path === '/farm-support/manage') return <Workspace />;
  if (path === '/farm-support/activate/' || path === '/farm-support/activate') return <Workspace activation />;
  if (/^\/(zh|en)\/tools\/$/.test(path)) return <ToolsPage locale={locale} />;
  if (path === '/') return <main className="fs-loading" role="status">{t("正在打开工作台…")}<a href="/farm-support/manage/">{t("负责人登录")}</a></main>;
  return <main className="backend-unavailable">
    <ProjectIdentity kind="brand" />
    <h1>{t("请先联系项目方")}</h1>
    <p>{t("负责人账号由项目方核实身份和负责村后开通，居民无需注册。")}</p>
    <ProjectIdentity kind="contact" /><ProjectIdentity kind="home" />
    <a className="fs-link" href="/farm-support/manage/">{t("已有账号？负责人登录")}</a>
  </main>;
}
