import { useLocale } from './LocaleProvider.jsx';
import { operationsGuide } from './operations-guide.js';
export default function OperationsGuide({actor,environment,storageReadonly}){
  const {locale,t}=useLocale();
  return <section className="fs-operations-guide"><h2>{t('操作与运维指南')}</h2><p>{t('按当前授权显示。这里不收集密码、密钥或恢复码；操作仍需在相应页面或受控控制台完成。')}</p>{storageReadonly&&<p className="fs-notice" role="status">{t('当前只读：新输入尚未保存，请联系项目级管理员。')}</p>}{environment!=='production'&&<p className="fs-muted">{t('本地演示只使用虚构资料，不能作为正式服务或部署验收。')}</p>}{operationsGuide(locale,actor).map(m=><article className="fs-panel" key={m.id} id={`guide-${m.id}`}><h3>{m.title}</h3><ol>{m.steps.map(step=><li key={step}>{step}</li>)}</ol>{m.links.map(link=><a className="fs-outline" key={link.href} href={link.href}>{link.label}</a>)}</article>)}</section>;
}
