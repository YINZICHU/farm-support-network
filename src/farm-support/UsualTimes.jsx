import { translate } from './i18n.js';
import { useLocale } from './LocaleProvider.jsx';
export const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function patternLabel(pattern, locale = 'zh') {
  const t = key => translate(locale,key);

  return pattern ? `${pattern.days.map(d => t(weekdayLabels[d - 1])).join(locale==='en'?', ':'、')} ${pattern.start}–${pattern.end}` : t("通常时段未登记");
}

export function patternFromForm(form) {
  const days = form.getAll('weekdays').map(Number);
  return days.length ? { days, start: String(form.get('usualStart') || ''), end: String(form.get('usualEnd') || '') } : null;
}

export default function UsualTimes({ pattern }) {
  const { locale, t } = useLocale();

  return <fieldset className="fs-usual-times"><legend>{t("通常可用星期和时段（可选）")}</legend>
    <p className="fs-muted">{t("只用于筛选候选，不代表任何具体日期已同意接单。留空或取消全部星期可清除通常时段。")}</p>
    <div className="fs-weekdays">{weekdayLabels.map((label, i) => <label key={label}><input type="checkbox" name="weekdays" value={i + 1} defaultChecked={pattern?.days.includes(i + 1)} />{t(label)}</label>)}</div>
    <div className="fs-form-grid"><label className="fs-field">{t("通常开始（北京时间）")}<input type="time" name="usualStart" defaultValue={pattern?.start || '07:00'} /></label><label className="fs-field">{t("通常结束（北京时间）")}<input type="time" name="usualEnd" defaultValue={pattern?.end || '18:00'} /></label></div>
  </fieldset>;
}
