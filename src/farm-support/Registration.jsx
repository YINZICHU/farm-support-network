import { useEffect, useRef, useState } from 'react';
import { requestApi } from './api.js';
import ProjectIdentity from './ProjectIdentity.jsx';
import { projectConfig } from './project-config.js';
import { serviceVillages, villageName } from './model.js';

const words = {
  zh: { label: '农忙支援 · 负责人账号', story: '让每个村的协作，\n从一位负责人开始。', intro: '居民仍可电话或当面联系。负责人核实需求、协调人员，获授权后管理对应村的资料。', steps: ['申请并验证邮箱', '自己设置登录密码', '管理员核实并分配权限'], request: '申请负责人账号', verify: '验证邮箱，设置密码', name: '负责人姓名', email: '邮箱', villages: '希望服务的村（可多选）', intent: '这里填写申请意向，实际权限由管理员核实后分配。', consent: '我同意为账号申请提供以上资料，并理解邮箱验证后仍需管理员审核。', submit: '发送验证链接', password: '设置密码（12–128位）', confirm: '再次输入密码', set: '验证并设置密码', busy: '正在处理…', login: '返回负责人登录', home: '返回主网站', offline: '居民和农活提供方无需注册。', demo: '本地演示：测试邮件，未发往真实邮箱。仅使用虚构姓名和邮箱。', unavailable: '注册暂未开放', unavailableBody: '邮件服务暂不可用，请稍后再试，或通过项目联系邮箱咨询。', checking: '正在检查注册服务…', missing: '请从验证邮件中打开完整链接。链接有效期30分钟，使用一次后失效。', pending: '等待管理员分配权限', rejected: '申请暂未获准', disabled: '账号当前未获授权', pendingBody: '邮箱已验证。管理员核实你的负责人身份后，会分配角色和服务村。获准后请重新登录。', rejectedBody: '如需继续申请，请联系项目管理员核实。', disabledBody: '请联系项目管理员确认账号状态。', refresh: '刷新状态', logout: '退出登录', requested: '申请服务村', completed: '邮箱已验证，密码已设置。请登录查看申请状态，等待管理员分配权限。', received: '申请已受理，请查看邮箱中的账号说明或验证链接。', receivedDemo: '申请已受理。本地管理员可在“测试收件箱”查看演示邮件；不会发送到真实邮箱。', chooseVillage: '请至少选择一个希望服务的村。', mismatch: '两次输入的密码不一致，请重新核对。', failed: '暂时无法完成，请稍后重试。', errors: { REGISTRATION_LINK_INVALID: '链接已过期或使用过，请重新申请验证链接。', REGISTRATION_UNAVAILABLE: '注册暂未开放，请稍后再试。', REGISTRATION_MAIL_FAILED: '验证邮件未能发出，请稍后重新提交。', REGISTRATION_SETUP_FAILED: '账号设置未完成，请联系管理员核查。已使用的链接不能再次提交。', INVALID_REGISTRATION: '请核对姓名、邮箱、申请村和告知同意。', INVALID_REGISTRATION_PASSWORD: '密码须为12–128位。', RATE_LIMITED: '提交过于频繁，请稍后重试。' } },
  en: { label: 'Farm support · Coordinator accounts', story: 'Local coordination\nstarts with a coordinator.', intro: 'Residents can still call or speak to a coordinator in person. Approved coordinators manage requests and records for their assigned villages.', steps: ['Apply and verify your email', 'Set your own password', 'An administrator assigns access'], request: 'Apply for a coordinator account', verify: 'Verify email and set a password', name: 'Coordinator name', email: 'Email address', villages: 'Villages you wish to support', intent: 'These are requested villages. An administrator confirms your identity and assigns access.', consent: 'I agree to provide these details for my account application and understand that administrator approval is still required.', submit: 'Send verification link', password: 'New password (12–128 characters)', confirm: 'Confirm password', set: 'Verify and set password', busy: 'Working…', login: 'Back to coordinator login', home: 'Back to main website', offline: 'Residents and farm-work providers do not need accounts.', demo: 'Local demonstration: test messages are not sent to a real email address. Use fictional details only.', unavailable: 'Registration is not open yet', unavailableBody: 'The email service is unavailable. Try later or contact the project by email.', checking: 'Checking registration availability…', missing: 'Open the complete link from your verification email. Links expire after 30 minutes and can be used once.', pending: 'Waiting for access approval', rejected: 'Application not approved', disabled: 'This account has no active access', pendingBody: 'Your email is verified. An administrator will confirm your coordinator role and assign villages. Sign in again after approval.', rejectedBody: 'Contact the project administrator if you would like your application reviewed.', disabledBody: 'Contact the project administrator to confirm your account status.', refresh: 'Refresh status', logout: 'Sign out', requested: 'Requested villages', completed: 'Your email is verified and your password is set. Sign in to view your application status. Administrator approval is still required.', received: 'Request received. Check your email for account information or a verification link.', receivedDemo: 'Request received. The local administrator can view the message in the test inbox. No real email has been sent.', chooseVillage: 'Choose at least one village.', mismatch: 'The passwords do not match. Please check them.', failed: 'Unable to complete this request. Please try again later.', errors: { REGISTRATION_LINK_INVALID: 'This link has expired or has been used. Request a new verification link.', REGISTRATION_UNAVAILABLE: 'Registration is not open yet. Please try later.', REGISTRATION_MAIL_FAILED: 'The email could not be sent. Please try again later.', REGISTRATION_SETUP_FAILED: 'Account setup could not finish. Contact the administrator; this link cannot be reused.', INVALID_REGISTRATION: 'Check your name, email, villages and consent.', INVALID_REGISTRATION_PASSWORD: 'Use a password between 12 and 128 characters.', RATE_LIMITED: 'Too many requests. Please try again later.' } },
};

const otherVillageWords = {
  zh: { otherVillage: '其他村庄（填写名称）', otherName: '村庄名称', otherPlaceholder: '请输入村庄名称，可附乡镇以便区分', otherHint: '新村庄将作为接入申请提交，由项目管理员核实；填写名称不会自动开通后台权限。', chooseVillage: '请选择一个服务村，或填写其他村庄名称。' },
  en: { otherVillage: 'Other village (enter name)', otherName: 'Village name', otherPlaceholder: 'Enter the village name; include its town if helpful', otherHint: 'An unlisted village is submitted for project administrator review. Entering its name does not grant access.', chooseVillage: 'Choose a village or enter the name of another village.' },
};

export function RegistrationView({ locale = 'zh', mode = 'request', config = null, account = null, busy = false, error = '', notice = '', errorKey = '', noticeKey = '', tokenPresent = false, completed = false, otherVillageEnabled = false, onOtherVillageChange, onSubmit, onRefresh, onLogout, onLanguage }) {
  const t = { ...words[locale], ...otherVillageWords[locale] }, status = account?.status;
  const requestedNames = [...(account?.requestedVillages || []).map(id => villageName(id, locale)), ...(account?.requestedOtherVillage ? [account.requestedOtherVillage] : [])];
  const statusTitle = status === 'PENDING' ? t.pending : status === 'REJECTED' ? t.rejected : t.disabled;
  return <div className="fs-login fs-registration">
    <a className="skip-link" href="#fs-registration-main">{locale === 'zh' ? '跳到表单' : 'Skip to form'}</a>
    <div className="fs-login-story"><ProjectIdentity kind="brand" /><p className="fs-kicker">{t.label}</p><h1>{t.story}</h1><p>{t.intro}</p><ol className="fs-register-steps">{t.steps.map(step => <li key={step}>{step}</li>)}</ol><small>{t.offline}</small></div>
    <main className="fs-login-form" id="fs-registration-main">
      <div className="fs-registration-nav"><ProjectIdentity kind="home" /><button type="button" className="fs-link" onClick={onLanguage}>{locale === 'zh' ? 'English' : '中文'}</button></div>
      <p className="fs-kicker">{t.label}</p><h2>{mode === 'status' ? statusTitle : mode === 'verify' ? t.verify : t.request}</h2>
      {config?.environment === 'local-demo' && <p className="fs-demo-note">{t.demo}</p>}
      <div role="status" aria-live="polite" className="fs-save-notice">{noticeKey ? t[noticeKey] : notice}</div><div role="alert" className="fs-error">{errorKey ? t.errors[errorKey] || t[errorKey] || t.failed : error}</div>
      {mode === 'request' && (config === null ? <p role="status">{t.checking}</p> : !config.enabled ? <div className="fs-notice"><strong>{t.unavailable}</strong><p>{t.unavailableBody}</p><ProjectIdentity kind="contact" /></div> : <form onSubmit={onSubmit}>
        <label className="fs-field">{t.name}<input name="name" autoComplete="name" maxLength={60} required /></label>
        <label className="fs-field">{t.email}<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
        <fieldset className="fs-register-villages"><legend>{t.villages}</legend><div>{serviceVillages.map(v => <label key={v.id}><input type="checkbox" name="villages" value={v.id} />{v[locale]}</label>)}<label><input type="checkbox" name="otherVillageEnabled" checked={otherVillageEnabled} onChange={event => onOtherVillageChange?.(event.target.checked)} aria-controls={otherVillageEnabled ? 'fs-other-village-field' : undefined} />{t.otherVillage}</label></div></fieldset>
        {otherVillageEnabled && <div id="fs-other-village-field"><label className="fs-field">{t.otherName}<input name="otherVillage" maxLength={80} required placeholder={t.otherPlaceholder} aria-describedby="fs-other-village-hint" /></label><p id="fs-other-village-hint" className="fs-muted">{t.otherHint}</p></div>}
        <p className="fs-muted">{t.intent}</p><label className="fs-check"><input name="consent" type="checkbox" required />{t.consent}</label>
        <button type="submit" className="fs-button" disabled={busy}>{busy ? t.busy : t.submit}</button>
      </form>)}
      {mode === 'verify' && !completed && (tokenPresent ? <form onSubmit={onSubmit}>
        <label className="fs-field">{t.password}<input type="password" name="password" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
        <label className="fs-field">{t.confirm}<input type="password" name="confirmPassword" minLength={12} maxLength={128} autoComplete="new-password" required /></label>
        <button type="submit" className="fs-button" disabled={busy}>{busy ? t.busy : t.set}</button>
      </form> : <p className="fs-notice">{t.missing}</p>)}
      {mode === 'status' && <><p>{status === 'PENDING' ? t.pendingBody : status === 'REJECTED' ? t.rejectedBody : t.disabledBody}</p>{requestedNames.length > 0 && <p className="fs-muted">{t.requested}: {requestedNames.join(' / ')}</p>}<div className="fs-inline-actions"><button type="button" className="fs-button" disabled={busy} onClick={onRefresh}>{t.refresh}</button><button type="button" className="fs-outline" disabled={busy} onClick={onLogout}>{t.logout}</button></div></>}
      {mode !== 'status' && <a className="fs-link" href="/farm-support/manage/">{t.login} →</a>}
      {mode === 'verify' && !tokenPresent && !completed && <p><a className="fs-link" href="/farm-support/register/">{t.request}</a></p>}
    </main>
  </div>;
}

export default function Registration({ locale: initialLocale = 'zh', mode = 'request' }) {
  const [locale, setLocale] = useState(initialLocale), [config, setConfig] = useState(null), [busy, setBusy] = useState(false), [errorKey, setErrorKey] = useState(''), [noticeKey, setNoticeKey] = useState(''), [tokenPresent, setTokenPresent] = useState(false), [completed, setCompleted] = useState(false);
  const [otherVillageEnabled, setOtherVillageEnabled] = useState(false);
  const token = useRef(null), live = useRef(false), t = words[locale];
  useEffect(() => {
    live.current = true;
    if (mode === 'verify' && token.current === null) {
      token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
      setTokenPresent(!!token.current);
    }
    requestApi('/registration/config').then(result => { if (live.current) setConfig(result); }).catch(() => { if (live.current) setConfig({ enabled: false }); });
    return () => { live.current = false; };
  }, [mode]);
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; document.title = `${mode === 'verify' ? t.verify : t.request} | ${projectConfig.projectName}`; }, [locale, mode, t]);
  async function submit(event) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    setErrorKey(''); setNoticeKey('');
    const otherVillage = otherVillageEnabled ? String(data.get('otherVillage') || '').trim() : '';
    if (mode === 'request' && !data.getAll('villages').length && !otherVillage) { setErrorKey('chooseVillage'); return; }
    if (mode === 'verify' && data.get('password') !== data.get('confirmPassword')) { setErrorKey('mismatch'); return; }
    setBusy(true);
    try {
      if (mode === 'request') {
        await requestApi('/registration/request', { email: data.get('email'), name: data.get('name'), villages: data.getAll('villages'), otherVillage, consent: data.get('consent') === 'on' });
        if (live.current) setNoticeKey(config.environment === 'local-demo' ? 'receivedDemo' : 'received');
      } else {
        await requestApi('/registration/complete', { token: token.current, password: data.get('password') });
        token.current = ''; form.reset();
        if (live.current) { setCompleted(true); setTokenPresent(false); setNoticeKey('completed'); }
      }
    } catch (e) { if (live.current) setErrorKey(e.code || 'failed'); }
    finally { if (live.current) setBusy(false); }
  }
  return <RegistrationView {...{ locale, mode, config, busy, errorKey, noticeKey, tokenPresent, completed, otherVillageEnabled }} onOtherVillageChange={setOtherVillageEnabled} onSubmit={submit} onLanguage={() => setLocale(locale === 'zh' ? 'en' : 'zh')} />;
}
