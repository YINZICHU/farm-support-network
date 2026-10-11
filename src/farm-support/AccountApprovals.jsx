import { semanticError, errorMessage } from './i18n.js';
import { useLocale } from './LocaleProvider.jsx';
import { useEffect, useRef, useState } from 'react';
import { villageName as baseVillageName, shanghaiTime as baseTime } from './model.js';

export function ApplicationCard({ application, villages, villageFacts = [], busy, onSubmit }) {
  const { locale, t } = useLocale();

  const villageName=id=>baseVillageName(id,locale,villageFacts);
  const pending = application.status === 'PENDING';
  return <article className="fs-application-card"><div><span className="fs-tag">{pending ? t("已验证 · 待审批") : application.status === 'APPROVED' ? t("已批准") : t("未批准")}</span><h3>{application.name}</h3><p>{application.email}</p>{application.requestedVillages.length > 0 && <p className="fs-muted">{t("申请意向：")}{application.requestedVillages.map(v => villageName(v)).join('、')}</p>}{application.requestedOtherVillage && <div className="fs-notice"><strong>{t("新村庄接入申请：")}{application.requestedOtherVillage}</strong><p>{t("请先核实村庄与实际负责人。填写名称不会建立新村权限；下方只能分配已配置的服务村，新村开通需另行确认。")}</p></div>}</div>
    {pending && <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSubmit({ id: application.id, version: application.version, decision: event.nativeEvent.submitter?.value || 'approve', role: data.get('role'), villages: data.getAll('villages'), adultVerified: data.get('adultVerified') === 'on' }); }}>
      <label className="fs-field">{t("分配角色")}<select name="role"><option value="coordinator">{t("村级协调负责人")}</option><option value="analyst">{t("脱敏汇总查看者")}</option><option value="reviewer">{t("独立复核人")}</option></select></label>
      <fieldset className="fs-register-villages"><legend>{t("分配服务村")}</legend><div>{villages.map(id => <label key={id}><input type="checkbox" name="villages" value={id} defaultChecked={application.requestedVillages.includes(id)} />{villageName(id)}</label>)}</div></fieldset>
      <label className="fs-check"><input type="checkbox" name="adultVerified" required />{t("我作为授权成年管理员已核实实际负责人身份，并确认本次权限决定。")}</label>
      <div className="fs-inline-actions"><button type="submit" className="fs-button" name="decision" value="approve" disabled={busy}>{t("批准并分配权限")}</button><button type="submit" className="fs-outline" name="decision" value="reject" disabled={busy}>{t("暂不批准")}</button></div>
    </form>}
  </article>;
}

export default function AccountApprovals({ api, villages, villageFacts = [], onPermissionsChanged, onUnauthorized }) {
  const { locale, t } = useLocale();

  const shanghaiTime=value=>baseTime(value,locale);
  const [applications, setApplications] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [messages, setMessages] = useState(null);
  const live = useRef(false), requestVersion = useRef(0);
  function failed(e) { if (!live.current) return; if (e.status === 401 || e.status === 403) { setApplications(null); setMessages(null); onUnauthorized(e); } else setError(semanticError(e)); }
  async function refresh() {
    const version = ++requestVersion.current;
    try { const data = await api('/registration/applications'); if (live.current && version === requestVersion.current) { setApplications(data); setError(''); } } catch (e) { if (version === requestVersion.current) failed(e); }
  }
  useEffect(() => { live.current = true; refresh(); return () => { live.current = false; requestVersion.current++; }; }, []);
  async function decide(input) {
    if (input.decision === 'approve' && !input.villages.length) { setError({code:'CHOOSE_VILLAGE'}); return; }
    setBusy(true); setError(''); setNotice('');
    try { await api('/registration/review', input); if (live.current) { setNotice({key:'权限决定已保存；申请人需重新登录。'}); await onPermissionsChanged(); } }
    catch (e) { failed(e); if (live.current && e.code === 'STALE_VERSION') await refresh(); }
    finally { if (live.current) setBusy(false); }
  }
  async function inbox() {
    setBusy(true); setError('');
    try { const data = await api('/registration/demo-mail'); if (live.current) setMessages(data.messages); } catch (e) { failed(e); } finally { if (live.current) setBusy(false); }
  }
  return <section className="fs-panel fs-account-approvals" aria-labelledby="fs-account-approvals-title">
    <div className="fs-section-heading"><div><p className="fs-kicker">{t("账号与权限")}</p><h2 id="fs-account-approvals-title">{t("审核负责人申请")}</h2></div><button type="button" className="fs-outline" disabled={busy} onClick={refresh}>{t("刷新申请")}</button></div>
    <p>{t("邮箱验证后，账号仍没有业务权限。请核实本人身份，再分配角色和服务村。")}</p>
    <p><a className="fs-link" href="/farm-support/register/" target="_blank" rel="noopener noreferrer">{t("打开负责人申请页 ↗")}</a></p>
    <div className="fs-error" role="alert">{error&&errorMessage(locale,error.code)}</div><div className="fs-save-notice" role="status" aria-live="polite">{notice&&t(notice.key)}</div>
    {applications === null ? <p role="status">{t("正在读取申请…")}</p> : applications.length ? applications.map(application => <ApplicationCard key={`${application.id}-${application.version}`} {...{ application, villages, villageFacts, busy }} onSubmit={decide} />) : <p className="fs-muted">{t("还没有已验证的负责人申请。")}</p>}
    <details className="fs-test-inbox"><summary>{t("本地测试收件箱")}</summary><p className="fs-demo-note">{t("测试邮件，未发往真实邮箱。仅本地授权管理员可查看，重启演示服务会清空收件箱。")}</p><button type="button" className="fs-outline" disabled={busy} onClick={inbox}>{t("刷新测试邮件")}</button>
      {messages?.length === 0 && <p role="status">{t("暂无测试邮件。可先在申请页使用虚构资料提交。")}</p>}
      {messages && [...messages].reverse().map(mail => <article key={mail.id} className="fs-demo-mail"><h3>{mail.subject}</h3><p>{mail.to} · {shanghaiTime(mail.at)}</p><p>{mail.text}</p>{mail.verificationUrl && <a className="fs-link" href={mail.verificationUrl} target="_blank" rel="noopener noreferrer">{t("打开本地验证与设置密码页 ↗")}</a>}</article>)}
    </details>
  </section>;
}
