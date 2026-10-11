import { semanticError, errorMessage } from './i18n.js';
import { useLocale, LanguageSwitch } from './LocaleProvider.jsx';
import { useEffect, useRef, useState } from 'react';
import { taskKinds as baseTasks, villageName as baseVillageName, shanghaiTime as baseTime } from './model.js';

const labels = { confirmed: '已记录具体时段 · 接单仍需联系', usual: '通常时段相符 · 需本人确认', 'needs-confirmation': '时段未知 · 待联系核实' };
const localValue = time => new Date(time + 28800000).toISOString().slice(0, 16);

export function CandidateResults({ result, onContact, onAvailability, busy }) {
  const { locale, t } = useLocale();

  const shanghaiTime=value=>baseTime(value,locale);
  return <section className="fs-match-results" aria-label={t("候选推荐结果")}><div role="status" aria-live="polite">
    <h3>{result.candidates.length ? t("找到 {v0} 位可联系候选",{v0:(result.candidates.length)}) : t("暂未找到符合条件的候选")}</h3>
    <p className="fs-muted">{t("核对时间：")}{shanghaiTime(result.checkedAt)}{t("。推荐不占用人员、不代表接单；安排时会再次检查。")}</p>
    {!result.capacityAvailable && <p className="fs-notice">{t("该村这个半天的名额已占用。可以先联系了解意愿，但现在不能安排；请选择其他时段或记录候补。")}</p>}
    {!result.candidates.length && <p>{t("可换一个时段、补充经本人核实的人员技能，或记录候补；不会自动扩大任务范围。")}</p>}
  </div>{result.candidates.map(p => <article className="fs-candidate" key={p.id}>
    <div className="fs-record-meta"><strong>{p.code}</strong><span className="fs-tag">{t(labels[p.availabilityStatus])}</span></div>
    <ul>{p.reasons.map(reason => <li key={reason}>{t(reason)}</li>)}</ul>
    <div className="fs-inline-actions"><button type="button" className="fs-outline" disabled={busy} onClick={() => onContact?.(p.id)} aria-label={t("查看候选 {v0} 的必要联系资料",{v0:(p.code)})}>{t("查看必要联系资料")}</button>
      {p.availabilityStatus !== 'confirmed' && onAvailability && <button type="button" className="fs-link" disabled={busy} onClick={() => onAvailability(p.id)}>{t("本人同意后登记本次时段")}</button>}
    </div>
  </article>)}</section>;
}

export default function MatchDialog({ request, onClose, onMatch, onContact, onClearContact, onAvailability, onArrange, contact, busy, villages = [] }) {
  const { locale, t } = useLocale();

  const taskKinds=Object.fromEntries(Object.entries(baseTasks).map(([key,value])=>[key,t(value)])), villageName=id=>baseVillageName(id,locale,villages);
  const tomorrow = Math.floor((Date.now() + 28800000) / 86400000) * 86400000 - 28800000 + 86400000 + 9 * 3600000;
  const [start, setStart] = useState(localValue(tomorrow)), [end, setEnd] = useState(localValue(tomorrow + 3600000));
  const [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const panel = useRef(null), generation = useRef(0), mounted = useRef(false);
  const closeAction = useRef(onClose); closeAction.current = onClose;
  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement;
    panel.current?.querySelector('input')?.focus();
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); closeAction.current(); }
      if (e.key !== 'Tab') return;
      const list = [...panel.current.querySelectorAll('input,button,a')].filter(x => !x.disabled);
      if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { mounted.current = false; generation.current++; document.removeEventListener('keydown', key); trigger?.focus(); };
  }, []);
  function change(value, setter) { generation.current++; setLoading(false); setResult(null); setError(''); onClearContact(); setter(value); }
  async function submit(event) {
    event.preventDefault(); const attempt = ++generation.current; setLoading(true); setResult(null); setError(''); onClearContact();
    try {
      const next = await onMatch({ request: request.id, version: request.version, start: `${start}:00+08:00`, end: `${end}:00+08:00` });
      if (mounted.current && attempt === generation.current && next) setResult(next);
    } catch (e) { if (mounted.current && attempt === generation.current) setError(semanticError(e)); }
    finally { if (mounted.current && attempt === generation.current) setLoading(false); }
  }
  async function contactPerson(id) {
    setError(''); const attempt = generation.current;
    const response = await onContact(id);
    if (mounted.current && attempt === generation.current && response?.error) setError(semanticError(response.error));
  }
  const confirmed = result?.candidates.filter(p => p.availabilityStatus === 'confirmed') || [];
  return <div className="fs-modal-backdrop"><section className="fs-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="fs-match-title">
    <header><div><p className="fs-kicker">{villageName(request.village)} · {request.household}</p><h2 id="fs-match-title">{t("自动推荐合适人选")}</h2></div><LanguageSwitch /><button type="button" className="fs-close" aria-label={t("关闭推荐，返回需求")} disabled={busy} onClick={onClose}>×</button></header>
    <p>{taskKinds[request.task]}{t("· 需求已核实。请选择这次的具体日期和时段。")}</p><p className="fs-muted">{t("首次预留须距离开始超过1小时。单次仍不超过4小时；匹配会包含前后各30分钟的往返与交接时间。不根据病情或其他私人情况排名。")}</p>
    <form onSubmit={submit}><div className="fs-form-grid"><label className="fs-field">{t("计划开始（北京时间）")}<input type="datetime-local" required disabled={busy} value={start} onChange={e => change(e.target.value, setStart)} /></label><label className="fs-field">{t("计划结束（北京时间）")}<input type="datetime-local" required disabled={busy} value={end} onChange={e => change(e.target.value, setEnd)} /></label></div>
      <button type="submit" className="fs-button" disabled={loading || busy}>{loading ? t("正在核对技能、时段和排班…") : t("查找合适人选")}</button>
    </form><div role="status" aria-live="polite">{loading ? t("正在查询，尚未安排人员。") : ''}</div><div className="fs-error" role="alert">{error && errorMessage(locale,error.code)}</div>
    {result && <CandidateResults result={result} busy={busy || loading} onContact={contactPerson} onAvailability={id => onAvailability(id, result)} />}
    {contact && <aside className="fs-contact-reveal" aria-label={t("经授权查看的候选联系资料")}><strong>{t("必要联系资料 · 仅用于本次协调")}</strong><p>{contact.name} · {contact.phone || t("未登记电话")}</p><button type="button" className="fs-link" onClick={onClearContact}>{t("收起联系资料")}</button></aside>}
    {result && <footer className="fs-match-footer"><p className="fs-muted">{t("主岗和备用必须是不同的人。通常时段或未知时段，须先联系本人并登记这次的可用时间。")}</p><button type="button" className="fs-button" disabled={busy || loading || !result.capacityAvailable || confirmed.length < 2} onClick={() => onArrange(result)}>{t("联系确认后，进入主备安排")}</button><button type="button" className="fs-link" onClick={onClose}>{t("返回需求")}</button></footer>}
  </section></div>;
}
