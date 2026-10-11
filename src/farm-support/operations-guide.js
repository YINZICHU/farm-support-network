import { translate } from './i18n.js';
const modules=[
  {id:'start',title:'日常使用顺序',steps:['项目方先核实负责人身份，再私下交付一次性邀请。本人设置密码；管理账号完成验证器验证。居民无需账号，也无需ChatGPT账号。','先说明用途并核实同意，再登记人员、技能和通常时段。具体日期仍须本人确认。','登记线下需求并核实任务与安全范围；自动匹配只推荐，不自动接单。联系主岗和备用后，三方分别确认。','记录现场交接、安全开工与结束，再分别验收、记录直接结算和自愿回访；不收集医疗或健康信息。']},
  {id:'villages',title:'增加与管理村庄',steps:['在“村庄与权限”新增中英文名称和核实依据。新村默认为筹备、每半天容量1单。','核实负责人、联系安排、安全保障和数据授权后再修改本村状态或容量。容量是1–10单，不是无限容量。','暂停或关闭不删除历史，也不阻止既有作业的安全收尾。'],when:c=>c.projectAdmin||c.canCreateVillages||c.managedVillages?.length},
  {id:'global-permissions',title:'账号授权与缩减',steps:['项目级管理员分配服务村、新增权和管理范围；分析或复核角色不能获得管理权。','不能调整自己的权限或撤销最后一位有效项目级管理员。缩减授权会撤销会话；旧邀请不能恢复更大权限。'],when:c=>c.projectAdmin},
  {id:'recovery',title:'备份与隔离恢复',steps:['项目级管理员按运营文档从控制台导出三个配套文件：加密备份包（.bundle，含业务及认证）、最新边界（.boundary）和校验凭据（.receipt.json）。一起复制到服务器之外并校验摘要；密钥私下保管，不输入指南或发给项目方。','恢复只能使用新的隔离目录，先核验身份、备份和最新边界；不能一键覆盖在线数据库。恢复后管理账号须重新核实激活并完成MFA。','重要权限变化或日常使用后备份；实际持久卷、资源预算与恢复演练由部署方验收，本地预览不能代替。'],when:c=>c.projectAdmin},
  {id:'maintenance',title:'运维与容量',steps:['只读容量保护出现时停止新输入并联系项目级管理员。已有资料保留，不代表新输入已保存。','托管续费、扩容、停用和服务费用由部署方在托管平台人工办理；模板不自动操作账单，不承诺免费或无限容量。','CSV用于离线整理，没有在线上传或批量入库入口。逐条核实后录入，避免重复人员和家庭编码。']},
  {id:'tools',title:'模板与工具',steps:['工具库按需下载原件。文件语言会单独标注；英文界面不代表存在英文文件。','公开工具不含生产村民数据、原始问卷或访谈。使用前应适配本地服务、联系方式和紧急号码，保留原作者署名。'],tools:true}
];
export function operationsGuide(locale,capabilities={}){
  const t=(key)=>translate(locale,key);
  return modules.filter(m=>!m.when||m.when(capabilities)).map(m=>({id:m.id,title:t(m.title),steps:m.steps.map(t),links:m.tools?[{label:t('打开模板与工具'),href:`/${locale==='en'?'en':'zh'}/tools/`}]:[]}));
}
