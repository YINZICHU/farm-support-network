# Bilingual Network, Village Management and Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立 Network 模板增加完整双语工作台、可授权的持久村庄管理、公开工具库和角色相关操作指南，不改正式项目。

**Architecture:** SQLite 内现有加密业务状态作为运行中村庄与权限的唯一事实源；静态项目配置只保留品牌与种子村庄。共享固定字典翻译界面，授权快照提供业务数据；经审核的原件通过独立目录和精确二进制白名单按需下载。当前会话按任务顺序实施，每项先 RED 再 GREEN；用户已经选择 Native，不再询问执行方式。

**Tech Stack:** Node.js 24.19.0，pnpm 11.19.0，React 19.2.0，Vite 6.4.4，Better Auth 1.7.7，现有 SQLite / AES-GCM / 独立隐私边界；Node 内置测试与 Vite SSR 测试。

**Spec:** `docs/superpowers/specs/2026-10-11-bilingual-network-village-tools-design.md`（2026-10-11 用户已确认）。本文所有仓库相对路径均以 `C:/Users/Mike/Documents/Codex/2026-09-06/product-design-plugin-product-design-openai/care-in-farming-toolkit` 为根。

## Global Constraints

- 仅独立 Network 模板；不修改原主站、私人后台或正式存储，不部署、不上传 GitHub、不调整托管、DNS 或 SSL。
- 不纳入：公开注册、自动邮件、居民账号、定位、支付、第三方追踪、任意文件上传、CSV 批量入库、一键覆盖恢复数据库、医疗机构信息更新或新医疗建议。
- 保持原米白、深绿、档案式字体与组件方向；匹配仅推荐，不自动接单。用户业务输入不机翻、不改写。
- `admin`、`coordinator`、`analyst`、`reviewer` 不变；`projectAdmin` 仅 admin；`canCreateVillages` 仅 admin/coordinator、默认 false；`managedVillages` 是 `villages` 子集；授权 `version` 为正整数。
- `villageRegistryVersion = 1`；不可变 `seedVillageIds`、递增 `registryRevision`；服务器生成 `v-` 加 UUID。名称每种语言 1–80 字符，拒绝控制字符，NFKC / trim / 英文大小写用于查重，不替换展示字形。
- 新村 `PREPARING`、容量 1、contact null；每半天容量 1–10 单；不提供物理删除；暂停/关闭阻止新受理、预留、开工，但保留安全收尾和历史。
- 生产对管理员、新增村庄者及受限管理者强制已验证 MFA；实时权限判断先于幂等返回。认证异步工作在同步业务事务之外。
- `x-farm-project-version` 继续只校验编译时项目配置；不要混入注册表版本。生产 `/public`、`/registration/*` 保持关闭。
- 双语共用数据，时间继续 `Asia/Shanghai`；语言切换不清空同一身份的输入，身份/授权变更仍清理全部私人视图。
- 375px 无横向溢出、触控区域至少 44px，保留焦点/读屏/减少动态效果；不增加装饰性动画。
- 19 项候选逐项内容审查；只有清洁获准原件按原始字节复制。不修改原文件、自动清理或生成不存在的翻译/PDF；不合格项列为待提供公开版本。
- 精确路径、字节数和原始 SHA-256 双重准入；文本 UTF-8 LF、二进制原字节；资源目录不得自我批准文件。代码 MIT 与工具再使用说明分开，保留殷子楚 Yin Zichu 署名。
- 初始化、升级和启动分开；不自动迁移正式实例；恢复只到新的隔离目录，最新边界不得扩大权限。备份仍由部署方保管。
- 本轮交付本地预览、截图、源码包和验证记录；Windows 模拟挂载不等于真实 Linux 持久卷/资源预算/恢复演练验收。

## Review Focus

1. 已取消新增权但重发旧 key：拒绝返回旧成功结果，不能复建或借重试保留权力（任务 3）。
2. 老邀请、旧备份包含更大权限：激活及恢复只能使用当前权限上限，不能复活被缩减的范围/新增权（任务 4）。
3. 未完成请求遇到语言切换或账号/授权变化：前者保留输入，后者丢弃过时的联系人、打印结果和表单（任务 5–6）。
4. 全角/组合字符重名，动态村重启、种子漂移：归一化查重，保留合法新增村，配置错配拒绝且不改库（任务 1–3）。
5. 同名工具被替换、Office 隐藏个人记录、目录自我许可：内容审计先于复制，独立白名单和原字节摘要均须通过（任务 7–8）。

## 文件与职责映射

| 范围 | 文件与职责 |
| --- | --- |
| 运行注册表 | 新 `src/farm-support/village-registry.js` 纯校验/名字/引用；改 `store.mjs` 初始化、`production-store.mjs` 启动校验；配置本身不改 |
| 受控升级 | 新 `server/farm-support/registry-upgrade.mjs`、`scripts/farm-support/registry-upgrade.mjs`；沿用 maintenance 的加密备份，不进入正常启动 |
| 权限事务 | 新 `src/farm-support/permissions.js`；改 `domain.mjs`、`store.mjs` 边界；测试虚构授权显式化 |
| 身份边界 | 改 `activation.mjs`、`mfa.mjs`、`http.mjs`、`maintenance.mjs`；邀请、激活、MFA、备份、恢复共用权限判定 |
| 双语基础 | 新 `i18n.js`、`LocaleProvider.jsx`；改 `api.js`、`session.js`、`model.js`、`environment.js`，只传语义码 |
| 业务界面 | 改现有工作台/登录/MFA/匹配/打印组件；从 Workspace 提取 `ActionDialog.jsx`；新 `VillageManagement.jsx`、`OperationsGuide.jsx`、`operations-guide.js` |
| 工具原件 | 新 `public/network-tools/` 精确文件、新 `resource-approval.js` 独立准入、新 `resource-catalog.js` 展示目录、新审查脚本和清单；不复制整个原项目目录 |
| 工具入口与发布 | 新 `ToolsPage.jsx`，改 `BackendApp.jsx`、`static.mjs`、`check-release.mjs`、`source-manifest.mjs`、`.gitattributes`；审计/使用说明 docs 精确准入 |
| 验收 | 新对应 Node/SSR 测试与本地 QA 脚本、更新现有回归、README/API/运维文档、CI；截图/测试日志/ZIP 放仓库外 outputs |

以下 `server` 指 `server/farm-support/`，`client` 指 `src/farm-support/`；Files 列表使用完整仓库相对路径。提交使用 `git -c user.name=Codex -c user.email=codex@localhost commit`，不改用户 Git 身份；只 add 对应任务的显式文件。

### Task 1: 持久注册表与启动保护

**Files:** Create `src/farm-support/village-registry.js`、`tests/village-registry.test.mjs`；Modify `server/farm-support/store.mjs`、`server/farm-support/production-store.mjs`、`tests/production-store.test.mjs`、`tests/template-storage.test.mjs`、`tests/farm-support/helpers.mjs`、`tests/identity-fixture.mjs`。

**Interfaces:**
- Consumes `projectConfig.villages: Array<{id,zh,en}>`；`openStore(path,key,options)`、`store.transact(fn)`、`store.read()`。
- Produces `seedRegistry(villages,at): {villageRegistryVersion:1,seedVillageIds:string[],registryRevision:1,villages:Village[]}`；`assertVillageRegistry(state,seedVillages): void`；`villageLabel(villages,id,locale): string`。
- `Village = {id,zh,en,state,capacity,contact,version,source:'seed'|'created',createdBy:string|null,createdAt:number}`；校验业务/授权/邀请/激活 claim 的村引用；未升级旧状态抛 `REGISTRY_UPGRADE_REQUIRED`，错种子保留 `CONFIG_VILLAGE_MISMATCH`。

- [ ] **1. 写 `dynamic village survives reopen but seed drift leaves storage untouched` 和 `invalid registry references fail closed` 测试。** 用真实加密临时库建立 seed，追加完整 `v-UUID` village 后 reopen；以同一 snapshot 验证漂移/重复 ID/坏引用/不支持版本拒绝。断言核心：
  ```js
  assert.equal(reopened.read().villages.find(v => v.id === dynamicId).zh, '新增村');
  assert.throws(() => assertVillageRegistry(state, changedSeeds), /CONFIG_VILLAGE_MISMATCH/);
  assert.deepEqual(storageHashesAfter, storageHashesBefore);
  assert.throws(() => assertVillageRegistry(badReference, seeds), /REGISTRY_REFERENCE_INVALID/);
  ```
- [ ] **2. RED：** `node --test tests/village-registry.test.mjs tests/production-store.test.mjs tests/template-storage.test.mjs`；新测试应因缺接口/旧 exact-count 校验失败，记录失败名。
- [ ] **3. 实现上述纯接口和初始化/启动调用。** 保留 storageSchema、AES-GCM、实例密钥校验、只读检查快照和文件保护；普通启动不升级、不 provision。种子 ID 比较忽略顺序但不允许换 ID；动态 ID/所有引用必须合法。缺 capability 的旧 grant 按无权限解释，不通过覆盖全村推断 root。测试 fixture 显式写版本及权限，`identityFixture.account(email,role,villages,permissions={})` 接受显式字段，默认不授 projectAdmin。
- [ ] **4. GREEN：** 重跑步骤 2；两组新测试及原启动/配置测试全部通过。
- [ ] **5. 提交：** 显式 add Files；commit `feat: persist validated village registry without weakening startup guards`。

### Task 2: 不自动运行的旧状态升级工具

**Files:** Create `server/farm-support/registry-upgrade.mjs`、`scripts/farm-support/registry-upgrade.mjs`、`tests/registry-upgrade.test.mjs`；Modify `server/farm-support/production-store.mjs`、`docs/operations.md`、`docs/deployment.md`。

**Interfaces:**
- Consumes Task 1 注册表接口；既有 `exportRecoveryBundle({store,config,outputFile,backupKey})`、签名存储身份与一致性检查。
- Produces `inspectRegistryUpgrade({config,verifiedMount,projectAdminUserId}): UpgradeCheck`（只读）与 `applyRegistryUpgrade({config,verifiedMount,projectAdminUserId,verifiedIdentity,backupKey}): Promise<UpgradeResult>`；`UpgradeCheck={needed,eligibleAdminUserId,registryRevision,instanceId}`，`UpgradeResult={changed,registryRevision,backupReceipt:null|{checkpointId,sha256}}`。
- CLI `node scripts/farm-support/registry-upgrade.mjs --check`；apply 额外需 `--apply --offline-confirmed --verified-identity --project-admin-user-id <id>`。密钥从既有私下环境读取，不放参数/日志；flag 是操作者确认，不声称自动核实身份/停服。

- [ ] **1. 写 `upgrade preserves business records and is idempotent`、`ambiguous bootstrap or wrong identity refuses before writing`、`transaction failure rolls back after a verified backup`。** 虚构 legacy 同 seed 库、核验 bootstrap claim/user 绑定；缺绑定需显式指定有效 admin 并 verifiedIdentity。断言：
  ```js
  assert.deepEqual(after.people, before.people); assert.deepEqual(after.orders, before.orders);
  assert.equal(after.villageRegistryVersion, 1);
  assert.deepEqual(after.grants.filter(g => g.projectAdmin).map(g => g.userId), [ownerId]);
  assert.equal((await applyRegistryUpgrade(args)).changed, false);
  assert.deepEqual(refusedHashesAfter, refusedHashesBefore);
  ```
- [ ] **2. RED：** `node --test tests/registry-upgrade.test.mjs`；预期缺 upgrade 模块失败。
- [ ] **3. 实现 check/apply 及精确 CLI。** 仅部署方停服后的验证副本执行；只读检查实例/密钥/旧结构/种子/绑定，apply 再核对并锁定写入，先成功导出三份加密配套文件，再单事务写注册表与显式 root。备份/事务失败不升级；不自动重建库。其他 grants 默认 canCreate=false、managed=[]、version=1；历史记录 ID、内容与边界保持。说明旧备份/升级的隔离恢复和失败处理。
- [ ] **4. GREEN：** 步骤 2，加 `node --test tests/production-store.test.mjs tests/maintenance-cli.test.mjs`；无漂移、无自动升级、重复 apply 不重复改状态。
- [ ] **5. 提交：** 显式 add Files；commit `feat: add explicit backed-up village registry upgrade`。

### Task 3: 实时权限、加村及缩减边界事务

**Files:** Create `src/farm-support/permissions.js`、`tests/village-management.test.mjs`、`tests/grant-capabilities.test.mjs`；Modify `server/farm-support/domain.mjs`、`server/farm-support/store.mjs`、`tests/farm-support/concurrency.test.mjs`、`tests/farm-support/race-worker.mjs`、`tests/farm-support/operations.test.mjs`、`tests/farm-support/privacy-recovery.test.mjs`。

**Interfaces:**
- Consumes Task 1 `assertVillageRegistry`；既有 `createDomain(store,clock=Date.now)` 的 `dispatch(userId,command,payload,key)` / `snapshot(userId)`。
- Produces `grantCapabilities(grant): {projectAdmin:boolean,canCreateVillages:boolean,managedVillages:string[],version:number}`、`requiresManagementMfa(grant): boolean`、`mayManageVillage(grant,id): boolean`；服务端仍对非法角色/范围拒绝。
- Command `village.create({zh,en,evidence,registryRevision}) -> Village`；`settings.village({id,version,zh,en,state,capacity,evidence}) -> Village`；`grant.permissions({userId,version,projectAdmin,canCreateVillages,managedVillages,villages,evidence}) -> Grant`。Grant 保留 role/active，版本递增；snapshot.actor 同步四个新字段，snapshot 另含 registryRevision。
- `Grant = {userId,role,active,villages,projectAdmin,canCreateVillages,managedVillages,version,...existingMetadata}`；只读 actor 投影不带身份核实记录。创建权来自显式 projectAdmin 或 canCreateVillages，不来自覆盖村数。
- Boundary `{kind:'permissions-reduced',userId,version,projectAdmin,canCreateVillages,managedVillages,villages,at}`；重放 boolean AND、范围交集、版本取上限，只缩减不提升。

- [ ] **1. 写 `delegated creator obtains only their new village`、`revoked creator cannot retry an old successful key`、`normalized duplicate names and stale revisions reject`、`paused village keeps safe completion available` 及权限/竞态测试。** 核心断言：
  ```js
  assert.equal(created.state, 'PREPARING'); assert.equal(created.capacity, 1);
  assert.match(created.id, /^v-[0-9a-f-]{36}$/);
  assert.deepEqual(creatorScopeAfter, [...creatorScopeBefore, created.id]);
  assert.equal(otherCoordinatorScope.includes(created.id), false);
  assert.throws(() => f.call('village.create', payload, 'local', oldKey), /FORBIDDEN/);
  assert.throws(() => f.call('village.create', {...duplicatePayload,zh:'Ｆａｒｍ',en:'Farm'}), /VILLAGE_NAME_DUPLICATE/);
  assert.throws(() => f.call('settings.village', {...editPayload,version:staleVersion}), /VERSION_CONFLICT/);
  assert.deepEqual(historyAfterPause, historyBeforePause);
  ```
  另外断言：root 随新村扩大范围但受限 admin 不扩大；最后 root/自行改授权拒绝；改名 ID 不变；取消新增权保留原管理范围；边界 replay 不恢复 extrascope；同 key 只一村、不同 key 并发旧 registryRevision 只一次成功。
- [ ] **2. RED：** `node --import ./tests/cross-village-setup.mjs --test tests/village-management.test.mjs tests/grant-capabilities.test.mjs tests/farm-support/concurrency.test.mjs`；旧 command/授权行为失败。
- [ ] **3. 实现权限纯接口与同步事务。** livegrant + command 权限先于幂等查找，成功重试无需匹配已递增 registryRevision；新请求检查旧版本。创建原子更新 creator、所有有效 projectAdmins、registryRevision、最少审计；管理设置只 root/managed。全项目设置和全库权限不再用“scope 数量相同”判断。缩减先追加边界，事务内清失效账号会话；旧边界种类继续支持。关闭村阻止 reserve/start/create，保留安全收尾/验收/费用/投诉原保护。
- [ ] **4. GREEN：** 步骤 2，加 `node --import ./tests/cross-village-setup.mjs --test tests/farm-support/domain.test.mjs tests/farm-support/operations.test.mjs tests/farm-support/privacy-recovery.test.mjs`；不得把安全收尾改成无权限执行。
- [ ] **5. 提交：** 显式 add Files；commit `feat: enforce delegated village creation and durable permission reductions`。

### Task 4: 邀请、MFA、备份与恢复共用新权限

**Files:** Modify `server/farm-support/activation.mjs`、`server/farm-support/mfa.mjs`、`server/farm-support/http.mjs`、`server/farm-support/maintenance.mjs`、`tests/activation.test.mjs`、`tests/mfa.test.mjs`、`tests/production-http.test.mjs`、`tests/production-recovery.test.mjs`、`tests/account-security.test.mjs`；Create `tests/management-identity.test.mjs`。

**Interfaces:**
- Consumes Task 3 `requiresManagementMfa` / `mayManageVillage` / `grantCapabilities` 和实时 registry。
- Produces 兼容既有 `bootstrapAdministrator(args)`、`createActivationService(args).issue(actor,input)` / `activate({token,password})` / `recover(actor,input,authority)`；issue input 增 `projectAdmin`, `projectAdminConfirmed`, `canCreateVillages`, `managedVillages`，省略均无权限。projectAdminConfirmed 只在显式项目管理员邀请时必需，不能取代现有 adultVerified/身份核实。
- `requirePrivilegedMfa({session,grant,auth}): Promise<void>` 签名不变；enrollment 允许所有 needs-management-MFA 账号。restore 仍返回 `{sessionsCleared:true}`，失效所有管理员/creator/manager 和所有会话/待用 claims/旧 MFA，不通过旧 claim 重授权限。

- [ ] **1. 写 `coordinator with creation capability must enroll before accessing private data`、`manager can invite only ordinary coordinators in managed scope`、`issuer downgrade invalidates outstanding elevation invitation`、`old backup cannot revive removed creator permission`。** 用 identityFixture 显式 root，真实 auth 会话；断言：
  ```js
  assert.equal(statusBeforeEnrollment, 'MFA_SETUP_REQUIRED');
  assert.equal(workspaceBeforeVerifiedMfa.status, 403);
  assert.throws(() => service.issue(managerId, adminInvitation), /FORBIDDEN/);
  await assert.rejects(service.activate({token: staleToken, password: testPassword}), /FORBIDDEN|INVITATION_INVALID/);
  assert.equal(restoredCreator.active, false); assert.equal(restoredCreator.canCreateVillages, false);
  assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM session').get().n, 0);
  ```
  同时测普通 coordinator 不强制新 MFA、新村能邀请、root 激活包含当前动态村、有限 admin 无全库备份、恢复最新边界引用后建村缺失时不制造记录。
- [ ] **2. RED：** `node --test tests/management-identity.test.mjs tests/activation.test.mjs tests/mfa.test.mjs tests/production-recovery.test.mjs`；旧 admin-only MFA/静态 registry/restore 规则失败。
- [ ] **3. 接入实时权限。** HTTP 异步认证/MFA 后事务重检 grant；邀请 issue 和 activation 前/后均检查 issuer 当前权限；manager 不能写任意 capability 或外村。bootstrap 显式 root，恢复从当前 grant 权限上限取得字段而非旧 claim。备份 root-only；恢复应用最新可信边界后停用所有管理者并清认证材料，不碰原卷。保留私下 handoff、24 小时邀请码、日志脱敏、同源/Host/方法/限流和 Secure HttpOnly cookie。
- [ ] **4. GREEN：** 步骤 2，加 `node --test tests/production-http.test.mjs tests/account-security.test.mjs tests/production-entry.test.mjs tests/storage-budget.test.mjs`；注册/public 仍 404，cookie/header/只读保护不弱化。
- [ ] **5. 提交：** 显式 add Files；commit `feat: align invitations mfa and recovery with live village capabilities`。

### Task 5: 双语字典、语义状态与私人视图身份

**Files:** Create `src/farm-support/i18n.js`、`src/farm-support/LocaleProvider.jsx`、`tests/network-i18n.test.mjs`；Modify `src/farm-support/api.js`、`src/farm-support/session.js`、`src/farm-support/model.js`、`src/farm-support/environment.js`、`src/main.jsx`、`tests/farm-support/session.test.mjs`、`tests/private-views.test.mjs`、`tests/retry.test.mjs`。

**Interfaces:**
- Consumes Task 3 snapshot.actor；Task 1 `villageLabel`；既有 private view generation/epoch 与 mutation retry envelope。
- Produces `messages = {zh,en}`（同键集合）；`translate(locale,key,values={}): string`（未知 key 抛 `I18N_KEY_MISSING`）；`errorMessage(locale,code): string`（未知码使用泛化失败）；`formatProjectTime(value,locale): string`（Asia/Shanghai）；`useLocale(): {locale,setLocale,t}`。
- LocaleProvider prop `children`；query lang 优先，其后 localStorage 仅 `network.locale`，非法值 zh。`workspaceIdentity(actor)` 增 version/projectAdmin/canCreate/managed/scope，locale 不属于 identity；错误保存 `{code,status}`，notice 保存 `{key,values}`，不缓存上一语言字符串。

- [ ] **1. 写 `dictionary keys and semantic errors match in both locales`、`locale is not an auth boundary but grant changes are`、`late private reads are discarded after authorization change`。** 断言：
  ```js
  assert.deepEqual(Object.keys(messages.zh).sort(), Object.keys(messages.en).sort());
  assert.match(errorMessage('en', 'SIGN_IN_FAILED'), /sign in/i);
  assert.equal(workspaceIdentity(actor), workspaceIdentity({...actor, locale:'en'}));
  assert.notEqual(workspaceIdentity(actor), workspaceIdentity({...actor, version:actor.version+1}));
  assert.equal(views.contactValue, null); assert.equal(views.printCardValue, null);
  assert.match(formatProjectTime(at, 'en'), /Shanghai|UTC\+08|GMT\+8/);
  ```
  测未知错误不枚举邮箱；延迟成功和失败都不覆盖新 session；语言偏好中没有业务字段/凭证。
- [ ] **2. RED：** `node --test tests/network-i18n.test.mjs tests/farm-support/session.test.mjs tests/private-views.test.mjs tests/retry.test.mjs`；缺字典接口及旧 identity 比较失败。
- [ ] **3. 实现基础接口并替换静态标签依赖。** task/state ID、金额整数、校验阈值和日期 payload 不变；运行村名从 snapshot 获取，不回退跨村静态资料。切语言只 set state/更新 lang、title、query，不重建 auth/workspace 树，不动 activation hash；安全 query 更新不把 token/输入传到 URL。API 继续配置 hash 检查、401 清理和幂等重试。
- [ ] **4. GREEN：** 步骤 2，加 `node --test tests/template-contracts.test.mjs tests/template-config.test.mjs`；测试错误渲染按当前语言、静态配置摘要不受新增村影响。
- [ ] **5. 提交：** 显式 add Files；commit `feat: add shared bilingual copy without weakening session cleanup`。

### Task 6: 完整双语工作台、村庄权限页和操作指南

**Files:** Create `src/farm-support/ActionDialog.jsx`、`src/farm-support/VillageManagement.jsx`、`src/farm-support/OperationsGuide.jsx`、`src/farm-support/operations-guide.js`、`tests/network-workspace.test.mjs`、`tests/operations-guide.test.mjs`；Modify `src/farm-support/Workspace.jsx`、`src/farm-support/LoginPanel.jsx`、`src/farm-support/AccountSecurity.jsx`、`src/farm-support/AccountApprovals.jsx`、`src/farm-support/MatchDialog.jsx`、`src/farm-support/PrintCard.jsx`、`src/farm-support/UsualTimes.jsx`、`src/farm-support/ProjectIdentity.jsx`、`src/farm-support/Registration.jsx`、`src/farm-support/Public.jsx`、`src/farm-support/public-fallback.js`、`src/farm-support/styles.css`、`src/farm-support/registration.css`、`src/farm-support/project-identity.css`、`src/BackendApp.jsx`、`vite.config.mjs`、`tests/backend-render.test.mjs`、`tests/production-ui.test.mjs`、`tests/farm-support/matching-render.test.mjs`、`tests/template-render.test.mjs`。

**Interfaces:**
- Consumes Task 5 `useLocale`，Task 3 commands/snapshot；Workspace existing save(command,payload)、invite(payload)、privateViews.clear()。
- Produces `VillageManagement({actor,villages,registryRevision,grants,busy,error,onCommand,onInvite})`；`ActionDialog` 保留原同名 props 和 payload，新增 `villages` 事实列表；`OperationsGuide({actor,environment,storageReadonly})`。
- `operationsGuide(locale,capabilities): Array<{id,title,steps:string[],links:Array<{label,href}>}>`；内部 page ID `villages`/`operations`，工具为普通 `/zh/tools/` / `/en/tools/` 链接。新村/管理 dialog 继续既有 retry 和焦点控制。

- [ ] **1. 写 `both locales expose the complete coordinator workflow`、`creation form preserves fields on locale switch but clears on logout`、`role-aware guide never asks for backup keys or cookies`。** SSR 加交互 helper 测控制状态；核心断言：
  ```js
  assert.match(englishHtml, /Villages.*permissions|Village management/i);
  assert.match(englishHtml, /Templates.*Tools|Operations Guide/i);
  assert.equal(formAfterLocale.zh, formBeforeLocale.zh);
  assert.equal(formAfterLogout, null);
  assert.equal(managerCanSeeGlobalGrantControls, false);
  assert.doesNotMatch(guideHtml, /<input[^>]+name="(?:cookie|backupKey|dataKey)"/);
  ```
  覆盖登录/MFA enrollment/恢复码/空状态/所有既有表单/匹配/打印、英中文金额时间对应、修改版本冲突保留输入；所有 label/按钮按同字典翻译，业务原文原样转义。
- [ ] **2. RED：** `node --test tests/network-workspace.test.mjs tests/operations-guide.test.mjs tests/backend-render.test.mjs tests/production-ui.test.mjs tests/farm-support/matching-render.test.mjs tests/template-render.test.mjs`；新页面和双语断言失败。
- [ ] **3. 提取原 ActionDialog 不改业务，再接入字典/新两页。** 登录、验证器、激活和旧路由可切语言；不得让 demo 注册路径在生产开放。村管理只显示授权村，cap 未授不能加村，更新带版本/核实依据；非 root 隐藏全局设置/backup/grant-controls，后端仍强制拒绝。指南说明加村、邀请自设密码/MFA、同意登记、时段需求、匹配人工确认、交接验收费用、权限缩减、备份三文件与隔离恢复；托管续费/扩容人工办理、CSV 无上传、不承诺无限容量。CSS 沿用样式，仅补 wrap/min-width/focus/44px，保持 reduced-motion。
- [ ] **4. GREEN：** 步骤 2，加 `node --test tests/farm-support/registration-ui.test.mjs tests/farm-support/matching-client.test.mjs`；桌面/375 及实际键盘语言保留检查在任务 9 完成。
- [ ] **5. 提交：** 显式 add Files；commit `feat: localize network workflows and add delegated village operations`。

### Task 7: 逐项资源审查、原件复制和唯一目录

**Files:** Create `src/farm-support/resource-approval.js`、`src/farm-support/resource-catalog.js`、`scripts/audit-network-tools.mjs`、`docs/tool-resource-review.json`、`docs/tools-usage.md`、`docs/tools-usage.en.md`、`tests/network-tools-audit.test.mjs`、`tests/network-tools-catalog.test.mjs`；Modify `THIRD_PARTY_NOTICES.md`。仅通过审核时 Create 下列精确路径对应原件：

- `public/network-tools/rural-health-care-survey-template-zh.docx`
- `public/network-tools/semi-structured-interview-template-zh.docx`
- `public/network-tools/healthcare-friction-action-planning-template-zh.xlsx`
- `public/network-tools/research-image-consent-template-bilingual.docx`
- `public/network-tools/village-replication-toolkit.pptx`
- `public/network-tools/healthcare-friction-framework-zh.pdf`
- `public/network-tools/healthcare-friction-framework-en.pdf`
- `public/network-tools/farming-health-calendar-zh.png`
- `public/network-tools/health-guide-front-zh.png`
- `public/network-tools/health-guide-back-zh.png`
- `public/network-tools/navigation-card-front-zh.png`
- `public/network-tools/navigation-card-back-zh.png`
- `public/network-tools/bus-care-card-zh.png`
- `public/network-tools/travel-reminder-zh.png`
- `public/network-tools/journey-maps-overview-zh.png`
- `public/network-tools/journey-map-a-zh.png`
- `public/network-tools/journey-map-b-zh.png`
- `public/network-tools/journey-map-c-zh.png`
- `public/network-tools/journey-map-d-zh.png`

**Interfaces:**
- Consumes Spec §8.2 精确 19 文件，来源仅同级 `care-in-farming-contact-release/public/project-assets/downloads/`（7 项）和 `images/`（12 项）。
- Produces 独立 `approvedResourceBytes: Record<exactPath,{bytes,sha256}>`；`resourceCatalog: Array<{id,path,title:{zh,en},purpose:{zh,en},language:'zh'|'en'|'bilingual',format,bytes,sha256,category,adaptation:{zh,en},sourceCredit:{zh,en}}>`；`assertApprovedResource(path,bytes:Uint8Array): void`。
- `auditNetworkTools({sourceRoot}): Promise<Array<{filename,bytes,sha256,status:'review-required'|'excluded',findings:string[]}>>` 是技术扫描报告，不会自动 approve。`docs/tool-resource-review.json` 记录逐项人工内容审查后的 accepted/excluded、原因、大小摘要与审查日期；目录不能自我批准，approval 常量只能依据人工审查变更。

- [ ] **1. 写 `binary approval rejects a replacement even if catalog is edited`、`hidden response/comment/embedded object requires review`、`catalog labels actual original language and exact bytes`。** 使用仅虚构的 Office/PDF/PNG fixtures，不生成真实研究记录；断言：
  ```js
  assert.throws(() => assertApprovedResource(path, changedBytes), /RESOURCE_NOT_APPROVED/);
  assert.equal(auditWithHiddenAnswers.status, 'review-required');
  assert.equal(catalogEntry.language, 'zh'); assert.equal(catalogEntry.format, 'PNG');
  assert.equal(catalogEntry.bytes, originalBytes.length);
  assert.deepEqual(copiedBytes, originalBytes);
  ```
- [ ] **2. RED：** `node --test tests/network-tools-audit.test.mjs tests/network-tools-catalog.test.mjs`；缺 approval/catalog/audit 接口失败。
- [ ] **3. 实现审查脚本，读取对应文件技能后逐项人工核验。** Office 检正文/表格/属性/修订/批注/隐藏表页/嵌入对象/宏/外部引用；PDF 检正文与附加内容；12 PNG 逐张看可见个人资料。记录第三方来源权利与本地适用性，不能把打开成功当隐私审查。合格项原字节复制到精确目录、填写独立 approval 和共用 catalog；不合格项不复制、不清理，报告用户提供公开版或批准后续清理。任何缺少可靠再使用依据的项标记待确认，不宣布已公开授权。用原始 bytes 重新计算 source/destination SHA-256 相等；不纳入报告/政策/伦理/数据 workbook。
- [ ] **4. GREEN：** 步骤 2；逐项审查表必须 19 行、所有 accepted 文件 hash/bytes 一致；有 excluded 可以交付安全子集，但报告确切缺项，不能声称全套已完成。原件、本地电话/公交/120、复合路径的说明按 Spec 保留。
- [ ] **5. 提交：** 显式 add Files 和审核通过的确切资源路径；commit `feat: package audited original network tools with separate reuse notices`。不得 git add 整个来源目录。

### Task 8: 工具页、精确静态下载和发布清单

**Files:** Create `src/farm-support/ToolsPage.jsx`、`tests/network-tools-routes.test.mjs`；Modify `src/BackendApp.jsx`、`src/farm-support/styles.css`、`server/farm-support/static.mjs`、`scripts/check-release.mjs`、`scripts/source-manifest.mjs`、`.gitattributes`、`tests/production-http.test.mjs`、`tests/template-source.test.mjs`、`tests/template-release.test.mjs`、`tests/release.test.mjs`、`tests/template-render.test.mjs`。

**Interfaces:**
- Consumes Task 7 approval/catalog/assertApprovedResource；Task 5 字典/LocaleProvider。
- Produces `ToolsPage({locale})`；`serveProductionClient(req,res,clientDir): boolean` 保留签名，新增 exact `/zh/tools/` `/en/tools/` 与已审批 `/network-tools/<filename>`。
- `createSourceManifest(root)` 新 schemaVersion=2，files 每项 `{path,bytes,sha256,normalization:'UTF-8 LF'|'raw'}`；`verifySourceManifest(root): boolean` 不变。`inspectRelease({root,artifactRoot})`、`listReleaseFiles(root)`、`inspectGitHistory(root)` 保留签名，对每个获准 binary 先 exact path/bytes/hash，再禁止其他路径/凭证。

- [ ] **1. 写 `public tools have bilingual labels but no private registry data`、`static downloads reject traversal symlinks and modified bytes`、`binary manifest preserves original bytes while text normalizes LF`。** 断言：
  ```js
  assert.equal(toolPage.status, 200); assert.match(englishPage, /Chinese original/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(unapprovedDownload.status, 404);
  assert.equal(binaryEntry.normalization, 'raw'); assert.equal(binaryEntry.bytes, fileBytes.length);
  assert.equal(release.inspectRelease({root: tamperedTree}).ok, false);
  ```
  同时测 HEAD 空 body、准确 MIME、未登录可下载但 workspace 401；Office 文档超通用 4MiB 只给确切 toolkit 20,434,159 字节例外；错误 hash/未知同扩展/填入 CSV/宏/私人旧历史仍拒绝，来源公开 URL 只在被审原件/必要署名中准入。
- [ ] **2. RED：** `node --test tests/network-tools-routes.test.mjs tests/template-release.test.mjs tests/template-source.test.mjs tests/release.test.mjs`；旧静态路由和文本-only 白名单失败。
- [ ] **3. 实现只读两页和有限文件服务。** 每卡名称/用途/实际语言/格式/由 bytes 格式化大小/下载/本地改编提醒，英语不是英文文件；不用 JS 导入大二进制。精确 static route/path+symlink/遍历保护，保持已有 GET/HEAD/no-store/security headers。release 只扩展指定 resources、审计/使用说明、spec/plan 文档白名单；保留 repo/history/secret扫描，禁止 original privatebackend/email 链接。`.gitattributes` 办公/PDF/PNG binary；文本按原规则 LF，raw hash 在源码和产物双重验证。
- [ ] **4. GREEN：** 步骤 2，加 `node --test tests/production-http.test.mjs tests/template-render.test.mjs`；生成新版 source-manifest 后验证，但最终全包/历史验收在任务 9。
- [ ] **5. 提交：** 显式 add Files 及生成的 `docs/source-manifest.json`；commit `feat: serve audited bilingual tools with binary-safe release guards`。

### Task 9: 完整回归、真实浏览器检查和本地交付

**Files:** Create `tests/network-acceptance.test.mjs`、`scripts/check-network-preview.mjs`、`docs/network-acceptance.md`；Modify `README.md`、`README.en.md`、`docs/quick-start.md`、`docs/api.md`、`docs/data-fields.md`、`docs/operations.md`、`docs/identity-operations.md`、`docs/deployment.md`、`.github/workflows/ci.yml`、`scripts/check-release.mjs`、`docs/source-manifest.json`。仓库外 artifacts：`C:/Users/Mike/Documents/Codex/2026-09-06/product-design-plugin-product-design-openai/outputs/open-source-template/network-bilingual/`。

**Interfaces:**
- Consumes Tasks 1–8 的 API、UI、catalog 与释放清单；现有 `node tests/configured-suite.mjs` 在独立临时副本验证单村/三村；当前 demo 使用虚构资料、独立临时库。
- Produces `checkNetworkPreview({locale,width,scrollWidth,viewportWidth,brokenLinks,consoleErrors,focusChecks}): {ok:boolean,violations:string[]}`；这是检查实际浏览器测量值的纯函数，不自行控制浏览器。真实预览先读取 computer-use 技能及当前浏览器文档，使用产品浏览器工具，不另建未经允许的自动化表面。`docs/network-acceptance.md` 记录确切环境、命令退出码、样本审查、截图路径与待验项，不记录演示密码/邀请码。

- [ ] **1. 写 `bilingual network acceptance retains private and lifecycle safeguards`：** 用前述已导出的接口集成完整虚构 add-village/invite/activate/MFA/rename/pause/safe-end 场景，assert root/manager/ordinary roles 的最终 scopes；测试 tools 与 private API 隔离。preview helper 使用测量值仿真，不以仿真代替目视检查：
  ```js
  assert.equal(checkNetworkPreview({locale:'en',width:375,viewportWidth:375,scrollWidth:390,brokenLinks:[],consoleErrors:[],focusChecks:{pass:true}}).ok, false);
  assert.equal(checkNetworkPreview({locale:'zh',width:375,viewportWidth:375,scrollWidth:375,brokenLinks:[],consoleErrors:[],focusChecks:{pass:true}}).ok, true);
  ```
- [ ] **2. RED：** `node --test tests/network-acceptance.test.mjs`；缺 preview helper 或尚未连接的全链路验收断言失败。
- [ ] **3. 完成验收脚本、说明文档和 CI 验证步骤。** CI 不添加部署/付费/上传步骤，保留准确 Node/pnpm 与现有受限 Linux 容器恢复检查。说明应用账户不等于 ChatGPT 账号、没有公众注册、托管和备份责任、工具权利区别/地方性改编；检查源码实际工具/路由与文档一致。读取 Sites 本地预览说明后仅启动独立 demo，不停止未知进程；已知自建旧 demo 可按其 session 停止。
- [ ] **4. GREEN + 自动验证（分别执行，保存完整日志，不串接分隔命令）：**
  - `node --test tests/network-acceptance.test.mjs`
  - `node --import ./tests/cross-village-setup.mjs --test tests/*.test.mjs tests/farm-support/*.test.mjs`
  - `node scripts/source-manifest.mjs`
  - `node tests/configured-suite.mjs`
  - `pnpm build`（Vite configLoader runner）
  - `pnpm check:release`
  - `git diff --check`
  预期各 exit 0、tests fail 0；不借用旧 202/202 日志。首先确认 node/pnpm 路径版本；若只能使用 bundled pnpm 11.25，写明差异并保留 11.19.0 待验证，不能谎报锁定环境。
- [ ] **5. 真实浏览器 QA 并记 evidence。** Desktop 1440 与 375px，各检查 zh/en 登录/MFA/工作台/村管理/工具/指南/打印；无横向溢出，44px，Tab/Enter/对话框 Escape 和返回焦点，labels/live-region、reduced-motion、控制台、下载 MIME/bytes/hash、切语言保留草稿与退出清理。写明读屏是标签检查还是实际读屏器测试；截图 desktop-zh/en、mobile375-zh/en，不截密码/激活 token/验证器密钥/恢复码。真实 Linux 挂载/资源预算/恢复演练未跑则标记未验，不采用 verifiedMount=true 结论替代。
- [ ] **6. 提交并生成可复核独立包。** 先只提交本任务文件（commit `test: verify bilingual network village management and audited tool delivery`），更新 manifest 后再验 release。以通过 `listReleaseFiles` 的精确文件集合打包 ZIP，校验解压后的条目/sha256/bytes 与 manifest 对应；不打包 .git、node_modules、dist、日志、runtime、备份、私人资料。仅 artifacts 使用生成脚本写 ZIP，打包期间任何源码改动需重做 manifest/验证。
- [ ] **7. 交付并报告实际边界。** 给中文/英文管理及 tools 本地链接、截图、改动清单、审核 19 项结果与未纳入原因、测试/构建统计、ZIP/hash、使用说明。正式主站和 backend HEAD/工作树状态与实施前对比，确认未触及；公开 GitHub、部署、正式迁移与真实数据接入另等用户明确批准。

## 计划自查与确认点

- Spec §1–3/范围：全局边界和 Task 9；§4 权限：Tasks 3–4/6；§5 注册表：Tasks 1–3；§6 升级恢复：Tasks 2–4；§7 双语：Tasks 5–6；§8–9 工具/发布：Tasks 7–8；§10 指南：Task 6/9；§11 验收：Task 9。
- 五项 Review Focus 各有命名失败测试；没有仅靠隐藏按钮、人数范围、cookie 旧角色或删除配置检查授权。
- Task 1 Village、Task 3 Grant/commands、Task 5 locale、Task 7 catalog/approval、Task 8 manifest 的接口在所有后续任务保持同名；不存在未定义的跨任务函数引用。
- 候选资源尚未内容审查；不提前承诺全 19 项安全/可再许可。正式部署、Linux 运营验收、GitHub 发布没有被安排为本轮动作。
- 这是待用户书面核对的实施计划，不是功能完成报告。批准后保持 Native，由当前会话依序实施，无需再次选择模式。
