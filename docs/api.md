# 同源负责人接口

基础路径 `/api/farm-support`。只连接自己部署的实例，浏览器使用 same-origin credentials。不是匿名跨域接口；不公开数据库，不提供批量 CSV 导入。生产不开放 `/public`、`/registration/*`、公共注册、匿名查单或通用 Better Auth 管理接口。

POST 需要精确 `Origin`（与 FARM_ORIGIN 相同），JSON Content-Type，最多32768字节且必须对象；Host也须匹配。生产禁止多来源 CORS，私有响应 no-store，认证cookie Secure/HttpOnly/SameSite=Lax。受IP、全局与账户限流控制，不能靠更换挑战ID绕过。会话最多8小时；撤权清会话并在每次业务请求重新检查权限。

## 生产路由（以下前缀均为基础路径）

| 方法 / 路径 | 请求与权限 |
| --- | --- |
| GET /config | 无需登录；返回 environment、registrationEnabled=false、mainSiteOrigin及共享project，不含秘密或人员资料 |
| POST /activate | `{token,password}`；一次性邀请，绑定受邀邮箱/身份/村；密码12–128位，由本人设置；返回201 |
| POST /auth/sign-in/email | `{email,password}`；错误泛化；管理员可能返回twoFactorRedirect |
| POST /auth/sign-out | 注销cookie会话；本地也清空私密界面 |
| POST /auth/two-factor/enable | 管理员已登录、尚未启用；`{password}`；返回一次性TOTP设置材料/恢复码，只私下保存 |
| POST /auth/two-factor/verify-totp | `{code}`；会话或有效MFA挑战，服务端强制不信任设备 |
| POST /auth/two-factor/verify-backup-code | `{code}`；备用恢复码验证，不开放MFA关闭接口 |
| GET /account/status | 活跃授权账号；APPROVED / MFA_SETUP_REQUIRED / MFA_CHALLENGE_REQUIRED |
| GET /workspace | 登录+活跃授权；admin、新增村庄者或受限管理者须已验证MFA；按角色/村返回脱敏名册或汇总、授权村注册表和当前权限版本 |
| GET /contact?type=person\|request\|order&id=... | 仅授权管理员/协调人；单笔必要联系资料读取并审计 |
| GET /print?id=...&recipient=farmer\|main\|backup | 仅对应村管理员/协调人；仅交给本单对应当事人；读取并审计 |
| POST /matches | `{request,version,start,end}`；管理员/协调人有对应村权限，服务OPEN、需求已核实且无有效安排；不写订单/预留 |
| POST /command | `{command,payload,key}`；权限、consent、version和业务状态按命令验证；成功200 |
| POST /invitation | projectAdmin或指定村管理者+MFA；`{email,name,role,villages,adultVerified:true}`；仅projectAdmin可授予管理能力；受限管理者只能邀请自己managedVillages内的普通coordinator。项目管理员提权另需projectAdminConfirmed。返回201一次性activationPath；不自动发邮件 |
| POST /backup | 仅projectAdmin+MFA；`{backupKeyBase64}`，独立32字节密钥；暂锁维护，返回201 checkpointId/sha256 |
| GET /backup/download?part=receipt\|boundary\|bundle | 同上；只下载当前待取回恢复包，各部分须一同离线保管 |

另有无认证 `GET/HEAD /healthz`（不在API前缀内），仅就绪信号，不代表真实服务开放。普通协调人不强制MFA；admin、canCreateVillages或非空managedVillages账号的全部私人业务路由受MFA约束。analyst只读编码汇总；reviewer只看分配且未涉事的投诉，不看名册。居民无需账号。公共 `/zh/tools/`、`/en/tools/` 只提供静态工具卡和精确获准原件；工具入口不授权任何私人API。

## 命令与幂等

`key` 为8–128字符，匹配 `[\w-]`；建议每个动作随机UUID。相同账号+key+相同command/payload返回同一结果。回应丢失时保留原输入和key重试；编辑输入须换新key。不同输入复用key返回 IDEMPOTENCY_MISMATCH。存储/网络错误不意味着一定没写入；不要另建重复记录。带记录ID的更新须提供最新version；STALE_VERSION时刷新、重新核实，不盲重试。

人员：`person.create`、`person.availability`、`person.pattern`、`person.scope`、`person.status`。参阅 [字段字典](data-fields.md) 和 [虚构人员示例](../templates/examples/person-create.json)。

需求：`request.create`、`request.verify`（id/version/evidence/scopeSafe）、`request.disposition`（id/version/status/reason，候补加nextContact，合并加target）。[虚构需求示例](../templates/examples/request-create.json)。

订单：`order.reserve`、`order.propose`、`order.confirm`、`order.confirm-change`、`order.reject-change`、`order.recheck-people`、`order.activate-backup`、`order.overtime`、`order.handoff`、`order.start`、`order.safe-end`、`order.accept`、`order.payment`、`order.followup`、`order.safety`、`order.cancel`。主岗与备用必须不同；具体可用时间须覆盖前后30分钟。作业≤4小时，新增预留距开工>1小时，预留最长2小时。变更失败保留原安排，三方分别确认本版任务/时间/费用；匹配不会自动预留或确认。完整payload请沿用工作台表单或审阅 [domain.mjs](../server/farm-support/domain.mjs)，不要直接写SQLite。

管理：

- `village.create`：projectAdmin或明确canCreateVillages的admin/coordinator；`{zh,en,registryRevision,evidence}`。稳定ID由服务器生成，新村PREPARING/容量1；成功后为创建者和现有项目管理员加入该村范围，其他账号不自动获得。
- `settings.village`：projectAdmin或managedVillages含目标村的admin/coordinator；`{id,version,zh,en,state,capacity,evidence}`。更名不改ID，不提供物理删除。
- `grant.permissions`：仅projectAdmin；`{userId,version,villages,projectAdmin,canCreateVillages,managedVillages,evidence}`，不改变角色。不能改自己或撤最后一个有效项目管理员；减少权限先记恢复边界并删除目标会话。
- `settings.program`、`grant.revoke`：仅projectAdmin，撤权不能撤自己；全村范围admin不自动等于projectAdmin。
- `privacy.remove-contact`：授权admin按记录条件处理；投诉创建由协调人/admin，复核由指派且未涉事的reviewer完成。

实时权限判断先于幂等返回；撤销新增权后复用旧成功key也拒绝。异步邀请激活前后都检查当前授予者权限；旧邀请不能恢复被取消的管理能力。读取脱敏记录不代表允许查看任意联系资料。

注册表格式 `villageRegistryVersion=1`，`registryRevision` 是新增村庄的并发版本，不等于编译配置版本；新增或改名冲突返回 STALE_VERSION，保留输入并刷新核对。

## 错误

响应通常 `{error:"CODE"}`：400字段/同意/时间非法；401 LOGIN_REQUIRED 或泛化SIGN_IN_FAILED；403 FORBIDDEN、MFA_REQUIRED、ORIGIN_DENIED；404 NOT_FOUND/未开放路由；409 STALE_VERSION、服务状态/冲突/过期/幂等或维护争议；413 BODY_TOO_LARGE；415 JSON_REQUIRED；429 RATE_LIMITED；503 STORAGE_READ_ONLY/MAINTENANCE_BUSY。不要把验证材料或原始请求体打印到公开日志。

[匹配示例](../templates/examples/matches.json)只提供结构；替换为自己授权的需求ID/version和真实时间。未确认同意的示例写入会被拒绝。设置OPEN需要真实场地、安全、授权和联系安排已核实，不以接口调用代替这些工作。

## 页面配置版本

网页除读取配置和退出外，每次请求都发送 `x-farm-project-version`（规范化共享项目配置的 SHA-256）。版本不符时，服务器在认证或业务读写前返回 `CONFIG_MISMATCH`；页面清空私密视图与待提交输入，禁用登录/操作并提示刷新。它只是兼容性标记，不是认证凭证；运维接口客户端可以不发送，但仍须通过全部会话、MFA、授权、同意和记录版本检查。配置变动后仍能安全退出。
