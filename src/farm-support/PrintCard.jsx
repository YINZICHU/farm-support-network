import { useLocale, LanguageSwitch } from './LocaleProvider.jsx';
import { useEffect, useRef } from 'react';
import { shanghaiTime as baseTime, villageName as baseVillageName, taskKinds as baseTasks } from './model.js';

export default function PrintCard({ card, onClose, onRecipient, environment = 'local-demo', villages = [] }) {
  const { locale, t } = useLocale();

  const taskKinds=Object.fromEntries(Object.entries(baseTasks).map(([key,value])=>[key,t(value)])), shanghaiTime=value=>baseTime(value,locale), villageName=id=>baseVillageName(id,locale,villages);
  const panel = useRef(null);
  useEffect(() => {
    const trigger = document.activeElement; panel.current.querySelector('button').focus();
    const key = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const list = [...panel.current.querySelectorAll('button,select')].filter(x => !x.disabled); if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1).focus(); } else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0].focus(); } } };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); trigger?.focus(); };
  }, []);
  const terms = card.terms;
  return <div className="fs-modal-backdrop"><section className="fs-dialog fs-print-card" role="dialog" aria-modal="true" aria-labelledby="fs-print-title" ref={panel}><header><h2 id="fs-print-title">{t("农忙支援 · 单张约定卡")}</h2><LanguageSwitch /><button className="fs-close" aria-label={t("关闭约定卡")} onClick={onClose}>×</button></header><p className="fs-notice">{environment === 'production' ? t("仅交给本单经核实的接收者，请妥善保管必要地点信息；不含人员名册和研究资料。") : t("虚构本地演示，不提供真实服务。打印件可能含必要地点，请保管好；不含人员名册和研究资料。")}</p><label className="fs-print-recipient">{t("接收者")}<select aria-label={t("约定卡接收者")} value={card.recipient} onChange={e => onRecipient(e.target.value)}><option value="farmer">{t("农户")}</option><option value="main">{t("主提供方")}</option><option value="backup">{t("备用本人")}</option></select></label><p>{card.code} · {villageName(card.village)}{t("· 条款第")}{card.termsVersion}{t("版")}</p><h3>{taskKinds[terms.task]}</h3><dl>{[[t("时间"), `${shanghaiTime(terms.start)} — ${shanghaiTime(terms.end)}`], [t("地点"), terms.site], [t("完成标准"), terms.standard], [t("安全与禁止操作"), `${terms.safety}；${terms.prohibited}`], [t("费用包含项"), terms.feeIncludes], [t("主岗 / 备用金额"), `${terms.feeMain == null ? t("未知") : `¥${(terms.feeMain / 100).toFixed(2)}`} / ${terms.feeBackup == null ? t("未知") : `¥${(terms.feeBackup / 100).toFixed(2)}`}`], [t("备用与取消"), `${terms.backupTerms}；${terms.cancelTerms}`]].map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl><p>{t("各方确认记录：")}{['farmer', 'main', 'backup'].map((p, i) => `${[t("农户"), t("主岗"), t("备用")][i]} ${card.confirmations[p]?.agree === true ? t("已同意") : card.confirmations[p]?.agree === false ? t("已拒绝") : t("待确认")}`).join(' · ')}</p><p>{t("整理时间")}{shanghaiTime(card.generatedAt)}{t("。现场、电话与纸质记录不是电子签名；有变更请重新核实最新版本。")}</p><footer><button className="fs-outline" onClick={onClose}>{t("返回服务单")}</button><button className="fs-button" onClick={() => window.print()}>{t("打印这张卡")}</button></footer></section></div>;
}
