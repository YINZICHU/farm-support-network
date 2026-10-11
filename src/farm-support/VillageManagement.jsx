import { useEffect, useRef, useState } from 'react';
import { useLocale, LanguageSwitch } from './LocaleProvider.jsx';
import { errorMessage, semanticError } from './i18n.js';
import { mayManageVillage } from './permissions.js';
import { villageLabel } from './village-registry.js';
import { stateLabels } from './model.js';

function ManagementDialog({ dialog, actor, villages, registryRevision, busy, onClose, onCommand, onInvite }) {
  const { locale, t } = useLocale();
  const panel=useRef(null), close=useRef(onClose), [error,setError]=useState(null);
  close.current=onClose;
  useEffect(()=>{
    const trigger=document.activeElement;
    panel.current?.querySelector('input,select,button')?.focus();
    const key=e=>{
      if(e.key==='Escape'){e.preventDefault();close.current();}
      if(e.key!=='Tab')return;
      const controls=[...panel.current.querySelectorAll('input,select,button')].filter(x=>!x.disabled);
      if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1)?.focus();}
      else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0]?.focus();}
    };
    document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('keydown',key);trigger?.focus();};
  },[]);
  const v=dialog.object, root=actor.projectAdmin===true;
  const allowed=dialog.type==='invite'&&!root?villages.filter(v=>mayManageVillage(actor,v.id)):villages;
  async function submit(event){
    event.preventDefault();setError(null);
    const f=new FormData(event.currentTarget), val=k=>String(f.get(k)||''), chk=k=>f.get(k)==='on';
    try{
      if(dialog.type==='create') await onCommand('village.create',{zh:val('zh'),en:val('en'),evidence:val('evidence'),registryRevision:dialog.registryRevision});
      else if(dialog.type==='edit') await onCommand('settings.village',{id:v.id,version:v.version,zh:val('zh'),en:val('en'),state:val('state'),capacity:Number(val('capacity')),evidence:val('evidence')});
      else if(dialog.type==='grant') await onCommand('grant.permissions',{userId:v.userId,version:v.version,villages:f.getAll('villages'),projectAdmin:chk('projectAdmin'),canCreateVillages:chk('canCreateVillages'),managedVillages:f.getAll('managedVillages'),evidence:val('evidence')});
      else if(dialog.type==='program') await onCommand('settings.program',{state:val('state')});
      else await onInvite({email:val('email'),name:val('name'),role:root?val('role'):'coordinator',villages:f.getAll('villages'),adultVerified:chk('adultVerified'),projectAdmin:chk('projectAdmin'),projectAdminConfirmed:chk('projectAdminConfirmed'),canCreateVillages:chk('canCreateVillages'),managedVillages:f.getAll('managedVillages')});
      onClose();
    } catch(e){setError(semanticError(e));}
  }
  const scopes=(name,selected=[]) => <fieldset><legend>{t(name==='villages'?'授权服务村':'允许管理的村')}</legend><div className="fs-permission-options">{allowed.map(v=><label className="fs-check" key={v.id}><input type="checkbox" name={name} value={v.id} defaultChecked={selected.includes(v.id)} />{villageLabel(villages,v.id,locale)}</label>)}</div></fieldset>;
  const title={create:'新增村庄',edit:'修改本村规则',grant:'调整账号权限',invite:'邀请成年负责人',program:'整体服务状态'}[dialog.type];
  return <div className="fs-modal-backdrop"><section className="fs-dialog" role="dialog" aria-modal="true" aria-labelledby="fs-management-title" ref={panel}>
    <header><h2 id="fs-management-title">{t(title)}</h2><LanguageSwitch /><button type="button" className="fs-close" aria-label={t('关闭，返回原操作')} disabled={busy} onClick={onClose}>×</button></header>
    <form onSubmit={submit}><fieldset disabled={busy}>
      {['create','edit'].includes(dialog.type)&&<><label className="fs-field">{t('村庄中文名称')}<input name="zh" defaultValue={v?.zh} maxLength={80} required /></label><label className="fs-field">{t('村庄英文名称')}<input name="en" defaultValue={v?.en} maxLength={80} required /></label><p className="fs-muted">{t('名称可更正，稳定编号不改变。新村默认筹备、每半天容量1单；不会自动开放服务。')}</p></>}
      {['edit','program'].includes(dialog.type)&&<label className="fs-field">{t('服务状态')}<select name="state" defaultValue={v?.state||'PREPARING'}>{['PREPARING','OPEN','PAUSED','CLOSED'].map(id=><option value={id} key={id}>{t(stateLabels[id])}</option>)}</select></label>}
      {dialog.type==='edit'&&<label className="fs-field">{t('每半天容量（1–10单）')}<input name="capacity" type="number" min={1} max={10} defaultValue={v.capacity} required /></label>}
      {dialog.type==='invite'&&<><label className="fs-field">{t('受邀负责人称呼')}<input name="name" maxLength={60} required /></label><label className="fs-field">{t('受邀邮箱')}<input name="email" type="email" maxLength={320} required /></label>{root&&<label className="fs-field">{t('职责')}<select name="role"><option value="coordinator">{t('本村协调人')}</option><option value="admin">{t('成年运营管理员')}</option><option value="analyst">{t('仅编码汇总分析')}</option><option value="reviewer">{t('独立投诉复核')}</option></select></label>}<p className="fs-muted">{t('邀请链接私下交给本人；本人自设密码。有管理权限的账号必须完成验证器验证。不会自动发邮件。')}</p></>}
      {['grant','invite'].includes(dialog.type)&&<>{scopes('villages',v?.villages||[])}{root&&<><label className="fs-check"><input type="checkbox" name="projectAdmin" defaultChecked={v?.projectAdmin} />{t('项目级管理员（仅admin角色）')}</label><label className="fs-check"><input type="checkbox" name="canCreateVillages" defaultChecked={v?.canCreateVillages} />{t('允许新增村庄（仅admin或coordinator角色）')}</label>{scopes('managedVillages',v?.managedVillages||[])}<p className="fs-muted">{t('管理范围必须属于授权服务村。分析和复核角色不能获得管理权限。不会凭角色自动授予新增权。')}</p>{dialog.type==='invite'&&<label className="fs-check"><input type="checkbox" name="projectAdminConfirmed" />{t('若邀请项目级管理员，我已另外核实此项全局授权。')}</label>}</>}{dialog.type==='invite'&&<label className="fs-check"><input type="checkbox" name="adultVerified" required />{t('已核实受邀身份、成年职责和服务村，并会私下交付邀请。')}</label>}</>}
      {dialog.type!=='invite'&&<label className="fs-field">{t('核实依据编号（不写病情或账号密码）')}<input name="evidence" maxLength={120} required /></label>}
      <label className="fs-check"><input type="checkbox" required />{t('已核实负责人、安全保障和必要数据授权；按真实情况设置。')}</label>
    </fieldset><p role="alert" className="fs-error">{error&&errorMessage(locale,error.code)}</p><footer><button type="button" className="fs-outline" disabled={busy} onClick={onClose}>{t('取消')}</button><button type="submit" className="fs-button" disabled={busy}>{t(busy?'正在保存…':'核实后保存')}</button></footer></form>
  </section></div>;
}

export default function VillageManagement({actor,villages,registryRevision,grants=[],busy=false,error='',onCommand,onInvite}){
  const {locale,t}=useLocale(),[dialog,setDialog]=useState(null);
  const root=actor.projectAdmin===true;
  const open=(type,object)=>setDialog({type,object,registryRevision});
  return <section className="fs-village-management">
    <div className="fs-section-heading"><div><p className="fs-kicker">{t('先核实，再开放')}</p><h2>{t('村庄与权限')}</h2></div>{(root||actor.canCreateVillages)&&<button className="fs-button" disabled={busy} onClick={()=>open('create')}>{t('＋ 新增村庄')}</button>}</div>
    <p>{t('只显示授权村庄。暂停或关闭阻止新受理与开工，但保留安全收尾和历史；没有物理删除按钮。')}</p>
    <div className="fs-village-grid">{villages.map(v=><article className="fs-panel" key={v.id}><h3>{villageLabel(villages,v.id,locale)}</h3><p>{t(stateLabels[v.state])} · {t('每半天容量')} {v.capacity}</p><small>{t('版本')} {v.version}</small>{mayManageVillage(actor,v.id)&&<div className="fs-inline-actions"><button className="fs-outline" disabled={busy} onClick={()=>open('edit',v)}>{t('修改本村规则')}</button><button className="fs-link" disabled={busy} onClick={()=>open('invite')}>{t('邀请成年负责人')}</button></div>}</article>)}</div>
    {root&&<section className="fs-panel"><h2>{t('全局账号权限')}</h2><p>{t('只由项目级管理员授权；不能修改自己的权限，也不能撤销最后一位有效项目级管理员。缩减权限会撤销目标账号的会话。')}</p><button className="fs-outline" disabled={busy} onClick={()=>open('program')}>{t('整体服务状态')}</button><div>{grants.map(g=><div className="fs-account-row" key={g.userId}><span>{g.userId.slice(0,10)} · {t(g.role)} · {t(g.active?'有效':'停用')}</span><button className="fs-outline" disabled={busy||!g.active||g.userId===actor.userId} onClick={()=>open('grant',g)}>{t('调整账号权限')}</button></div>)}</div></section>}
    {error&&<p className="fs-error" role="alert">{error}</p>}
    {dialog&&<ManagementDialog {...{dialog,actor,villages,registryRevision,busy,onCommand,onInvite}} onClose={()=>{if(!busy)setDialog(null);}} />}
  </section>;
}
