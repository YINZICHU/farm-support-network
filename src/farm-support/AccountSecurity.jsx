import { semanticError, errorMessage } from './i18n.js';
import { useLocale } from './LocaleProvider.jsx';
import { useState } from 'react';
import ProjectIdentity from './ProjectIdentity.jsx';

export default function AccountSecurity({ state, onSubmit, onLogout, error = '' }) {
  const { locale, t } = useLocale();

  const [enrollment, setEnrollment] = useState(null), [backup, setBackup] = useState(false), [busy, setBusy] = useState(false), [localError, setLocalError] = useState('');
  const setup = state === 'MFA_SETUP_REQUIRED';
  async function submit(event) {
    event.preventDefault(); setLocalError(''); setBusy(true);
    const form = event.currentTarget, values = new FormData(form);
    try {
      if (setup && !enrollment) {
        const result = await onSubmit('enable', { password: values.get('password') });
        form.reset(); setEnrollment(result);
      } else {
        await onSubmit(backup ? 'backup' : 'totp', { code: String(values.get('code') || '').trim() });
        form.reset(); setEnrollment(null);
      }
    } catch (e) { setLocalError(semanticError(e)); }
    finally { setBusy(false); }
  }
  return <main className="fs-security">
    <ProjectIdentity kind="brand" />
    <p className="fs-kicker">{t("管理员账号保护")}</p>
    <h1>{setup ? t("设置双重验证") : t("完成登录验证")}</h1>
    <p>{t("管理员需要密码和验证器验证码。完成验证前，不会开放村庄资料或管理操作。")}</p>
    <form onSubmit={submit}>
      {setup && !enrollment ? <label className="fs-field">{t("确认你的账号密码")}<input name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} /></label> : <>
        {enrollment && <section aria-label={t("验证器设置与恢复码")} className="fs-security-setup">
          <p>{t("在你自己的验证器中添加此账号，也可手动输入以下设置密钥。不要将它发给项目方或其他人。")}</p>
          <a className="fs-outline" href={enrollment.totpURI}>{t("在验证器中添加账号")}</a>
          <label className="fs-field">{t("手动设置密钥")}<input readOnly value={new URL(enrollment.totpURI).searchParams.get('secret') || ''} onFocus={e => e.target.select()} /></label>
          <h2>{t("保存一次性恢复码")}</h2><p>{t("每个恢复码只能使用一次。请私下保存；退出或刷新后不会继续显示。")}</p>
          <ul className="fs-recovery-codes">{enrollment.backupCodes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
          <label className="fs-check"><input type="checkbox" required />{t("我已私下保存恢复码")}</label>
        </section>}
        <label className="fs-field">{backup ? t("一次性恢复码") : t("验证器中的6位验证码")}<input key={backup ? 'backup' : 'totp'} name="code" required autoComplete="one-time-code" inputMode={backup ? 'text' : 'numeric'} pattern={backup ? undefined : '[0-9]{6}'} maxLength={backup ? 64 : 6} /></label>
      </>}
      <div role="alert" className="fs-error">{localError ? errorMessage(locale,localError.code) : error}</div>
      <button className="fs-button" disabled={busy}>{busy ? t("正在核实…") : setup && !enrollment ? t("开始设置验证器") : t("验证并继续")}</button>
    </form>
    {!setup && <button className="fs-link" type="button" disabled={busy} onClick={() => { setBackup(!backup); setLocalError(''); }}>{backup ? t("改用验证器验证码") : t("无法使用验证器？使用恢复码")}</button>}
    <p className="fs-muted">{t("链接过期或无法恢复？请联系")}<ProjectIdentity kind="contact" />{t("核实身份。不要发送密码、验证码或恢复码。")}</p>
    <button className="fs-outline" type="button" disabled={busy} onClick={async () => { setEnrollment(null); setLocalError(''); await onLogout(); }}>{t("退出账号")}</button>
  </main>;
}
