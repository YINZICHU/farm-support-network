import { randomUUID } from 'node:crypto';

// Only an explicit local launcher may opt in. This sends no network requests.
export function createDemoMailer({ origin }) {
  const base = new URL(origin);
  if (process.env.NODE_ENV === 'production' || base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw Error('LOCAL_DEMO_MAIL_ONLY');
  const messages = [];
  return {
    enabled: true, environment: 'local-demo',
    async send({ to, template, verificationUrl }) {
      if (!['verify', 'account-exists'].includes(template) || typeof to !== 'string' || /[\r\n]/.test(to)) throw Error('INVALID_MAIL');
      if (template === 'verify') {
        const url = new URL(verificationUrl);
        if (url.origin !== base.origin || url.pathname !== '/farm-support/register/verify/' || url.search || url.username || url.password || !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)) throw Error('INVALID_VERIFICATION_URL');
        // Resubmission invalidates the old link and may change the village intent.
        // Do not let a superseded test email inherit the new application's scope.
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].template === 'verify' && messages[i].to === to) messages.splice(i, 1);
        }
      }
      messages.push({ id: randomUUID(), to, template, ...(template === 'verify' ? { verificationUrl } : {}),
        subject: template === 'verify' ? '农时有医 · 验证邮箱并设置密码' : '农时有医 · 账号申请提示',
        text: template === 'verify' ? '请在30分钟内打开链接并设置自己的密码。验证后仍需管理员分配权限。请勿回复或发送密码。' : '如果你已申请或已有账号，请使用原账号登录，或联系项目管理员协助。此邮件不修改原密码或权限。',
        at: Date.now(), demo: true });
      if (messages.length > 100) messages.shift();
    },
    list() { return structuredClone(messages); },
  };
}
