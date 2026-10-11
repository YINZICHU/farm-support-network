import { useLocale } from './LocaleProvider.jsx';
import { environmentCopy } from './environment.js';
import ProjectIdentity from './ProjectIdentity.jsx';
export default function LoginPanel({ activation = false, config, busy = false, error = '', notice = '', onSubmit, logoutPending = false, onRetryLogout }) {
  const { locale, t } = useLocale();

  const copy = environmentCopy(config?.environment,locale), ready = !!config;
  return <div className="fs-login">
    <div className="fs-login-story">
      <ProjectIdentity kind="brand" />
      <p className="fs-kicker">{t("农忙支援 ·")}{ready ? copy.label : t("连接待确认")}</p>
      <h1>{t("把农忙支援，")}<br />{t("安排得清楚一点。")}</h1>
      <p>{t("一项任务，一段时间。")}<br />{t("由熟悉本村的负责人核实、联系与跟进。")}</p>
      <small>{t("居民无需注册。负责人先联系项目方，核实身份和负责村后，通过一次性邀请自行设置密码。")}</small>
    </div>
    <main className="fs-login-form">
      <p className="fs-kicker">{t("协调工作台")}</p><h2>{activation ? t("激活你的个人账号") : t("负责人登录")}</h2>
      <p>{ready ? copy.notice : t("暂时无法确认后台配置，请恢复连接后刷新；不会将资料保存到浏览器。")}</p>
      <div role="status" aria-live="polite">{notice}</div>
      <form onSubmit={onSubmit}>
        {!activation && <label className="fs-field">{t("账号邮箱")}<input name="email" type="email" autoComplete="username" maxLength={320} required /></label>}
        <label className="fs-field">{activation ? t("设置密码（12–128位）") : t("密码")}<input name="password" type="password" autoComplete={activation ? 'new-password' : 'current-password'} minLength={12} maxLength={128} required /></label>
        <div role="alert" className="fs-error">{error}</div>
        <button className="fs-button" disabled={busy || !ready || logoutPending}>{busy ? t("正在核实…") : activation ? t("设置密码并激活") : t("登录工作台 →")}</button>
      </form>
      {logoutPending && <button type="button" className="fs-outline" disabled={busy} onClick={onRetryLogout}>{t("重试安全退出")}</button>}
      {activation && <p className="fs-muted">{t("邀请仅可使用一次，并绑定身份、职责和授权村。过期后请联系项目方重新核实。")}</p>}
      {config?.registrationEnabled && <p><a href="/farm-support/register/" className="fs-link">{t("申请负责人账号")}</a></p>}
      <p>{t("申请账号或需要帮助？")}<ProjectIdentity kind="contact" />{t("。请勿发送密码或验证码。")}</p>
      <ProjectIdentity kind="home" />
    </main>
  </div>;
}
